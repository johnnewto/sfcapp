import type { SolverContext } from "../engine/context";
import type { ParsedEquation } from "../parser/parse";
import type { SolverMethod } from "../model/types";
import type { ConvergenceVariableDiagnostic } from "./convergenceFailure";
import { solveLinearSystem } from "./linearSolve";

export type BlockSeedSource = "lag" | "current_slot" | "explicit_guess";

export interface BlockProbeIteration {
  iteration: number;
  residualNorm: number;
  maxRelativeChange: number;
}

export interface BlockProbeResult {
  converged: boolean;
  iterationsUsed: number;
  variables: ConvergenceVariableDiagnostic[];
  iterations: BlockProbeIteration[];
  nonFinite: boolean;
  singularJacobian: boolean;
  residualNormBefore: number;
  residualNormAfter: number;
  initialGuess: Record<string, number>;
  finalValues?: Record<string, number>;
  seedSource: BlockSeedSource;
}

export function probeCyclicBlock(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  solverMethod: SolverMethod,
  options: { tolerance: number; maxIterations: number },
  seed: Record<string, number>,
  seedSource: BlockSeedSource
): BlockProbeResult {
  setCurrentValues(
    context,
    variables,
    variables.map((name) => seed[name] ?? NaN)
  );
  const initialGuess = Object.fromEntries(variables.map((name) => [name, seed[name] ?? NaN]));

  const baseResidual = residuals(variables, equationsByName, context);
  const residualNormBefore = maxAbs(baseResidual);
  if (!residualNormFinite(baseResidual)) {
    return {
      converged: false,
      iterationsUsed: 0,
      variables: buildResidualDiagnostics(variables, baseResidual),
      iterations: [],
      nonFinite: true,
      singularJacobian: false,
      residualNormBefore,
      residualNormAfter: residualNormBefore,
      initialGuess,
      seedSource
    };
  }

  switch (solverMethod) {
    case "NEWTON":
      return probeNewton(
        variables,
        equationsByName,
        context,
        options,
        initialGuess,
        seed,
        seedSource,
        residualNormBefore
      );
    case "BROYDEN":
      return probeBroyden(
        variables,
        equationsByName,
        context,
        options,
        initialGuess,
        seed,
        seedSource,
        residualNormBefore
      );
    case "GAUSS_SEIDEL":
      return probeGaussSeidel(
        variables,
        equationsByName,
        context,
        options,
        initialGuess,
        seedSource,
        residualNormBefore
      );
  }
}

export function blockResiduals(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext
): number[] {
  return residuals(variables, equationsByName, context);
}

export function blockJacobian(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  x: number[],
  baseResidual: number[]
): number[][] {
  return finiteDifferenceJacobian(variables, equationsByName, context, x, baseResidual);
}

export function isJacobianNumericallySingular(jacobian: number[][]): boolean {
  try {
    const n = jacobian.length;
    if (n === 0) {
      return false;
    }
    const rhs = new Array<number>(n).fill(0);
    rhs[0] = 1;
    solveLinearSystem(jacobian, rhs);
    return false;
  } catch {
    return true;
  }
}

export function seedCyclicBlockGuess(
  variables: string[],
  context: SolverContext,
  solverMethod: SolverMethod,
  explicitGuess?: Record<string, number>
): { guess: Record<string, number>; seedSource: BlockSeedSource } {
  if (explicitGuess) {
    const guess = Object.fromEntries(
      variables.map((variable) => [variable, explicitGuess[variable] ?? context.lagValue(variable)])
    );
    return { guess, seedSource: "explicit_guess" };
  }

  if (solverMethod === "NEWTON" || solverMethod === "BROYDEN") {
    return {
      guess: Object.fromEntries(variables.map((variable) => [variable, context.lagValue(variable)])),
      seedSource: "lag"
    };
  }

  return {
    guess: Object.fromEntries(variables.map((variable) => [variable, context.currentValue(variable)])),
    seedSource: "current_slot"
  };
}

function probeNewton(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  options: { tolerance: number; maxIterations: number },
  initialGuess: Record<string, number>,
  seed: Record<string, number>,
  seedSource: BlockSeedSource,
  residualNormBefore: number
): BlockProbeResult {
  const x = variables.map((variable) => seed[variable] ?? NaN);
  const iterations: BlockProbeIteration[] = [];
  let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];
  let iterationsUsed = 0;

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    iterationsUsed = iteration + 1;
    setCurrentValues(context, variables, x);
    const residual = residuals(variables, equationsByName, context);
    const residualNorm = maxAbs(residual);
    lastDiagnostics = buildResidualDiagnostics(variables, residual);

    if (!residualNormFinite(residual)) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        false,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        residualNorm,
        true,
        false
      );
    }

    iterations.push({
      iteration: iterationsUsed,
      residualNorm,
      maxRelativeChange: maxRelativeFromResidualDiagnostics(lastDiagnostics)
    });

    if (residualNorm < options.tolerance) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        true,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        residualNorm,
        false,
        false
      );
    }

    const jacobian = finiteDifferenceJacobian(variables, equationsByName, context, x, residual);
    if (isJacobianNumericallySingular(jacobian)) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        false,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        residualNorm,
        false,
        true
      );
    }

    let delta: number[];
    try {
      delta = solveLinearSystem(
        jacobian,
        residual.map((value) => -value)
      );
    } catch {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        false,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        residualNorm,
        false,
        true
      );
    }

    for (let index = 0; index < x.length; index += 1) {
      x[index] = (x[index] ?? 0) + (delta[index] ?? 0);
    }

    setCurrentValues(context, variables, x);
    const steppedResidual = residuals(variables, equationsByName, context);
    const steppedNorm = maxAbs(steppedResidual);
    if (steppedNorm < options.tolerance) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        true,
        iterationsUsed,
        buildResidualDiagnostics(variables, steppedResidual),
        iterations,
        steppedNorm,
        false,
        false
      );
    }
  }

  setCurrentValues(context, variables, x);
  const finalResidual = residuals(variables, equationsByName, context);
  return finishProbe(
    variables,
    context,
    initialGuess,
    seedSource,
    residualNormBefore,
    false,
    iterationsUsed,
    buildResidualDiagnostics(variables, finalResidual),
    iterations,
    maxAbs(finalResidual),
    !residualNormFinite(finalResidual),
    false
  );
}

function probeBroyden(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  options: { tolerance: number; maxIterations: number },
  initialGuess: Record<string, number>,
  seed: Record<string, number>,
  seedSource: BlockSeedSource,
  residualNormBefore: number
): BlockProbeResult {
  const x0 = variables.map((variable) => seed[variable] ?? NaN);
  const iterations: BlockProbeIteration[] = [];
  let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];
  let iterationsUsed = 0;

  setCurrentValues(context, variables, x0);
  const g0 = residuals(variables, equationsByName, context);
  if (!residualNormFinite(g0)) {
    return {
      converged: false,
      iterationsUsed: 0,
      variables: buildResidualDiagnostics(variables, g0),
      iterations: [],
      nonFinite: true,
      singularJacobian: false,
      residualNormBefore,
      residualNormAfter: residualNormBefore,
      initialGuess,
      seedSource
    };
  }

  const d0 = finiteDifferenceJacobian(variables, equationsByName, context, x0, g0);
  if (isJacobianNumericallySingular(d0)) {
    return {
      converged: false,
      iterationsUsed: 0,
      variables: buildResidualDiagnostics(variables, g0),
      iterations: [],
      nonFinite: false,
      singularJacobian: true,
      residualNormBefore,
      residualNormAfter: residualNormBefore,
      initialGuess,
      seedSource
    };
  }

  let currentInv: number[][];
  try {
    currentInv = invert(d0);
  } catch {
    return {
      converged: false,
      iterationsUsed: 0,
      variables: buildResidualDiagnostics(variables, g0),
      iterations: [],
      nonFinite: false,
      singularJacobian: true,
      residualNormBefore,
      residualNormAfter: residualNormBefore,
      initialGuess,
      seedSource
    };
  }

  let currentStep = multiplyMatrixVector(currentInv, negate(g0));
  let current = add(x0, currentStep);
  lastDiagnostics = buildStepDiagnostics(variables, x0, current);
  iterations.push({
    iteration: 1,
    residualNorm: residualNormBefore,
    maxRelativeChange: maxRelativeFromStepDiagnostics(lastDiagnostics)
  });

  if (valuesConverged(x0, current, options.tolerance)) {
    setCurrentValues(context, variables, current);
    const finalResidual = residuals(variables, equationsByName, context);
    return finishProbe(
      variables,
      context,
      initialGuess,
      seedSource,
      residualNormBefore,
      true,
      1,
      lastDiagnostics,
      iterations,
      maxAbs(finalResidual),
      false,
      false
    );
  }

  for (let iteration = 1; iteration < options.maxIterations; iteration += 1) {
    iterationsUsed = iteration + 1;
    setCurrentValues(context, variables, current);
    const g = residuals(variables, equationsByName, context);
    const residualNorm = maxAbs(g);
    lastDiagnostics = buildResidualDiagnostics(variables, g);

    if (!residualNormFinite(g)) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        false,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        residualNorm,
        true,
        false
      );
    }

    const u = multiplyMatrixVector(currentInv, g);
    const denominator = dot(currentStep, add(currentStep, u));

    if (Math.abs(denominator) < 1e-12) {
      const jacobian = finiteDifferenceJacobian(variables, equationsByName, context, current, g);
      if (isJacobianNumericallySingular(jacobian)) {
        return finishProbe(
          variables,
          context,
          initialGuess,
          seedSource,
          residualNormBefore,
          false,
          iterationsUsed,
          lastDiagnostics,
          iterations,
          residualNorm,
          false,
          true
        );
      }
      try {
        currentInv = invert(jacobian);
      } catch {
        return finishProbe(
          variables,
          context,
          initialGuess,
          seedSource,
          residualNormBefore,
          false,
          iterationsUsed,
          lastDiagnostics,
          iterations,
          residualNorm,
          false,
          true
        );
      }
    } else {
      const outer = outerProduct(u, currentStep);
      scaleInPlace(outer, 1 / denominator);
      currentInv = subtract(currentInv, multiplyMatrices(outer, currentInv));
    }

    const step = multiplyMatrixVector(currentInv, negate(g));
    const candidate = add(current, step);
    lastDiagnostics = buildStepDiagnostics(variables, current, candidate);
    iterations.push({
      iteration: iterationsUsed,
      residualNorm,
      maxRelativeChange: maxRelativeFromStepDiagnostics(lastDiagnostics)
    });

    if (valuesConverged(current, candidate, options.tolerance)) {
      setCurrentValues(context, variables, candidate);
      const finalResidual = residuals(variables, equationsByName, context);
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        true,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        maxAbs(finalResidual),
        false,
        false
      );
    }

    current = candidate;
    currentStep = step;
  }

  setCurrentValues(context, variables, current);
  const finalResidual = residuals(variables, equationsByName, context);
  return finishProbe(
    variables,
    context,
    initialGuess,
    seedSource,
    residualNormBefore,
    false,
    iterationsUsed || 1,
    buildResidualDiagnostics(variables, finalResidual),
    iterations,
    maxAbs(finalResidual),
    !residualNormFinite(finalResidual),
    false
  );
}

function probeGaussSeidel(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  options: { tolerance: number; maxIterations: number },
  initialGuess: Record<string, number>,
  seedSource: BlockSeedSource,
  residualNormBefore: number
): BlockProbeResult {
  const iterations: BlockProbeIteration[] = [];
  let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];
  let iterationsUsed = 0;

  setCurrentValues(
    context,
    variables,
    variables.map((variable) => initialGuess[variable] ?? NaN)
  );
  const startResidual = residuals(variables, equationsByName, context);
  if (!residualNormFinite(startResidual)) {
    return {
      converged: false,
      iterationsUsed: 0,
      variables: buildResidualDiagnostics(variables, startResidual),
      iterations: [],
      nonFinite: true,
      singularJacobian: false,
      residualNormBefore,
      residualNormAfter: residualNormBefore,
      initialGuess,
      seedSource
    };
  }

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    iterationsUsed = iteration + 1;
    let converged = true;
    const iterationDiagnostics: ConvergenceVariableDiagnostic[] = [];

    for (const variable of variables) {
      const equation = equationsByName.get(variable);
      if (!equation) {
        throw new Error(`Missing equation for variable: ${variable}`);
      }
      const previous = context.currentValue(variable);
      const next = equation.evaluate(context);
      context.setCurrentValue(variable, next);
      const relative = Math.abs(next - previous) / (Math.abs(previous) + 1e-15);
      const finite = Number.isFinite(next) && Number.isFinite(previous) && Number.isFinite(relative);
      iterationDiagnostics.push({
        name: variable,
        value: next,
        previous,
        relativeChange: relative,
        finite
      });
      if (!finite || relative >= options.tolerance) {
        converged = false;
      }
    }

    lastDiagnostics = iterationDiagnostics;
    const residual = residuals(variables, equationsByName, context);
    iterations.push({
      iteration: iterationsUsed,
      residualNorm: maxAbs(residual),
      maxRelativeChange: maxRelativeFromStepDiagnostics(iterationDiagnostics)
    });

    if (converged) {
      return finishProbe(
        variables,
        context,
        initialGuess,
        seedSource,
        residualNormBefore,
        true,
        iterationsUsed,
        lastDiagnostics,
        iterations,
        maxAbs(residual),
        false,
        false
      );
    }
  }

  const finalResidual = residuals(variables, equationsByName, context);
  return finishProbe(
    variables,
    context,
    initialGuess,
    seedSource,
    residualNormBefore,
    false,
    iterationsUsed,
    lastDiagnostics,
    iterations,
    maxAbs(finalResidual),
    !residualNormFinite(finalResidual),
    false
  );
}

function finishProbe(
  variables: string[],
  context: SolverContext,
  initialGuess: Record<string, number>,
  seedSource: BlockSeedSource,
  residualNormBefore: number,
  converged: boolean,
  iterationsUsed: number,
  variablesDiagnostics: ConvergenceVariableDiagnostic[],
  iterations: BlockProbeIteration[],
  residualNormAfter: number,
  nonFinite: boolean,
  singularJacobian: boolean
): BlockProbeResult {
  const finalValues = Object.fromEntries(
    variables.map((variable) => [variable, context.currentValue(variable)])
  );

  return {
    converged,
    iterationsUsed,
    variables: variablesDiagnostics,
    iterations,
    nonFinite,
    singularJacobian,
    residualNormBefore,
    residualNormAfter,
    initialGuess,
    finalValues,
    seedSource
  };
}

function residuals(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext
): number[] {
  return variables.map((variable) => {
    const equation = equationsByName.get(variable);
    if (!equation) {
      throw new Error(`Missing equation for variable: ${variable}`);
    }
    return equation.evaluate(context) - context.currentValue(variable);
  });
}

function finiteDifferenceJacobian(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: SolverContext,
  x: number[],
  baseResidual: number[]
): number[][] {
  const jacobian = Array.from({ length: variables.length }, () =>
    new Array<number>(variables.length).fill(0)
  );

  for (let col = 0; col < variables.length; col += 1) {
    const shifted = [...x];
    const step = 1e-7 * Math.max(1, Math.abs(shifted[col] ?? 0));
    shifted[col] = (shifted[col] ?? 0) + step;
    setCurrentValues(context, variables, shifted);
    const shiftedResidual = residuals(variables, equationsByName, context);

    for (let row = 0; row < variables.length; row += 1) {
      jacobian[row]![col] = ((shiftedResidual[row] ?? 0) - (baseResidual[row] ?? 0)) / step;
    }
  }

  setCurrentValues(context, variables, x);
  return jacobian;
}

function buildResidualDiagnostics(
  variables: string[],
  residual: number[]
): ConvergenceVariableDiagnostic[] {
  return variables.map((name, index) => {
    const residualValue = residual[index] ?? NaN;
    return {
      name,
      value: residualValue,
      residual: residualValue,
      finite: Number.isFinite(residualValue)
    };
  });
}

function buildStepDiagnostics(
  variables: string[],
  previous: number[],
  next: number[]
): ConvergenceVariableDiagnostic[] {
  return variables.map((name, index) => {
    const previousValue = previous[index] ?? NaN;
    const nextValue = next[index] ?? NaN;
    const relative =
      Math.abs(previousValue - nextValue) / (Math.abs(nextValue) + 1e-15);
    return {
      name,
      value: nextValue,
      previous: previousValue,
      relativeChange: relative,
      finite: Number.isFinite(previousValue) && Number.isFinite(nextValue) && Number.isFinite(relative)
    };
  });
}

function maxRelativeFromResidualDiagnostics(diagnostics: ConvergenceVariableDiagnostic[]): number {
  return diagnostics.reduce((max, entry) => Math.max(max, Math.abs(entry.residual ?? 0)), 0);
}

function maxRelativeFromStepDiagnostics(diagnostics: ConvergenceVariableDiagnostic[]): number {
  return diagnostics.reduce((max, entry) => Math.max(max, entry.relativeChange ?? 0), 0);
}

function valuesConverged(previous: number[], next: number[], tolerance: number): boolean {
  for (let index = 0; index < previous.length; index += 1) {
    const relative =
      Math.abs((previous[index] ?? 0) - (next[index] ?? 0)) / (Math.abs(next[index] ?? 0) + 1e-15);
    if (!Number.isFinite(relative) || relative >= tolerance) {
      return false;
    }
  }
  return true;
}

function setCurrentValues(context: SolverContext, variables: string[], values: number[]): void {
  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    if (variable) {
      context.setCurrentValue(variable, values[index] ?? NaN);
    }
  }
}

function maxAbs(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

function residualNormFinite(residual: number[]): boolean {
  return residual.every((value) => Number.isFinite(value));
}

function add(left: number[], right: number[]): number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function negate(values: number[]): number[] {
  return values.map((value) => -value);
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0)
  );
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    Array.from({ length: right[0]?.length ?? 0 }, (_, col) =>
      row.reduce((sum, value, index) => sum + value * (right[index]?.[col] ?? 0), 0)
    )
  );
}

function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  return Array.from({ length: n }, (_, col) => {
    const rhs = new Array<number>(n).fill(0);
    rhs[col] = 1;
    return solveLinearSystem(matrix, rhs);
  }).reduce((inverse, solution, col) => {
    solution.forEach((value, row) => {
      inverse[row]![col] = value;
    });
    return inverse;
  }, Array.from({ length: n }, () => new Array<number>(n).fill(0)));
}

function outerProduct(left: number[], right: number[]): number[][] {
  return left.map((l) => right.map((r) => l * r));
}

function scaleInPlace(matrix: number[][], scalar: number): void {
  for (const row of matrix) {
    for (let col = 0; col < row.length; col += 1) {
      row[col] = (row[col] ?? 0) * scalar;
    }
  }
}

function subtract(left: number[][], right: number[][]): number[][] {
  return left.map((row, rowIndex) =>
    row.map((value, colIndex) => value - (right[rowIndex]?.[colIndex] ?? 0))
  );
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}
