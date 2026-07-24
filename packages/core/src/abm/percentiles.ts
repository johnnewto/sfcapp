/** Linear interpolated percentile for a sorted ascending sample. `p` in [0, 1]. */
export function sortedPercentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) {
    return NaN;
  }
  if (sortedAscending.length === 1) {
    return sortedAscending[0]!;
  }
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sortedAscending.length - 1) * clamped;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) {
    return sortedAscending[lo]!;
  }
  const weight = index - lo;
  return sortedAscending[lo]! * (1 - weight) + sortedAscending[hi]! * weight;
}

export function mcBandLoName(seriesName: string): string {
  return `${seriesName}_p10`;
}

export function mcBandHiName(seriesName: string): string {
  return `${seriesName}_p90`;
}

export function mcBandMinName(seriesName: string): string {
  return `${seriesName}_min`;
}

export function mcBandMaxName(seriesName: string): string {
  return `${seriesName}_max`;
}
