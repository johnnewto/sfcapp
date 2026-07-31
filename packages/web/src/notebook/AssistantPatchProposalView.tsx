import type { NotebookAssistantInlinePatch } from "./notebookAssistantRuntime";

export function AssistantPatchProposalView({
  onApply,
  onDiscard,
  onPreviewJson,
  onToggleJson,
  onUndo,
  onUpdateJson,
  proposalId,
  patch,
  semanticSummary,
  undoAvailable
}: {
  onApply: (proposalId: string) => void;
  onDiscard: (proposalId: string) => void;
  onPreviewJson: (proposalId: string) => void;
  onToggleJson: (proposalId: string) => void;
  onUndo: (proposalId: string) => void;
  onUpdateJson: (proposalId: string, value: string) => void;
  patch: NotebookAssistantInlinePatch;
  proposalId: string;
  semanticSummary?: string[];
  undoAvailable: boolean;
}) {
  const preview = patch.preview;
  const canApplyPatch = preview.ok && patch.status === "ready" && !patch.isJsonDirty;
  const statusText = patch.status === "applied"
    ? "applied"
    : patch.status === "discarded"
      ? "discarded"
      : patch.isJsonDirty
        ? "edited"
        : preview.ok
          ? "valid"
          : "invalid";

  return (
    <div className="notebook-assistant-inline-patch" role="group" aria-label="Assistant patch proposal">
      <div className="notebook-assistant-inline-patch-summary">
        <strong>Patch proposal</strong>
        {patch.isJsonDirty ? (
          <span>{statusText}. Preview JSON before applying.</span>
        ) : (
          <span>
            {statusText}. Operations: {preview.summary.operationCount}; added: {preview.summary.addedCells}; changed: {preview.summary.changedCells}; removed: {preview.summary.removedCells}.
          </span>
        )}
      </div>
      {semanticSummary && semanticSummary.length > 0 ? (
        <ul className="notebook-inline-list" aria-label="Proposal summary">
          {semanticSummary.map((line) => (
            <li key={line} className="status-hint">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.issues.length > 0 ? (
        <ul className="notebook-inline-list">
          {preview.issues.map((issue, index) => (
            <li key={`${issue.message}-${index}`} className={issue.severity === "error" ? "field-error" : "status-hint"}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="button-row notebook-assistant-inline-patch-actions">
        <button
          type="button"
          onClick={() => onApply(proposalId)}
          disabled={!canApplyPatch}
        >
          Apply
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onDiscard(proposalId)}
          disabled={patch.status !== "ready"}
        >
          Discard
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onToggleJson(proposalId)}
        >
          {patch.isJsonVisible ? "Hide JSON" : "Edit JSON"}
        </button>
        {patch.status === "applied" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onUndo(proposalId)}
            disabled={!undoAvailable}
          >
            Undo
          </button>
        ) : null}
      </div>
      {patch.isJsonVisible ? (
        <div className="notebook-assistant-inline-patch-editor">
          <textarea
            aria-label="Inline assistant patch JSON"
            className="notebook-utility-textarea notebook-assistant-inline-patch-json"
            readOnly={patch.status !== "ready"}
            rows={5}
            value={patch.jsonText ?? JSON.stringify(patch.patch, null, 2)}
            onChange={(event) => onUpdateJson(proposalId, event.target.value)}
          />
          {patch.status === "ready" ? (
            <div className="button-row notebook-assistant-inline-patch-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onPreviewJson(proposalId)}
                disabled={!patch.isJsonDirty && preview.ok}
              >
                Preview JSON
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
