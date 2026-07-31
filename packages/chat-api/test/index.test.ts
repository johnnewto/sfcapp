import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index.ts";
import { getBundledNotebookAssistantPrompt } from "../src/notebookAssistantPrompt.ts";

const env = {
  ALLOWED_ORIGINS: "https://johnnewto.github.io",
  DISCOVERY_ALLOWED_ORIGINS: "https://johnnewto.github.io",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL_ALLOWLIST: "gpt-5.5"
};

describe("notebook assistant system prompt", () => {
  it("keeps the global assistant Ask-only and points edits to cell Ask AI", () => {
    const prompt = getBundledNotebookAssistantPrompt();
    expect(prompt).toContain("Ask-only");
    expect(prompt).toContain("Ask AI on the relevant chart cell or equation row");
    expect(prompt).toContain("chart-update");
    expect(prompt).toContain("equation-update");
    expect(prompt).not.toMatch(/Switch to Edit mode to prepare a patch/);
  });
});

describe("chat API notebook share shortening", () => {
  it("rejects shorten requests without SHARE_LINKS", async () => {
    const response = await worker.fetch(
      createShareShortenRequest("https://johnnewto.github.io/moneyjs/notebook?nbz=abc"),
      env
    );

    await expect(response.json()).resolves.toEqual({ error: "SHARE_LINKS is not configured." });
    expect(response.status).toBe(503);
  });

  it("rejects shorten requests for non-notebook URLs", async () => {
    const response = await worker.fetch(createShareShortenRequest("https://johnnewto.github.io/moneyjs/"), {
      ...env,
      SHARE_LINKS: createMemoryKv()
    });

    await expect(response.json()).resolves.toEqual({ error: "url must target a notebook share route." });
    expect(response.status).toBe(400);
  });

  it("accepts hash-based notebook share URLs", async () => {
    const longUrl = "https://johnnewto.github.io/moneyjs/#/notebook?nbz=compressed";
    const shareLinks = createMemoryKv();
    const response = await worker.fetch(createShareShortenRequest(longUrl), {
      ...env,
      SHARE_LINKS: shareLinks
    });

    const payload = (await response.json()) as { shortUrl?: string };
    expect(response.status).toBe(200);
    expect(payload.shortUrl).toMatch(/^https:\/\/sfcr-chat-api\.example\/s\/[A-Za-z0-9]{8}$/);

    const code = payload.shortUrl!.split("/").pop()!;
    const stored = JSON.parse((await shareLinks.get(code))!) as { url: string };
    expect(stored.url).toBe(longUrl);
  });

  it("returns a short link for valid notebook share URLs and stores the long URL", async () => {
    const longUrl = "https://johnnewto.github.io/moneyjs/notebook?nbz=compressed";
    const shareLinks = createMemoryKv();
    const response = await worker.fetch(createShareShortenRequest(longUrl), {
      ...env,
      SHARE_LINKS: shareLinks
    });

    const payload = (await response.json()) as { shortUrl?: string };
    expect(response.status).toBe(200);
    expect(payload.shortUrl).toMatch(/^https:\/\/sfcr-chat-api\.example\/s\/[A-Za-z0-9]{8}$/);

    const code = payload.shortUrl!.split("/").pop()!;
    const stored = JSON.parse((await shareLinks.get(code))!) as { url: string; createdAt: string };
    expect(stored.url).toBe(longUrl);
    expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts publish-view share URLs", async () => {
    const longUrl = "https://johnnewto.github.io/moneyjs/publish/live#?nbz=compressed";
    const shareLinks = createMemoryKv();
    const response = await worker.fetch(createShareShortenRequest(longUrl), {
      ...env,
      SHARE_LINKS: shareLinks
    });

    const payload = (await response.json()) as { shortUrl?: string };
    expect(response.status).toBe(200);
    expect(payload.shortUrl).toMatch(/^https:\/\/sfcr-chat-api\.example\/s\/[A-Za-z0-9]{8}$/);

    const code = payload.shortUrl!.split("/").pop()!;
    const stored = JSON.parse((await shareLinks.get(code))!) as { url: string };
    expect(stored.url).toBe(longUrl);
  });

  it("uses SHORT_LINK_BASE_URL when configured", async () => {
    const longUrl = "https://johnnewto.github.io/moneyjs/notebook?nbz=compressed";
    const response = await worker.fetch(createShareShortenRequest(longUrl), {
      ...env,
      SHARE_LINKS: createMemoryKv(),
      SHORT_LINK_BASE_URL: "https://mjs.example/"
    });

    const payload = (await response.json()) as { shortUrl?: string };
    expect(response.status).toBe(200);
    expect(payload.shortUrl).toMatch(/^https:\/\/mjs\.example\/s\/[A-Za-z0-9]{8}$/);
  });

  it("redirects GET /s/:code to the stored long URL", async () => {
    const longUrl = "https://johnnewto.github.io/moneyjs/notebook?nbz=compressed";
    const shareLinks = createMemoryKv();
    const shortenResponse = await worker.fetch(createShareShortenRequest(longUrl), {
      ...env,
      SHARE_LINKS: shareLinks
    });
    const { shortUrl } = (await shortenResponse.json()) as { shortUrl: string };
    const code = shortUrl.split("/").pop()!;

    const redirectResponse = await worker.fetch(new Request(`https://sfcr-chat-api.example/s/${code}`), {
      ...env,
      SHARE_LINKS: shareLinks
    });

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("Location")).toBe(longUrl);
  });

  it("returns 404 for unknown short codes", async () => {
    const response = await worker.fetch(new Request("https://sfcr-chat-api.example/s/abcdefgh"), {
      ...env,
      SHARE_LINKS: createMemoryKv()
    });

    await expect(response.json()).resolves.toEqual({ error: "Short link not found." });
    expect(response.status).toBe(404);
  });
});

describe("chat API discovery resources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects draft requests with untrusted discovery origins", async () => {
    const response = await worker.fetch(createDraftRequest("https://example.com/.well-known/sfcr.json"), env);

    await expect(response.json()).resolves.toEqual({ error: "discoveryUrl origin is not allowed." });
    expect(response.status).toBe(400);
  });

  it("rejects untrusted resource origins inside trusted discovery documents", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          resources: {
            notebooks: {
              guide: "../notebook-guide.md",
              manifest: "https://example.com/sfcr-notebook-guide.json",
              prompt: "../ai-prompts/create-sfcr-notebook.md",
              schema: "../sfcr-notebook.schema.json"
            }
          }
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(createDraftRequest("https://johnnewto.github.io/.well-known/sfcr.json"), env);

    await expect(response.json()).resolves.toEqual({ error: "SFCR discovery resource origin is not allowed." });
    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function createMemoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    }
  };
}

function createDraftRequest(discoveryUrl: string): Request {
  return new Request("https://sfcr-chat-api.example/v1/chat-builder/draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://johnnewto.github.io"
    },
    body: JSON.stringify({
      discoveryUrl,
      messages: [],
      model: "gpt-5.5",
      prompt: "Build a notebook."
    })
  });
}

function createShareShortenRequest(url: string): Request {
  return new Request("https://sfcr-chat-api.example/v1/notebook-share/shorten", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://johnnewto.github.io"
    },
    body: JSON.stringify({ url })
  });
}
