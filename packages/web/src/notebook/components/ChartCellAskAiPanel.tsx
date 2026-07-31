import { useEffect, useId, useState, type FormEvent } from "react";

import { AssistantMarkdown } from "../../components/AssistantMarkdown";
import { AssistantPatchProposalView } from "../AssistantPatchProposalView";
import { runScopedNotebookAssistantProposal } from "../notebookAssistantProposalRunner";
import {
  NOTEBOOK_ASSISTANT_API_URL,
  createAssistantPatchIssue,
  type NotebookAssistantInlinePatch
} from "../notebookAssistantRuntime";
import type { NotebookAssistantSnapshot } from "../notebookAssistantTools";
import {
  applyNotebookPatch,
  previewNotebookPatch,
  type NotebookPatch,
  type NotebookPatchResult
} from "../notebookPatch";
import type { ChartCell, NotebookDocument } from "../types";

export { isNotebookCellAiEnabled as isNotebookChartCellAiEnabled } from "../notebookCellAi";

export function ChartCellAskAiPanel({
  betaPassword,
  cell,
  document,
  model,
  onApplied,
  onClose,
  onUndoApplied,
  resultCount,
  selectedPeriodIndex,
  snapshot,
  undoAvailable,
  uiMessage
}: {
  betaPassword: string;
  cell: ChartCell;
  document: NotebookDocument;
  model: string;
  onApplied(args: { document: NotebookDocument; proposalId: string; patch: NotebookPatch }): void;
  onClose(): void;
  onUndoApplied(proposalId: string): void;
  resultCount: number;
  selectedPeriodIndex: number;
  snapshot: NotebookAssistantSnapshot;
  undoAvailable: boolean;
  uiMessage?: string | null;
}) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [proposalId, setProposalId] = useState(`chart-ai-${cell.id}`);
  const [inlinePatch, setInlinePatch] = useState<NotebookAssistantInlinePatch | null>(null);
  const [semanticSummary, setSemanticSummary] = useState<string[]>([]);

  useEffect(() => {
    setInlinePatch((current) => {
      if (!current || current.status === "discarded") {
        return current;
      }
      return {
        ...current,
        preview: previewNotebookPatch(document, current.patch)
      };
    });
  }, [document]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || isAsking || !NOTEBOOK_ASSISTANT_API_URL) {
      return;
    }

    const nextProposalId = `chart-ai-${cell.id}-${crypto.randomUUID()}`;
    setProposalId(nextProposalId);
    setIsAsking(true);
    setError(null);
    setAnswerText("Working...");
    setInlinePatch(null);
    setSemanticSummary([]);

    try {
      let streamedText = "";
      const result = await runScopedNotebookAssistantProposal({
        betaPassword,
        model,
        onTextDelta: (delta) => {
          streamedText += delta;
          setAnswerText(streamedText);
        },
        question,
        resultCount,
        scope: { kind: "chart-update", cellId: cell.id },
        selectedPeriodIndex,
        snapshot,
        uiMessage: uiMessage ?? null
      });

      setAnswerText(result.text);
      setSemanticSummary(result.semanticSummary);
      setInlinePatch(result.inlinePatch);
      if (result.scopeViolations.length > 0 && !result.inlinePatch) {
        setError(result.scopeViolations[0] ?? null);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to prepare chart AI proposal.";
      setError(message);
      setAnswerText(`Chart AI request failed: ${message}`);
    } finally {
      setIsAsking(false);
    }
  }

  function updatePatch(updater: (patch: NotebookAssistantInlinePatch) => NotebookAssistantInlinePatch): void {
    setInlinePatch((current) => (current ? updater(current) : current));
  }

  function handleToggleJson(): void {
    updatePatch((patch) => ({
      ...patch,
      jsonText: patch.jsonText ?? JSON.stringify(patch.patch, null, 2),
      isJsonVisible: !patch.isJsonVisible
    }));
  }

  function handleUpdateJson(_proposalId: string, value: string): void {
    updatePatch((patch) => ({
      ...patch,
      isJsonDirty: true,
      jsonText: value
    }));
  }

  function handlePreviewJson(): void {
    if (!inlinePatch) {
      return;
    }

    try {
      const patch = parsePatchText(inlinePatch.jsonText ?? JSON.stringify(inlinePatch.patch, null, 2));
      const preview = previewNotebookPatch(document, patch);
      updatePatch((current) => ({
        ...current,
        isJsonDirty: false,
        patch,
        preview
      }));
    } catch (previewError) {
      updatePatch((current) => ({
        ...current,
        isJsonDirty: true,
        preview: failedPreview(
          previewError instanceof Error ? previewError.message : "Unable to parse assistant patch."
        )
      }));
    }
  }

  function handleDiscard(): void {
    updatePatch((patch) => ({
      ...patch,
      status: "discarded"
    }));
  }

  function handleApply(): void {
    if (!inlinePatch || inlinePatch.status !== "ready") {
      return;
    }
    if (inlinePatch.isJsonDirty) {
      setError("Preview patch JSON before applying.");
      return;
    }

    const result = applyNotebookPatch(document, inlinePatch.patch);
    updatePatch((patch) => ({
      ...patch,
      isJsonDirty: false,
      preview: result,
      status: result.ok ? "applied" : patch.status
    }));

    if (!result.ok) {
      setError("Chart AI patch has validation issues.");
      return;
    }

    setError(null);
    onApplied({
      document: result.document,
      patch: inlinePatch.patch,
      proposalId
    });
  }

  function handleUndo(): void {
    onUndoApplied(proposalId);
    updatePatch((patch) => ({
      ...patch,
      preview: previewNotebookPatch(document, patch.patch),
      status: "ready"
    }));
  }

  return (
    <section className="notebook-chart-ask-ai" aria-label={`Ask AI for chart ${cell.title}`}>
      <div className="notebook-chart-ask-ai-header">
        <div>
          <strong>Ask AI</strong>
          <p className="status-hint">
            Propose updates for this chart only. Changes are not applied until you review and accept them.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>

      <form className="notebook-chart-ask-ai-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field" htmlFor={promptId}>
          <span>Request</span>
          <textarea
            id={promptId}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={`Example: Show YD and Cd for ${cell.title}`}
            disabled={isAsking}
          />
        </label>
        <div className="button-row">
          <button type="submit" disabled={!prompt.trim() || isAsking || !NOTEBOOK_ASSISTANT_API_URL}>
            {isAsking ? "Working..." : "Prepare update"}
          </button>
        </div>
      </form>

      {error ? <div className="field-error">{error}</div> : null}
      {answerText ? (
        <div className="notebook-chart-ask-ai-answer">
          <AssistantMarkdown text={answerText} />
        </div>
      ) : null}
      {inlinePatch ? (
        <AssistantPatchProposalView
          patch={inlinePatch}
          proposalId={proposalId}
          semanticSummary={semanticSummary}
          undoAvailable={undoAvailable}
          onApply={() => handleApply()}
          onDiscard={() => handleDiscard()}
          onPreviewJson={() => handlePreviewJson()}
          onToggleJson={() => handleToggleJson()}
          onUndo={() => handleUndo()}
          onUpdateJson={handleUpdateJson}
        />
      ) : null}
    </section>
  );
}

function parsePatchText(value: string): NotebookPatch {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    return { operations: parsed as NotebookPatch["operations"] };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as NotebookPatch;
  }
  throw new Error("Patch JSON must be an object with operations or an operations array.");
}

function failedPreview(message: string): NotebookPatchResult {
  return {
    issues: [createAssistantPatchIssue(message)],
    ok: false,
    summary: { addedCells: 0, changedCells: 0, operationCount: 0, removedCells: 0 }
  };
}
