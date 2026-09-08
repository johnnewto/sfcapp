# SFCApp

SFCApp is a **browser-first TypeScript application** for building and running stock-flow consistent (SFC) models.

Live app:
- [https://sfcapp.net/](https://sfcapp.net/)
- [https://johnnewto.github.io/sfcapp/](https://johnnewto.github.io/sfcapp/)


The main product surface lives in:

- `packages/web`: browser app
- `packages/core`: solver engine and model runtime
- `packages/core-worker`: browser worker wrapper around the solver

The older implementations remain in the repo as references:

- `references/java/`: migration/reference engine used to port behavior into TypeScript
- `references/r-sfcr/`: pinned checkout of the upstream R implementation for parity/reference work

## Current Focus

The primary development path is the browser application and the TypeScript solver.

That means:

- new product work should generally go into `packages/web` or `packages/core`
- root scripts are intended to support the browser app first
- R and Java are still valuable for parity checks and historical reference, but they are no longer the default entry point for the project

## Running The App

From the repo root:

```bash
pnpm dev
```

That starts the browser app in development mode.

You can also run the web app explicitly:

```bash
pnpm web:dev
```

For a local preview of the current production build at the root path:

```bash
pnpm web:build
pnpm web:preview
```

For a GitHub Pages-style preview with the `/sfcapp/` base path:

```bash
pnpm web:preview:pages
```

That preview runs on:

```text
http://localhost:4173/sfcapp/
```

The dev server will print a local URL, typically:

```text
http://localhost:5173
```

Notebook routes use path-based URLs such as `/notebook/bmw` or the hash fallback `#/notebook`.

## Building

Use Node.js 22 or newer. Wrangler requires Node 22 for the chat API Worker, and the GitHub Pages workflow also builds with Node 22.

With `fnm`:

```bash
fnm install
fnm use
corepack enable
```

With `nvm`, the same repo version file also works:

```bash
nvm install
nvm use
corepack enable
```

Build the browser-focused project from the repo root:

```bash
pnpm build
```

Or build the web app directly:

```bash
pnpm web:build
```

For a GitHub Pages deployment, build the app with the repository base path:

```bash
VITE_BASE_PATH=/sfcapp/ pnpm web:build
```

For a Cloudflare Pages deployment (root path on `sfcapp.pages.dev`):

```bash
VITE_BASE_PATH=/ pnpm web:build
```

To enable the in-notebook assistant on either static host, point the frontend at the Cloudflare Worker proxy:

```bash
VITE_BASE_PATH=/sfcapp/ VITE_NOTEBOOK_ASSISTANT_API_URL=https://sfcr-chat-api.<account>.workers.dev/v1/notebook-assistant/ask pnpm web:build
```

Equivalent root scripts:

```bash
pnpm web:build:pages
pnpm web:build:cloudflare
```
## Testing And Typechecking

Workspace-level checks:

```bash
pnpm typecheck
pnpm test
```

Web test lanes:

```bash
pnpm web:test:fast
pnpm web:test:integration
```

Use `pnpm web:test:fast` for quick feedback during most `packages/web` work. Use `pnpm web:test:integration` when a change affects notebook source flows, linked cell editors, or notebook navigation/inspection behavior.

Core-only tests:

```bash
pnpm --filter @sfcr/core test
```

## Browser App Capabilities

The current browser application is notebook-first and supports:

- notebook templates such as SIM and BMW, plus imported variants
- linked equation, external, initial-value, solver, matrix, run, chart, and markdown cells
- worker-backed baseline and scenario execution in the browser
- result tables, charts, accounting matrices, and variable inspection
- notebook source editing in JSON, YAML, or Markdown
- notebook share links (`nbz` query parameter, CircuitJS-style `ctz` sharing); see [Notebook share links](#notebook-share-links)
- optional in-notebook assistant when `VITE_NOTEBOOK_ASSISTANT_API_URL` is configured

## Notebook share links

The **Share link** button copies a URL that embeds the current notebook as LZ-compressed JSON in the `nbz` query parameter, for example:

```text
https://johnnewto.github.io/sfcapp/#/notebook?nbz=<compressed>&cell=<optional-cell-id>
```

The `nbz` payload lives in the **hash** so static hosts (GitHub Pages) do not receive a multi-kilobyte query string (which causes HTTP 414 URI Too Long). Legacy `…/notebook?nbz=…` links still load when the server accepts the request.

Opening the link loads the notebook as an imported variant. If a cell is selected when sharing, the optional `cell` parameter deep-links to that section.

**Size limit:** compressed `nbz` payloads are capped at 128,000 characters in the browser. Larger notebooks must use Save or Export instead. The chat-api shorten endpoint accepts share URLs up to the same 128,000-character limit.

**Share link shortening:** when the chat API Worker is configured with the `SHARE_LINKS` KV binding, Share link automatically copies a short `/s/:code` URL (on the Worker host, or `SHORT_LINK_BASE_URL` if set) instead of the long `nbz` URL. Opening the short link `302`s to the SFCApp share URL. If shortening is unavailable, Share link falls back to the long URL.

Production requires both:

1. `SHARE_LINKS` KV binding on the chat API Worker (see [Chat API](#chat-api))
2. Static-host build var `VITE_NOTEBOOK_ASSISTANT_API_URL` or `VITE_CHAT_BUILDER_API_URL` pointing at the deployed Worker (same vars for GitHub Pages and Cloudflare Pages)

Short links mint on the Worker host and `302` to whichever long SFCApp URL was shortened (GitHub Pages or Cloudflare Pages).

Local development:

```bash
# terminal 1
cp packages/chat-api/.dev.vars.example packages/chat-api/.dev.vars
pnpm --filter @sfcr/chat-api dev

# terminal 2
pnpm dev
```

On `localhost`, the web app uses `http://localhost:8787` for shortening without extra env vars (the Node adapter uses in-memory KV).

More detail: `packages/chat-api/README.md` (Notebook share shortening section).

## Static hosting (GitHub Pages and Cloudflare Pages)

This repository deploys the browser app to both:

- [https://johnnewto.github.io/sfcapp/](https://johnnewto.github.io/sfcapp/) (`VITE_BASE_PATH=/sfcapp/`)
- [https://sfcapp.pages.dev/](https://sfcapp.pages.dev/) (`VITE_BASE_PATH=/`)

The old GitHub Pages path still redirects:

- `https://johnnewto.github.io/moneyjs/…` → `https://johnnewto.github.io/sfcapp/…` (separate `moneyjs` GitHub Pages repo; source in `redirects/moneyjs-github-pages/`)

Both workflows run on pushes to `main` (and `workflow_dispatch`):

- `.github/workflows/deploy-pages.yml` — GitHub Pages
- `.github/workflows/deploy-cloudflare-pages.yml` — Cloudflare Pages project `sfcapp`

If the GitHub repository name changes, update the `VITE_BASE_PATH` value in the GitHub Pages workflow so it matches the new Pages path.
Also update `packages/web/public/404.html`; GitHub Pages uses that file to redirect direct deep links such as `/sfcapp/notebook/sim` or `/sfcapp/publish/italy-sfc` back into the browser app (as `/#/notebook/...` or `/#/publish/...`, which the client restores to real pathnames).

Cloudflare Pages uses `packages/web/public/_redirects` (`/* → /index.html` with status 200) for History-API deep links. GitHub Pages ignores `_redirects`.

### One-time Cloudflare Pages setup

1. Create a Cloudflare API token with Pages edit and Account read permissions.
2. Add GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Set repository variable `VITE_NOTEBOOK_ASSISTANT_API_URL` (or `VITE_CHAT_BUILDER_API_URL`) to the Worker ask URL — both static deploy workflows read these vars.
4. After updating Worker allowlists, redeploy the Worker: `pnpm --filter @sfcr/chat-api run deploy`.
5. Wrangler no longer creates a Pages project on first deploy. The Cloudflare Pages workflow creates project `sfcapp` if it is missing, then deploys to `https://sfcapp.pages.dev/`. You can also create it once locally with `pnpm dlx wrangler pages project create sfcapp --production-branch=main`.

### Chat API

The in-notebook assistant, notebook share shortening (Cloudflare KV `/s/:code`), and offline draft-eval harness use a Cloudflare Worker in `packages/chat-api` so secrets stay out of the browser bundle.

Detailed usage notes are in `packages/chat-api/README.md`.

Local Worker development:

```bash
cp packages/chat-api/.dev.vars.example packages/chat-api/.dev.vars
```

Edit `packages/chat-api/.dev.vars`:

- `OPENAI_API_KEY` — in-notebook assistant
- `BETA_PASSWORD` — optional beta gate

Start the GLIBC-friendly local Node adapter:

```bash
pnpm --filter @sfcr/chat-api dev
```

Deploy the Worker (after creating KV namespaces and pasting IDs into `packages/chat-api/wrangler.toml` — see `packages/chat-api/README.md`):

```bash
pnpm --filter @sfcr/chat-api run deploy
```

Configure Worker secrets (prompted interactively):

```bash
cd packages/chat-api
pnpm dlx wrangler secret put OPENAI_API_KEY
pnpm dlx wrangler secret put BETA_PASSWORD   # optional
```

Point both static-host builds at the Worker (repository variable or workflow env):

```text
VITE_NOTEBOOK_ASSISTANT_API_URL=https://sfcr-chat-api.<account>.workers.dev/v1/notebook-assistant/ask
```

The Worker streams OpenAI Responses API events to the browser, caps each response with `MAX_OUTPUT_TOKENS`, and accepts only allowlisted origins and models. Configure `ALLOWED_ORIGINS`, `MAX_OUTPUT_TOKENS`, and `OPENAI_MODEL_ALLOWLIST` in `packages/chat-api/wrangler.toml` or Cloudflare. Production allowlists include `https://johnnewto.github.io`, `https://sfcapp.pages.dev`, and `https://sfcapp.net`. `wrangler.toml` also defines a Cloudflare Workers Rate Limiting binding for 10 requests per minute per rate-limit key, plus the `SHARE_LINKS` KV binding used by notebook share shortening.
### AI Discovery Endpoints

The browser app publishes AI-facing notebook authoring resources for browser-based tools such as ChatGPT or Claude.

Canonical GitHub Pages URLs:

- `https://johnnewto.github.io/sfcapp/.well-known/sfcr.json`
- `https://johnnewto.github.io/sfcapp/ai/index.html`
- `https://johnnewto.github.io/sfcapp/.well-known/sfcr-notebook-guide.json`
- `https://johnnewto.github.io/sfcapp/notebook-guide.md`
- `https://johnnewto.github.io/sfcapp/sfcr-notebook.schema.json`
- `https://johnnewto.github.io/sfcapp/ai-prompts/create-sfcr-notebook.md`

Example notebook references:

- `https://johnnewto.github.io/sfcapp/notebook-examples/bmw.notebook.json`
- `https://johnnewto.github.io/sfcapp/notebook-examples/gl6-dis-rentier.notebook.v2.json`

Local development equivalents:

- `http://localhost:5173/.well-known/sfcr.json`
- `http://localhost:5173/ai/index.html`

Recommended discovery flow for AI clients:

1. Fetch `/.well-known/sfcr.json` first.
2. Follow that index to the notebook manifest, guide, schema, prompt, and examples.
3. Validate generated notebook JSON against the published schema before returning it.

## Project Layout

```text
packages/
  core/         TypeScript solver engine
  core-worker/  Worker protocol and wrapper
  web/          Browser application

references/
  java/         Reference Java engine used during migration
  r-sfcr/       Upstream R reference repo (git submodule)
```

## Role Of The Reference Code

The reference code is still useful, but it is no longer the center of the repo.

Use them for:

- parity checks
- understanding legacy behavior
- migration reference when extending the TypeScript solver

If cloning fresh, initialize the external R reference with:

```bash
git submodule update --init --recursive
```

Do not treat them as the default runtime target for new product work unless a task explicitly requires it.
