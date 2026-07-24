import type { SimulationResult } from "@sfcr/core";
import type { ChartAxisRange, ChartCell, ChartSeriesSpec } from "@sfcr/notebook-core";

import { getVariableUnitLabel } from "../lib/units";
import type { VariableUnitMetadata } from "../lib/unitMeta";
import { buildMatrixEntryTimeSeries } from "./matrixSliceGraph";

export interface ResolvedChartSeries {
  highlightKey: string;
  name: string;
  values: number[];
  unit?: string;
}

interface NamedChartSeriesSpec {
  expression: string;
  name: string;
  spec: ChartSeriesSpec;
}

function isGraphableTimeSeries(values: number[]): boolean {
  return values.length > 1 && values.some(Number.isFinite);
}

/** Matches a bare variable name (no operators), used to detect `"name, runId"` shorthand. */
const BARE_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_^]*$/;

export function isBareVariableName(name: string): boolean {
  return BARE_VARIABLE_NAME.test(name.trim());
}

/**
 * Parses a `variables` shorthand entry. A bare variable name optionally followed
 * by `, <runId>` selects that run as the series source (Option A shorthand,
 * e.g. `"Cd, xy_run"`). Anything whose left side is not a bare name (such as a
 * matrix/function expression containing commas) is treated as a raw expression.
 */
function parseVariableShorthand(entry: string): ChartSeriesSpec {
  const commaIndex = entry.indexOf(",");
  if (commaIndex === -1) {
    return { expression: entry };
  }

  const left = entry.slice(0, commaIndex).trim();
  const right = entry.slice(commaIndex + 1).trim();
  if (left && right && BARE_VARIABLE_NAME.test(left)) {
    return { expression: left, sourceRunCellId: right };
  }

  return { expression: entry };
}

export function resolveChartSeriesSpecs(cell: Pick<ChartCell, "series" | "variables">): ChartSeriesSpec[] {
  if (cell.series != null && cell.series.length > 0) {
    return cell.series;
  }

  return (cell.variables ?? []).map((entry) => parseVariableShorthand(entry));
}

function resolveChartSeriesDisplayName(
  spec: ChartSeriesSpec,
  seenNames: Map<string, number>
): string {
  const baseName = spec.label?.trim() || spec.expression.trim();
  const seenCount = (seenNames.get(baseName) ?? 0) + 1;
  seenNames.set(baseName, seenCount);

  if (seenCount > 1) {
    // Prefer the source run id to disambiguate the same variable drawn from
    // different runs; fall back to the expression otherwise.
    const qualifier = spec.sourceRunCellId?.trim() || spec.expression.trim();
    return `${baseName} (${qualifier})`;
  }

  return baseName;
}

function assignChartSeriesNames(specs: ChartSeriesSpec[]): NamedChartSeriesSpec[] {
  const seenNames = new Map<string, number>();

  return specs.flatMap((spec) => {
    const expression = spec.expression.trim();
    if (!expression) {
      return [];
    }

    return [
      {
        spec,
        expression,
        name: resolveChartSeriesDisplayName(spec, seenNames)
      }
    ];
  });
}

/** Resolves a run cell's result by id, used to source per-series traces from other runs. */
export type ResolveResultByRunId = (runCellId: string) => SimulationResult | null;

interface BuildNamedChartSeriesOptions {
  slice?: { startIndex: number; length: number };
  resolveResultByRunId?: ResolveResultByRunId;
}

function buildNamedChartSeriesValues(
  namedSpecs: NamedChartSeriesSpec[],
  result: SimulationResult,
  options: BuildNamedChartSeriesOptions = {}
): ResolvedChartSeries[] {
  const { slice, resolveResultByRunId } = options;
  return namedSpecs.flatMap(({ expression, name, spec }) => {
    const sourceRunCellId = spec.sourceRunCellId?.trim();
    const specResult =
      sourceRunCellId && resolveResultByRunId
        ? resolveResultByRunId(sourceRunCellId) ?? result
        : result;
    let values = buildMatrixEntryTimeSeries(expression, specResult);
    if (slice) {
      values = values.slice(slice.startIndex, slice.startIndex + slice.length);
    }

    if (!isGraphableTimeSeries(values)) {
      return [];
    }

    return [{ highlightKey: expression, name, values }];
  });
}

export function resolveChartSeriesUnit(
  entry: Pick<ResolvedChartSeries, "highlightKey">,
  cell: Pick<ChartCell, "series" | "variables">,
  variableUnitMetadata: VariableUnitMetadata
): string | undefined {
  const expression = entry.highlightKey.trim();
  const spec = resolveChartSeriesSpecs(cell).find((candidate) => candidate.expression.trim() === expression);
  const explicitUnit = spec?.unit?.trim();
  if (explicitUnit) {
    return explicitUnit;
  }

  if (/^[A-Za-z_][A-Za-z0-9_^]*$/.test(expression)) {
    return getVariableUnitLabel(variableUnitMetadata, expression) ?? undefined;
  }

  return undefined;
}

export function buildResolvedChartSeriesWithUnits(
  cell: Pick<ChartCell, "series" | "variables">,
  result: SimulationResult,
  variableUnitMetadata: VariableUnitMetadata,
  resolveResultByRunId?: ResolveResultByRunId
): ResolvedChartSeries[] {
  return buildResolvedChartSeries(cell, result, resolveResultByRunId).map((entry) => ({
    ...entry,
    unit: resolveChartSeriesUnit(entry, cell, variableUnitMetadata)
  }));
}

export function buildResolvedChartSeries(
  cell: Pick<ChartCell, "series" | "variables">,
  result: SimulationResult,
  resolveResultByRunId?: ResolveResultByRunId
): ResolvedChartSeries[] {
  return buildNamedChartSeriesValues(assignChartSeriesNames(resolveChartSeriesSpecs(cell)), result, {
    resolveResultByRunId
  });
}

function seriesMagnitude(values: number[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (Number.isFinite(value)) {
      const magnitude = Math.abs(value);
      if (max == null || magnitude > max) {
        max = magnitude;
      }
    }
  }
  return max;
}

/**
 * Suggests axis groupings by bucketing series whose magnitudes are within a
 * factor of `ratioThreshold` of each other. Series are scaled by their largest
 * absolute value, so variables of similar order of magnitude land on one axis.
 * Group and member order follow the input (chart) order.
 */
export function suggestChartAxisGroups(
  series: Array<Pick<ResolvedChartSeries, "name" | "values">>,
  options: { ratioThreshold?: number } = {}
): string[][] {
  const ratioThreshold = options.ratioThreshold ?? 10;
  const entries = series
    .map((entry, index) => ({ name: entry.name, index, magnitude: seriesMagnitude(entry.values) }))
    .filter(
      (entry): entry is { name: string; index: number; magnitude: number } => entry.magnitude != null
    );
  if (entries.length === 0) {
    return [];
  }

  const groupIdByName = new Map<string, number>();
  let groupId = 0;
  let base = Number.POSITIVE_INFINITY;
  [...entries]
    .sort((left, right) => left.magnitude - right.magnitude)
    .forEach((entry, position) => {
      if (position === 0) {
        base = entry.magnitude;
      } else if (entry.magnitude > base * ratioThreshold) {
        groupId += 1;
        base = entry.magnitude;
      }
      groupIdByName.set(entry.name, groupId);
    });

  const groupOrder: number[] = [];
  const membersByGroup = new Map<number, string[]>();
  [...entries]
    .sort((left, right) => left.index - right.index)
    .forEach((entry) => {
      const id = groupIdByName.get(entry.name) ?? 0;
      const members = membersByGroup.get(id);
      if (members) {
        members.push(entry.name);
      } else {
        membersByGroup.set(id, [entry.name]);
        groupOrder.push(id);
      }
    });

  return groupOrder.map((id) => membersByGroup.get(id) ?? []);
}

export function buildResolvedChartSeriesRanges(
  cell: Pick<ChartCell, "series" | "variables" | "seriesRanges">,
  resolvedSeries: Pick<ResolvedChartSeries, "highlightKey" | "name">[]
): Record<string, ChartAxisRange | undefined> | undefined {
  const specs = resolveChartSeriesSpecs(cell);
  const merged: Record<string, ChartAxisRange | undefined> = {
    ...(cell.seriesRanges ?? {})
  };

  const specsByExpression = new Map<string, ChartSeriesSpec>();
  for (const spec of specs) {
    specsByExpression.set(spec.expression.trim(), spec);
  }

  for (const entry of resolvedSeries) {
    const spec = specsByExpression.get(entry.highlightKey);
    if (spec?.range) {
      merged[entry.name] = spec.range;
    }
  }

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
}

export function buildOverlaySeriesFromSpecs(
  specs: ChartSeriesSpec[],
  result: SimulationResult,
  slice?: { startIndex: number; length: number }
): ResolvedChartSeries[] {
  return buildNamedChartSeriesValues(assignChartSeriesNames(specs), result, { slice });
}

export function resolveChartSeriesDisplayNames(
  cell: Pick<ChartCell, "series" | "variables">
): string[] {
  return assignChartSeriesNames(resolveChartSeriesSpecs(cell)).map((entry) => entry.name);
}

function chartCellUsesSeriesEntries(cell: Pick<ChartCell, "series">): boolean {
  return cell.series != null && cell.series.length > 0;
}

export function appendChartVariable(cell: ChartCell, variableName: string): ChartCell {
  if (chartCellUsesSeriesEntries(cell)) {
    const series = cell.series ?? [];
    if (series.some((entry) => entry.expression.trim() === variableName)) {
      return cell;
    }
    return {
      ...cell,
      series: [{ expression: variableName }, ...series]
    };
  }

  const variables = cell.variables ?? [];
  if (variables.includes(variableName)) {
    return cell;
  }

  return {
    ...cell,
    variables: [variableName, ...variables]
  };
}

export function setChartTimeRangeInclusive(
  cell: ChartCell,
  timeRangeInclusive: [number, number] | undefined
): ChartCell {
  if (timeRangeInclusive == null) {
    if (cell.timeRangeInclusive == null) {
      return cell;
    }
    const { timeRangeInclusive: _removed, ...rest } = cell;
    return rest;
  }

  if (
    cell.timeRangeInclusive?.[0] === timeRangeInclusive[0] &&
    cell.timeRangeInclusive?.[1] === timeRangeInclusive[1]
  ) {
    return cell;
  }

  return {
    ...cell,
    timeRangeInclusive
  };
}

export function removeChartSeriesByDisplayName(cell: ChartCell, displayName: string): ChartCell {
  if (chartCellUsesSeriesEntries(cell)) {
    const names = resolveChartSeriesDisplayNames(cell);
    const removeIndex = names.indexOf(displayName);
    if (removeIndex === -1) {
      return cell;
    }

    return {
      ...cell,
      series: cell.series?.filter((_, index) => index !== removeIndex)
    };
  }

  const variables = cell.variables ?? [];
  if (!variables.includes(displayName)) {
    return cell;
  }

  return {
    ...cell,
    variables: variables.filter((name) => name !== displayName)
  };
}

export function moveChartSeriesByDisplayName(
  cell: ChartCell,
  displayName: string,
  direction: "left" | "right"
): ChartCell {
  if (chartCellUsesSeriesEntries(cell)) {
    const names = resolveChartSeriesDisplayNames(cell);
    const currentIndex = names.indexOf(displayName);
    if (currentIndex === -1 || !cell.series) {
      return cell;
    }

    const nextIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= cell.series.length) {
      return cell;
    }

    const nextSeries = [...cell.series];
    [nextSeries[currentIndex], nextSeries[nextIndex]] = [
      nextSeries[nextIndex]!,
      nextSeries[currentIndex]!
    ];

    return {
      ...cell,
      series: nextSeries
    };
  }

  const variables = cell.variables ?? [];
  const currentIndex = variables.indexOf(displayName);
  if (currentIndex === -1) {
    return cell;
  }

  const nextIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= variables.length) {
    return cell;
  }

  const nextVariables = [...variables];
  [nextVariables[currentIndex], nextVariables[nextIndex]] = [
    nextVariables[nextIndex]!,
    nextVariables[currentIndex]!
  ];

  return {
    ...cell,
    variables: nextVariables
  };
}

export interface ResolvedMcBand {
  /** Display / axis key matching the mean series name. */
  seriesName: string;
  lo: number[];
  hi: number[];
  /** `"percentile"` when companions are `_p10`/`_p90`, else `"minmax"`. */
  kind: "percentile" | "minmax";
}

function seriesToNumberArray(values: Float64Array | number[] | undefined): number[] | null {
  if (!values || values.length < 2) {
    return null;
  }
  const asArray = Array.from(values);
  return asArray.some(Number.isFinite) ? asArray : null;
}

/**
 * Resolves Monte Carlo summary bands for bare chart variables when companion
 * `{name}_p10`/`{name}_p90` or `{name}_min`/`{name}_max` series exist on the result.
 */
export function buildMcBandsForChart(
  cell: Pick<ChartCell, "showMcBands" | "series" | "variables">,
  result: SimulationResult | null | undefined,
  resolvedSeries: Array<Pick<ResolvedChartSeries, "name" | "highlightKey">>
): ResolvedMcBand[] {
  if (!cell.showMcBands || !result) {
    return [];
  }

  const bands: ResolvedMcBand[] = [];
  const seen = new Set<string>();

  for (const entry of resolvedSeries) {
    const variableName = entry.highlightKey?.trim() || entry.name.trim();
    if (!variableName || seen.has(variableName) || !isBareVariableName(variableName)) {
      continue;
    }
    seen.add(variableName);

    const p10 = seriesToNumberArray(result.series[`${variableName}_p10`]);
    const p90 = seriesToNumberArray(result.series[`${variableName}_p90`]);
    if (p10 && p90) {
      bands.push({ seriesName: entry.name, lo: p10, hi: p90, kind: "percentile" });
      continue;
    }

    const min = seriesToNumberArray(result.series[`${variableName}_min`]);
    const max = seriesToNumberArray(result.series[`${variableName}_max`]);
    if (min && max) {
      bands.push({ seriesName: entry.name, lo: min, hi: max, kind: "minmax" });
    }
  }

  return bands;
}
