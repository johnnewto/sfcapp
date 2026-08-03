import { AssistantMarkdown } from "../../components/AssistantMarkdown";
import type { PublicationVariableInteraction } from "../publicationInspect";

export function PublicationMarkdown({
  interaction,
  source
}: {
  interaction: PublicationVariableInteraction;
  source: string;
}) {
  return (
    <AssistantMarkdown
      className="publication-markdown"
      currentValues={interaction.currentValues}
      highlightedVariable={interaction.highlightedVariable}
      onSelectVariable={interaction.onSelectVariable}
      parameterNames={interaction.parameterNames}
      text={source}
      variableDescriptions={interaction.variableDescriptions}
      variableUnitMetadata={interaction.variableUnitMetadata}
    />
  );
}
