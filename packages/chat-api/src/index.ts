import { getBundledChatBuilderSystemPrompt } from "./chatBuilderSystemPrompt.ts";
import { getBundledNotebookAssistantPrompt } from "./notebookAssistantPrompt.ts";

interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  ALLOWED_ORIGINS?: string;
  BETA_PASSWORD?: string;
  CHAT_BUILDER_SYSTEM_PROMPT?: string | (() => string | Promise<string>);
  CHAT_BUILDER_RATE_LIMITER?: RateLimitBinding;
  DISCOVERY_ALLOWED_ORIGINS?: string;
  MAX_OUTPUT_TOKENS?: string;
  NOTEBOOK_ASSISTANT_SYSTEM_PROMPT?: string | (() => string | Promise<string>);
  OPENAI_API_KEY?: string;
  OPENAI_MODEL_ALLOWLIST?: string;
  SHARE_LINKS?: KvNamespaceLike;
  SHORT_LINK_BASE_URL?: string;
}

interface ShareLinkRecord {
  createdAt: string;
  url: string;
}

interface CacheStorageWithDefault extends CacheStorage {
  default?: Cache;
}

interface RateLimitBinding {
  limit(args: { key: string }): Promise<{ success: boolean }>;
}

interface ChatMessage {
  role: "assistant" | "user";
  text: string;
}

interface ChatDraftRequest {
  betaPassword?: unknown;
  discoveryUrl?: unknown;
  messages?: unknown;
  model?: unknown;
  prompt?: unknown;
}

interface NotebookAssistantRequest {
  betaPassword?: unknown;
  context?: unknown;
  messages?: unknown;
  model?: unknown;
  question?: unknown;
}

interface NotebookShareShortenRequest {
  url?: unknown;
}

interface SfcrDiscoveryIndex {
  resources?: {
    notebooks?: {
      examples?: Array<{ id?: string; url?: string }>;
      guide?: string;
      manifest?: string;
      prompt?: string;
      schema?: string;
    };
  };
}

interface SfcrNotebookManifest {
  examples?: Array<{ id?: string; label?: string; url?: string }>;
  guideUrl?: string;
  promptUrl?: string;
  schemaUrl?: string;
}

const DEFAULT_ALLOWED_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1", "gpt-5.5", "o3"];
const DEFAULT_DISCOVERY_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "https://johnnewto.github.io",
  "https://sfcapp.pages.dev",
  "https://moneyjs.pages.dev"
];
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DISCOVERY_CACHE_TTL_SECONDS = 600;
const MAX_DISCOVERY_BUNDLE_LENGTH = 1_000_000;
const MAX_DISCOVERY_EXAMPLES = 5;
const MAX_DISCOVERY_RESOURCE_LENGTH = 250_000;
const MAX_PROMPT_LENGTH = 12000;
const MAX_MESSAGE_COUNT = 12;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_NOTEBOOK_SHARE_URL_LENGTH = 128_000;
const MAX_SHARE_CODE_ATTEMPTS = 8;
const NOTEBOOK_SHARE_QUERY_PARAM = "nbz";
const SHARE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SHARE_CODE_LENGTH = 8;
const SHARE_REDIRECT_PATH = /^\/s\/([A-Za-z0-9]{8})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shareRedirectMatch = SHARE_REDIRECT_PATH.exec(url.pathname);
  if (shareRedirectMatch) {
    return handleShareRedirect(request, env, shareRedirectMatch[1]!, corsHeaders);
  }

  if (url.pathname === "/v1/notebook-assistant/ask") {
    return handleNotebookAssistantRequest(request, env, corsHeaders);
  }

  if (url.pathname === "/v1/notebook-share/shorten") {
    return handleNotebookShareShortenRequest(request, env, corsHeaders);
  }

  if (url.pathname !== "/v1/chat-builder/draft") {
    return jsonResponse({ error: "Not found." }, 404, corsHeaders);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!corsHeaders["Access-Control-Allow-Origin"]) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, corsHeaders);
  }

  let payload: ChatDraftRequest;
  try {
    payload = (await request.json()) as ChatDraftRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400, corsHeaders);
  }

  if (!isBetaPasswordAllowed(payload, env)) {
    return jsonResponse({ error: "Beta password is required." }, 403, corsHeaders);
  }

  const rateLimitResponse = await enforceChatBuilderRateLimit(request, env, corsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500, corsHeaders);
  }

  const validation = validateDraftRequest(payload, env);
  if ("error" in validation) {
    return jsonResponse({ error: validation.error }, 400, corsHeaders);
  }

  try {
    const systemPrompt = await resolveChatBuilderSystemPrompt(env);
    const resourceBundle = await loadChatBuilderResourceBundle(validation.discoveryUrl, env);
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: validation.model,
        max_output_tokens: resolveMaxOutputTokens(env),
        store: false,
        stream: true,
        instructions: `${systemPrompt.trim()}\n\n${resourceBundle}`,
        input: [
          ...validation.messages.map((message) => ({
            role: message.role,
            content: message.text
          })),
          {
            role: "user",
            content: validation.prompt
          }
        ]
      })
    });

    if (!openAiResponse.ok || !openAiResponse.body) {
      return jsonResponse(
        { error: await readOpenAiError(openAiResponse) },
        openAiResponse.status || 502,
        corsHeaders
      );
    }

    return new Response(openAiResponse.body, {
      status: openAiResponse.status,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": openAiResponse.headers.get("Content-Type") ?? "text/event-stream; charset=utf-8"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create chat draft.";
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
}

async function handleNotebookShareShortenRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!corsHeaders["Access-Control-Allow-Origin"]) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, corsHeaders);
  }

  const rateLimitResponse = await enforceChatBuilderRateLimit(request, env, corsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!env.SHARE_LINKS) {
    return jsonResponse({ error: "SHARE_LINKS is not configured." }, 503, corsHeaders);
  }

  let payload: NotebookShareShortenRequest;
  try {
    payload = (await request.json()) as NotebookShareShortenRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400, corsHeaders);
  }

  const validation = validateNotebookShareShortenRequest(payload, env);
  if ("error" in validation) {
    return jsonResponse({ error: validation.error }, 400, corsHeaders);
  }

  try {
    const code = await mintShareCode(env.SHARE_LINKS, validation.url);
    if (!code) {
      return jsonResponse({ error: "Unable to allocate a short link code." }, 500, corsHeaders);
    }

    const shortUrl = `${resolveShortLinkBase(request, env)}/s/${code}`;
    return jsonResponse({ shortUrl }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to shorten notebook share URL.";
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
}

async function handleShareRedirect(
  request: Request,
  env: Env,
  code: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!env.SHARE_LINKS) {
    return jsonResponse({ error: "SHARE_LINKS is not configured." }, 503, corsHeaders);
  }

  try {
    const stored = await env.SHARE_LINKS.get(code);
    if (!stored) {
      return jsonResponse({ error: "Short link not found." }, 404, corsHeaders);
    }

    const record = parseShareLinkRecord(stored);
    if (!record) {
      return jsonResponse({ error: "Short link is invalid." }, 500, corsHeaders);
    }

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        Location: record.url
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve short link.";
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
}

async function mintShareCode(store: KvNamespaceLike, longUrl: string): Promise<string | null> {
  const record: ShareLinkRecord = {
    createdAt: new Date().toISOString(),
    url: longUrl
  };
  const value = JSON.stringify(record);

  for (let attempt = 0; attempt < MAX_SHARE_CODE_ATTEMPTS; attempt += 1) {
    const code = createShareCode();
    const existing = await store.get(code);
    if (existing !== null) {
      continue;
    }

    await store.put(code, value);
    return code;
  }

  return null;
}

function createShareCode(): string {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length]!;
  }
  return code;
}

function resolveShortLinkBase(request: Request, env: Env): string {
  const configured = env.SHORT_LINK_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  return new URL(request.url).origin;
}

function parseShareLinkRecord(stored: string): ShareLinkRecord | null {
  try {
    const parsed = JSON.parse(stored) as Partial<ShareLinkRecord>;
    if (typeof parsed.url !== "string" || parsed.url.trim() === "") {
      return null;
    }

    return {
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      url: parsed.url
    };
  } catch {
    return null;
  }
}

async function handleNotebookAssistantRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }

  if (!corsHeaders["Access-Control-Allow-Origin"]) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, corsHeaders);
  }

  let payload: NotebookAssistantRequest;
  try {
    payload = (await request.json()) as NotebookAssistantRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400, corsHeaders);
  }

  if (!isBetaPasswordAllowed(payload, env)) {
    return jsonResponse({ error: "Beta password is required." }, 403, corsHeaders);
  }

  const rateLimitResponse = await enforceChatBuilderRateLimit(request, env, corsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500, corsHeaders);
  }

  const validation = validateNotebookAssistantRequest(payload, env);
  if ("error" in validation) {
    return jsonResponse({ error: validation.error }, 400, corsHeaders);
  }

  try {
    const systemPrompt = await resolveNotebookAssistantSystemPrompt(env);
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: validation.model,
        max_output_tokens: Math.min(resolveMaxOutputTokens(env), 3000),
        store: false,
        stream: true,
        instructions: systemPrompt,
        input: [
          ...validation.messages.map((message) => ({
            role: message.role,
            content: message.text
          })),
          {
            role: "user",
            content: `Notebook context:\n${validation.context}\n\nQuestion:\n${validation.question}`
          }
        ]
      })
    });

    if (!openAiResponse.ok || !openAiResponse.body) {
      return jsonResponse(
        { error: await readOpenAiError(openAiResponse) },
        openAiResponse.status || 502,
        corsHeaders
      );
    }

    return new Response(openAiResponse.body, {
      status: openAiResponse.status,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": openAiResponse.headers.get("Content-Type") ?? "text/event-stream; charset=utf-8"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to answer notebook question.";
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
}

function isBetaPasswordAllowed(payload: ChatDraftRequest, env: Env): boolean {
  const configuredPassword = env.BETA_PASSWORD?.trim();
  if (!configuredPassword) {
    return true;
  }

  return typeof payload.betaPassword === "string" && payload.betaPassword === configuredPassword;
}

async function enforceChatBuilderRateLimit(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!env.CHAT_BUILDER_RATE_LIMITER) {
    return null;
  }

  const key =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("Origin") ??
    "anonymous";
  const { success } = await env.CHAT_BUILDER_RATE_LIMITER.limit({ key });
  if (success) {
    return null;
  }

  return jsonResponse({ error: "Rate limit exceeded. Please wait before trying again." }, 429, {
    ...corsHeaders,
    "Retry-After": "60"
  });
}

function resolveMaxOutputTokens(env: Env): number {
  const configured = Number(env.MAX_OUTPUT_TOKENS);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_MAX_OUTPUT_TOKENS;
}

async function resolveChatBuilderSystemPrompt(env: Env): Promise<string> {
  if (typeof env.CHAT_BUILDER_SYSTEM_PROMPT === "function") {
    const prompt = await env.CHAT_BUILDER_SYSTEM_PROMPT();
    if (prompt.trim() !== "") {
      return prompt;
    }
  }

  if (typeof env.CHAT_BUILDER_SYSTEM_PROMPT === "string" && env.CHAT_BUILDER_SYSTEM_PROMPT.trim() !== "") {
    return env.CHAT_BUILDER_SYSTEM_PROMPT;
  }

  return getBundledChatBuilderSystemPrompt();
}

async function resolveNotebookAssistantSystemPrompt(env: Env): Promise<string> {
  if (typeof env.NOTEBOOK_ASSISTANT_SYSTEM_PROMPT === "function") {
    const prompt = await env.NOTEBOOK_ASSISTANT_SYSTEM_PROMPT();
    if (prompt.trim() !== "") {
      return prompt;
    }
  }

  if (
    typeof env.NOTEBOOK_ASSISTANT_SYSTEM_PROMPT === "string" &&
    env.NOTEBOOK_ASSISTANT_SYSTEM_PROMPT.trim() !== ""
  ) {
    return env.NOTEBOOK_ASSISTANT_SYSTEM_PROMPT;
  }

  return getBundledNotebookAssistantPrompt();
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigins = parseList(env.ALLOWED_ORIGINS);
  const allowAnyOrigin = allowedOrigins.length === 0;
  const allowedOrigin = allowAnyOrigin || allowedOrigins.includes(origin) ? origin : "";

  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Vary": "Origin"
  };
}

function isDiscoveryOriginAllowed(discoveryUrl: URL, env: Env): boolean {
  const allowedOrigins = resolveDiscoveryAllowedOrigins(env);
  return allowedOrigins.includes(discoveryUrl.origin);
}

function assertDiscoveryResourceOriginAllowed(resourceUrl: string, env: Env): void {
  const url = new URL(resourceUrl);
  if (!isDiscoveryOriginAllowed(url, env)) {
    throw new Error("SFCR discovery resource origin is not allowed.");
  }
}

function resolveDiscoveryAllowedOrigins(env: Env): string[] {
  const configuredDiscoveryOrigins = parseList(env.DISCOVERY_ALLOWED_ORIGINS).map(normalizeOrigin).filter(isString);
  if (configuredDiscoveryOrigins.length > 0) {
    return configuredDiscoveryOrigins;
  }

  const configuredBrowserOrigins = parseList(env.ALLOWED_ORIGINS).map(normalizeOrigin).filter(isString);
  if (configuredBrowserOrigins.length > 0) {
    return configuredBrowserOrigins;
  }

  return DEFAULT_DISCOVERY_ALLOWED_ORIGINS;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function validateDraftRequest(
  payload: ChatDraftRequest,
  env: Env
):
  | {
      discoveryUrl: string;
      messages: ChatMessage[];
      model: string;
      prompt: string;
    }
  | { error: string } {
  if (typeof payload.model !== "string" || payload.model.trim() === "") {
    return { error: "model is required." };
  }

  const model = payload.model.trim();
  const allowedModels = parseList(env.OPENAI_MODEL_ALLOWLIST);
  const modelAllowlist = allowedModels.length > 0 ? allowedModels : DEFAULT_ALLOWED_MODELS;
  if (!modelAllowlist.includes(model)) {
    return { error: "model is not allowed." };
  }

  if (typeof payload.prompt !== "string" || payload.prompt.trim() === "") {
    return { error: "prompt is required." };
  }

  const prompt = payload.prompt.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` };
  }

  if (typeof payload.discoveryUrl !== "string" || payload.discoveryUrl.trim() === "") {
    return { error: "discoveryUrl is required." };
  }

  let discoveryUrl: URL;
  try {
    discoveryUrl = new URL(payload.discoveryUrl);
  } catch {
    return { error: "discoveryUrl must be a valid URL." };
  }

  if (!["http:", "https:"].includes(discoveryUrl.protocol)) {
    return { error: "discoveryUrl must use http or https." };
  }

  if (!isDiscoveryOriginAllowed(discoveryUrl, env)) {
    return { error: "discoveryUrl origin is not allowed." };
  }

  if (!Array.isArray(payload.messages)) {
    return { error: "messages must be an array." };
  }

  if (payload.messages.length > MAX_MESSAGE_COUNT) {
    return { error: `messages must include ${MAX_MESSAGE_COUNT} items or fewer.` };
  }

  const messages: ChatMessage[] = [];
  for (const message of payload.messages) {
    if (!isRecord(message)) {
      return { error: "messages must contain objects." };
    }
    if (message.role !== "assistant" && message.role !== "user") {
      return { error: "message role must be assistant or user." };
    }
    if (typeof message.text !== "string") {
      return { error: "message text must be a string." };
    }
    if (message.text.length > MAX_MESSAGE_LENGTH) {
      return { error: `message text must be ${MAX_MESSAGE_LENGTH} characters or fewer.` };
    }
    messages.push({ role: message.role, text: message.text });
  }

  return {
    discoveryUrl: discoveryUrl.toString(),
    messages,
    model,
    prompt
  };
}

function validateNotebookShareShortenRequest(
  payload: NotebookShareShortenRequest,
  env: Env
): { url: string } | { error: string } {
  if (typeof payload.url !== "string" || payload.url.trim() === "") {
    return { error: "url is required." };
  }

  const urlText = payload.url.trim();
  if (urlText.length > MAX_NOTEBOOK_SHARE_URL_LENGTH) {
    return { error: `url must be ${MAX_NOTEBOOK_SHARE_URL_LENGTH} characters or fewer.` };
  }

  let shareUrl: URL;
  try {
    shareUrl = new URL(urlText);
  } catch {
    return { error: "url must be a valid URL." };
  }

  if (!["http:", "https:"].includes(shareUrl.protocol)) {
    return { error: "url must use http or https." };
  }

  if (!isNotebookShareOriginAllowed(shareUrl, env)) {
    return { error: "url origin is not allowed." };
  }

  if (!isNotebookShareRouteUrl(shareUrl)) {
    return { error: "url must target a notebook share route." };
  }

  if (!readNotebookShareParams(shareUrl)?.has(NOTEBOOK_SHARE_QUERY_PARAM)) {
    return { error: `url must include the ${NOTEBOOK_SHARE_QUERY_PARAM} query parameter.` };
  }

  return { url: shareUrl.toString() };
}

function isNotebookShareRouteUrl(shareUrl: URL): boolean {
  if (shareUrl.pathname.includes("/notebook") || shareUrl.pathname.includes("/publish")) {
    return true;
  }

  return /^#\/notebook(\?|$)/.test(shareUrl.hash);
}

function readNotebookShareParams(shareUrl: URL): URLSearchParams | null {
  if (shareUrl.searchParams.has(NOTEBOOK_SHARE_QUERY_PARAM)) {
    return shareUrl.searchParams;
  }

  const queryIndex = shareUrl.hash.indexOf("?");
  if (queryIndex === -1) {
    return null;
  }

  const params = new URLSearchParams(shareUrl.hash.slice(queryIndex + 1));
  return params.has(NOTEBOOK_SHARE_QUERY_PARAM) ? params : null;
}

function isNotebookShareOriginAllowed(shareUrl: URL, env: Env): boolean {
  const allowedOrigins = resolveDiscoveryAllowedOrigins(env);
  return allowedOrigins.includes(shareUrl.origin);
}

function validateNotebookAssistantRequest(
  payload: NotebookAssistantRequest,
  env: Env
):
  | {
      context: string;
      messages: ChatMessage[];
      model: string;
      question: string;
    }
  | { error: string } {
  if (typeof payload.model !== "string" || payload.model.trim() === "") {
    return { error: "model is required." };
  }

  const model = payload.model.trim();
  const allowedModels = parseList(env.OPENAI_MODEL_ALLOWLIST);
  const modelAllowlist = allowedModels.length > 0 ? allowedModels : DEFAULT_ALLOWED_MODELS;
  if (!modelAllowlist.includes(model)) {
    return { error: "model is not allowed." };
  }

  if (typeof payload.question !== "string" || payload.question.trim() === "") {
    return { error: "question is required." };
  }

  const question = payload.question.trim();
  if (question.length > MAX_PROMPT_LENGTH) {
    return { error: `question must be ${MAX_PROMPT_LENGTH} characters or fewer.` };
  }

  if (typeof payload.context !== "string" || payload.context.trim() === "") {
    return { error: "context is required." };
  }

  const context = payload.context.trim();
  if (context.length > 60000) {
    return { error: "context is too large." };
  }

  if (!Array.isArray(payload.messages)) {
    return { error: "messages must be an array." };
  }

  if (payload.messages.length > MAX_MESSAGE_COUNT) {
    return { error: `messages must include ${MAX_MESSAGE_COUNT} items or fewer.` };
  }

  const messages: ChatMessage[] = [];
  for (const message of payload.messages) {
    if (!isRecord(message)) {
      return { error: "messages must contain objects." };
    }
    if (message.role !== "assistant" && message.role !== "user") {
      return { error: "message role must be assistant or user." };
    }
    if (typeof message.text !== "string") {
      return { error: "message text must be a string." };
    }
    if (message.text.length > MAX_MESSAGE_LENGTH) {
      return { error: `message text must be ${MAX_MESSAGE_LENGTH} characters or fewer.` };
    }
    messages.push({ role: message.role, text: message.text });
  }

  return { context, messages, model, question };
}

async function loadChatBuilderResourceBundle(discoveryUrl: string, env: Env): Promise<string> {
  const discovery = await fetchJsonResource<SfcrDiscoveryIndex>(discoveryUrl);
  const notebookResources = discovery.resources?.notebooks;

  if (!notebookResources?.manifest || !notebookResources.guide || !notebookResources.schema || !notebookResources.prompt) {
    throw new Error("SFCR discovery index is missing notebook resources.");
  }

  const manifestUrl = resolveDocumentResourceUrl(discoveryUrl, notebookResources.manifest);
  const guideUrl = resolveDocumentResourceUrl(discoveryUrl, notebookResources.guide);
  const schemaUrl = resolveDocumentResourceUrl(discoveryUrl, notebookResources.schema);
  const promptUrl = resolveDocumentResourceUrl(discoveryUrl, notebookResources.prompt);
  [manifestUrl, guideUrl, schemaUrl, promptUrl].forEach((url) => assertDiscoveryResourceOriginAllowed(url, env));

  const notebookManifest = await fetchJsonResource<SfcrNotebookManifest>(manifestUrl);
  const exampleUrls = [
    ...(notebookManifest.examples
      ?.map((example) => (example.url ? resolveDocumentResourceUrl(manifestUrl, example.url) : null))
      .filter((url): url is string => Boolean(url)) ?? []),
    ...(notebookResources.examples
      ?.map((example) => (example.url ? resolveDocumentResourceUrl(discoveryUrl, example.url) : null))
      .filter((url): url is string => Boolean(url)) ?? [])
  ]
    .filter((url, index, all) => all.indexOf(url) === index)
    .filter((url) => {
      assertDiscoveryResourceOriginAllowed(url, env);
      return true;
    })
    .slice(0, MAX_DISCOVERY_EXAMPLES);

  const [guideText, schemaText, promptText, ...exampleTexts] = await Promise.all([
    fetchTextResource(guideUrl),
    fetchTextResource(schemaUrl),
    fetchTextResource(promptUrl),
    ...exampleUrls.map((url) => fetchTextResource(url))
  ]);

  const bundle = [
    "SFCR discovery bundle:",
    JSON.stringify(discovery, null, 2),
    "\nNotebook manifest:",
    JSON.stringify(notebookManifest, null, 2),
    "\nNotebook guide:",
    guideText,
    "\nNotebook schema:",
    schemaText,
    "\nNotebook generation prompt:",
    promptText,
    ...exampleTexts.map((exampleText, index) => `\nNotebook example ${index + 1}:\n${exampleText}`)
  ].join("\n");

  if (bundle.length > MAX_DISCOVERY_BUNDLE_LENGTH) {
    throw new Error("SFCR discovery bundle is too large.");
  }

  return bundle;
}

async function fetchJsonResource<T>(url: string): Promise<T> {
  const text = await fetchTextResource(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse ${url}`);
  }
}

async function fetchTextResource(url: string): Promise<string> {
  const cachedResponse = await readCachedResource(url);
  if (cachedResponse) {
    return readLimitedText(cachedResponse, url);
  }

  const response = await fetch(url, {
    cf: { cacheTtl: DISCOVERY_CACHE_TTL_SECONDS, cacheEverything: true }
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }

  await writeCachedResource(url, response.clone());
  return readLimitedText(response, url);
}

async function readCachedResource(url: string): Promise<Response | null> {
  const cache = getDefaultCache();
  if (!cache) {
    return null;
  }

  const response = await cache.match(url);
  return response && response.ok ? response : null;
}

async function writeCachedResource(url: string, response: Response): Promise<void> {
  const cache = getDefaultCache();
  if (!cache) {
    return;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${DISCOVERY_CACHE_TTL_SECONDS}`);
  await cache.put(url, new Response(response.body, { status: response.status, headers }));
}

function getDefaultCache(): Cache | null {
  const cacheStorage = globalThis.caches as CacheStorageWithDefault | undefined;
  return cacheStorage?.default ?? null;
}

async function readLimitedText(response: Response, url: string): Promise<string> {
  const contentLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DISCOVERY_RESOURCE_LENGTH) {
    throw new Error(`Fetched resource is too large: ${url}`);
  }

  const text = await response.text();
  if (text.length > MAX_DISCOVERY_RESOURCE_LENGTH) {
    throw new Error(`Fetched resource is too large: ${url}`);
  }

  return text;
}

function resolveDocumentResourceUrl(baseUrl: string, resourceUrl: string): string {
  try {
    return new URL(resourceUrl, baseUrl).toString();
  } catch {
    return resourceUrl;
  }
}

async function readOpenAiError(response: Response): Promise<string> {
  try {
    const error = (await response.json()) as { error?: { message?: string } };
    return error.error?.message ?? "OpenAI request failed.";
  } catch {
    return "OpenAI request failed.";
  }
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
