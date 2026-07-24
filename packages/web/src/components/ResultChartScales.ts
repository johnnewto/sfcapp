export interface ChartAxisRange {
  includeZero?: boolean;
  max?: number;
  min?: number;
}

export const DEFAULT_AXIS_TICK_COUNT = 5;
const TIME_RANGE_MIN_WINDOW = 2;

const AUTO_AXIS_EDGE_PADDING_RATIO = 0.04;

export function resolveTimeRange(
  timeRangeInclusive: [number, number] | undefined,
  defaults: { endPeriodInclusive: number; startPeriodInclusive: number } | undefined,
  seriesLength: number
): { endPeriodInclusive: number; startPeriodInclusive: number } {
  const fullRange = {
    startPeriodInclusive: 1,
    endPeriodInclusive: Math.max(seriesLength, 1)
  };
  const autoRange = clampTimeRange(defaults ?? fullRange, fullRange);

  if (!timeRangeInclusive) {
    return autoRange;
  }

  return clampTimeRange(
    {
      startPeriodInclusive: timeRangeInclusive[0],
      endPeriodInclusive: timeRangeInclusive[1]
    },
    fullRange
  );
}

function clampTimeRange(
  range: { endPeriodInclusive: number; startPeriodInclusive: number },
  bounds: { endPeriodInclusive: number; startPeriodInclusive: number }
): { endPeriodInclusive: number; startPeriodInclusive: number } {
  const startPeriodInclusive = Math.min(
    Math.max(Math.round(range.startPeriodInclusive), bounds.startPeriodInclusive),
    bounds.endPeriodInclusive
  );
  const endPeriodInclusive = Math.max(
    startPeriodInclusive,
    Math.min(Math.round(range.endPeriodInclusive), bounds.endPeriodInclusive)
  );

  return { startPeriodInclusive, endPeriodInclusive };
}

export function buildAxisMetrics(
  finiteValues: number[],
  axisRange?: ChartAxisRange,
  tickCount: number = DEFAULT_AXIS_TICK_COUNT,
  options?: { exactTickCount?: boolean; niceScale?: boolean }
): { min: number; max: number; range: number; ticks: number[] } {
  const includeZero = axisRange?.includeZero === true;
  const usableValues = finiteValues.filter(Number.isFinite);
  const autoBounds = buildAutoBounds(usableValues, includeZero);
  const rawAutoBounds = buildRawAutoBounds(usableValues, includeZero);
  const manualMin = axisRange?.min;
  const manualMax = axisRange?.max;
  const resolvedAutoBounds =
    options?.niceScale && manualMin == null && manualMax == null
      ? buildNiceScaleBounds(
          rawAutoBounds.min,
          rawAutoBounds.max,
          tickCount,
          options.exactTickCount === true
        )
      : autoBounds;
  let resolvedMin = manualMin ?? resolvedAutoBounds.min;
  let resolvedMax = manualMax ?? resolvedAutoBounds.max;

  if (!(resolvedMin < resolvedMax)) {
    if (Number.isFinite(resolvedMin) && Number.isFinite(resolvedMax)) {
      if (resolvedMin > resolvedMax) {
        const swap = resolvedMin;
        resolvedMin = resolvedMax;
        resolvedMax = swap;
      } else {
        // Equal bounds (or denormal after nice-scaling): expand to a unit window.
        resolvedMax = resolvedMin + 1;
      }
    } else {
      resolvedMin = 0;
      resolvedMax = 1;
    }
  }

  return {
    min: resolvedMin,
    max: resolvedMax,
    range: resolvedMax - resolvedMin || 1,
    ticks: buildNumericTicks(resolvedMin, resolvedMax, tickCount, options)
  };
}

function buildAutoBounds(finiteValues: number[], includeZero: boolean): { min: number; max: number } {
  const rawBounds = buildRawAutoBounds(finiteValues, includeZero);
  const range = rawBounds.max - rawBounds.min || Math.max(Math.abs(rawBounds.max), 1);
  const edgePadding = range * AUTO_AXIS_EDGE_PADDING_RATIO;
  let paddedMin = rawBounds.min - edgePadding;
  let paddedMax = rawBounds.max + edgePadding;

  if (includeZero) {
    paddedMin = Math.min(paddedMin, 0);
    paddedMax = Math.max(paddedMax, 0);
  }

  if (!(paddedMin < paddedMax)) {
    paddedMax = paddedMin + 1;
  }

  return { min: paddedMin, max: paddedMax };
}

function buildRawAutoBounds(finiteValues: number[], includeZero: boolean): { min: number; max: number } {
  if (finiteValues.length === 0) {
    return includeZero ? { min: 0, max: 1 } : { min: 0, max: 1 };
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const range = maxValue - minValue || Math.max(Math.abs(maxValue), 1);
  let paddedMin = minValue === maxValue ? minValue - range * 0.05 : minValue;
  let paddedMax = maxValue === minValue ? maxValue + range * 0.05 : maxValue;

  if (includeZero) {
    paddedMin = Math.min(paddedMin, 0);
    paddedMax = Math.max(paddedMax, 0);
  }

  if (!(paddedMin < paddedMax)) {
    paddedMax = paddedMin + 1;
  }

  return { min: paddedMin, max: paddedMax };
}

function buildNiceScaleBounds(
  min: number,
  max: number,
  tickCount: number,
  exactTickCount: boolean
): { min: number; max: number } {
  if (!(min < max)) {
    return { min, max };
  }

  const intervalCount = Math.max(tickCount - 1, 1);
  let step = buildNiceTickStepCeil((max - min) / intervalCount);

  if (!exactTickCount) {
    return {
      min: roundTickValue(Math.floor(min / step) * step),
      max: roundTickValue(Math.ceil(max / step) * step)
    };
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const niceMin = roundTickValue(Math.floor(min / step) * step);
    const niceMax = roundTickValue(niceMin + step * intervalCount);

    if (niceMax >= max - step * 1e-6) {
      return { min: niceMin, max: niceMax };
    }

    step = buildNextNiceTickStep(step);
  }

  return { min, max };
}

export function snapAxisMetrics<
  T extends {
    axisRangeConfig?: ChartAxisRange;
    max: number;
    min: number;
    range: number;
    ticks: number[];
  }
>(
  metrics: T[],
  axisSnapTolarance?: number,
  tickOptions?: { exactTickCount?: boolean; niceScale?: boolean }
): T[] {
  if (axisSnapTolarance == null || metrics.length < 2) {
    return metrics;
  }

  const tolerance = axisSnapTolarance;
  const nextMetrics = [...metrics];
  const visited = new Set<number>();

  for (let index = 0; index < nextMetrics.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const baseMetric = nextMetrics[index];
    if (baseMetric.axisRangeConfig?.min != null || baseMetric.axisRangeConfig?.max != null) {
      visited.add(index);
      continue;
    }

    const group = [index];
    for (let candidateIndex = index + 1; candidateIndex < nextMetrics.length; candidateIndex += 1) {
      const candidate = nextMetrics[candidateIndex];
      if (candidate.axisRangeConfig?.min != null || candidate.axisRangeConfig?.max != null) {
        continue;
      }

      if (rangesAreSnapCompatible(baseMetric, candidate, tolerance)) {
        group.push(candidateIndex);
      }
    }

    if (group.length === 1) {
      visited.add(index);
      continue;
    }

    const snappedMin = Math.min(...group.map((groupIndex) => nextMetrics[groupIndex].min));
    const snappedMax = Math.max(...group.map((groupIndex) => nextMetrics[groupIndex].max));
    const snappedRange = snappedMax - snappedMin || 1;
    const snappedTicks = buildNumericTicks(
      snappedMin,
      snappedMax,
      nextMetrics[group[0]]?.ticks.length ?? DEFAULT_AXIS_TICK_COUNT,
      tickOptions
    );

    group.forEach((groupIndex) => {
      nextMetrics[groupIndex] = {
        ...nextMetrics[groupIndex],
        min: snappedMin,
        max: snappedMax,
        range: snappedRange,
        ticks: snappedTicks
      };
      visited.add(groupIndex);
    });
  }

  return nextMetrics;
}

function rangesAreSnapCompatible(
  left: { min: number; max: number; range: number },
  right: { min: number; max: number; range: number },
  tolerance: number
): boolean {
  const referenceRange = Math.max(left.range, right.range, 1);
  return (
    Math.abs(left.min - right.min) <= tolerance * referenceRange &&
    Math.abs(left.max - right.max) <= tolerance * referenceRange
  );
}

export function toPolylinePoints(
  values: number[],
  leftPadding: number,
  topPadding: number,
  plotWidth: number,
  plotHeight: number,
  min: number,
  range: number,
  options?: { skipNonFinite?: boolean }
): string {
  const skipNonFinite = options?.skipNonFinite ?? false;
  return values
    .map((value, index) => {
      if (skipNonFinite && !Number.isFinite(value)) {
        return null;
      }
      const x = toX(index, leftPadding, plotWidth, values.length);
      const safeValue = Number.isFinite(value) ? value : min;
      const y = toY(safeValue, topPadding, plotHeight, min, range);
      return `${x},${y}`;
    })
    .filter((point): point is string => point != null)
    .join(" ");
}

/**
 * Closed SVG path for a fill between upper (`hi`) and lower (`lo`) series.
 * Traces hi left→right then lo right→left.
 */
export function toBandAreaPath(
  lo: number[],
  hi: number[],
  leftPadding: number,
  topPadding: number,
  plotWidth: number,
  plotHeight: number,
  min: number,
  range: number
): string | null {
  const length = Math.min(lo.length, hi.length);
  if (length < 2) {
    return null;
  }
  const hiPoints: string[] = [];
  const loPoints: string[] = [];
  for (let index = 0; index < length; index++) {
    const hiValue = hi[index];
    const loValue = lo[index];
    if (!Number.isFinite(hiValue) || !Number.isFinite(loValue)) {
      return null;
    }
    const x = toX(index, leftPadding, plotWidth, length);
    hiPoints.push(`${x},${toY(hiValue, topPadding, plotHeight, min, range)}`);
    loPoints.push(`${x},${toY(loValue, topPadding, plotHeight, min, range)}`);
  }
  return `M ${hiPoints.join(" L ")} L ${loPoints.reverse().join(" L ")} Z`;
}

export function toX(index: number, leftPadding: number, plotWidth: number, length: number): number {
  const xStep = plotWidth / Math.max(length - 1, 1);
  return leftPadding + index * xStep;
}

export function periodFromSvgX(
  svgX: number,
  leftPadding: number,
  plotWidth: number,
  seriesLength: number
): number {
  const relativeX = svgX - leftPadding;
  const index = Math.round((relativeX / Math.max(plotWidth, 1)) * Math.max(seriesLength - 1, 0));
  return Math.min(Math.max(index + 1, 1), seriesLength);
}

export function clampInteractiveTimeRange(
  range: { endPeriodInclusive: number; startPeriodInclusive: number },
  seriesLength: number
): { endPeriodInclusive: number; startPeriodInclusive: number } {
  const boundedStart = Math.min(Math.max(Math.round(range.startPeriodInclusive), 1), seriesLength);
  const boundedEnd = Math.min(Math.max(Math.round(range.endPeriodInclusive), 1), seriesLength);
  const startPeriodInclusive = Math.min(boundedStart, boundedEnd);
  let endPeriodInclusive = Math.max(boundedStart, boundedEnd);
  endPeriodInclusive = Math.max(endPeriodInclusive, startPeriodInclusive + TIME_RANGE_MIN_WINDOW - 1);
  endPeriodInclusive = Math.min(endPeriodInclusive, seriesLength);

  return { startPeriodInclusive, endPeriodInclusive };
}

export function applyTimeRangeDrag({
  leftPadding,
  mode,
  nextX,
  originEnd,
  originStart,
  originX,
  plotWidth,
  seriesLength
}: {
  leftPadding: number;
  mode: "end" | "pan" | "start";
  nextX: number;
  originEnd: number;
  originStart: number;
  originX: number;
  plotWidth: number;
  seriesLength: number;
}): { endPeriodInclusive: number; startPeriodInclusive: number } {
  if (mode === "start") {
    const nextStart = Math.min(
      periodFromSvgX(nextX, leftPadding, plotWidth, seriesLength),
      originEnd - TIME_RANGE_MIN_WINDOW + 1
    );
    return clampInteractiveTimeRange(
      { startPeriodInclusive: nextStart, endPeriodInclusive: originEnd },
      seriesLength
    );
  }

  if (mode === "end") {
    const nextEnd = Math.max(
      periodFromSvgX(nextX, leftPadding, plotWidth, seriesLength),
      originStart + TIME_RANGE_MIN_WINDOW - 1
    );
    return clampInteractiveTimeRange(
      { startPeriodInclusive: originStart, endPeriodInclusive: nextEnd },
      seriesLength
    );
  }

  const originPeriod = periodFromSvgX(originX, leftPadding, plotWidth, seriesLength);
  const nextPeriod = periodFromSvgX(nextX, leftPadding, plotWidth, seriesLength);
  const delta = nextPeriod - originPeriod;
  const windowSize = originEnd - originStart;
  let startPeriodInclusive = originStart + delta;
  let endPeriodInclusive = originEnd + delta;

  if (startPeriodInclusive < 1) {
    startPeriodInclusive = 1;
    endPeriodInclusive = startPeriodInclusive + windowSize;
  }

  if (endPeriodInclusive > seriesLength) {
    endPeriodInclusive = seriesLength;
    startPeriodInclusive = endPeriodInclusive - windowSize;
  }

  return clampInteractiveTimeRange({ startPeriodInclusive, endPeriodInclusive }, seriesLength);
}

/**
 * Converts an interactive slider window into the value stored on a chart cell.
 * Returns `undefined` when the window matches the chart defaults (full series unless
 * `timeRangeDefaults` narrows it), so authors can clear `timeRangeInclusive`.
 */
export function toStoredTimeRangeInclusive(
  range: { endPeriodInclusive: number; startPeriodInclusive: number },
  seriesLength: number,
  defaults?: { endPeriodInclusive: number; startPeriodInclusive: number }
): [number, number] | undefined {
  const clamped = clampInteractiveTimeRange(range, seriesLength);
  const baseline = resolveTimeRange(undefined, defaults, seriesLength);
  if (
    clamped.startPeriodInclusive === baseline.startPeriodInclusive &&
    clamped.endPeriodInclusive === baseline.endPeriodInclusive
  ) {
    return undefined;
  }

  return [clamped.startPeriodInclusive, clamped.endPeriodInclusive];
}

export function timeRangeInclusiveEquals(
  left: [number, number] | undefined,
  right: [number, number] | undefined
): boolean {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return left[0] === right[0] && left[1] === right[1];
}

export function toY(
  value: number,
  topPadding: number,
  plotHeight: number,
  min: number,
  range: number
): number {
  const rawY = topPadding + plotHeight - ((value - min) / range) * plotHeight;
  return Math.max(topPadding, Math.min(topPadding + plotHeight, rawY));
}

function buildNumericTicks(
  min: number,
  max: number,
  count: number,
  options?: { exactTickCount?: boolean }
): number[] {
  if (count <= 1) {
    return [min];
  }

  if (options?.exactTickCount === true) {
    return buildExactCountNumericTicks(min, max, count);
  }

  const rawStep = (max - min) / Math.max(count - 1, 1);
  const tickStep = buildNiceTickStep(rawStep);
  const firstTick = Math.ceil((min - tickStep * 1e-6) / tickStep) * tickStep;
  const ticks: number[] = [];

  for (let value = firstTick; value <= max + tickStep * 1e-6; value += tickStep) {
    ticks.push(roundTickValue(value));
  }

  return ticks.length > 0 ? ticks : [roundTickValue(min)];
}

function buildExactCountNumericTicks(min: number, max: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    roundTickValue(min + ((max - min) * index) / Math.max(count - 1, 1))
  );
}

function buildNiceTickStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(rawStep));
  const increment = 5 * 10 ** (exponent - 1);
  const roundedStep = Math.round(rawStep / increment) * increment;

  if (roundedStep > 0) {
    return roundTickValue(roundedStep);
  }

  return roundTickValue(increment);
}

function buildNiceTickStepCeil(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(rawStep));
  const increment = 5 * 10 ** (exponent - 1);
  const roundedUpStep = Math.ceil(rawStep / increment) * increment;

  if (roundedUpStep > 0) {
    return roundTickValue(roundedUpStep);
  }

  return roundTickValue(increment);
}

function buildNextNiceTickStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(step));
  const increment = 5 * 10 ** (exponent - 1);
  return roundTickValue(step + increment);
}

function roundTickValue(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }

  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const precision = Math.max(0, 6 - exponent);
  return Number(value.toFixed(precision));
}

export function buildIntegerTicks(length: number, count: number): number[] {
  if (length <= 1) {
    return [0];
  }

  const ticks = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    ticks.add(Math.round(((length - 1) * index) / Math.max(count - 1, 1)));
  }
  return Array.from(ticks).sort((left, right) => left - right);
}

export function formatAxisValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "NaN";
  }

  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return `${(value / 1e12).toFixed(1)}T`;
  }
  if (abs >= 1e9) {
    return `${(value / 1e9).toFixed(1)}G`;
  }
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(1)}K`;
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}
