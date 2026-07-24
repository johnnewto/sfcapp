import type { ModelDefinition, SimulationOptions } from "../model/types";
import type { SeriesMap, SimulationResult } from "../result/result";

import type { Rng } from "./rng";
import { createRng } from "./rng";
import {
  mcBandHiName,
  mcBandLoName,
  mcBandMaxName,
  mcBandMinName,
  sortedPercentile
} from "./percentiles";

export interface AbmMonteCarloOptions {
  periods: number;
  monteCarlo: number;
  /**
   * Base seed; MC run `mc` (1-based) uses `createRng(baseSeed + mc)` so runs are
   * reproducible and independent. Defaults to 0 (so MC=1 uses seed 1, matching
   * Leeds R `set.seed(mc)` indexing intent without claiming R stream parity).
   */
  baseSeed?: number;
  /**
   * Summary-band style for names listed in `hooks.bandSeriesNames`.
   * - `percentile` (default): emit `{name}_p10` / `{name}_p90`
   * - `minmax`: emit `{name}_min` / `{name}_max`
   */
  bandKind?: "percentile" | "minmax";
}

/**
 * Opaque model state owned by the tick. May hold one or more agent populations
 * (households now; firms/banks later) plus any aggregate stocks.
 */
export type AbmModelState = unknown;

export interface AbmTickContext {
  periodZeroBased: number;
  periodOneBased: number;
  mcIndexOneBased: number;
  rng: Rng;
  state: AbmModelState;
}

export interface AbmTickResult {
  /** Macro (and optional micro) scalars for this period, keyed by series name. */
  values: Record<string, number>;
}

export interface AbmMonteCarloHooks {
  /** Allocate and initialize state for one MC run. */
  init: (rng: Rng, mcIndexOneBased: number) => AbmModelState;
  /** Advance one period; mutate state in place and return recorded values. */
  tick: (ctx: AbmTickContext) => AbmTickResult;
  /** Series names to allocate (means across MC). */
  seriesNames: string[];
  /**
   * Subset of `seriesNames` for which summary bands are stored
   * (`_p10`/`_p90` or `_min`/`_max` depending on `bandKind`).
   */
  bandSeriesNames?: string[];
  /**
   * Optional series recorded only from MC run 1 (micro histories).
   * Written directly each period; not averaged.
   */
  microSeriesNames?: string[];
  /** Optional stub model metadata for SimulationResult. */
  model?: ModelDefinition;
}

function emptyModel(): ModelDefinition {
  return {
    equations: [{ name: "_abm", expression: "0" }],
    externals: {},
    initialValues: {}
  };
}

function abmSimulationOptions(periods: number): SimulationOptions {
  return {
    periods,
    solverMethod: "GAUSS_SEIDEL",
    tolerance: 1,
    maxIterations: 1,
    defaultInitialValue: 0
  };
}

/**
 * Shared ABM Monte Carlo driver. Population-agnostic: the tick owns all agents.
 */
export function runAbmMonteCarlo(
  options: AbmMonteCarloOptions,
  hooks: AbmMonteCarloHooks
): SimulationResult {
  const { periods, monteCarlo } = options;
  if (periods < 1) {
    throw new Error(`ABM periods must be >= 1 (got ${periods}).`);
  }
  if (monteCarlo < 1) {
    throw new Error(`ABM monteCarlo must be >= 1 (got ${monteCarlo}).`);
  }

  const baseSeed = options.baseSeed ?? 0;
  const bandKind = options.bandKind ?? "percentile";
  const meanNames = hooks.seriesNames;
  const microNames = hooks.microSeriesNames ?? [];
  const bandNames = (hooks.bandSeriesNames ?? []).filter((name) => meanNames.includes(name));
  const bandNameSet = new Set(bandNames);

  const sums: SeriesMap = {};
  for (const name of meanNames) {
    sums[name] = new Float64Array(periods);
  }
  const micro: SeriesMap = {};
  for (const name of microNames) {
    micro[name] = new Float64Array(periods);
  }

  // samples[name][period][mcIndex] — only for banded series
  const samples: Record<string, Float64Array[]> = {};
  for (const name of bandNames) {
    samples[name] = Array.from({ length: periods }, () => new Float64Array(monteCarlo));
  }

  for (let mc = 1; mc <= monteCarlo; mc++) {
    const rng = createRng(baseSeed + mc);
    const state = hooks.init(rng, mc);
    const mcZero = mc - 1;

    for (let t = 0; t < periods; t++) {
      const { values } = hooks.tick({
        periodZeroBased: t,
        periodOneBased: t + 1,
        mcIndexOneBased: mc,
        rng,
        state
      });

      for (const name of meanNames) {
        const v = values[name];
        if (v === undefined || Number.isNaN(v)) {
          throw new Error(`ABM tick missing series "${name}" at period ${t + 1}, MC ${mc}.`);
        }
        sums[name]![t]! += v;
        if (bandNameSet.has(name)) {
          samples[name]![t]![mcZero] = v;
        }
      }

      if (mc === 1) {
        for (const name of microNames) {
          const v = values[name];
          if (v === undefined || Number.isNaN(v)) {
            throw new Error(`ABM tick missing micro series "${name}" at period ${t + 1}.`);
          }
          micro[name]![t] = v;
        }
      }
    }
  }

  const series: SeriesMap = { ...micro };
  const inv = 1 / monteCarlo;
  for (const name of meanNames) {
    const row = sums[name]!;
    const mean = new Float64Array(periods);
    for (let t = 0; t < periods; t++) {
      mean[t] = row[t]! * inv;
    }
    series[name] = mean;
  }

  for (const name of bandNames) {
    const lo = new Float64Array(periods);
    const hi = new Float64Array(periods);
    for (let t = 0; t < periods; t++) {
      const periodSamples = Array.from(samples[name]![t]!);
      periodSamples.sort((a, b) => a - b);
      if (bandKind === "minmax") {
        lo[t] = periodSamples[0]!;
        hi[t] = periodSamples[periodSamples.length - 1]!;
      } else {
        lo[t] = sortedPercentile(periodSamples, 0.1);
        hi[t] = sortedPercentile(periodSamples, 0.9);
      }
    }
    if (bandKind === "minmax") {
      series[mcBandMinName(name)] = lo;
      series[mcBandMaxName(name)] = hi;
    } else {
      series[mcBandLoName(name)] = lo;
      series[mcBandHiName(name)] = hi;
    }
  }

  return {
    series,
    blocks: [],
    model: hooks.model ?? emptyModel(),
    options: abmSimulationOptions(periods)
  };
}
