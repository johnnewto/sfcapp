import type { SimulationResult } from "@sfcr/core";

import type { AbmModelCell, NotebookCell } from "../notebook/types";
import { AbmModelCellView } from "../notebook/components/AbmModelCellView";
import type { PublicationSection } from "./buildPublicationViewModel";
import { PublicationAppendixSection } from "./components/PublicationAppendix";
import { PublicationCaption } from "./components/PublicationCaption";
import { PublicationChart } from "./components/PublicationChart";
import { PublicationChartGrid } from "./components/PublicationChartGrid";
import { PublicationEquations } from "./components/PublicationEquations";
import { PublicationMarkdown } from "./components/PublicationMarkdown";
import { PublicationMore } from "./components/PublicationMore";
import { PublicationMatrix } from "./components/PublicationMatrix";
import { PublicationSequence } from "./components/PublicationSequence";
import { PublicationSankey } from "./components/PublicationSankey";
import { PublicationTable } from "./components/PublicationTable";
import type { MatrixGraphRequest } from "../notebook/matrixSliceGraph";
import {
  cycleMatrixEntryDisplayMode,
  formatMatrixEntryDisplayMode,
  type MatrixEntryDisplayMode
} from "../notebook/matrixEntryDisplay";
import type { PublicationVariableInteraction } from "./publicationInspect";

export function PublicationCellView({
  cells,
  getResult,
  interaction,
  interactiveCharts = false,
  matrixEntryDisplayMode = "equation",
  onMatrixEntryDisplayModeChange,
  onRequestMatrixGraph,
  originYear,
  section,
  selectedPeriodIndex,
  showHeading = true
}: {
  cells: NotebookCell[];
  getResult(runCellId: string): SimulationResult | null;
  interaction: PublicationVariableInteraction;
  interactiveCharts?: boolean;
  matrixEntryDisplayMode?: MatrixEntryDisplayMode;
  onMatrixEntryDisplayModeChange?(mode: MatrixEntryDisplayMode): void;
  onRequestMatrixGraph?(request: MatrixGraphRequest): void;
  originYear?: number;
  section: PublicationSection;
  selectedPeriodIndex: number;
  showHeading?: boolean;
}) {
  const { cell } = section;
  const moreNode = cell.more?.trim() ? (
    <PublicationMore interaction={interaction} source={cell.more} />
  ) : null;

  if (section.kind === "prose" && cell.type === "markdown") {
    return (
      <section id={section.anchorId} className="publication-section publication-section-prose">
        {showHeading && cell.title.trim() ? (
          <h2 className="publication-section-heading">{cell.title}</h2>
        ) : null}
        <PublicationMarkdown interaction={interaction} source={cell.source} />
        {moreNode}
      </section>
    );
  }

  if (section.kind === "equations" && (cell.type === "equations" || cell.type === "model")) {
    return (
      <section id={section.anchorId} className="publication-section publication-section-equations">
        {showHeading ? <h2 className="publication-section-heading">{cell.title}</h2> : null}
        <PublicationEquations cell={cell} interaction={interaction} />
        {cell.description?.trim() || cell.note?.trim() ? (
          <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        ) : null}
        {moreNode}
      </section>
    );
  }

  if (section.kind === "abm-model" && cell.type === "abm-model") {
    return (
      <section id={section.anchorId} className="publication-section publication-section-abm-model">
        {showHeading ? <h2 className="publication-section-heading">{cell.title}</h2> : null}
        <AbmModelCellView
          cell={cell as AbmModelCell}
          currentValues={interaction.currentValues}
          highlightedVariable={interaction.highlightedVariable}
          onVariableInspectRequest={
            interaction.onSelectVariable
              ? ({ selectedVariable }) => interaction.onSelectVariable?.(selectedVariable)
              : undefined
          }
          variableDescriptions={interaction.variableDescriptions}
          variableUnitMetadata={interaction.variableUnitMetadata}
        />
        {cell.description?.trim() || cell.note?.trim() ? (
          <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        ) : null}
        {moreNode}
      </section>
    );
  }

  if (section.kind === "matrix" && cell.type === "matrix") {
    const matrixDisplayLabel = formatMatrixEntryDisplayMode(matrixEntryDisplayMode);
    return (
      <figure id={section.anchorId} className="publication-section publication-section-matrix">
        {onMatrixEntryDisplayModeChange ? (
          <div className="publication-matrix-controls publication-no-print">
            <button
              type="button"
              className="publication-matrix-display-toggle"
              aria-label={`Matrix cell display: ${matrixDisplayLabel}. Activate to change.`}
              title={`Matrix cells show ${matrixDisplayLabel.toLowerCase()}`}
              onClick={() =>
                onMatrixEntryDisplayModeChange(cycleMatrixEntryDisplayMode(matrixEntryDisplayMode))
              }
            >
              Cells: {matrixDisplayLabel}
            </button>
          </div>
        ) : null}
        <PublicationMatrix
          cell={cell}
          entryDisplayMode={matrixEntryDisplayMode}
          getResult={getResult}
          interaction={interaction}
          onRequestMatrixGraph={onRequestMatrixGraph}
          selectedPeriodIndex={selectedPeriodIndex}
        />
        <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        {moreNode}
      </figure>
    );
  }

  if (section.kind === "sequence" && cell.type === "sequence") {
    return (
      <figure id={section.anchorId} className="publication-section publication-section-sequence">
        <PublicationSequence
          cell={cell}
          cells={cells}
          getResult={getResult}
          interaction={interaction}
          selectedPeriodIndex={selectedPeriodIndex}
        />
        <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        {moreNode}
      </figure>
    );
  }

  if (section.kind === "sankey" && cell.type === "sankey") {
    return (
      <figure id={section.anchorId} className="publication-section publication-section-sankey">
        <PublicationSankey
          cell={cell}
          cells={cells}
          getResult={getResult}
          selectedPeriodIndex={selectedPeriodIndex}
        />
        <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        {moreNode}
      </figure>
    );
  }

  if (section.kind === "chart" && (cell.type === "chart" || cell.type === "chart-grid")) {
    return (
      <figure id={section.anchorId} className="publication-section publication-section-chart">
        {cell.type === "chart" ? (
          <PublicationChart
            cell={cell}
            cells={cells}
            getResult={getResult}
            interaction={interaction}
            interactive={interactiveCharts}
            originYear={originYear}
            result={getResult(cell.sourceRunCellId)}
            selectedPeriodIndex={selectedPeriodIndex}
          />
        ) : (
          <PublicationChartGrid
            cell={cell}
            cells={cells}
            getResult={getResult}
            interaction={interaction}
            interactive={interactiveCharts}
            originYear={originYear}
            selectedPeriodIndex={selectedPeriodIndex}
          />
        )}
        <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        {moreNode}
      </figure>
    );
  }

  if (section.kind === "table" && cell.type === "table") {
    return (
      <figure id={section.anchorId} className="publication-section publication-section-table">
        <PublicationTable cell={cell} cells={cells} interaction={interaction} />
        <PublicationCaption description={cell.description} note={cell.note} title={cell.title} />
        {moreNode}
      </figure>
    );
  }

  if (section.kind === "run" && cell.type === "run") {
    const runText = [cell.description?.trim(), cell.note?.trim()].filter(Boolean).join(" ");
    return (
      <section id={section.anchorId} className="publication-section publication-section-prose">
        {showHeading && cell.title.trim() ? (
          <h2 className="publication-section-heading">{cell.title}</h2>
        ) : null}
        {runText ? <p>{runText}</p> : null}
        {moreNode}
      </section>
    );
  }

  if (section.kind === "appendix") {
    return (
      <section id={section.anchorId} className="publication-section publication-section-appendix">
        <h3 className="publication-appendix-heading">{cell.title}</h3>
        <PublicationAppendixSection cell={cell} interaction={interaction} />
        {moreNode}
      </section>
    );
  }

  return null;
}
