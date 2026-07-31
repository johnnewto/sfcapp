import type { NotebookAssistantMessage } from "./notebookAssistantRuntime";
import { AssistantPatchProposalView } from "./AssistantPatchProposalView";

export function AssistantInlinePatchView({
  message,
  onApply,
  onDiscard,
  onPreviewJson,
  onToggleJson,
  onUndo,
  onUpdateJson,
  undoStackLength
}: {
  message: NotebookAssistantMessage;
  onApply: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
  onPreviewJson: (messageId: string) => void;
  onToggleJson: (messageId: string) => void;
  onUndo: (messageId: string) => void;
  onUpdateJson: (messageId: string, value: string) => void;
  undoStackLength: number;
}) {
  if (!message.patch) {
    return null;
  }

  return (
    <AssistantPatchProposalView
      patch={message.patch}
      proposalId={message.id}
      onApply={onApply}
      onDiscard={onDiscard}
      onPreviewJson={onPreviewJson}
      onToggleJson={onToggleJson}
      onUndo={onUndo}
      onUpdateJson={onUpdateJson}
      undoAvailable={undoStackLength > 0}
    />
  );
}
