---
name: expand-notebook
description: Expand an SFCApp pilot template or public example notebook with new sections and explanatory "[more]" panels grounded in a textbook reference. Use when adding cells to packages/web/src/notebook/templates/<id>.notebook.yaml or public/notebook-examples/, writing inline `more:` panels, or replicating a Godley & Lavoie / SFC chapter into a notebook. Composes with sfcr-notebook-files for YAML mechanics.
---

# Expand an SFCApp notebook

Add sections to a pilot template or public example: new cells in the notebook YAML plus
matching collapsible **"[more]"** explanations, with prose grounded in a cited
reference and **verified against solved model output**.

For cell-type snippets, YAML shape, and compile commands, also follow
[sfcr-notebook-files](../sfcr-notebook-files/SKILL.md) and
[append-cells.md](../sfcr-notebook-files/append-cells.md).

## Key locations

| Kind | Path |
|------|------|
| **Pilot template** | `packages/web/src/notebook/templates/<file_id>.notebook.yaml` |
| **Generated JSON** | `templates/generated/<file_id>.notebook.json` (compile output — do not hand-edit) |
| **Public example** | `packages/web/public/notebook-examples/<file_id>.example.notebook.yaml` |
| **Figures** | `packages/web/public/figures/` — reference as `![alt](figures/name.svg)` |
| **Canonical `more:` example** | `packages/web/src/notebook/templates/sim.notebook.yaml` |

- **"[more]" panels:** inline `more: |` on each cell (first-class field; parsed by `notebook-core`).
- **Rendering:** notebook run view (`NotebookCellMore`) and publication view (`PublicationMore`).
- **Docs-site notebooks** (`moneyjs-docs` / `app/notebooks/`) are a separate repo and skill (`expand-docs-notebook`) — not this workflow.

## Workflow

```
- [ ] 1. Read the notebook YAML; list existing cell ids, order, and which already have `more:`
- [ ] 2. Design the new section (markdown / run / chart / table / matrix as needed)
- [ ] 3. Insert cells in narrative order; add an inline `more:` panel on each new cell
- [ ] 4. Compile pilot YAML (below); fix parse / compile errors
- [ ] 5. Solve in dev or template tests; verify numeric claims in `more:` prose
- [ ] 6. Run targeted tests (validation ladder below)
```

## "[more]" panel rules

Add a `more:` block scalar on the same cell wrapper as the cell body:

```yaml
  - table:
      id: baseline-table
      title: Baseline summary
      variables: [Y, YD, Hh]
      sourceRunCellId: baseline-run
      more: |
        Watch `Hh` flatten as `YD - Cd` shrinks toward zero ...
```

- One panel per cell `id`; do not duplicate ids.
- Keep `source` / `description` short; put extended textbook prose in `more:`.
- Assets under `packages/web/public/figures/`.

### Rendering / authoring

Panels render through markdown (**no KaTeX**):

- Variables and equations in **backticks**, not LaTeX. ✅ `` `Cd = alpha1 * YD + alpha2 * lag(Hh)` `` — ❌ `$C_d = \alpha_1 YD$`
- Use `pow(b, e)` for exponentiation, never `^`.
- In `more: |` block scalars, italics as `_italic_`, not `*italic*` (YAML rejects `*word` alias tokens). `**bold**` and ` * ` inside backticks are fine.

## Cell conventions

- Each `cells:` item has exactly one wrapper key (`markdown`, `matrix`, `sequence`, `equations`, `solver`, `externals`, `initial-values`, `run`, `chart`, `table`). No redundant `type` field.
- File order is UI order. Typical: intro → matrices → sequences → equations → solver → externals → initial-values → baseline run → charts/tables → scenario markdown → scenario run → scenario charts/tables.
- `chart` / `table` `variables` are bare model variable names (no expressions).
- Quote descriptions inside compact row arrays.

## Scenario / run mechanics

See `packages/core/src/engine/runScenario.ts`.

- A scenario run starts from the baseline run's **last-period** state, then applies shocks over `rangeInclusive: [start, end]` (both endpoints included).
- Shock kinds: `constant` (`value`) or `series` (`values` array). A `series` maps `values[period - start]` onto each period.
- Shock only **externals**, never equation variables.
- **Growth experiments:** SIM-type models have no intrinsic growth; drive the exogenous variable with a geometric `series`, e.g. `Gd_t = base * pow(1 + g, t - 1)`. Generate the array with a quick node one-liner rather than by hand.

## After editing

**Pilot template** (most expansions):

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write <file_id>
```

For `bmw` or `sim`, also refresh public examples:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write --write-public-examples <file_id>
```

**Public example only** (no matching pilot): edit YAML directly; no compile required unless syncing from a pilot.

Preview: `pnpm dev` → open the template from the notebook UI and run baseline + scenario cells.

## Verification

Ground every numeric claim in `[more]` prose (steady-state values, growth rates, ratios) against solved output and the cited reference.

1. **Compile gate** — `compile:notebook-yaml` must succeed; fix YAML parse errors (often unquoted `*` in `more:` blocks).
2. **Solve gate** — in `pnpm dev`, baseline and new scenario runs must complete without solver errors.
3. **Targeted tests** (repo root, smallest first):
   - `pnpm --filter @sfcr/web exec vitest run test/notebookMoreField.test.ts`
   - `pnpm --filter @sfcr/web exec vitest run test/notebookYamlTemplates.test.ts`
   - Template smoke for the edited id if covered: `pnpm web:test:templates` (operator — slow)
4. **Economics check** — inspect run results in the UI or existing template regression fixtures; do not assert numbers in `more:` that contradict solved series.

## Boundaries

- Solver / model semantics: `packages/core` — only when the expansion requires new equations or externals
- In-browser notebook assistant: separate workflow
- `moneyjs-docs` / `app/notebooks/`: use `expand-docs-notebook` in that repo, not this skill
- `references/java/` and `references/r-sfcr/`: parity lookup when explicitly requested
