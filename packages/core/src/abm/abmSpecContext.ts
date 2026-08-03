import type { SolverContext } from "../engine/context";
import type { Rng } from "./rng";
import { runif } from "./rng";
import type { AbmPopulationParam, AbmPopulationSpec, AbmSpec } from "./abmSpecTypes";

export interface PopulationRuntime {
  name: string;
  size: number;
  /** Per-agent parameters (fixed after init). */
  params: Record<string, Float64Array>;
  /** Current-period state. */
  cur: Record<string, Float64Array>;
  /** Previous-period state (lag targets). */
  prev: Record<string, Float64Array>;
  /** Shuffle order (agent ids); length = size. Empty until first shuffle. */
  order: number[];
  /** Inverse: agentId -> 0-based queue position. -1 if not shuffled this period. */
  positionOf: Int32Array;
  shuffled: boolean;
}

export interface AbmRuntimeState {
  populations: Record<string, PopulationRuntime>;
  /** Current-period aggregates. */
  aggregates: Record<string, number>;
  /** Previous-period aggregates (for lag). */
  prevAggregates: Record<string, number>;
  /** Resolved scalar params (spec + overrides). */
  params: Record<string, number>;
  periodOneBased: number;
  /** Agent index while evaluating an agent tick; -1 in aggregate mode. */
  agentIndex: number;
  /** Population under an agent tick; null in aggregate mode. */
  activePopulation: PopulationRuntime | null;
}

export function createPopulationRuntime(
  spec: AbmPopulationSpec,
  rng: Rng,
  sizeOverride?: number,
  paramOverrides?: Record<string, AbmPopulationParam>
): PopulationRuntime {
  const size = sizeOverride ?? spec.size;
  if (size < 1) {
    throw new Error(`ABM population "${spec.name}" size must be >= 1 (got ${size}).`);
  }

  const params: Record<string, Float64Array> = {};
  const mergedParams = { ...(spec.params ?? {}), ...(paramOverrides ?? {}) };
  for (const [name, def] of Object.entries(mergedParams)) {
    const values = new Float64Array(size);
    if ("draw" in def && def.draw === "uniform") {
      for (let i = 0; i < size; i++) {
        values[i] = runif(rng, def.lo, def.hi);
      }
    } else if ("value" in def) {
      values.fill(def.value);
    } else {
      throw new Error(`ABM population "${spec.name}" param "${name}" has unknown shape.`);
    }
    params[name] = values;
  }

  const cur: Record<string, Float64Array> = {};
  const prev: Record<string, Float64Array> = {};
  for (const name of spec.state) {
    cur[name] = new Float64Array(size);
    prev[name] = new Float64Array(size);
  }

  return {
    name: spec.name,
    size,
    params,
    cur,
    prev,
    order: new Array(size),
    positionOf: new Int32Array(size).fill(-1),
    shuffled: false
  };
}

export function createRuntimeState(
  spec: AbmSpec,
  rng: Rng,
  options?: {
    params?: Record<string, number>;
    populationSizes?: Record<string, number>;
    populationParams?: Record<string, Record<string, AbmPopulationParam>>;
  }
): AbmRuntimeState {
  const params = { ...(spec.params ?? {}), ...(options?.params ?? {}) };
  const populations: Record<string, PopulationRuntime> = {};
  for (const pop of spec.populations) {
    populations[pop.name] = createPopulationRuntime(
      pop,
      rng,
      options?.populationSizes?.[pop.name],
      options?.populationParams?.[pop.name]
    );
  }
  const opening = { ...(spec.state?.aggregates ?? {}) };
  return {
    populations,
    aggregates: { ...opening },
    prevAggregates: { ...opening },
    params,
    periodOneBased: 1,
    agentIndex: -1,
    activePopulation: null
  };
}

/** Copy current state into prev and clear shuffle flags at period end. */
export function advancePeriodBuffers(state: AbmRuntimeState): void {
  state.prevAggregates = { ...state.aggregates };
  for (const pop of Object.values(state.populations)) {
    for (const name of Object.keys(pop.cur)) {
      pop.prev[name]!.set(pop.cur[name]!);
    }
    pop.shuffled = false;
    pop.positionOf.fill(-1);
  }
}

function resolvePopulationSum(state: AbmRuntimeState, columnRef: string): number {
  const dot = columnRef.indexOf(".");
  if (dot <= 0) {
    throw new Error(`ABM sum() expects "<population>.<variable>" (got "${columnRef}").`);
  }
  const popName = columnRef.slice(0, dot);
  const varName = columnRef.slice(dot + 1);
  const pop = state.populations[popName];
  if (!pop) {
    throw new Error(`ABM sum() unknown population "${popName}".`);
  }
  if (varName === "size") {
    return pop.size;
  }
  const values = pop.cur[varName];
  if (!values) {
    throw new Error(`ABM sum() unknown variable "${varName}" on population "${popName}".`);
  }
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i]!;
  }
  return total;
}

function lookupScalar(state: AbmRuntimeState, name: string, useLag: boolean): number {
  if (name === "t") {
    return state.periodOneBased;
  }
  // Legacy bare name; prefer "<population>.rank".
  if (name === "position") {
    return lookupQueueRank(state, state.activePopulation?.name);
  }

  const sizeSuffix = ".size";
  if (name.endsWith(sizeSuffix)) {
    const popName = name.slice(0, -sizeSuffix.length);
    const pop = state.populations[popName];
    if (!pop) {
      throw new Error(`ABM unknown population size "${name}".`);
    }
    return pop.size;
  }

  const rankSuffix = ".rank";
  if (name.endsWith(rankSuffix)) {
    return lookupQueueRank(state, name.slice(0, -rankSuffix.length));
  }

  if (state.activePopulation && state.agentIndex >= 0) {
    const pop = state.activePopulation;
    const i = state.agentIndex;
    const param = pop.params[name];
    if (param) {
      return param[i]!;
    }
    if (useLag) {
      const prev = pop.prev[name];
      if (prev) {
        return prev[i]!;
      }
    } else {
      const cur = pop.cur[name];
      if (cur) {
        return cur[i]!;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(state.params, name)) {
    return state.params[name]!;
  }

  if (useLag) {
    if (Object.prototype.hasOwnProperty.call(state.prevAggregates, name)) {
      return state.prevAggregates[name]!;
    }
    // First period: lag of unset aggregate is 0.
    if (Object.prototype.hasOwnProperty.call(state.aggregates, name)) {
      return 0;
    }
    return 0;
  }

  if (Object.prototype.hasOwnProperty.call(state.aggregates, name)) {
    return state.aggregates[name]!;
  }

  throw new Error(`ABM unknown variable "${name}".`);
}

/**
 * 1-based place in this period's shuffle queue for the current agent.
 * Requires an active agent tick and a prior shuffle of `populationName`.
 */
function lookupQueueRank(state: AbmRuntimeState, populationName: string | undefined): number {
  if (!populationName) {
    throw new Error(`ABM queue rank is only available inside an agent tick after shuffle.`);
  }
  const pop = state.populations[populationName];
  if (!pop) {
    throw new Error(`ABM unknown population "${populationName}" for queue rank.`);
  }
  if (!state.activePopulation || state.agentIndex < 0) {
    throw new Error(
      `ABM "${populationName}.rank" is only available inside an agent tick after shuffle.`
    );
  }
  if (state.activePopulation.name !== populationName) {
    throw new Error(
      `ABM "${populationName}.rank" cannot be read while evaluating population "${state.activePopulation.name}".`
    );
  }
  if (!pop.shuffled) {
    throw new Error(`ABM "${populationName}.rank" requires a prior shuffle tick.`);
  }
  const pos = pop.positionOf[state.agentIndex]!;
  if (pos < 0) {
    throw new Error(`ABM agent ${state.agentIndex} has no queue rank.`);
  }
  return pos + 1;
}

/**
 * SolverContext bound to the current runtime state. Agent ticks set
 * `state.agentIndex` / `state.activePopulation` before evaluating equations.
 * Pass the Monte Carlo `rng` so `random.uniform(low, high, size)` shares the hire/shuffle stream.
 */
export function createAbmSolverContext(state: AbmRuntimeState, rng: Rng): SolverContext {
  return {
    currentValue(variable: string): number {
      return lookupScalar(state, variable, false);
    },
    lagValue(variable: string, _offset = 1): number {
      return lookupScalar(state, variable, true);
    },
    diffValue(variable: string): number {
      return lookupScalar(state, variable, false) - lookupScalar(state, variable, true);
    },
    setCurrentValue(variable: string, value: number): void {
      if (state.activePopulation && state.agentIndex >= 0) {
        const cur = state.activePopulation.cur[variable];
        if (!cur) {
          throw new Error(
            `ABM cannot write "${variable}" — not a state variable of "${state.activePopulation.name}".`
          );
        }
        cur[state.agentIndex] = value;
        return;
      }
      state.aggregates[variable] = value;
    },
    hasSeries(variable: string): boolean {
      if (variable === "t" || variable === "position") {
        return true;
      }
      if (variable.endsWith(".size") || variable.endsWith(".rank")) {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(state.params, variable)) {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(state.aggregates, variable)) {
        return true;
      }
      if (state.activePopulation) {
        const pop = state.activePopulation;
        if (pop.params[variable] || pop.cur[variable]) {
          return true;
        }
      }
      return false;
    },
    evaluateMatrixColumnSum(columnRef: string): number {
      return resolvePopulationSum(state, columnRef);
    },
    randomUniform(lo: number, hi: number): number {
      return runif(rng, lo, hi);
    },
    matrixColumnSums: {}
  };
}
