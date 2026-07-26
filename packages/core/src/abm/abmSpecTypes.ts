/**
 * Declarative ABM model specification. Plain, structured-cloneable data only —
 * authored in notebook YAML (`abm-model` cells) and interpreted by `runAbmSpec`.
 */

/** Uniform draw for heterogeneous population parameters (drawn once at init). */
export interface AbmUniformDraw {
  draw: "uniform";
  lo: number;
  hi: number;
}

/** Fixed scalar parameter (same value for every agent). */
export interface AbmConstantParam {
  value: number;
}

export type AbmPopulationParam = AbmUniformDraw | AbmConstantParam;

export interface AbmPopulationSpec {
  name: string;
  size: number;
  /** Per-agent state variable names (zero-initialized; written by agent ticks). */
  state: string[];
  /** Per-agent parameters (drawn or constant at init). */
  params?: Record<string, AbmPopulationParam>;
}

/**
 * `[target, expression]` or `[target, expression, description]` — same compact
 * row shape as notebook equation cells (description is optional metadata only).
 */
export type AbmEquationRow = [string, string] | [string, string, string];

export interface AbmAgentTick {
  kind: "agent";
  population: string;
  equations: AbmEquationRow[];
}

export interface AbmAggregateTick {
  kind: "aggregate";
  equations: AbmEquationRow[];
}

export interface AbmHireLotteryTick {
  kind: "hire-lottery";
  /** Aggregate holding labour demand. */
  demand: string;
  /** Aggregate or param holding hiring spread s. */
  spread: string;
  /** Population name whose size caps hiring, or a numeric literal. */
  cap: string | number;
  /** Aggregate written with hired count N. */
  into: string;
}

export interface AbmShuffleTick {
  kind: "shuffle";
  population: string;
}

export interface AbmRationFcfsTick {
  kind: "ration-fcfs";
  population: string;
  /** Per-agent demand variable. */
  demand: string;
  /** Aggregate holding available supply. */
  supply: string;
  /** Per-agent served amount written. */
  into: string;
}

export type AbmTickSpec =
  | AbmAgentTick
  | AbmAggregateTick
  | AbmHireLotteryTick
  | AbmShuffleTick
  | AbmRationFcfsTick;

/** Agent selector for micro recording (MC run 1 only). */
export type AbmMicroAgentRef = "first" | "last" | "all" | number;

/**
 * Default cap when `agents` includes `"all"`. Raise via `maxAgents` for larger
 * populations (R ABM_SIM stores every household at n=200).
 */
export const ABM_MICRO_DEFAULT_MAX_AGENTS = 64;

export interface AbmMicroRecord {
  population: string;
  /**
   * Which agents to record from MC run 1.
   * - `first` / `last` → series `var_h1` / `var_hLast`
   * - positive integer → 1-based index → `var_h{i}`
   * - `all` → every agent as `var_h1`…`var_h{n}` (subject to `maxAgents`)
   * YAML may also use the bare string `agents: all`.
   */
  agents: AbmMicroAgentRef[] | "all";
  variables: string[];
  /**
   * Maximum agents when `agents` includes `all`. Defaults to
   * {@link ABM_MICRO_DEFAULT_MAX_AGENTS}.
   */
  maxAgents?: number;
}

/**
 * Optional recording overrides. When omitted, the engine stores every aggregate
 * macro (MC means + bands) and first/last-agent micro for each population (MC run 1).
 *
 * Legacy authoring still accepts an object (`series` / `micro` / …) or a directive list.
 */
export type AbmRecordDirective =
  | {
      population: string;
      agents?: AbmMicroAgentRef[] | "all";
      variables?: string[];
      maxAgents?: number;
    }
  | { "monte-carlo-run": number }
  | { monteCarlo: number }
  | { bands: string[] | "all" | "none" }
  | { descriptions: Record<string, string> };

export interface AbmRecordSpec {
  /**
   * Macro series averaged across Monte Carlo runs (upper-case by convention).
   * Omitted / empty → every aggregate assignment from ticks (auto-all macros).
   */
  series?: string[];
  /** Subset of `series` for which `_p10`/`_p90` (or min/max) bands are stored. */
  bands?: string[];
  /**
   * Optional default Monte Carlo count when the run cell does not set `monteCarlo`.
   * Prefer setting `abm.monteCarlo` on the run cell.
   */
  monteCarlo?: number;
  /**
   * Micro histories from MC run 1 only (lower-case / `*_h*` by convention).
   * Default: first + last agent, all state variables, for every population.
   */
  micro?: AbmMicroRecord[];
  /**
   * Human-readable labels for macro series names and micro base variables.
   */
  descriptions?: Record<string, string>;
}

export interface AbmCheckSpec {
  left: string;
  right: string;
  /** Absolute tolerance; string or number (YAML often quotes small floats). */
  tolerance: number | string;
}

export interface AbmSpec {
  /** Optional display / registry id. */
  modelId?: string;
  populations: AbmPopulationSpec[];
  /** Scalar params shared by all agents and aggregates. */
  params?: Record<string, number>;
  ticks: AbmTickSpec[];
  /** Optional; defaults to all macros + first/last micro per population. */
  record?: AbmRecordSpec;
  check?: AbmCheckSpec;
}

/** Runtime overrides applied on top of a base AbmSpec. */
export interface AbmSpecOverrides {
  periods?: number;
  monteCarlo?: number;
  baseSeed?: number;
  bandKind?: "percentile" | "minmax" | "none";
  /** Override scalar params by name. */
  params?: Record<string, number>;
  /** Override population size by population name. */
  populationSizes?: Record<string, number>;
  /**
   * Replace a population param draw/constant. Used by the ABM-SIM wrapper for
   * `homogeneousAlpha1` and alpha1 range overrides.
   */
  populationParams?: Record<string, Record<string, AbmPopulationParam>>;
}
