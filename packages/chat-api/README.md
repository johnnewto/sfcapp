# SFCR Chat API

Cloudflare Worker proxy for the in-notebook assistant, first-party notebook share shortening (KV), and offline notebook-draft eval harness. It keeps API keys out of the browser and streams model events back to clients.

Endpoints:

- `POST /v1/notebook-assistant/ask`: Q&A and safe edit proposals for the current notebook.
- `POST /v1/notebook-share/shorten`: shorten an SFCApp `nbz` share URL into `/s/:code` (requires `SHARE_LINKS` KV binding).
- `GET /s/:code`: redirect to the stored long SFCApp share URL.
- `POST /v1/chat-builder/draft`: generate a full notebook draft (used by the eval harness and API clients, not a browser route).

## Local Development

Use Node.js 22 or newer.

Create local secrets:

```bash
cp packages/chat-api/.dev.vars.example packages/chat-api/.dev.vars
```

Edit `packages/chat-api/.dev.vars` and set:

- `OPENAI_API_KEY` — in-notebook assistant
- `BETA_PASSWORD` — optional beta gate
- `SHORT_LINK_BASE_URL` — optional short-link host override (defaults to the request origin)

Start the local Node adapter:

```bash
pnpm --filter @sfcr/chat-api dev
```

Expected output:

```text
SFCR chat API local server listening on http://localhost:8787
Draft endpoint: http://localhost:8787/v1/chat-builder/draft
Share shorten: http://localhost:8787/v1/notebook-share/shorten
Share redirect: http://localhost:8787/s/<code>
```

The local Node adapter injects an in-memory KV store for `SHARE_LINKS`, so Share link works without Wrangler.

Editable local prompts live in `packages/chat-api/prompts/`:

- `chat-builder-system.md`: full notebook draft generation.
- `notebook-assistant-system.md`: notebook Q&A responses and safe patch proposal guidance.

In local Node development these files are read on every request, so prompt edits do not require restarting `pnpm --filter @sfcr/chat-api dev`.

Point the web app at the assistant endpoint:

```bash
VITE_NOTEBOOK_ASSISTANT_API_URL=http://localhost:8787/v1/notebook-assistant/ask pnpm web:dev
```

On localhost, the notebook app also falls back to `http://localhost:8787/v1/notebook-assistant/ask` when no env var is set.

Wrangler local dev is still available on systems with a recent enough GLIBC:

```bash
pnpm --filter @sfcr/chat-api dev:wrangler
```

The Node adapter exists because Wrangler's local `workerd` runtime can fail on older Linux distributions. Production still deploys to Cloudflare Workers.

On `localhost`, the web app calls `http://localhost:8787/v1/notebook-share/shorten` for Share link even when no `VITE_*` env var is set.

## Notebook share shortening

SFCApp **Share link** builds a long URL with an `nbz` query parameter (LZ-compressed notebook JSON), then calls this Worker to mint a short `/s/:code` link before copying to the clipboard.

Flow:

1. Browser builds `…/#/notebook?nbz=…&cell=…` (hash routing avoids HTTP 414 on static hosts; optional `cell` for deep links).
2. Browser `POST`s `{ "url": "<long share url>" }` to `/v1/notebook-share/shorten`.
3. Worker validates the URL origin (must match `ALLOWED_ORIGINS` / `DISCOVERY_ALLOWED_ORIGINS`) and that it is a notebook share link with `nbz`.
4. Worker stores `{ url, createdAt }` in the `SHARE_LINKS` KV namespace under an 8-character code.
5. Browser copies `https://<worker-or-SHORT_LINK_BASE_URL>/s/<code>`. Opening that URL `GET`s the Worker, which `302`s to the long SFCApp URL. If shortening fails, Share link copies the long URL instead.

**Local:** run `pnpm --filter @sfcr/chat-api dev` (in-memory KV), then `pnpm dev` in another terminal.

**Production:** create KV namespaces and paste the IDs into `wrangler.toml`:

```bash
cd packages/chat-api
pnpm dlx wrangler kv namespace create SHARE_LINKS
pnpm dlx wrangler kv namespace create SHARE_LINKS --preview
# Edit wrangler.toml: replace REPLACE_WITH_SHARE_LINKS_KV_* placeholders with the printed IDs
pnpm --filter @sfcr/chat-api run deploy
```

Optional: set `SHORT_LINK_BASE_URL` in `wrangler.toml` `[vars]` (or the Cloudflare dashboard) when short links should use a custom host instead of the Worker origin.

Configure the static frontend to use the same Worker base URL as the assistant:

```text
VITE_NOTEBOOK_ASSISTANT_API_URL=https://sfcr-chat-api.<account>.workers.dev/v1/notebook-assistant/ask
```

`VITE_CHAT_BUILDER_API_URL` also works; the web app derives `/v1/notebook-share/shorten` from either variable.

**Verify after deploy:**

```bash
SHORT=$(curl -s -X POST "https://sfcr-chat-api.<account>.workers.dev/v1/notebook-share/shorten" \
  -H "Content-Type: application/json" \
  -H "Origin: https://johnnewto.github.io" \
  -d '{"url":"https://johnnewto.github.io/sfcapp/notebook?nbz=test"}')
echo "$SHORT"
# Expected: {"shortUrl":"https://sfcr-chat-api.<account>.workers.dev/s/<code>"}

curl -sI "$(echo "$SHORT" | sed -n 's/.*"shortUrl":"\([^"]*\)".*/\1/p')"
# Expected: HTTP/2 302 and Location: https://johnnewto.github.io/sfcapp/notebook?nbz=test
```

`503` with `SHARE_LINKS is not configured` means the KV binding is missing. Short links open on the **Worker** host and redirect to GitHub Pages or Cloudflare Pages (or a future custom domain). Share URLs (and compressed `nbz` payloads) are capped at 128,000 characters; shortening does not raise that limit.

If you previously used TinyURL, remove the unused Worker secret:

```bash
pnpm dlx wrangler secret delete TINYURL_API_TOKEN
```

## Draft Eval Harness

Offline draft-generation regression uses `pnpm eval:chat-builder` against `POST /v1/chat-builder/draft`:

```bash
pnpm eval:chat-builder -- --fixture sim-basic
pnpm eval:chat-builder:live -- --fixture sim-basic --model gpt-5.4
```

Artifacts are written under `packages/web/eval-runs/chat-builder/`.

## Deploy

```bash
pnpm --filter @sfcr/chat-api run deploy
```

Set the OpenAI key as a Cloudflare Worker secret:

```bash
cd packages/chat-api
pnpm dlx wrangler secret put OPENAI_API_KEY
```

Set a beta password as a Worker secret when you want the public frontend gated:

```bash
pnpm dlx wrangler secret put BETA_PASSWORD
```

For production, set:

- `OPENAI_API_KEY`: Cloudflare secret.
- `BETA_PASSWORD`: optional Cloudflare secret. When set, browser requests must include the matching beta password.
- `SHARE_LINKS`: Cloudflare KV namespace binding in `wrangler.toml` for notebook share short links.
- `SHORT_LINK_BASE_URL`: optional var. When set, minted short URLs use this origin instead of the Worker request origin.
- `ALLOWED_ORIGINS`: comma-separated allowed browser origins, for example `https://johnnewto.github.io,https://sfcapp.pages.dev`.
- `DISCOVERY_ALLOWED_ORIGINS`: comma-separated allowed origins for public discovery bundles. Defaults to `ALLOWED_ORIGINS` when unset.
- `MAX_OUTPUT_TOKENS`: output token cap for each OpenAI response. Defaults to `8000`.
- `OPENAI_MODEL_ALLOWLIST`: comma-separated model ids accepted by the proxy, for example `gpt-5.4-mini,gpt-5.4,gpt-4.1,gpt-5.5,o3`.
- `CHAT_BUILDER_RATE_LIMITER`: Cloudflare Workers Rate Limiting binding configured in `wrangler.toml` as 10 requests per minute per rate-limit key.

Configure GitHub Pages and Cloudflare Pages builds with the same repository variable:

```text
VITE_NOTEBOOK_ASSISTANT_API_URL=https://sfcr-chat-api.<account>.workers.dev/v1/notebook-assistant/ask
```

Both static hosts share this Worker. Short links mint on the Worker and redirect to whichever long SFCApp URL was shortened.

The Worker only fetches notebook discovery bundles from trusted origins. Discovery resources are capped at 250 KB each, example loading is capped at five unique examples, and the assembled discovery bundle is capped at 1 MB. Public discovery resources are cached for 10 minutes when Cloudflare's default cache is available.

## Validation

```bash
pnpm --filter @sfcr/chat-api typecheck
pnpm --filter @sfcr/chat-api test
```
