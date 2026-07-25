import type { SimulationResult } from "@sfcr/core";

import type { VariableUnitMetadata } from "../lib/unitMeta";
import type { VariableDescriptions } from "../lib/variableDescriptions";
import { evaluateMatrixEntryNumber } from "./matrixAccountSumRow";
import type { MatrixCell } from "./types";

export interface MatrixGraphRequest {
  index: number;
  kind: MatrixGraphSliceKind;
  label: string;
  matrixCellId: string;
  matrixTitle: string;
  series: MatrixGraphSeriesEntry[];
  sourceRunCellId: string;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
}

export type MatrixGraphSliceKind = "row" | "column";

export type MatrixGraphLegendMode = "expression" | "cross";

export interface MatrixGraphSeriesEntry {
  crossLabel: string;
  label: string;
  source: string;
  values: number[];
}

export interface MatrixGraphChartSeries {
  highlightKey: string;
  legendTooltip?: string;
  name: string;
  values: number[];
}

function isGraphableMatrixSource(source: string): boolean {
  const trimmed = source.trim();
  return trimmed.length > 0 && trimmed !== "0";
}

function resolveMatrixSeriesLength(result: SimulationResult): number {
  return Math.max(...Object.values(result.series).map((values) => values.length), 0);
}

export function buildMatrixEntryTimeSeries(source: string, result: SimulationResult): number[] {
  const length = resolveMatrixSeriesLength(result);
  if (length <= 0) {
    return [];
  }

  return Array.from({ length }, (_, periodIndex) => {
    const value = evaluateMatrixEntryNumber(source, result, periodIndex);
    return value ?? Number.NaN;
  });
}

function isGraphableTimeSeries(values: ArrayLike<number>): boolean {
  if (values.length <= 1) {
    return false;
  }
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(values[i])) {
      return true;
    }
  }
  return false;
}

function resolveSumIndices(cell: MatrixCell): { sumColumnIndex: number; sumRowIndex: number } {
  return {
    sumColumnIndex: cell.columns.findIndex((column) => column.trim().toLowerCase() === "sum"),
    sumRowIndex: cell.rows.findIndex((row) => row.label.trim().toLowerCase() === "sum")
  };
}

function formatMatrixGraphRowCrossLabel(
  row: MatrixCell["rows"][number],
  rowIndex: number,
  rows: MatrixCell["rows"]
): string {
  const label = row.label.trim();
  const band = row.band?.trim();

  if (label) {
    const duplicateLabelCount = rows.filter(
      (candidate) => candidate.label.trim().toLowerCase() === label.toLowerCase()
    ).length;
    if (duplicateLabelCount > 1 && band && band.toLowerCase() !== label.toLowerCase()) {
      return `${band}: ${label}`;
    }
    return label;
  }

  return band || `Row ${rowIndex + 1}`;
}

function formatMatrixGraphColumnCrossLabel(cell: MatrixCell, columnIndex: number): string {
  return cell.columns[columnIndex]?.trim() || `Column ${columnIndex + 1}`;
}

function pushMatrixGraphSeriesEntry(
  entries: MatrixGraphSeriesEntry[],
  args: {
    crossLabel: string;
    source: string;
    result: SimulationResult;
  }
): void {
  const { crossLabel, source, result } = args;
  if (!isGraphableMatrixSource(source)) {
    return;
  }

  const values = buildMatrixEntryTimeSeries(source, result);
  if (!isGraphableTimeSeries(values)) {
    return;
  }

  entries.push({
    crossLabel,
    label: source.trim(),
    source,
    values
  });
}

export function collectMatrixRowGraphSeries(
  cell: MatrixCell,
  rowIndex: number,
  result: SimulationResult
): MatrixGraphSeriesEntry[] {
  const { sumColumnIndex, sumRowIndex } = resolveSumIndices(cell);
  if (rowIndex === sumRowIndex) {
    return [];
  }

  const row = cell.rows[rowIndex];
  if (!row) {
    return [];
  }

  const entries: MatrixGraphSeriesEntry[] = [];
  row.values.forEach((source, columnIndex) => {
    if (columnIndex === sumColumnIndex) {
      return;
    }

    pushMatrixGraphSeriesEntry(entries, {
      crossLabel: formatMatrixGraphColumnCrossLabel(cell, columnIndex),
      source,
      result
    });
  });

  return entries;
}

export function collectMatrixColumnGraphSeries(
  cell: MatrixCell,
  columnIndex: number,
  result: SimulationResult
): MatrixGraphSeriesEntry[] {
  const { sumColumnIndex, sumRowIndex } = resolveSumIndices(cell);
  if (columnIndex === sumColumnIndex) {
    return [];
  }

  const entries: MatrixGraphSeriesEntry[] = [];
  cell.rows.forEach((row, rowIndex) => {
    if (rowIndex === sumRowIndex) {
      return;
    }

    pushMatrixGraphSeriesEntry(entries, {
      crossLabel: formatMatrixGraphRowCrossLabel(row, rowIndex, cell.rows),
      source: row.values[columnIndex] ?? "",
      result
    });
  });

  return entries;
}

export function resolveMatrixGraphChartSeries(
  series: MatrixGraphSeriesEntry[],
  legendMode: MatrixGraphLegendMode,
  result?: SimulationResult | null
): MatrixGraphChartSeries[] {
  const nameCounts = new Map<string, number>();

  return series.map((entry) => {
    const baseName = legendMode === "cross" ? entry.crossLabel : entry.label;
    const seenCount = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, seenCount);
    const name = seenCount > 1 ? `${baseName} (${entry.label})` : baseName;
    const liveValues = result ? buildMatrixEntryTimeSeries(entry.source, result) : null;
    const values =
      liveValues && isGraphableTimeSeries(liveValues) ? liveValues : Array.from(entry.values);

    return {
      highlightKey: entry.source,
      name,
      values,
      legendTooltip:
        legendMode === "cross"
          ? entry.label
          : entry.crossLabel !== entry.label
            ? entry.crossLabel
            : undefined
    };
  });
}

export function matrixGraphChartHasExternalSeries(
  chartSeries: MatrixGraphSeriesEntry[],
  sliceSeries: MatrixGraphSeriesEntry[]
): boolean {
  const sliceSources = new Set(sliceSeries.map((entry) => entry.source.trim()));
  return chartSeries.some((entry) => !sliceSources.has(entry.source.trim()));
}

export function matrixGraphCrossLegendHint(kind: MatrixGraphSliceKind): string {
  return kind === "row" ? "column labels" : "row labels";
}

export function collectMatrixGraphSliceSeries(
  cell: MatrixCell,
  kind: MatrixGraphSliceKind,
  index: number,
  result: SimulationResult
): MatrixGraphSeriesEntry[] {
  return kind === "row"
    ? collectMatrixRowGraphSeries(cell, index, result)
    : collectMatrixColumnGraphSeries(cell, index, result);
}

export function listAddableMatrixGraphSeries(
  chartSeries: MatrixGraphSeriesEntry[],
  sliceSeries: MatrixGraphSeriesEntry[]
): MatrixGraphSeriesEntry[] {
  const activeSources = new Set(chartSeries.map((entry) => entry.source));
  return sliceSeries.filter((entry) => !activeSources.has(entry.source));
}

export function listAddableMatrixGraphSources(
  chartSeries: MatrixGraphSeriesEntry[],
  sliceSeries: MatrixGraphSeriesEntry[],
  result: SimulationResult | null | undefined
): string[] {
  const activeSources = new Set(chartSeries.map((entry) => entry.source.trim()));
  const fromSlice = listAddableMatrixGraphSeries(chartSeries, sliceSeries).map((entry) => entry.source);
  const fromRun = result
    ? Object.entries(result.series)
        .filter(
          ([name, values]) =>
            !activeSources.has(name.trim()) &&
            values.length > 1 &&
            values.some(Number.isFinite)
        )
        .map(([name]) => name)
    : [];

  return Array.from(new Set([...fromSlice, ...fromRun])).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function resolveMatrixGraphSeriesEntryToAdd(
  source: string,
  sliceSeries: MatrixGraphSeriesEntry[],
  result: SimulationResult,
  variableDescriptions?: VariableDescriptions
): MatrixGraphSeriesEntry | null {
  const trimmed = source.trim();
  const fromSlice = sliceSeries.find(
    (entry) => entry.source === source || entry.source.trim() === trimmed
  );
  if (fromSlice) {
    return fromSlice;
  }

  const values = result.series[source] ?? result.series[trimmed];
  if (!values || !isGraphableTimeSeries(values)) {
    return null;
  }

  const description = variableDescriptions?.get(source) ?? variableDescriptions?.get(trimmed);

  return {
    crossLabel: description ?? trimmed,
    label: trimmed,
    source: trimmed,
    values: Array.from(values)
  };
}
