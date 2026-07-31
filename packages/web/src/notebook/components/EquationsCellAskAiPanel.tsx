import { useId, useState, type FormEvent } from "react";

import { AssistantMarkdown } from "../../components/AssistantMarkdown";
import { runScopedNotebookAssistantProposal } from "../notebookAssistantProposalRunner";
import { NOTEBOOK_ASSISTANT_API_URL } from "../notebookAssistantRuntime";
import type { NotebookAssistantSnapshot } from "../notebookAssistantTools";
import type { EquationsCell, NotebookDocument } from "../types";

export function EquationsCellAskAiPanel({
  betaPassword,
  cell,
  document,
  model,
  onClose,
  resultCount,
  selectedPeriodIndex,
  snapshot,
  uiMessage
}: {
  betaPassword: string;
  cell: EquationsCell;
  document: NotebookDocument;
  model: string;
  onClose(): void;
  resultCount: number;
  selectedPeriodIndex: number;
  snapshot: NotebookAssistantSnapshot;
  uiMessage?: string | null;
}) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || isAsking || !NOTEBOOK_ASSISTANT_API_URL) {
      return;
    }

    setIsAsking(true);
    setError(null);
    setAnswerText("Working...");

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
        scope: {
          kind: "equations-cell-ask",
          cellId: cell.id,
          modelId: cell.modelId
        },
        selectedPeriodIndex,
        snapshot: {
          ...snapshot,
          document
        },
        uiMessage: uiMessage ?? null
      });

      setAnswerText(result.text);
      if (result.scopeViolations.length > 0) {
        setError(result.scopeViolations[0] ?? null);
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unable to ask about this equations cell.";
      setError(message);
      setAnswerText(`Equations cell AI request failed: ${message}`);
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <section className="notebook-equation-ask-ai" aria-label={`Ask AI for equations cell ${cell.title}`}>
      <div className="notebook-equation-ask-ai-header">
        <div>
          <strong>Ask AI · {cell.title}</strong>
          <p className="status-hint">
            Ask about this equations cell and its related parameters. This cell-level ask is read-only and will not
            propose notebook edits.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>

      <form className="notebook-equation-ask-ai-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field" htmlFor={promptId}>
          <span>Request</span>
          <textarea
            id={promptId}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: Explain the household block, or how investment depends on the capital stock"
            disabled={isAsking}
          />
        </label>
        <div className="button-row">
          <button type="submit" disabled={!prompt.trim() || isAsking || !NOTEBOOK_ASSISTANT_API_URL}>
            {isAsking ? "Working..." : "Ask"}
          </button>
        </div>
      </form>

      {error ? <div className="field-error">{error}</div> : null}
      {answerText ? (
        <div className="notebook-equation-ask-ai-answer">
          <AssistantMarkdown text={answerText} />
        </div>
      ) : null}
    </section>
  );
}
