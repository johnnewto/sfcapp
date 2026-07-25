import { buildOrderedBlocks, type EquationBlock } from "../graph/blocks";
import { wrapContextWithMatrixColumnSums } from "../engine/matrixColumnSum";
import type { SolverContext } from "../engine/context";
import { parseEquation, type ParsedEquation } from "../parser/parse";
import type { ModelDefinition, SimulationOptions, SolverMethod } from "../model/types";
import type { ConvergenceVariableDiagnostic } from "../solver/convergenceFailure";
import { gaussSeidelSolver } from "../solver/gaussSeidel";
import { newtonSolver } from "../solver/newton";
import { broydenSolver } from "../solver/broyden";
import type { BlockSolver } from "../solver/types";
import {
  blockJacobian,
  blockResiduals,
  isJacobianNumericallySingular,
  probeCyclicBlock,
  seedCyclicBlockGuess,
  type BlockProbeIteration,
  type BlockSeedSource
} from "../solver/blockProbe";

export type BlockConvergenceStatus =
  | "acyclic"
  | "converged"
  | "max_iterations"
  | "non_finite"
  | "singular_jacobian";

export interface BlockJacobianDiagnostics {
  variables: string[];
  matrix: number[][];
  residualNorm: number;
  singular: boolean;
}

export interface BlockConvergenceAnalysis {
  period: number;
  block: EquationBlock;
  status: BlockConvergenceStatus;
  solverMethod: SolverMethod;
  tolerance: number;
  maxIterations: number;
  iterationsUsed: number;
  seedSource: BlockSeedSource | "acyclic";
  initialGuess: Record<string, number>;
  finalValues?: Record<string, number>;
  residualNormBefore: number;
  residualNormAfter: number;
  jacobianAtStart?: BlockJacobianDiagnostics;
  variables: ConvergenceVariableDiagnostic[];
  iterations?: BlockProbeIteration[];
}

export interface BlockConvergenceReport {
  period: number;
  solverMethod: SolverMethod;
  tolerance: number;
  maxIterations: number;
  blocks: BlockConvergenceAnalysis[];
}

export interface BlockConvergenceOptions {
  solverMethod?: SolverMethod;
  tolerance?: number;
  maxIterations?: number;
  lagOverrides?: Record<string, number>;
  currentGuess?: Record<string, number>;
  solveUpstreamBlocks?: boolean;
  recordIterations?: boolean;
  blocks?: EquationBlock[];
}

export interface InitialValueProbeCandidate {
  label: string;
  initialValues: Record<string, number>;
  defaultInitialValue?: number;
}

export interface InitialValueProbeResult {
  label: string;
  initialValues: Record<string, number>;
  report: BlockConvergenceReport;
  allCyclicConverged: boolean;
}

export function analyzeAllBlockConvergence(
  model: ModelDefinition,
  options: SimulationOptions,
  period: number,
  analysisOptions?: BlockConvergenceOptions
): BlockConvergenceReport {
  validatePeriod(period, options);

  const solverMethod = analysisOptions?.solverMethod ?? options.solverMethod;
  const tolerance = analysisOptions?.tolerance ?? options.tolerance;
  const maxIterations = analysisOptions?.maxIterations ?? options.maxIterations;
  const blocks = resolveBlocks(model, analysisOptions?.blocks);
  const blockAnalyses: BlockConvergenceAnalysis[] = [];

  for (const block of blocks) {
    blockAnalyses.push(
      analyzeBlockAtPeriod(model, options, period, block.id, blocks, {
        ...analysisOptions,
        solverMethod,
        tolerance,
        maxIterations,
        blocks
      })
    );
  }

  return {
    period,
    solverMethod,
    tolerance,
    maxIterations,
    blocks: blockAnalyses
  };
}

export function analyzeBlockConvergence(
  model: ModelDefinition,
  options: SimulationOptions,
  period: number,
  blockId: number,
  analysisOptions?: BlockConvergenceOptions
): BlockConvergenceAnalysis {
  validatePeriod(period, options);
  const blocks = resolveBlocks(model, analysisOptions?.blocks);
  const block = blocks.find((entry) => entry.id === blockId);
  if (!block) {
    throw new Error(`Unknown block id: ${blockId}`);
  }

  return analyzeBlockAtPeriod(model, options, period, blockId, blocks, analysisOptions);
}

export function probeInitialValuesForPeriod1(
  model: ModelDefinition,
  options: SimulationOptions,
  candidates: InitialValueProbeCandidate[],
  analysisOptions?: Omit<BlockConvergenceOptions, "lagOverrides" | "period">
): InitialValueProbeResult[] {
  if (options.periods <= 1) {
    throw new Error("probeInitialValuesForPeriod1 requires options.periods > 1");
  }

  return candidates.map((candidate) => {
    const lagOverrides = buildLagOverridesFromInitialValues(
      model,
      options,
      candidate.initialValues,
      candidate.defaultInitialValue
    );
    const report = analyzeAllBlockConvergence(model, options, 1, {
      ...analysisOptions,
      lagOverrides
    });
    const cyclicBlocks = report.blocks.filter((entry) => entry.block.cyclic);
    const allCyclicConverged = cyclicBlocks.every((entry) => entry.status === "converged");

    return {
      label: candidate.label,
      initialValues: candidate.initialValues,
      report,
      allCyclicConverged
    };
  });
}

function analyzeBlockAtPeriod(
  model: ModelDefinition,
  options: SimulationOptions,
  period: number,
  blockId: number,
  blocks: EquationBlock[],
  analysisOptions?: BlockConvergenceOptions
): BlockConvergenceAnalysis {
  const solverMethod = analysisOptions?.solverMethod ?? options.solverMethod;
  const tolerance = analysisOptions?.tolerance ?? options.tolerance;
  const maxIterations = analysisOptions?.maxIterations ?? options.maxIterations;
  const solveUpstream = analysisOptions?.solveUpstreamBlocks ?? true;
  const recordIterations = analysisOptions?.recordIterations ?? false;

  const matrixColumnSums = model.matrixColumnSums ?? {};
  const matrixColumnSumLocations = model.matrixColumnSumLocations;
  const parsed = model.equations.map((equation) =>
    parseEquation(equation.name, equation.expression, { matrixColumnSums })
  );
  const equationsByName = new Map(parsed.map((equation) => [equation.name, equation]));
  const block = blocks.find((entry) => entry.id === blockId);
  if (!block) {
    throw new Error(`Unknown block id: ${blockId}`);
  }

  const context = buildAnalysisContext(model, options, period, {
    lagOverrides: analysisOptions?.lagOverrides,
    currentOverrides: analysisOptions?.currentGuess
  });
  const wrappedContext = wrapContextWithMatrixColumnSums(
    context,
    matrixColumnSums,
    matrixColumnSumLocations
  );
  const solver = selectSolver(solverMethod);
  const runOptions = { tolerance, maxIterations };

  if (solveUpstream) {
    for (const upstream of blocks) {
      if (upstream.id === blockId) {
        break;
      }
      solver.solveBlock(period, upstream, equationsByName, wrappedContext, runOptions);
    }
  }

  if (!block.cyclic) {
    return analyzeAcyclicBlock(period, block, equationsByName, wrappedContext, solverMethod, tolerance, maxIterations);
  }

  const variables = block.equationNames;
  const { guess, seedSource } = seedCyclicBlockGuess(
    variables,
    wrappedContext,
    solverMethod,
    analysisOptions?.currentGuess
  );

  setBlockCurrentValues(wrappedContext, variables, guess);
  const baseResidual = blockResiduals(variables, equationsByName, wrappedContext);
  const residualNormBefore = maxAbs(baseResidual);
  const jacobian = blockJacobian(variables, equationsByName, wrappedContext, variables.map((v) => guess[v] ?? NaN), baseResidual);

  const probe = probeCyclicBlock(
    variables,
    equationsByName,
    wrappedContext,
    solverMethod,
    runOptions,
    guess,
    seedSource
  );

  const status = classifyProbeStatus(probe);

  return {
    period,
    block,
    status,
    solverMethod,
    tolerance,
    maxIterations,
    iterationsUsed: probe.iterationsUsed,
    seedSource: probe.seedSource,
    initialGuess: probe.initialGuess,
    finalValues: probe.finalValues,
    residualNormBefore: probe.residualNormBefore,
    residualNormAfter: probe.residualNormAfter,
    jacobianAtStart: {
      variables,
      matrix: jacobian,
      residualNorm: residualNormBefore,
      singular: isJacobianNumericallySingular(jacobian)
    },
    variables: probe.variables,
    ...(recordIterations ? { iterations: probe.iterations } : {})
  };
}

function analyzeAcyclicBlock(
  period: number,
  block: EquationBlock,
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  solverMethod: SolverMethod,
  tolerance: number,
  maxIterations: number
): BlockConvergenceAnalysis {
  const variable = block.equationNames[0];
  if (!variable) {
    throw new Error(`Empty block encountered at period ${period}`);
  }
  const equation = equationsByName.get(variable);
  if (!equation) {
    throw new Error(`Missing equation for variable: ${variable}`);
  }

  const previous = context.currentValue(variable);
  const rhsBefore = equation.evaluate(context);
  const residualNormBefore = Math.abs(rhsBefore - previous);
  const next = rhsBefore;
  context.setCurrentValue(variable, next);
  const rhsAfter = equation.evaluate(context);
  const residualNormAfter = Math.abs(rhsAfter - next);
  const finite = Number.isFinite(previous) && Number.isFinite(next) && Number.isFinite(rhsBefore);

  return {
    period,
    block,
    status: finite ? "acyclic" : "non_finite",
    solverMethod,
    tolerance,
    maxIterations,
    iterationsUsed: 0,
    seedSource: "acyclic",
    initialGuess: { [variable]: previous },
    finalValues: { [variable]: next },
    residualNormBefore,
    residualNormAfter,
    variables: [
      {
        name: variable,
        value: next,
        previous,
        relativeChange: Math.abs(next - previous) / (Math.abs(previous) + 1e-15),
        finite
      }
    ]
  };
}

function classifyProbeStatus(probe: {
  converged: boolean;
  nonFinite: boolean;
  singularJacobian: boolean;
}): BlockConvergenceStatus {
  if (probe.converged) {
    return "converged";
  }
  if (probe.nonFinite) {
    return "non_finite";
  }
  if (probe.singularJacobian) {
    return "singular_jacobian";
  }
  return "max_iterations";
}

function validatePeriod(period: number, options: SimulationOptions): void {
  if (!Number.isInteger(period)) {
    throw new Error(`Block convergence period must be an integer, received ${period}`);
  }
  if (period <= 0) {
    throw new Error(`Block convergence period must be greater than 0, received ${period}`);
  }
  if (period >= options.periods) {
    throw new Error(
      `Block convergence period must be less than ${options.periods}, received ${period}`
    );
  }
}

function resolveBlocks(model: ModelDefinition, blocks?: EquationBlock[]): EquationBlock[] {
  if (blocks && blocks.length > 0) {
    return blocks;
  }
  const parsed = model.equations.map((equation) =>
    parseEquation(equation.name, equation.expression, {
      matrixColumnSums: model.matrixColumnSums ?? {}
    })
  );
  return buildOrderedBlocks(parsed).blocks;
}

interface PeriodValues {
  current: number;
  lag: number;
}

class BlockAnalysisContext implements SolverContext {
  constructor(private readonly values: Map<string, PeriodValues>) {}

  currentValue(variable: string): number {
    return this.requireEntry(variable).current;
  }

  lagValue(variable: string): number {
    return this.requireEntry(variable).lag;
  }

  diffValue(variable: string): number {
    return this.currentValue(variable) - this.lagValue(variable);
  }

  setCurrentValue(variable: string, value: number): void {
    this.requireEntry(variable).current = value;
  }

  setLagValue(variable: string, value: number): void {
    this.requireEntry(variable).lag = value;
  }

  hasSeries(variable: string): boolean {
    return this.values.has(variable);
  }

  private requireEntry(variable: string): PeriodValues {
    const entry = this.values.get(variable);
    if (!entry) {
      throw new Error(`Unknown variable: ${variable}`);
    }
    return entry;
  }
}

function buildAnalysisContext(
  model: ModelDefinition,
  options: SimulationOptions,
  period: number,
  overrides?: {
    lagOverrides?: Record<string, number>;
    currentOverrides?: Record<string, number>;
  }
): BlockAnalysisContext {
  const defaultValue = options.defaultInitialValue ?? 1e-15;
  const endogenous = model.equations.map((equation) => equation.name);
  const externals = Object.keys(model.externals);
  const allNames = [...endogenous, ...externals];
  const values = new Map<string, PeriodValues>();

  for (const name of allNames) {
    const lag =
      overrides?.lagOverrides?.[name] ??
      model.initialValues[name] ??
      defaultValue;
    const current = overrides?.currentOverrides?.[name] ?? defaultValue;
    values.set(name, { current, lag });
  }

  for (const [name, external] of Object.entries(model.externals)) {
    const entry = values.get(name);
    if (!entry) {
      continue;
    }
    if (external.kind === "constant") {
      entry.current = external.value;
      entry.lag = external.value;
    } else {
      const atPeriod = external.values[period] ?? external.values[period - 1] ?? defaultValue;
      const atLag = external.values[period - 1] ?? external.values[0] ?? defaultValue;
      entry.current = atPeriod;
      entry.lag = atLag;
    }
  }

  return new BlockAnalysisContext(values);
}

function buildLagOverridesFromInitialValues(
  model: ModelDefinition,
  options: SimulationOptions,
  initialValues: Record<string, number>,
  defaultInitialValue?: number
): Record<string, number> {
  const defaultValue = defaultInitialValue ?? options.defaultInitialValue ?? 1e-15;
  const endogenous = model.equations.map((equation) => equation.name);
  const overrides: Record<string, number> = {};

  for (const name of endogenous) {
    if (name in initialValues) {
      overrides[name] = initialValues[name]!;
    } else if (name in model.initialValues) {
      overrides[name] = model.initialValues[name]!;
    } else {
      overrides[name] = defaultValue;
    }
  }

  return overrides;
}

function setBlockCurrentValues(
  context: SolverContext,
  variables: string[],
  guess: Record<string, number>
): void {
  for (const variable of variables) {
    context.setCurrentValue(variable, guess[variable] ?? NaN);
  }
}

function selectSolver(solverMethod: SolverMethod): BlockSolver {
  switch (solverMethod) {
    case "GAUSS_SEIDEL":
      return gaussSeidelSolver;
    case "NEWTON":
      return newtonSolver;
    case "BROYDEN":
      return broydenSolver;
  }
}

function maxAbs(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}
