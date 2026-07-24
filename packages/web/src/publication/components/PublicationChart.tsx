import { useMemo, useState } from "react";

import type { SimulationResult } from "@sfcr/core";

import { ResultChart } from "../../components/ResultChart";
import {
  applyChartCompareMode,
  canApplyChartCompareMode,
  filterReferenceTracesForCompareMode,
  resolveChartCompareMode,
  resolveCompareModeSharedRange
} from "../../notebook/chartCompareMode";
import {
  buildReferenceTraceOverlaySeriesList,
  formatChartReferenceTraceLegend,
  resolveEffectiveScenarioStartPeriod,
  resolveReferenceTraces
} from "../../notebook/chartReferenceTrace";
import { buildNotebookVariableUnitMetadata } from "../../notebook/notebookAppHelpers";
import {
  appendChartVariable,
  buildMcBandsForChart,
  buildResolvedChartSeriesRanges,
  buildResolvedChartSeriesWithUnits,
  moveChartSeriesByDisplayName,
  removeChartSeriesByDisplayName,
  setChartTimeRangeInclusive
} from "../../notebook/chartSeries";
import type { ChartCell, NotebookCell, RunCell } from "../../notebook/types";
import {
  buildScenarioShockMarkers,
  resolveShowScenarioShocks
} from "../../lib/scenarioShockMarkers";
import { buildPublicationVariableDescriptions } from "../publicationVariables";
import type { PublicationVariableInteraction } from "../publicationInspect";

export function PublicationChart({
  cell,
  cells,
  getResult,
  gridAxisFontSize,
  interaction,
  interactive = false,
  originYear,
  result,
  selectedPeriodIndex
}: {
  cell: ChartCell;
  cells: NotebookCell[];
  getResult(runCellId: string): SimulationResult | null;
  gridAxisFontSize?: number;
  interaction: PublicationVariableInteraction;
  interactive?: boolean;
  originYear?: number;
  result: SimulationResult | null;
  selectedPeriodIndex: number;
}) {
  const [chartCell, setChartCell] = useState<ChartCell>(cell);
  const activeCell = interactive ? chartCell : cell;

  const variableUnitMetadata = useMemo(() => buildNotebookVariableUnitMetadata(cells), [cells]);
  const variableDescriptions = useMemo(() => buildPublicationVariableDescriptions(cells), [cells]);

  if (!result) {
    return <p className="publication-status-hint">Chart data is not available.</p>;
  }

  const addVariableOptions = interactive
    ? Object.entries(result.series)
        .filter(([, values]) => values.length > 1 && Array.from(values).some(Number.isFinite))
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right))
    : undefined;

  const levelSeries = buildResolvedChartSeriesWithUnits(
    activeCell,
    result,
    variableUnitMetadata,
    getResult
  );
  if (
    levelSeries.length === 0 &&
    !(interactive && addVariableOptions != null && addVariableOptions.length > 0)
  ) {
    return <p className="publication-status-hint">Chart data is not available.</p>;
  }

  const sourceRunCell = cells.find(
    (candidate): candidate is RunCell =>
      candidate.type === "run" && candidate.id === activeCell.sourceRunCellId
  );
  const baselineRunCell =
    sourceRunCell?.mode === "scenario" && sourceRunCell.baselineRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCell.baselineRunCellId
        )
      : null;
  const baselineResult = baselineRunCell ? getResult(baselineRunCell.id) : null;
  const baselineStartPeriod = sourceRunCell
    ? resolveEffectiveScenarioStartPeriod(cells, sourceRunCell)
    : undefined;
  const compareMode = resolveChartCompareMode(activeCell);
  const compareModeApplicable = canApplyChartCompareMode({
    sourceRunCell,
    baselineStartPeriod,
    baselineResult
  });
  const series = applyChartCompareMode({
    cell: activeCell,
    series: levelSeries,
    sourceRunCell,
    baselineStartPeriod,
    baselineResult
  });
  const seriesRanges = buildResolvedChartSeriesRanges(activeCell, series);
  const seriesLength = Math.max(...series.map((entry) => entry.values.length), 1);
  const sharedRange = resolveCompareModeSharedRange(activeCell, compareModeApplicable);
  const hasObserved = result.observed != null && Object.keys(result.observed).length > 0;
  const referenceTraces = filterReferenceTracesForCompareMode(
    resolveReferenceTraces(activeCell, sourceRunCell, hasObserved),
    compareModeApplicable ? compareMode : "levels"
  );
  const overlaySeries = buildReferenceTraceOverlaySeriesList({
    cell: activeCell,
    referenceTraces,
    result,
    resolvedSeries: levelSeries,
    sourceRunCell,
    baselineStartPeriod,
    baselineResult
  });
  const overlayTraceKinds = new Set(overlaySeries.map((entry) => entry.referenceTraceKind));
  const referenceTraceLegendLabels = referenceTraces
    .filter((trace) => overlayTraceKinds.has(trace))
    .map((trace) => ({
      kind: trace,
      label: formatChartReferenceTraceLegend(trace)
    }));
  const scenarioShocks = resolveShowScenarioShocks(activeCell, sourceRunCell)
    ? buildScenarioShockMarkers(sourceRunCell, result, baselineResult)
    : [];
  const mcBands = buildMcBandsForChart(activeCell, result, levelSeries).map((band) => ({
    seriesName: band.seriesName,
    lo: band.lo,
    hi: band.hi
  }));

  return (
    <div className="publication-chart">
      <ResultChart
        addVariableOptions={addVariableOptions}
        axisMode={activeCell.axisMode ?? "shared"}
        axisGroups={activeCell.axisGroups}
        axisSnapTolarance={activeCell.axisSnapTolarance}
        niceScale={activeCell.niceScale}
        highlightedVariable={interaction.highlightedVariable}
        onAddVariable={
          interactive
            ? (variableName) =>
                setChartCell((current) => appendChartVariable(current, variableName))
            : undefined
        }
        onInspectScenarioShockVariable={interaction.onSelectVariable}
        onMoveVariable={
          interactive
            ? (variableName, direction) =>
                setChartCell((current) =>
                  moveChartSeriesByDisplayName(current, variableName, direction)
                )
            : undefined
        }
        onRemoveVariable={
          interactive
            ? (variableName) =>
                setChartCell((current) => removeChartSeriesByDisplayName(current, variableName))
            : undefined
        }
        onTimeRangeInclusiveChange={
          interactive
            ? (range) => setChartCell((current) => setChartTimeRangeInclusive(current, range))
            : undefined
        }
        overlaySeries={overlaySeries}
        bands={mcBands}
        periodLabelOffset={0}
        originYear={originYear}
        referenceTraceLegendLabels={referenceTraceLegendLabels}
        scenarioShocks={scenarioShocks}
        selectedIndex={Math.min(selectedPeriodIndex, seriesLength - 1)}
        series={series}
        seriesRanges={seriesRanges}
        sharedRange={sharedRange}
        showAxisSummary={false}
        timeRangeDefaults={{
          endPeriodInclusive: seriesLength,
          startPeriodInclusive: 1
        }}
        timeRangeInclusive={activeCell.timeRangeInclusive}
        timeRangeSlider={interactive ? "auto" : false}
        variableDescriptions={variableDescriptions}
        variableUnitMetadata={variableUnitMetadata}
        xAxisTitle={activeCell.xAxis?.title}
        yAxis={activeCell.yAxis}
        yAxisTickCount={activeCell.yAxisTickCount}
        axisFontSize={activeCell.axisFontSize ?? gridAxisFontSize}
      />
    </div>
  );
}
