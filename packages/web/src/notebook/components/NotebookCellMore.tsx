import { useId, useState } from "react";

import { AssistantMarkdown } from "../../components/AssistantMarkdown";
import type { VariableDescriptions } from "../../lib/variableDescriptions";
import type { VariableUnitMetadata } from "../../lib/unitMeta";

export function NotebookCellMore({
  currentValues,
  highlightedVariable,
  onSelectVariable,
  parameterNames,
  text,
  variableDescriptions,
  variableUnitMetadata
}: {
  currentValues?: Record<string, number | undefined>;
  highlightedVariable?: string | null;
  onSelectVariable?(variableName: string): void;
  parameterNames?: Set<string>;
  text: string;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
}) {
  const [open, setOpen] = useState(true);
  const panelId = useId();

  if (!text.trim()) {
    return null;
  }

  return (
    <div className="notebook-cell-more">
      {open ? (
        <div id={panelId} className="notebook-cell-more-panel">
          <AssistantMarkdown
            className="notebook-cell-more-markdown"
            currentValues={currentValues}
            highlightedVariable={highlightedVariable}
            onSelectVariable={onSelectVariable}
            parameterNames={parameterNames}
            text={text}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        </div>
      ) : null}
      <div className="notebook-cell-more-row">
        <button
          type="button"
          className="notebook-cell-more-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "less" : "more"}
        </button>
      </div>
    </div>
  );
}
