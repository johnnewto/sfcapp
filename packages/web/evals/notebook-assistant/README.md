# Notebook Assistant Eval Harness

Offline-first harness for debugging in-notebook assistant ask and scoped cell-AI behavior. This is a sibling to the draft eval harness (`pnpm eval:chat-builder`): that harness evaluates full notebook drafts, while this harness evaluates existing notebook context, tool choice, minimal patch proposals, validation, and preview summaries.

The scoring core lives in `src/notebook/notebookAssistantEval.ts` and imports the production assistant flow, scoped proposal runner, tool dispatcher, and patch validation modules. The Node CLI in this folder is a fixture/artifact wrapper around that TypeScript evaluator.

## Assistant Round Trip Coverage

The browser Assistant panel already supports a bounded multi-step assistant turn:

1. Build notebook context from the current notebook, selected variable/period, run state, mode, and advertised tool syntax.
2. Send the first request to `/v1/notebook-assistant/ask`.
3. Parse `notebookAssistantToolRequests` from the assistant response.
4. Filter tools by mode (Ask = read tools only) or by cell scope for chart/equation Ask AI.
5. Dispatch allowed tools locally in the browser.
6. Attach a proposed patch immediately if helper tools produce one (scoped Edit paths and legacy global Edit).
7. Send a follow-up request with summarized tool results when needed.
8. Stream the final assistant answer.
9. Check the final answer for direct patch proposals only when legacy global Edit is enabled.

This is a two-request, one-tool-round loop, not an unbounded agent loop.

The offline eval harness uses `src/notebook/notebookAssistantEval.ts`, which imports the production assistant flow, tool dispatcher, and patch validation modules. It evaluates saved assistant responses without network calls. Fixtures may set `scope` for cell Ask AI (`chart-update`, `equation-update`, `equations-cell-ask`) and assert target-scope rejection.

The CLI live eval command is still reserved for a future response provider that will call `/v1/notebook-assistant/ask`, run the same local tool dispatch, send tool results back, and score the final response through the same TypeScript evaluator.

## Phase 1: Offline Harness + Saved Responses

Implemented as the default mode:

```bash
pnpm eval:notebook-assistant -- --fixture ask-list-runs
pnpm eval:notebook-assistant -- --fixture chart-update-baseline-vars
pnpm eval:notebook-assistant -- --all
```

Runs write artifacts under `packages/web/eval-runs/notebook-assistant/`:

- `fixture.json`
- `assistant.raw.txt`
- `tool-requests.json`
- `tool-results.json`
- `patch.json`
- `preview.json`
- `validation.json`
- `summary.json`

For ad hoc debugging, pass `--progress` or set `EVAL_NOTEBOOK_ASSISTANT_PROGRESS=1`.

## Fixture Contract

Each fixture supplies an existing notebook, assistant mode (or cell `scope`), user question, saved assistant response, and expected behavior:

```json
{
  "id": "chart-update-baseline-vars",
  "mode": "ask",
  "scope": { "kind": "chart-update", "cellId": "baseline-chart" },
  "question": "Update this chart to show Y, YD, and Mh.",
  "notebookPath": "../../public/notebook-examples/bmw.example.notebook.json",
  "savedResponsePath": "responses/chart-update-baseline-vars.raw.txt",
  "expected": {
    "toolNames": ["createUpdateChartVariablesPatch"],
    "patch": true,
    "changedChartVariables": { "id": "baseline-chart", "variables": ["Y", "YD", "Mh"] },
    "scopeViolations": false
  }
}
```

Ask-mode fixtures should expect read tools or grounded prose and no patch. Scoped cell fixtures should prefer helper patch tools for the bound target and use `blockedToolNames` / `scopeViolations` for cross-target attempts. Legacy `mode: "edit"` fixtures remain for offline scoring of the gated global Edit path (`VITE_NOTEBOOK_ASSISTANT_EDIT=1`).

## Phase 2: Deterministic Tool/Patch Tests

The TypeScript evaluator and CLI wrapper are covered by `test/notebookAssistantEvalHarness.test.mjs`:

- fixture loading
- production assistant tool request extraction
- ask-mode patch/tool blocking through the real mode filter
- scoped chart/equation target rejection
- helper patch extraction through the real tool dispatcher
- patch validation and preview through the real patch module
- artifact writing

Focused test command:

```bash
pnpm --filter @sfcr/web exec vitest run test/notebookAssistantEvalHarness.test.mjs
```

## Phase 3: Live Mode, Manual Only

CLI live mode is intentionally not implemented yet. The browser Assistant panel already has a local live-test path for manual checks against `/v1/notebook-assistant/ask`; the CLI still needs a response provider that can call that endpoint, execute local notebook tools, send tool results back, and pass the final response through the same TypeScript evaluator.

```bash
pnpm eval:notebook-assistant:live -- --fixture chart-update-baseline-vars
```

The command currently reports that CLI live mode is not available rather than falling back silently.

## Phase 4: Live Batch Eval, Manual Or Scheduled

After live mode exists and more fixtures are added, run it manually or from a scheduled job. Do not put live provider calls in normal PR CI.

## Phase 5: Dashboard/Comparison Reports

The artifact format is plain JSON/text so a later report page can compare fixtures, model responses, tools used, patch summaries, validation status, and residual diagnostics.
