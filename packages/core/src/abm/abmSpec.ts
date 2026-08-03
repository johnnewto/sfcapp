import { parseEquation } from "../parser/parse";
import type { CompiledExpression } from "../compile/compileExpression";
import type { SimulationResult } from "../result/result";
import { hireLottery, rationFcfs, shuffleIndices } from "./rng";
import { runAbmMonteCarlo } from "./monteCarlo";
import {
  advancePeriodBuffers,
  createAbmSolverContext,
  createRuntimeState,
  type AbmRuntimeState,
  type PopulationRuntime
} from "./abmSpecContext";
import { normalizeAbmSpec, aggregateAssignedNames, defaultAbmRecord } from "./normalizeAbmSpec";
import {
  ABM_MICRO_DEFAULT_MAX_AGENTS,
  type AbmEquationRow,
  type AbmMicroAgentRef,
  type AbmMicroRecord,
  type AbmSpec,
  type AbmSpecOverrides,
  type AbmTickSpec
} from "./abmSpecTypes";

interface CompiledEq {
  name: string;
  evaluate: CompiledExpression;
}

interface CompiledSpec {
  ticks: Array<
    | { kind: "agent"; population: string; equations: CompiledEq[] }
    | { kind: "aggregate"; equations: CompiledEq[] }
    | Extract<AbmTickSpec, { kind: "hire-lottery" | "shuffle" | "ration-fcfs" }>
  >;
  microSeriesNames: string[];
  microBindings: Array<{ seriesName: string; population: string; agentIndex: number; variable: string }>;
}

function compileEquations(rows: AbmEquationRow[]): CompiledEq[] {
  return rows.map((row) => {
    const [name, expression] = row;
    const parsed = parseEquation(name, expression);
    return { name: parsed.name, evaluate: parsed.evaluate };
  });
}

function resolveTolerance(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`ABM check tolerance must be a non-negative finite number (got ${value}).`);
  }
  return n;
}

function microAgentIndex(agent: "first" | "last" | number, size: number): number {
  if (agent === "first") {
    return 0;
  }
  if (agent === "last") {
    return size - 1;
  }
  if (!Number.isInteger(agent) || agent < 1 || agent > size) {
    throw new Error(`ABM micro agent index must be in 1..${size} (got ${agent}).`);
  }
  return agent - 1;
}

function microSeriesName(variable: string, agent: "first" | "last" | number): string {
  if (agent === "first") {
    return `${variable}_h1`;
  }
  if (agent === "last") {
    return `${variable}_hLast`;
  }
  return `${variable}_h${agent}`;
}

function normalizeMicroAgentList(agents: AbmMicroRecord["agents"]): AbmMicroAgentRef[] {
  if (agents === "all") {
    return ["all"];
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("ABM micro record needs a non-empty agents list (or agents: all).");
  }
  return agents;
}

/**
 * Expand micro agent refs to concrete indexes. `"all"` fills 1..size (capped);
 * later `first`/`last` tokens prefer the `_h1` / `_hLast` series aliases.
 */
export function expandAbmMicroAgents(
  entry: Pick<AbmMicroRecord, "agents" | "maxAgents">,
  size: number
): Array<{ agent: "first" | "last" | number; agentIndex: number }> {
  const raw = normalizeMicroAgentList(entry.agents);
  const maxAgents = entry.maxAgents ?? ABM_MICRO_DEFAULT_MAX_AGENTS;
  if (raw.includes("all") && size > maxAgents) {
    throw new Error(
      `ABM micro agents: "all" for population size ${size} exceeds maxAgents=${maxAgents}. ` +
        `Raise maxAgents or list specific agents (first / last / 1-based indexes).`
    );
  }

  const byIndex = new Map<number, "first" | "last" | number>();

  for (const agent of raw) {
    if (agent === "all") {
      for (let i = 1; i <= size; i++) {
        if (!byIndex.has(i - 1)) {
          byIndex.set(i - 1, i);
        }
      }
      continue;
    }
    const agentIndex = microAgentIndex(agent, size);
    const existing = byIndex.get(agentIndex);
    if (existing === "first" || existing === "last") {
      continue;
    }
    byIndex.set(agentIndex, agent);
  }

  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([agentIndex, agent]) => ({ agent, agentIndex }));
}

function compileMicro(spec: AbmSpec, populationSizes: Record<string, number>): CompiledSpec["microBindings"] {
  const bindings: CompiledSpec["microBindings"] = [];
  const seenNames = new Set<string>();
  for (const entry of spec.record?.micro ?? []) {
    const size = populationSizes[entry.population];
    if (size == null) {
      throw new Error(`ABM micro record references unknown population "${entry.population}".`);
    }
    for (const { agent, agentIndex } of expandAbmMicroAgents(entry, size)) {
      for (const variable of entry.variables) {
        const seriesName = microSeriesName(variable, agent);
        if (seenNames.has(seriesName)) {
          throw new Error(`ABM micro series "${seriesName}" is recorded more than once.`);
        }
        seenNames.add(seriesName);
        bindings.push({
          seriesName,
          population: entry.population,
          agentIndex,
          variable
        });
      }
    }
  }
  return bindings;
}

/** Validate an AbmSpec; throws on structural errors. */
export function validateAbmSpec(spec: AbmSpec, overrides?: AbmSpecOverrides): void {
  if (!spec.populations?.length) {
    throw new Error("ABM spec requires at least one population.");
  }
  if (!spec.ticks?.length) {
    throw new Error("ABM spec requires at least one tick.");
  }

  const defaults = defaultAbmRecord(spec.populations, spec.ticks);
  const record = {
    ...defaults,
    ...spec.record,
    series: spec.record?.series?.length ? spec.record.series : defaults.series,
    bands: spec.record?.bands !== undefined ? spec.record.bands : defaults.bands,
    micro: spec.record?.micro?.length ? spec.record.micro : defaults.micro,
    descriptions: {
      ...(defaults.descriptions ?? {}),
      ...(spec.record?.descriptions ?? {})
    }
  };

  if (!record.series?.length) {
    throw new Error("ABM spec requires record.series (normalize the spec first for auto macros).");
  }

  const popNames = new Set(spec.populations.map((p) => p.name));
  for (const pop of spec.populations) {
    if (pop.state.length === 0) {
      throw new Error(`ABM population "${pop.name}" needs at least one state variable.`);
    }
    const size = overrides?.populationSizes?.[pop.name] ?? pop.size;
    if (size < 1) {
      throw new Error(`ABM population "${pop.name}" size must be >= 1.`);
    }
  }

  const stateByPop = new Map(spec.populations.map((p) => [p.name, new Set(p.state)]));
  let shuffledPops = new Set<string>();

  for (const tick of spec.ticks) {
    switch (tick.kind) {
      case "agent": {
        if (!popNames.has(tick.population)) {
          throw new Error(`ABM agent tick references unknown population "${tick.population}".`);
        }
        const state = stateByPop.get(tick.population)!;
        for (const [name, expr] of tick.equations) {
          if (!state.has(name)) {
            throw new Error(
              `ABM agent equation target "${name}" is not a state variable of "${tick.population}".`
            );
          }
          if (!expr.trim()) {
            throw new Error(`ABM agent equation "${name}" has an empty expression.`);
          }
        }
        break;
      }
      case "aggregate":
        for (const [name, expr] of tick.equations) {
          if (!name.trim() || !expr.trim()) {
            throw new Error("ABM aggregate equation needs a non-empty name and expression.");
          }
        }
        break;
      case "hire-lottery":
        if (typeof tick.cap === "string" && !popNames.has(tick.cap) && tick.cap !== tick.demand) {
          // cap may be a population name; numeric handled at runtime via params/aggregates
        }
        break;
      case "shuffle":
        if (!popNames.has(tick.population)) {
          throw new Error(`ABM shuffle references unknown population "${tick.population}".`);
        }
        shuffledPops = new Set(shuffledPops);
        shuffledPops.add(tick.population);
        break;
      case "ration-fcfs":
        if (!popNames.has(tick.population)) {
          throw new Error(`ABM ration-fcfs references unknown population "${tick.population}".`);
        }
        if (!shuffledPops.has(tick.population)) {
          throw new Error(
            `ABM ration-fcfs for "${tick.population}" requires a prior shuffle tick.`
          );
        }
        break;
    }
  }

  // <pop>.rank / legacy position is only usable after shuffle — soft-checked at runtime.

  const aggregates = new Set(aggregateAssignedNames(spec.ticks));
  for (const name of record.series ?? []) {
    if (!aggregates.has(name)) {
      throw new Error(
        `ABM record.series "${name}" is never assigned by an aggregate (or hire-lottery) tick.`
      );
    }
  }
  for (const name of record.bands ?? []) {
    if (!(record.series ?? []).includes(name)) {
      throw new Error(`ABM record.bands "${name}" must also appear in record.series.`);
    }
  }

  for (const entry of record.micro ?? []) {
    if (!popNames.has(entry.population)) {
      throw new Error(`ABM micro record references unknown population "${entry.population}".`);
    }
    const state = stateByPop.get(entry.population)!;
    const size = overrides?.populationSizes?.[entry.population] ?? spec.populations.find((p) => p.name === entry.population)!.size;
    expandAbmMicroAgents(entry, size);
    for (const variable of entry.variables) {
      if (!state.has(variable)) {
        throw new Error(
          `ABM micro variable "${variable}" is not a state variable of "${entry.population}".`
        );
      }
    }
  }

  if (spec.check) {
    resolveTolerance(spec.check.tolerance);
  }

  const opening = spec.state?.aggregates ?? {};
  const paramNames = new Set(Object.keys(spec.params ?? {}));
  for (const [name, value] of Object.entries(opening)) {
    if (!name.trim()) {
      throw new Error("ABM state.aggregates entries need a non-empty name.");
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`ABM state.aggregates "${name}" must be a finite number.`);
    }
    if (paramNames.has(name)) {
      throw new Error(`ABM state.aggregates "${name}" collides with a scalar param.`);
    }
    if (!aggregates.has(name)) {
      throw new Error(
        `ABM state.aggregates "${name}" is never assigned by an aggregate (or hire-lottery) tick.`
      );
    }
  }
}

function compileSpec(spec: AbmSpec, overrides?: AbmSpecOverrides): CompiledSpec {
  validateAbmSpec(spec, overrides);

  const populationSizes: Record<string, number> = {};
  for (const pop of spec.populations) {
    populationSizes[pop.name] = overrides?.populationSizes?.[pop.name] ?? pop.size;
  }

  const ticks: CompiledSpec["ticks"] = spec.ticks.map((tick) => {
    switch (tick.kind) {
      case "agent":
        return {
          kind: "agent",
          population: tick.population,
          equations: compileEquations(tick.equations)
        };
      case "aggregate":
        return {
          kind: "aggregate",
          equations: compileEquations(tick.equations)
        };
      default:
        return tick;
    }
  });

  const microBindings = compileMicro(spec, populationSizes);
  return {
    ticks,
    microSeriesNames: microBindings.map((b) => b.seriesName),
    microBindings
  };
}

function resolveCap(state: AbmRuntimeState, cap: string | number): number {
  if (typeof cap === "number") {
    return cap;
  }
  const pop = state.populations[cap];
  if (pop) {
    return pop.size;
  }
  if (Object.prototype.hasOwnProperty.call(state.aggregates, cap)) {
    return state.aggregates[cap]!;
  }
  if (Object.prototype.hasOwnProperty.call(state.params, cap)) {
    return state.params[cap]!;
  }
  throw new Error(`ABM hire-lottery cap "${cap}" is not a population, aggregate, or param.`);
}

function resolveScalarRef(state: AbmRuntimeState, name: string): number {
  if (Object.prototype.hasOwnProperty.call(state.aggregates, name)) {
    return state.aggregates[name]!;
  }
  if (Object.prototype.hasOwnProperty.call(state.params, name)) {
    return state.params[name]!;
  }
  throw new Error(`ABM unknown scalar reference "${name}".`);
}

function runAgentTick(
  state: AbmRuntimeState,
  context: ReturnType<typeof createAbmSolverContext>,
  pop: PopulationRuntime,
  equations: CompiledEq[]
): void {
  state.activePopulation = pop;
  for (let i = 0; i < pop.size; i++) {
    state.agentIndex = i;
    for (const eq of equations) {
      const value = eq.evaluate(context);
      context.setCurrentValue(eq.name, value);
    }
  }
  state.agentIndex = -1;
  state.activePopulation = null;
}

function runAggregateTick(
  state: AbmRuntimeState,
  context: ReturnType<typeof createAbmSolverContext>,
  equations: CompiledEq[]
): void {
  state.activePopulation = null;
  state.agentIndex = -1;
  for (const eq of equations) {
    const value = eq.evaluate(context);
    context.setCurrentValue(eq.name, value);
  }
}

function executeTick(
  state: AbmRuntimeState,
  context: ReturnType<typeof createAbmSolverContext>,
  tick: CompiledSpec["ticks"][number],
  rng: Parameters<typeof hireLottery>[0]
): void {
  switch (tick.kind) {
    case "agent": {
      const pop = state.populations[tick.population];
      if (!pop) {
        throw new Error(`ABM unknown population "${tick.population}".`);
      }
      runAgentTick(state, context, pop, tick.equations);
      return;
    }
    case "aggregate":
      runAggregateTick(state, context, tick.equations);
      return;
    case "hire-lottery": {
      const demand = resolveScalarRef(state, tick.demand);
      const spread = resolveScalarRef(state, tick.spread);
      const cap = resolveCap(state, tick.cap);
      state.aggregates[tick.into] = hireLottery(rng, demand, spread, cap);
      return;
    }
    case "shuffle": {
      const pop = state.populations[tick.population];
      if (!pop) {
        throw new Error(`ABM shuffle unknown population "${tick.population}".`);
      }
      shuffleIndices(rng, pop.size, pop.order);
      pop.positionOf.fill(-1);
      for (let q = 0; q < pop.size; q++) {
        pop.positionOf[pop.order[q]!] = q;
      }
      pop.shuffled = true;
      return;
    }
    case "ration-fcfs": {
      const pop = state.populations[tick.population];
      if (!pop) {
        throw new Error(`ABM ration-fcfs unknown population "${tick.population}".`);
      }
      if (!pop.shuffled) {
        throw new Error(`ABM ration-fcfs requires a prior shuffle for "${tick.population}".`);
      }
      const demand = pop.cur[tick.demand];
      const into = pop.cur[tick.into];
      if (!demand || !into) {
        throw new Error(
          `ABM ration-fcfs demand "${tick.demand}" / into "${tick.into}" must be state variables.`
        );
      }
      const supply = resolveScalarRef(state, tick.supply);
      rationFcfs(demand, pop.order, supply, into);
      return;
    }
  }
}

function collectRecordedValues(
  state: AbmRuntimeState,
  seriesNames: string[],
  microBindings: CompiledSpec["microBindings"],
  check?: AbmSpec["check"]
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of seriesNames) {
    if (!Object.prototype.hasOwnProperty.call(state.aggregates, name)) {
      throw new Error(`ABM tick missing recorded series "${name}".`);
    }
    values[name] = state.aggregates[name]!;
  }
  for (const binding of microBindings) {
    const pop = state.populations[binding.population]!;
    const arr = pop.cur[binding.variable];
    if (!arr) {
      throw new Error(
        `ABM micro variable "${binding.variable}" missing on "${binding.population}".`
      );
    }
    values[binding.seriesName] = arr[binding.agentIndex]!;
  }
  if (check) {
    const left = state.aggregates[check.left];
    const right = state.aggregates[check.right];
    if (left === undefined || right === undefined) {
      throw new Error(`ABM check variables "${check.left}" / "${check.right}" were not assigned.`);
    }
    const tol = resolveTolerance(check.tolerance);
    if (Math.abs(left - right) > tol) {
      throw new Error(
        `ABM stock-flow check failed at period ${state.periodOneBased}: |${check.left} - ${check.right}| = ${Math.abs(left - right)} > ${tol}.`
      );
    }
  }
  return values;
}

/**
 * Run a declarative ABM specification under Monte Carlo aggregation.
 * Accepts typed specs or YAML-shaped tick wrappers (normalized first).
 */
export function runAbmSpec(specInput: AbmSpec | unknown, overrides: AbmSpecOverrides = {}): SimulationResult {
  const spec = resolveSpecInput(specInput);
  const compiled = compileSpec(spec, overrides);
  const periods = overrides.periods ?? 100;
  const monteCarlo = overrides.monteCarlo ?? spec.record?.monteCarlo ?? 50;
  const baseSeed = overrides.baseSeed ?? 0;
  const bandKind = overrides.bandKind ?? "percentile";
  const seriesNames = spec.record?.series ?? [];
  const bandSeriesNames = bandKind === "none" ? [] : (spec.record?.bands ?? []);

  const externals: Record<string, { kind: "constant"; value: number }> = {};
  for (const [name, value] of Object.entries({ ...(spec.params ?? {}), ...(overrides.params ?? {}) })) {
    externals[name] = { kind: "constant", value };
  }
  for (const pop of spec.populations) {
    const size = overrides.populationSizes?.[pop.name] ?? pop.size;
    externals[`${pop.name}_size`] = { kind: "constant", value: size };
  }
  externals.monteCarlo = { kind: "constant", value: monteCarlo };

  return runAbmMonteCarlo(
    {
      periods,
      monteCarlo,
      baseSeed,
      ...(bandKind === "none" ? {} : { bandKind })
    },
    {
      seriesNames,
      bandSeriesNames,
      microSeriesNames: compiled.microSeriesNames,
      model: {
        equations: [{ name: "_abm_spec", expression: "0" }],
        externals,
        initialValues: {}
      },
      init: (rng) =>
        createRuntimeState(spec, rng, {
          params: overrides.params,
          populationSizes: overrides.populationSizes,
          populationParams: overrides.populationParams
        }),
      tick: (ctx) => {
        const state = ctx.state as AbmRuntimeState;
        state.periodOneBased = ctx.periodOneBased;
        const context = createAbmSolverContext(state, ctx.rng);

        for (const tick of compiled.ticks) {
          executeTick(state, context, tick, ctx.rng);
        }

        const values = collectRecordedValues(
          state,
          seriesNames,
          compiled.microBindings,
          spec.check
        );
        advancePeriodBuffers(state);
        return { values };
      }
    }
  );
}

/** Resolve micro series naming for tests / callers. */
export function abmMicroSeriesName(
  variable: string,
  agent: "first" | "last" | number
): string {
  return microSeriesName(variable, agent);
}

function resolveSpecInput(specInput: unknown): AbmSpec {
  return normalizeAbmSpec(specInput);
}
