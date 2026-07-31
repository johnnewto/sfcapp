# Assistant Operation

## Current State

The notebook Assistant is a browser-orchestrated analysis and patch-proposal system. The chat API streams model text, while the browser owns notebook state, runtime outputs, notebook helper tools, patch validation, preview, apply, discard, and undo.

The main safety boundary is:

```text
Model proposes. Browser validates. User applies.
```

The assistant can inspect notebook state and propose edits, but it does not directly mutate the notebook.

## User-Facing Modes

The sidebar Assistant panel is **Ask-only**: question-answering and read-only notebook inspection (Mode 1 and Mode 2 below). It must not create patch proposals. If the user asks for a notebook change in the global panel, the assistant should direct them to **Ask AI** on the relevant chart cell or equation row.

Scoped edits (Mode 3) use cell Ask AI:

- Chart toolbar **Ask AI** — update that chart's variables or options only.
- Equation row **Ask AI** — explain or update that existing equation only.
- Equations cell header **Ask AI** — read-only explanation of the equations cell.

Proposals still appear for review; the notebook does not change until the user applies a patch. The Manual Patch JSON panel remains an advanced utility.

Legacy global **Edit** mode is gated behind `VITE_NOTEBOOK_ASSISTANT_EDIT=1` for internal/dev use only.

## Example Prompts

Use these prompts to exercise the current assistant modes during local testing.

### Ask Mode Prompts

Ask mode is for explanation, inspection, and read-only data access.

```text
What does YD mean in this notebook?
```

```text
Use the notebook tools to inspect the BMW baseline run and show YD and Cd for periods 0 through 10.
```

```text
Use the notebook tools to get the equation and dependencies for YD, then explain what drives it.
```

```text
List the available runs and charts in this notebook.
```

```text
Inspect the transaction-flow matrix and explain which rows involve household deposits.
```

```text
Use the notebook tools to compare current values for Y, YD, Cd, and Mh in the baseline run at the selected period.
```

### Cell Ask AI Prompts

Use these on a chart or equation Ask AI panel (not the global sidebar Ask composer). The notebook should not change until the user reviews and applies the proposal.

```text
Update this chart to show Y, YD, and Mh.
```

```text
Explain what drives Cd in this equation.
```

```text
Make Cd less sensitive to current income by scaling alpha1 by 0.8.
```

```text
(Equations cell header) Explain the household block and how investment depends on the capital stock.
```

### Prompting Notes

- In the global Ask panel, use words like `inspect`, `explain`, `show`, `list`, and `compare`.
- For notebook changes, open Ask AI on the chart or equation you want to change.
- If a prompt asks for a notebook change in the global Ask panel, the expected behavior is to point the user at cell Ask AI.

## Main Components

- `packages/web/src/notebook/NotebookApp.tsx`: builds assistant context, sends requests to the chat API, parses tool requests, runs browser tools, loads patch proposals into the Patch JSON panel, and handles preview/apply/discard/undo.
- `packages/web/src/notebook/notebookAssistantTools.ts`: defines the browser-side assistant tool registry and dispatcher.
- `packages/web/src/notebook/notebookPatch.ts`: validates, previews, and applies JSON Pointer notebook patches.
- `packages/chat-api/src/notebookAssistantPrompt.ts`: bundled notebook assistant system prompt.
- `packages/chat-api/prompts/notebook-assistant-system.md`: editable local development prompt.

The chat API endpoint is:

```text
POST /v1/notebook-assistant/ask
```

The chat API remains a streaming model proxy. It does not run notebook tools or recompute notebook state.

## Mode 1: Plain Q&A

For ordinary questions, the assistant answers from the compact notebook context sent by the browser.

Example:

```text
What does YD mean in this notebook?
```

If the provided context is enough, the assistant answers directly. No browser tool is run and the Patch JSON panel is not used.

User-facing mode: `Ask`.

## Mode 2: Browser Read Tools

If the assistant needs more exact notebook or runtime data, it can ask the browser to run read-only tools by returning a fenced JSON block.

Example tool request:

```json
{
  "notebookAssistantToolRequests": [
    {
      "name": "getSeriesWindow",
      "args": {
        "runId": "baseline-newton",
        "variable": "YD",
        "start": 0,
        "end": 10
      }
    }
  ]
}
```

The browser intercepts the JSON, runs the tool locally against the current notebook snapshot, sends tool results back to the model, and then displays the model's final answer.

User-facing mode: `Ask`.

Current read tools:

- `getNotebookSummary`
- `getEquation`
- `getCurrentValues`
- `getSeries`
- `getSeriesWindow`
- `getMatrix`
- `getVariableMetadata`
- `getDependencyGraph`
- `listRuns`
- `listVariables`
- `listCharts`

## Mode 3: Helper-Generated Patch Proposals

For common notebook edits, the assistant can ask the browser to generate a validated patch through helper tools.

Example user request:

```text
Add a chart for the BMW baseline run with variables YD and Cd.
```

Preferred helper request:

```json
{
  "notebookAssistantToolRequests": [
    {
      "name": "createAddChartPatch",
      "args": {
        "runId": "baseline-newton",
        "title": "Disposable income",
        "variables": ["YD", "Cd"]
      }
    }
  ]
}
```

The browser validates the run and variables, creates a notebook patch, previews it, and shows an inline patch card on the assistant reply. The notebook remains unchanged until the user clicks `Apply` on the patch card.

User-facing path: cell Ask AI for chart/equation updates; legacy global Edit only when `VITE_NOTEBOOK_ASSISTANT_EDIT=1`.

Current helper patch tools:

- `createAddChartPatch`
- `createUpdateChartVariablesPatch`
- `createAddEquationPatch`
- `createUpdateEquationPatch`
- `createRemoveEquationPatch`
- `createUpdateVariableDescriptionPatch`
- `createAddExternalPatch`
- `createUpdateExternalPatch`
- `createAddInitialValuePatch`
- `createUpdateInitialValuePatch`
- `createAddScenarioRunPatch`
- `createUpdateRunOptionsPatch`
- `createAddTablePatch`
- `createUpdateTableVariablesPatch`
- `createAddMatrixRowPatch`
- `createUpdateMatrixRowPatch`
- `createRemoveMatrixRowPatch`
- `createAddMarkdownCellPatch`
- `createUpdateMarkdownCellPatch`
- `createUpdateChartOptionsPatch`
- `createUpdateNotebookTitlePatch`
- `createUpdateVariableUnitMetaPatch`
- `createUpdateParameterPatch`

Current proposal-level patch tools:

- `validateNotebookPatch`
- `previewNotebookPatch`
- `explainNotebookPatch`

`createAddChartPatch` prefers `runId`, `title`, and `variables`. It also accepts common run-source aliases such as `sourceRunCellId`, `runCellId`, `sourceRunId`, and `resultRunId`, and can default the title from the variables when needed. `createUpdateVariableUnitMetaPatch` can set explicit display labels such as `%` for dimensionless percent-style variables. The equation and external helpers resolve model sections in the browser, validate duplicate names, and block dependent equation removal unless `allowDependents` is set. The matrix, markdown, table, and chart-option helpers resolve target cells by stable ids and return typed ambiguity errors when a title match is not unique.

Implementation notes:

- Helpers should return `{ patch, preview }` and never apply changes directly.
- Helpers should prefer stable `/cells/by-id/...` paths for cell property edits.
- Helpers that touch equations should validate duplicate names and dependency risks before returning a patch.
- Helpers that reference runs, variables, charts, tables, matrices, or models should resolve names/ids in the browser and return typed errors when ambiguous.

## Mode 4: Direct Patch Proposal

The model can also return raw notebook patch JSON directly for unsupported edits. Supported common edits, such as adding charts, changing chart variables, or changing parameters, should use helper tools instead of raw patch JSON. If the model still returns a direct patch for a supported edit and the browser can infer the intended helper request, the browser translates it through the helper tool before filling Patch JSON.

Example:

```json
{
  "operations": [
    {
      "op": "add",
      "path": "/cells/-",
      "value": {
        "id": "disposable-income",
        "type": "chart",
        "title": "Disposable income",
        "sourceRunCellId": "baseline-newton",
        "variables": ["YD", "Cd"]
      }
    }
  ]
}
```

The browser detects direct patch JSON, applies the helper-only policy for supported edits, translates supported raw patches through helper tools when possible, shows allowed or helper-generated patches inline with the assistant reply, and runs preview validation. This path is flexible, but helper-generated patches are required for common edits because the browser can validate context-aware details before producing the patch.

The browser also has compatibility fallbacks for malformed semantic wrappers such as `notebookPatchProposal` with a `chart-variables-update` entry, top-level semantic objects such as `patchKind: "updateChartVariables"` or `patchKind: "updateVariableUnitMeta"`, and plain-text chart variable proposals that include an explicit variable list. When enough information is present, it converts those responses into the matching helper request. If the model directly asks to validate or preview a raw patch in legacy Edit mode, the browser can also surface that validated patch as an inline review/apply card. The prompt still instructs the model to use `notebookAssistantToolRequests` directly.

User-facing path: Manual Patch JSON panel, or legacy global Edit when gated on. Preferred product path for supported chart/equation edits is cell Ask AI.

## Mode 5: Manual Patch Mode

The Patch JSON panel is the manual and advanced patch editor. A user can place patch JSON there directly, or use `Open in Patch JSON` from an inline assistant patch card, then choose:

- `Preview patch`
- `Apply patch`
- `Discard`
- `Undo patch`

Patch application is always user-confirmed.

## Patch Validation

Notebook patches are JSON Pointer-based and support:

- `add`
- `replace`
- `remove`

Cell property paths use stable cell ids, for example `/cells/by-id/baseline-chart/variables`. Numeric cell-property paths such as `/cells/9/variables` are rejected so patches do not depend on notebook ordering.

Validation includes patch shape checks, allowed path checks, application against a cloned notebook, notebook normalization, full notebook validation, and a summary of added, changed, and removed cells.

## Operational Commands

Start the web app from the repository root:

```bash
pnpm web:dev
```

Start the local chat API from the repository root:

```bash
pnpm --filter @sfcr/chat-api dev
```

The root command `pnpm chat-api:dev` does not exist.

Useful validation commands:

```bash
pnpm --filter @sfcr/web exec vitest run test/notebookAssistantTools.test.ts
pnpm --filter @sfcr/web exec vitest run test/notebookPatch.test.ts
pnpm --filter @sfcr/web exec vitest run test/App.notebook-navigation.test.tsx -t "assistant-requested notebook tools|direct assistant notebook patch|malformed assistant notebook tool|unknown assistant notebook tool|helper validation"
pnpm --filter @sfcr/web typecheck
pnpm --filter @sfcr/chat-api typecheck
```

## Current Rough Edges

The assistant currently uses structured JSON inside streamed chat text rather than native typed model tool calls. This makes tool calls easier to inspect and test, but it is more brittle than native tool calling because the model can format JSON or arguments imperfectly.

The browser has hardening for malformed tool JSON, unknown tools, helper validation failures, direct patch proposals, and common add-chart argument aliases. Native tool calls may be a future improvement if streaming support and browser orchestration can remain clean.
