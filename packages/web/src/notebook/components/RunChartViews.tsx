import { ResultChart } from "../../components/ResultChart";
import { ScenarioShockVariableLine } from "../../components/ScenarioShockVariableLine";
import type { EditorState } from "../../lib/editorModel";
import { resolveInspectorModelSource, type VariableInspectRequest } from "../../lib/variableInspect";
import type { buildVariableUnitMetadata } from "../../lib/units";
import type { VariableDescriptions } from "../../lib/variableDescriptions";
import {
  buildScenarioShockMarkers,
  formatScenarioShockRunCellLabel,
  resolveShowScenarioShocks
} from "../../lib/scenarioShockMarkers";
import {
  applyChartCompareMode,
  canApplyChartCompareMode,
  filterReferenceTracesForCompareMode,
  resolveChartCompareMode,
  resolveCompareModeSharedRange
} from "../chartCompareMode";
import {
  buildReferenceTraceOverlaySeriesList,
  formatChartReferenceTraceLegend,
  resolveEffectiveScenarioStartPeriod,
  resolveReferenceTraces
} from "../chartReferenceTrace";
import {
  buildMcBandsForChart,
  buildResolvedChartSeriesRanges,
  buildResolvedChartSeriesWithUnits
} from "../chartSeries";
import { summarizeSolverBlocks } from "../../lib/solverBlockSummary";
import type { ChartCell, NotebookCell, RunCell } from "../types";
import type { useNotebookRunner } from "../useNotebookRunner";

export function RunCellView({
  cell,
  cells,
  currentValues,
  editor,
  onVariableInspectRequest,
  onShowSolverBlockDag,
  highlightedVariable = null,
  runner,
  variableDescriptions,
  variableUnitMetadata
}: {
  cell: RunCell;
  cells: NotebookCell[];
  currentValues: Record<string, number | undefined>;
  editor: EditorState | null;
  highlightedVariable?: string | null;
  onVariableInspectRequest(args: VariableInspectRequest): void;
  onShowSolverBlockDag?(): void;
  runner: ReturnType<typeof useNotebookRunner>;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: ReturnType<typeof buildVariableUnitMetadata>;
}) {
  const modelSource = resolveInspectorModelSource(cell);
  const baselineStartPeriod = resolveEffectiveScenarioStartPeriod(cells, cell);
  const result = runner.getResult(cell.id);
  const baselineRunCell =
    cell.mode === "scenario" && cell.baselineRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === cell.baselineRunCellId
        ) ?? null
      : null;
  const baselineResult = baselineRunCell ? runner.getResult(baselineRunCell.id) : null;
  const scenarioShockMarkers =
    cell.mode === "scenario" && cell.scenario?.shocks.length
      ? buildScenarioShockMarkers(cell, result, baselineResult)
      : [];
  const warnings = result?.warnings ?? [];
  const blockSummary = result?.blocks ? summarizeSolverBlocks(result.blocks) : null;
  const handleInspectVariable =
    editor == null
      ? undefined
      : (selectedVariable: string) => {
          onVariableInspectRequest({
            currentValues,
            editor,
            modelSource,
            sourceRunCellId: cell.id,
            selectedVariable,
            variableDescriptions,
            variableUnitMetadata
          });
        };

  return (
    <div className="notebook-run-summary">
      <div className="notebook-run-meta">
        <span className="notebook-run-meta-chip">
          Mode <strong>{cell.mode}</strong>
        </span>
        {cell.mode === "scenario" && cell.baselineRunCellId ? (
          <span className="notebook-run-meta-chip">
            Baseline <strong>{cell.baselineRunCellId}</strong>
          </span>
        ) : null}
        {cell.mode === "scenario" && baselineStartPeriod != null ? (
          <span className="notebook-run-meta-chip">
            Start period <strong>{baselineStartPeriod}</strong>
          </span>
        ) : null}
        {cell.periods != null ? (
          <span className="notebook-run-meta-chip">
            {cell.mode === "scenario" ? "Scenario periods" : "Periods"} <strong>{cell.periods}</strong>
          </span>
        ) : null}
        {blockSummary ? (
          onShowSolverBlockDag ? (
            <button
              type="button"
              className="notebook-run-meta-chip notebook-run-meta-chip-button"
              title={`${blockSummary.tooltip}\n\nClick to open block dependency graph.`}
              aria-label={`Solver block structure: ${blockSummary.ariaLabel}. Open block dependency graph.`}
              onClick={onShowSolverBlockDag}
            >
              Blocks <strong>{blockSummary.totalBlocks}</strong>
              {blockSummary.cyclicBlockCount > 0 ? (
                <>
                  {" · "}
                  <strong>{blockSummary.cyclicBlockCount}</strong> cyclic
                </>
              ) : null}
            </button>
          ) : (
            <span
              className="notebook-run-meta-chip"
              title={blockSummary.tooltip}
              aria-label={`Solver block structure: ${blockSummary.ariaLabel}. ${blockSummary.tooltip.replaceAll("\n", "; ")}`}
            >
              Blocks <strong>{blockSummary.totalBlocks}</strong>
              {blockSummary.cyclicBlockCount > 0 ? (
                <>
                  {" · "}
                  <strong>{blockSummary.cyclicBlockCount}</strong> cyclic
                </>
              ) : null}
            </span>
          )
        ) : null}
      </div>
      {scenarioShockMarkers.length ? (
        <ul className="notebook-run-scenarios">
          {scenarioShockMarkers.map((marker) => (
            <li
              key={`${cell.id}-shock-${marker.shockIndex}`}
              className="notebook-run-shock"
              aria-label={formatScenarioShockRunCellLabel(marker)}
            >
              <div className="notebook-run-shock-line">
                <span className="notebook-run-shock-period-label">
                  Period {marker.startPeriodInclusive} to {marker.endPeriodInclusive}
                </span>
                {marker.variables.length > 0 ? (
                  <>
                    {",  "}
                    {marker.variables.map((entry, entryIndex) => (
                      <span key={`${marker.shockIndex}-${entry.name}`} className="notebook-run-shock-variable">
                        {entryIndex > 0 ? ", " : null}
                        {handleInspectVariable ? (
                          <ScenarioShockVariableLine
                            entry={entry}
                            highlightedVariable={highlightedVariable}
                            inspectButtonClassName="notebook-run-shock-variable-button"
                            onInspect={handleInspectVariable}
                          />
                        ) : (
                          <ScenarioShockVariableLine entry={entry} />
                        )}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <div className="notebook-run-warnings" role="status" aria-label="Run warnings">
          <div className="notebook-run-warning-heading">Warnings</div>
          <ul className="notebook-run-warning-list">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.message}-${index}`} className="notebook-run-warning-item">
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ChartCellView({
  cell,
  cells,
  currentValues,
  editor,
  gridAxisFontSize,
  onAddVariable,
  onMoveVariable,
  onRemoveVariable,
  onTimeRangeInclusiveChange,
  onVariableInspectRequest,
  originYear,
  runner,
  selectedPeriodIndex,
  highlightedVariable = null,
  variableDescriptions,
  variableUnitMetadata
}: {
  cell: ChartCell;
  cells: NotebookCell[];
  currentValues: Record<string, number | undefined>;
  editor: EditorState | null;
  gridAxisFontSize?: number;
  highlightedVariable?: string | null;
  onAddVariable?(variableName: string): void;
  onMoveVariable?(variableName: string, direction: "left" | "right"): void;
  onRemoveVariable?(variableName: string): void;
  onTimeRangeInclusiveChange?(range: [number, number] | undefined): void;
  onVariableInspectRequest?(args: VariableInspectRequest): void;
  originYear?: number;
  runner: ReturnType<typeof useNotebookRunner>;
  selectedPeriodIndex: number;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: ReturnType<typeof buildVariableUnitMetadata>;
}) {
  const result = runner.getResult(cell.sourceRunCellId);
  if (!result) {
    return null;
  }

  const sourceRunCell = cells.find(
    (candidate): candidate is RunCell =>
      candidate.type === "run" && candidate.id === cell.sourceRunCellId
  );
  const baselineRunCell =
    sourceRunCell?.mode === "scenario" && sourceRunCell.baselineRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCell.baselineRunCellId
        )
      : null;
  const baselineResult = baselineRunCell ? runner.getResult(baselineRunCell.id) : null;
  const previousResult = runner.getPreviousResult(cell.sourceRunCellId);
  const baselineStartPeriod = sourceRunCell
    ? resolveEffectiveScenarioStartPeriod(cells, sourceRunCell)
    : undefined;
  const levelSeries = buildResolvedChartSeriesWithUnits(
    cell,
    result,
    variableUnitMetadata,
    (runCellId) => runner.getResult(runCellId)
  );
  const compareMode = resolveChartCompareMode(cell);
  const compareModeApplicable = canApplyChartCompareMode({
    sourceRunCell,
    baselineStartPeriod,
    baselineResult
  });
  const series = applyChartCompareMode({
    cell,
    series: levelSeries,
    sourceRunCell,
    baselineStartPeriod,
    baselineResult
  });
  const seriesRanges = buildResolvedChartSeriesRanges(cell, series);
  const periodLabelOffset = baselineStartPeriod != null ? baselineStartPeriod - 1 : 0;
  const chartSelectedIndex =
    baselineStartPeriod != null
      ? Math.max(selectedPeriodIndex - periodLabelOffset, 0)
      : selectedPeriodIndex;
  const hasObserved = result.observed != null && Object.keys(result.observed).length > 0;
  const referenceTraces = filterReferenceTracesForCompareMode(
    resolveReferenceTraces(cell, sourceRunCell, hasObserved),
    compareModeApplicable ? compareMode : "levels"
  );
  const overlaySeries = buildReferenceTraceOverlaySeriesList({
    cell,
    referenceTraces,
    result,
    resolvedSeries: levelSeries,
    sourceRunCell,
    baselineStartPeriod,
    baselineResult,
    previousResult
  });
  const overlayTraceKinds = new Set(overlaySeries.map((entry) => entry.referenceTraceKind));
  const referenceTraceLegendLabels = referenceTraces
    .filter((trace) => overlayTraceKinds.has(trace))
    .map((trace) => ({
      kind: trace,
      label: formatChartReferenceTraceLegend(trace)
    }));
  const timeRangeDefaults = resolveChartTimeRangeDefaults(series[0]?.values.length ?? 0);
  const sharedRange = resolveCompareModeSharedRange(cell, compareModeApplicable);
  const addVariableOptions = Object.entries(result.series)
    .filter(([, values]) => values.length > 1 && Array.from(values).some(Number.isFinite))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  const scenarioShocks = resolveShowScenarioShocks(cell, sourceRunCell)
    ? buildScenarioShockMarkers(sourceRunCell, result, baselineResult)
    : [];
  const mcBands = buildMcBandsForChart(cell, result, levelSeries).map((band) => ({
    seriesName: band.seriesName,
    lo: band.lo,
    hi: band.hi
  }));
  const modelSource = sourceRunCell ? resolveInspectorModelSource(sourceRunCell) : null;
  const handleInspectScenarioShockVariable =
    editor == null || sourceRunCell == null || !onVariableInspectRequest
      ? undefined
      : (selectedVariable: string) => {
          onVariableInspectRequest({
            currentValues,
            editor,
            modelSource,
            sourceRunCellId: sourceRunCell.id,
            selectedVariable,
            variableDescriptions,
            variableUnitMetadata
          });
        };

  return (
    <ResultChart
      addVariableOptions={addVariableOptions}
      axisMode={cell.axisMode ?? "shared"}
      axisGroups={cell.axisGroups}
      axisSnapTolarance={cell.axisSnapTolarance}
      niceScale={cell.niceScale}
      onAddVariable={onAddVariable}
      onInspectScenarioShockVariable={handleInspectScenarioShockVariable}
      onMoveVariable={onMoveVariable}
      onRemoveVariable={onRemoveVariable}
      onTimeRangeInclusiveChange={onTimeRangeInclusiveChange}
      overlaySeries={overlaySeries}
      bands={mcBands}
      periodLabelOffset={periodLabelOffset}
      originYear={originYear}
      referenceTraceLegendLabels={referenceTraceLegendLabels}
      scenarioShocks={scenarioShocks}
      seriesRanges={seriesRanges}
      selectedIndex={chartSelectedIndex}
      series={series}
      showAxisSummary={false}
      sharedRange={sharedRange}
      timeRangeDefaults={timeRangeDefaults}
      timeRangeInclusive={cell.timeRangeInclusive}
      highlightedVariable={highlightedVariable}
      variableDescriptions={variableDescriptions}
      variableUnitMetadata={variableUnitMetadata}
      xAxisTitle={cell.xAxis?.title}
      yAxis={cell.yAxis}
      yAxisTickCount={cell.yAxisTickCount}
      axisFontSize={cell.axisFontSize ?? gridAxisFontSize}
    />
  );
}

function resolveChartTimeRangeDefaults(
  seriesLength: number
): { endPeriodInclusive: number; startPeriodInclusive: number } {
  return {
    startPeriodInclusive: 1,
    endPeriodInclusive: Math.max(seriesLength, 1)
  };
}
