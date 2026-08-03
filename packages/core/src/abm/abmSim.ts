import { runAbmSpec } from "./abmSpec";
import type { AbmSpec, AbmSpecOverrides, AbmUniformDraw } from "./abmSpecTypes";
import type { SimulationResult } from "../result/result";

export interface AbmSimConfig {
  periods?: number;
  households?: number;
  monteCarlo?: number;
  /** Mean propensity to consume out of income. */
  alpha1m?: number;
  /** Half-width of uniform draw for heterogeneous alpha1. */
  alpha1d?: number;
  /** Propensity to consume out of wealth (common). */
  alpha2?: number;
  /** Tax rate on wage income. */
  theta?: number;
  /** Labour productivity (and wage, so zero profit). */
  pr?: number;
  /** Hiring randomness spread s in U(1-s, 1+s). */
  s?: number;
  /** Baseline government spending before the shock. */
  g0?: number;
  /** Government spending from shockPeriod onward (1-based). */
  g1?: number;
  /** First period (1-based) of the G shock. */
  shockPeriod?: number;
  /** Force homogeneous alpha1 = alpha1m (for textbook recovery tests). */
  homogeneousAlpha1?: boolean;
  baseSeed?: number;
  /**
   * Summary band style for macro series. Defaults to `"percentile"` (`_p10`/`_p90`).
   * Use `"minmax"` for envelope bands, or `"none"` to skip band series.
   */
  bandKind?: "percentile" | "minmax" | "none";
}

export const ABM_SIM_DEFAULTS = {
  periods: 100,
  households: 200,
  monteCarlo: 50,
  alpha1m: 0.6,
  alpha1d: 0.4,
  alpha2: 0.4,
  theta: 0.2,
  pr: 1.1,
  s: 0.2,
  g0: 20,
  g1: 30,
  shockPeriod: 60
} as const;

/**
 * Declarative ABM-SIM spec matching Leeds ABM_SIM.R / the former hand-rolled tick.
 * Hiring uses `random.uniform` then `shuffle` so the RNG stream matches the original hire-lottery order.
 */
export const ABM_SIM_SPEC: AbmSpec = {
  modelId: "abm-sim",
  populations: [
    {
      name: "households",
      size: ABM_SIM_DEFAULTS.households,
      state: ["h", "yd", "cd", "c", "y", "e"],
      params: {
        alpha1: {
          draw: "uniform",
          lo: ABM_SIM_DEFAULTS.alpha1m - ABM_SIM_DEFAULTS.alpha1d,
          hi: ABM_SIM_DEFAULTS.alpha1m + ABM_SIM_DEFAULTS.alpha1d
        }
      }
    }
  ],
  params: {
    alpha2: ABM_SIM_DEFAULTS.alpha2,
    theta: ABM_SIM_DEFAULTS.theta,
    pr: ABM_SIM_DEFAULTS.pr,
    w: ABM_SIM_DEFAULTS.pr,
    s: ABM_SIM_DEFAULTS.s,
    g0: ABM_SIM_DEFAULTS.g0,
    g1: ABM_SIM_DEFAULTS.g1,
    shockPeriod: ABM_SIM_DEFAULTS.shockPeriod
  },
  state: {
    aggregates: {
      H_s: 0
    }
  },
  ticks: [
    {
      kind: "aggregate",
      equations: [["G", "if (t >= shockPeriod) { g1 } else { g0 }"]]
    },
    {
      kind: "agent",
      population: "households",
      equations: [["cd", "min(alpha1 * yd + alpha2 * h, h)"]]
    },
    {
      kind: "aggregate",
      equations: [
        ["AD", "sum(households.cd) + G"],
        ["Nd", "AD / pr"]
      ]
    },
    {
      kind: "aggregate",
      equations: [
        [
          "N",
          "min(min(floor(Nd * random.uniform(1 - s, 1 + s, 1)), floor(Nd)), households.size)"
        ]
      ]
    },
    { kind: "shuffle", population: "households" },
    {
      kind: "agent",
      population: "households",
      equations: [["e", "if (households.rank <= N) { 1 } else { 0 }"]]
    },
    {
      kind: "aggregate",
      equations: [
        ["Y", "pr * N"],
        ["YG", "min(G, Y)"],
        ["YC", "Y - YG"]
      ]
    },
    {
      kind: "ration-fcfs",
      population: "households",
      demand: "cd",
      supply: "YC",
      into: "c"
    },
    {
      kind: "agent",
      population: "households",
      equations: [
        ["y", "w * e"],
        ["yd", "y * (1 - theta)"],
        ["h", "h + y - c - theta * y"]
      ]
    },
    {
      kind: "aggregate",
      equations: [
        ["C", "sum(households.c)"],
        ["YD", "sum(households.yd)"],
        ["TAX", "theta * w * N"],
        ["H_d", "sum(households.h)"],
        ["H_s", "H_s + YG - TAX"],
        ["UR", "(households.size - N) / households.size"]
      ]
    }
  ],
  record: {
    // Descriptions only — series/micro fill from defaults at normalize time.
    descriptions: {
      Y: "Output / income (MC mean)",
      C: "Consumption (MC mean)",
      YD: "Disposable income (MC mean)",
      H_d: "Total household money (MC mean)",
      H_s: "Government money supply (MC mean)",
      UR: "Unemployment rate, emergent (MC mean)",
      G: "Government spending",
      TAX: "Tax revenue",
      N: "Employment (hired count)",
      AD: "Total demand for goods",
      Nd: "Labour needed (1/pr workers per good)",
      YG: "Actual government spending (served first)",
      YC: "Goods left for households",
      c: "Household consumption (micro, MC run 1)",
      h: "Household money holdings (micro, MC run 1)",
      e: "Employment flag 0/1 (micro, MC run 1)"
    }
  },
  check: { left: "H_d", right: "H_s", tolerance: 1e-9 }
};

function resolveConfig(config: AbmSimConfig = {}) {
  return {
    periods: config.periods ?? ABM_SIM_DEFAULTS.periods,
    households: config.households ?? ABM_SIM_DEFAULTS.households,
    monteCarlo: config.monteCarlo ?? ABM_SIM_DEFAULTS.monteCarlo,
    alpha1m: config.alpha1m ?? ABM_SIM_DEFAULTS.alpha1m,
    alpha1d: config.alpha1d ?? ABM_SIM_DEFAULTS.alpha1d,
    alpha2: config.alpha2 ?? ABM_SIM_DEFAULTS.alpha2,
    theta: config.theta ?? ABM_SIM_DEFAULTS.theta,
    pr: config.pr ?? ABM_SIM_DEFAULTS.pr,
    s: config.s ?? ABM_SIM_DEFAULTS.s,
    g0: config.g0 ?? ABM_SIM_DEFAULTS.g0,
    g1: config.g1 ?? ABM_SIM_DEFAULTS.g1,
    shockPeriod: config.shockPeriod ?? ABM_SIM_DEFAULTS.shockPeriod,
    homogeneousAlpha1: config.homogeneousAlpha1 ?? false,
    baseSeed: config.baseSeed ?? 0,
    bandKind: config.bandKind ?? "percentile"
  };
}

/** Build an AbmSpec for ABM-SIM from resolved config (alpha1 draw / size / params). */
export function buildAbmSimSpec(config: AbmSimConfig = {}): {
  spec: AbmSpec;
  overrides: AbmSpecOverrides;
} {
  const cfg = resolveConfig(config);
  const alpha1: AbmUniformDraw | { value: number } = cfg.homogeneousAlpha1
    ? { value: cfg.alpha1m }
    : {
        draw: "uniform",
        lo: cfg.alpha1m - cfg.alpha1d,
        hi: cfg.alpha1m + cfg.alpha1d
      };

  const overrides: AbmSpecOverrides = {
    periods: cfg.periods,
    monteCarlo: cfg.monteCarlo,
    baseSeed: cfg.baseSeed,
    bandKind: cfg.bandKind,
    params: {
      alpha2: cfg.alpha2,
      theta: cfg.theta,
      pr: cfg.pr,
      w: cfg.pr,
      s: cfg.s,
      g0: cfg.g0,
      g1: cfg.g1,
      shockPeriod: cfg.shockPeriod
    },
    populationSizes: { households: cfg.households },
    populationParams: { households: { alpha1 } }
  };

  // When bands are "none", still record the same series; runAbmSpec drops band emission.
  const spec: AbmSpec =
    cfg.bandKind === "none"
      ? {
          ...ABM_SIM_SPEC,
          record: {
            ...ABM_SIM_SPEC.record,
            bands: []
          }
        }
      : ABM_SIM_SPEC;

  return { spec, overrides };
}

/**
 * Agent-based SIM (Leeds ABM_SIM.R): heterogeneous households, job lottery,
 * FCFS goods market, Monte Carlo means. Implemented via `runAbmSpec`.
 */
export function runAbmSim(config: AbmSimConfig = {}): SimulationResult {
  const { spec, overrides } = buildAbmSimSpec(config);
  const result = runAbmSpec(spec, overrides);

  // Preserve the historical series surface for callers that only expect the
  // original seven macro names (+ micro). TAX and N remain available when present.
  return result;
}
