# AGENTS.md

## Project Focus
This repository is browser-first and TypeScript-first.

Default implementation targets:
- `packages/web`
- `packages/core`
- `packages/core-worker`
- `packages/notebook-core`
- `packages/chat-api` (Cloudflare Worker for notebook assistant and draft-eval API; separate from main app build)

The `references/` directories are not the default place to make changes. Use them for parity checks, migration reference, and historical behavior only.

Use Node.js 22 or newer (see `.nvmrc`). Run commands from the repository root unless there is a specific reason not to.

## Architecture
The active architecture is split across TypeScript packages:
- `packages/core`: solver engine, model runtime, and domain logic
- `packages/core-worker`: worker-facing wrapper around `@sfcr/core`
- `packages/notebook-core`: notebook document format, schema, YAML/JSON parsing, validation (no UI)
- `packages/web`: browser UI, editor flows, notebook presentation, and result display
- `packages/chat-api`: serverless OpenAI proxy for the notebook assistant and draft-eval harness; browser uses `VITE_NOTEBOOK_ASSISTANT_API_URL` (with `VITE_CHAT_BUILDER_API_URL` as a legacy assistant fallback)

Preferred dependency direction:
- `packages/web` -> `packages/core-worker`, `packages/notebook-core`, and `packages/core`
- `packages/core-worker` -> `packages/core`
- `packages/notebook-core` -> `packages/core`
- `packages/core` should remain independent of browser UI concerns

Keep solver and model semantics in `packages/core`. Keep worker transport and browser-thread boundary code in `packages/core-worker`. Keep notebook schema and document transforms in `packages/notebook-core`. Keep React UI, view state, and user interaction logic in `packages/web`.

## Working Rules
- Prefer the smallest change that solves the task.
- Keep new product work in the TypeScript packages unless a task explicitly requires reference-code investigation.
- When changing solver behavior, consider whether the change should be checked against the Java or R references.
- Preserve existing package boundaries unless the task requires moving responsibilities.
- Do not edit `packages/*/dist/` or hand-edit pilot `templates/generated/*.json`; regenerate from YAML (see Notebook Templates).

## Notebook Templates
Pilot notebook templates use YAML as source of truth:
- Source: `packages/web/src/notebook/templates/<id>.notebook.yaml`
- Generated (checked in): `packages/web/src/notebook/templates/generated/<id>.notebook.json`
- Pilot IDs: `bmw`, `sim`

After editing pilot YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write
```

When pilot templates feed public AI examples (`bmw`, `sim`), also refresh `public/notebook-examples/`:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write --write-public-examples
```

Adding a template requires the YAML file, an entry in `packages/web/src/notebook/templates.ts` (`?raw` import + `NOTEBOOK_TEMPLATES`), and relevant tests. File names use underscores; TypeScript `NotebookTemplateId` values use hyphens (e.g. file `godley_fiscal_sfc.notebook.yaml` → id `"godley-fiscal-sfc"`).

## Notebook Schema
Canonical schema for validation: `packages/notebook-core/src/sfcr-notebook.schema.json`.

When the public notebook contract changes, also update `packages/web/public/sfcr-notebook.schema.json` (used by AI clients and evals).

After `packages/notebook-core` edits, run:

```bash
pnpm --filter @sfcr/notebook-core run check:boundaries
```

## Commands
Common commands:
- `pnpm dev`
- `pnpm web:dev`
- `pnpm build`
- `pnpm web:build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm web:test:fast`
- `pnpm web:test:integration`
- `pnpm web:test:templates`
- `pnpm --filter @sfcr/core test`
- `pnpm --filter @sfcr/web test`
- `pnpm --filter @sfcr/web exec vitest run test/<file>.test.tsx`
- `pnpm --filter @sfcr/web compile:notebook-yaml -- --write`
- `pnpm --filter @sfcr/web compile:notebook-yaml -- --write --write-public-examples` (pilot templates with public examples)
- `pnpm --filter @sfcr/notebook-core run check:boundaries`

## Validation

Use the smallest `pnpm` command that proves the change.

1. **One file** — `pnpm --filter @sfcr/web exec vitest run test/<file>.test.ts(x)` (add `--reporter=dot` for DOM-heavy output).
2. **Most `packages/web` work** — `pnpm web:test:fast` (skips four `App.notebook-*` integration tests and five template smoke/regression suites).
3. **Notebook UI flows** — `pnpm web:test:integration` when touching source import/export, cell editors, navigation, or assistant UI.
4. **Templates / model smoke** — `pnpm web:test:templates` when changing notebook templates, fixtures, or broad solver-over-template behavior. Regenerating R regression JSON: see `devdocs/r-regression-fixtures.md`.
5. **Cross-package or pre-handoff** — `pnpm typecheck` then `pnpm test` (Turbo across packages).

Package-specific: `pnpm --filter @sfcr/core test`, `pnpm --filter @sfcr/chat-api test`. `@sfcr/core-worker` and `@sfcr/notebook-core` use compile-only `test`; run `check:boundaries` after notebook-core edits. Worker protocol is covered from `packages/web/test/workerHandler.test.ts`.

`pnpm --filter @sfcr/web test` is not the same as `web:test:fast` — prefer root shortcuts for iteration.

### Scope tests to the change

Run only the narrow tests that exercise what you changed (rung 1, and rung 2/3 only for the matching area). Do **not** run the heavy/broad suites yourself — `pnpm test`, `pnpm web:test:integration`, and `pnpm web:test:templates` are slow and flaky under parallel load. Leave those to the operator: report the targeted commands you ran and suggest the operator run the heavy suites before handoff.

Do **not** start Vite (`pnpm dev` / `pnpm web:dev`), drive the in-app browser, or otherwise do live UI verification. The operator runs the app and checks behavior. Prove UI changes with focused Vitest (jsdom) tests; if a visual check is still needed, say what to click in the running notebook.

Timeouts in heavy/broad runs are usually load artifacts, not real failures. If a test times out (rather than failing an assertion) in an area unrelated to your change, treat it as a likely load artifact: re-run just that file in isolation to confirm, and do not chase it as a regression.

After pilot notebook YAML edits: `pnpm --filter @sfcr/web compile:notebook-yaml -- --write`.

If a task affects browser behavior, prefer proving it in the web package (focused Vitest) rather than only the Java/R references. Leave live Vite/browser checks to the operator.

## Reference Code
Use `references/java/` and `references/r-sfcr/` for:
- parity checks
- legacy behavior lookup
- migration guidance

Do not treat reference implementations as the default runtime target unless the task explicitly asks for that.

## Cursor Rules
File-scoped agent rules live in `.cursor/rules/` (`.mdc` files). They complement this document with package-specific guidance when matching files are open. `sfcr-validation.mdc` is always applied (testing ladder); `sfcr-web-testing.mdc` applies under `packages/web/**`.

## Notes For Agents
- Favor edits in the active TypeScript packages over reference implementations.
- If behavior is copied or inferred from reference code, state that clearly.
- Avoid broad refactors unless they are requested or required by the change.
- No ESLint or Prettier in this repo; rely on `tsc --noEmit` and Vitest/turbo tasks.
