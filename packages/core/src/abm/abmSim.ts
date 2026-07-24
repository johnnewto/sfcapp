import { hireLottery, rationFcfs, runif, shuffleIndices, type Rng } from "./rng";
import { runAbmMonteCarlo, type AbmModelState } from "./monteCarlo";
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

interface HouseholdPopulation {
  n: number;
  alpha1: Float64Array;
  h: Float64Array;
  yd: Float64Array;
  cd: Float64Array;
  c: Float64Array;
  y: Float64Array;
  order: number[];
}

interface AbmSimState {
  populations: {
    households: HouseholdPopulation;
  };
  /** Aggregate money supply (government liability). */
  H_s: number;
  G: Float64Array;
  pr: number;
  w: number;
  alpha2: number;
  theta: number;
  s: number;
}

function governmentPath(periods: number, g0: number, g1: number, shockPeriod: number): Float64Array {
  const G = new Float64Array(periods);
  const shockZero = Math.max(0, shockPeriod - 1);
  for (let t = 0; t < periods; t++) {
    G[t] = t >= shockZero ? g1 : g0;
  }
  return G;
}

function initHouseholds(
  rng: Rng,
  n: number,
  alpha1m: number,
  alpha1d: number,
  homogeneous: boolean
): HouseholdPopulation {
  const alpha1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    alpha1[i] = homogeneous ? alpha1m : runif(rng, alpha1m - alpha1d, alpha1m + alpha1d);
  }
  return {
    n,
    alpha1,
    h: new Float64Array(n),
    yd: new Float64Array(n),
    cd: new Float64Array(n),
    c: new Float64Array(n),
    y: new Float64Array(n),
    order: new Array(n)
  };
}

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

/**
 * Agent-based SIM (Leeds ABM_SIM.R): heterogeneous households, job lottery,
 * FCFS goods market, Monte Carlo means.
 */
export function runAbmSim(config: AbmSimConfig = {}): SimulationResult {
  const cfg = resolveConfig(config);
  const lastIdx = cfg.households - 1;

  return runAbmMonteCarlo(
    {
      periods: cfg.periods,
      monteCarlo: cfg.monteCarlo,
      baseSeed: cfg.baseSeed,
      ...(cfg.bandKind === "none" ? {} : { bandKind: cfg.bandKind })
    },
    {
      seriesNames: ["Y", "C", "YD", "H_d", "H_s", "UR", "G"],
      bandSeriesNames:
        cfg.bandKind === "none" ? [] : ["Y", "C", "YD", "H_d", "H_s", "UR"],
      microSeriesNames: [
        "c_h1",
        "h_h1",
        "e_h1",
        "c_hLast",
        "h_hLast",
        "e_hLast"
      ],
      model: {
        equations: [{ name: "_abm_sim", expression: "0" }],
        externals: {
          alpha1m: { kind: "constant", value: cfg.alpha1m },
          alpha2: { kind: "constant", value: cfg.alpha2 },
          theta: { kind: "constant", value: cfg.theta },
          pr: { kind: "constant", value: cfg.pr },
          s: { kind: "constant", value: cfg.s },
          households: { kind: "constant", value: cfg.households },
          monteCarlo: { kind: "constant", value: cfg.monteCarlo }
        },
        initialValues: {}
      },
      init: (rng) => {
        const households = initHouseholds(
          rng,
          cfg.households,
          cfg.alpha1m,
          cfg.alpha1d,
          cfg.homogeneousAlpha1
        );
        const state: AbmSimState = {
          populations: { households },
          H_s: 0,
          G: governmentPath(cfg.periods, cfg.g0, cfg.g1, cfg.shockPeriod),
          pr: cfg.pr,
          w: cfg.pr,
          alpha2: cfg.alpha2,
          theta: cfg.theta,
          s: cfg.s
        };
        return state;
      },
      tick: (ctx) => {
        const state = ctx.state as AbmSimState;
        const hh = state.populations.households;
        const { n, alpha1, h, yd, cd, c, y, order } = hh;
        const { pr, w, alpha2, theta, s } = state;
        const Gi = state.G[ctx.periodZeroBased]!;

        // Tick 1: planned consumption
        let AD = Gi;
        for (let i = 0; i < n; i++) {
          const planned = Math.min(alpha1[i]! * yd[i]! + alpha2 * h[i]!, h[i]!);
          cd[i] = planned;
          AD += planned;
        }
        const Nd = AD / pr;

        // Tick 2: job lottery
        const N = hireLottery(ctx.rng, Nd, s, n);

        // Tick 3: shuffle (jobs + goods queue)
        shuffleIndices(ctx.rng, n, order);

        // Tick 4: goods — government first, then FCFS households
        const YG = Math.min(Gi, N * pr);
        const YC = N * pr - YG;
        rationFcfs(cd, order, YC, c);

        // Tick 5: wages, taxes, money
        y.fill(0);
        for (let k = 0; k < N; k++) {
          y[order[k]!] = w;
        }

        let TAX = 0;
        let Y = 0;
        let C = 0;
        let YD = 0;
        for (let i = 0; i < n; i++) {
          const yi = y[i]!;
          const tax = theta * yi;
          const ci = c[i]!;
          h[i] = h[i]! + yi - ci - tax;
          yd[i] = yi - tax;
          TAX += tax;
          Y += yi;
          C += ci;
          YD += yd[i]!;
        }

        // Tick 6: aggregates + SFC
        const H_d = h.reduce((a, b) => a + b, 0);
        state.H_s = state.H_s + (YG - TAX);

        return {
          values: {
            Y,
            C,
            YD,
            H_d,
            H_s: state.H_s,
            UR: (n - N) / n,
            G: Gi,
            c_h1: c[0]!,
            h_h1: h[0]!,
            e_h1: y[0]! > 0 ? 1 : 0,
            c_hLast: c[lastIdx]!,
            h_hLast: h[lastIdx]!,
            e_hLast: y[lastIdx]! > 0 ? 1 : 0
          }
        };
      }
    }
  );
}

/** Narrow helper for tests / callers that need the resolved AbmSimState type. */
export type { AbmModelState };
