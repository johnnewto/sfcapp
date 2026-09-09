---
name: sfcr-notebook-files
description: Creates and edits SFCR notebook YAML in repo paths (pilot templates, public examples, new notebooks). Use when authoring .notebook.yaml, appending cells, optional collapsible `more:` panels, updating templates, or running compile:notebook-yaml. Not for the in-browser notebook assistant.
---

# SFCR notebook files (YAML / templates / examples)

Author **compact `sfcr-notebook-yaml`** in the repo. Runtime JSON is generated or validated separately; do not hand-edit `templates/generated/*.notebook.json` for pilot templates.

## Choose workflow

| Task | Action |
|------|--------|
| **Expand with sections + `[more]` panels** | Follow [expand-notebook](../expand-notebook/SKILL.md) (textbook-grounded expansion workflow) |
| **New notebook** | Copy `packages/web/public/notebook-examples/starter.example.notebook.yaml`, follow guide + prompt below |
| **Append a cell** | Add one wrapped entry to `cells:` — see [append-cells.md](append-cells.md) |
| **Edit pilot template** | Edit `packages/web/src/notebook/templates/<id>.notebook.yaml`, then compile (below) |
| **Refresh public examples** | After pilot YAML change for `bmw` or `sim`, compile with `--write-public-examples` |
| **JSON-only client** | Use `packages/web/public/ai-prompts/create-sfcr-notebook.md` and schema; prefer YAML for repo work |

## Read first (do not duplicate in chat)

1. `packages/web/public/notebook-guide.md` — structure, cell types, matrix rules, validation checklist
2. `packages/web/public/ai-prompts/create-sfcr-notebook-yaml.md` — generation constraints for new files
3. Examples (pick by need):
   - `packages/web/public/notebook-examples/starter.example.notebook.yaml` — minimum scaffold
   - `.../sim.example.notebook.yaml` — small Godley-Lavoie baseline + scenario (with inline `more:` panels)
   - `.../bmw.example.notebook.yaml` — sectors, bands, scenarios
   - `.../gl6-dis-rentier-v2.example.notebook.yaml` — split households / distributional layout
4. Schema (expanded JSON): `packages/web/public/sfcr-notebook.schema.json`

Pilot-only rule file (auto-applies under `templates/**`): `.cursor/rules/sfcr-notebook-templates.mdc`.

## YAML shape (required)

```yaml
format: sfcr-notebook-yaml
formatVersion: 1
id: my-model-notebook
title: My Model
metadata:
  version: 1
cells:
  - markdown:
      id: intro
      title: Overview
      source: ...
```

- Each `cells` item has **exactly one** wrapper key: `markdown`, `matrix`, `sequence`, `sankey`, `diagram`, `equations`, `solver`, `externals`, `initial-values`, `run`, `chart`, `table`.
- Fields inside the wrapper are cell fields **without** a redundant `type` field.
- **Do not** use legacy top-level sections (`introCell`, `cellOrder`, `variables`, `equations` at root, etc.) in new YAML.

## Recommended `cells` order

File order is UI order:

1. Intro markdown → 2. Balance-sheet matrix → 3. Transaction-flow matrix → 4. Sequence cells → 5. Equations → 6. Solver → 7. Externals → 8. Initial values → 9. Baseline run → 10. Charts/tables → 11. Scenario markdown → 12. Scenario runs → 13. Scenario charts/tables

## Optional collapsible "[more]" panels

Add an optional `more:` string field on any cell wrapper (`markdown`, `matrix`, `equations`, `run`, `chart`, `table`, …). The UI renders it as a collapsible panel below the cell body, open by default with a **less** / **more** toggle.

```yaml
  - markdown:
      id: overview
      title: Overview
      source: |
        Short intro shown in the cell body.
      more: |
        Longer textbook-style explanation, figures, and context for readers who want depth.
```

- **Canonical example:** `packages/web/src/notebook/templates/sim.notebook.yaml` (and the compiled public example).
- **Parsing:** `notebook-core` preserves `more` through YAML parse/serialize and `compile:notebook-yaml`.
- **Rendering:** notebook run view (`NotebookCellMore`) and publication view (`PublicationMore`) both use markdown rendering (no KaTeX).
- **Figures:** put assets under `packages/web/public/figures/` and reference them relatively, e.g. `![alt](figures/sim-circuit.svg)`.
- **One panel per cell** — `more` attaches to that cell's `id`; do not duplicate ids.

### `more:` authoring rules

- Write variables and equations in **backticks**, not LaTeX. ✅ `` `Cd = alpha1 * YD + alpha2 * lag(Hh)` `` — ❌ `$C_d = \alpha_1 YD$`
- Use `pow(b, e)` for exponentiation, never `^` (same as model expressions).
- In **block scalar** `more: |` text, write italics as `_italic_`, not `*italic*`. The YAML dialect rejects `*word` tokens (they look like aliases). `**bold**` and multiplication inside backticks are fine.
- Keep the cell `source` / `description` concise; put extended prose in `more:`.

See [append-cells.md](append-cells.md) for per-type snippets.

## Anti-patterns

- Unquoted descriptions inside compact **row arrays** (must be quoted strings)
- Matrix rows whose value count ≠ `columns` length; `sectors` length must match `columns`
- `^` for exponentiation in expressions — use `pow(base, exponent)`; `^` is for notation like `H^P`
- Duplicate cell `id` values
- Mismatched `modelId` across equations / solver / externals / initial-values / runs
- Hand-editing `packages/web/src/notebook/templates/generated/*.json`

## Pilot templates

**Paths:** `packages/web/src/notebook/templates/<file_id>.notebook.yaml`  
**Generated:** `templates/generated/<file_id>.notebook.json`

| File id (underscores) | TS `NotebookTemplateId` (hyphens) |
|----------------------|-----------------------------------|
| `bmw` | `bmw` |
| `sim` | `sim` |

After editing pilot YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write
```

For `bmw` or `sim`, also refresh public examples:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write --write-public-examples
```

Compile a subset: append template ids, e.g. `pnpm --filter @sfcr/web compile:notebook-yaml -- --write bmw sim`.

**New pilot template:** add YAML, register in `packages/web/src/notebook/templates.ts` (`?raw` + `NOTEBOOK_TEMPLATES`), add smoke/regression coverage, then compile.

## Public examples

**Paths:** `packages/web/public/notebook-examples/*.example.notebook.yaml`

These are maintained for AI/bootstrap; they are **not** rewritten by compile unless you use `--write-public-examples` on the matching pilot ids (`bmw`, `sim`, etc.). For a **new** standalone example file, edit YAML directly and ensure it parses (see validation).

## Validation ladder

Smallest proof first (repo root):

1. Pilot/template change → `pnpm --filter @sfcr/web compile:notebook-yaml -- --write` (and `--write-public-examples` if applicable)
2. Template/model smoke → `pnpm web:test:templates`
3. YAML / `more:` parser tests → `pnpm --filter @sfcr/web exec vitest run test/notebookYamlTemplates.test.ts test/notebookMoreField.test.ts`
4. Public examples contract → `pnpm --filter @sfcr/web exec vitest run test/publicAiResources.test.ts`
5. Broader web work → `pnpm web:test:fast`
6. `notebook-core` schema edits → update `packages/notebook-core/src/sfcr-notebook.schema.json` and `packages/web/public/sfcr-notebook.schema.json`, then `pnpm --filter @sfcr/notebook-core run check:boundaries`
7. Pre-handoff → `pnpm typecheck` then `pnpm test`

## Boundaries

- Solver/model semantics: `packages/core` — not in YAML skill edits unless the task requires it
- In-browser assistant (tool JSON, Edit mode): separate skill/workflow — not this file
- `references/java/` and `references/r-sfcr/` — parity only when explicitly requested

## More detail

- Expanding notebooks (sections + `[more]` + verification): [expand-notebook](../expand-notebook/SKILL.md)
- Appending cells (snippets + placement): [append-cells.md](append-cells.md)
