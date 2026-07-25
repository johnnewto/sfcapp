import type { ParsedEquation } from "../parser/parse";

import { throwConvergenceError, type ConvergenceVariableDiagnostic } from "./convergenceFailure";
import type { BlockSolver } from "./types";
import { solveLinearSystem } from "./linearSolve";

export const broydenSolver: BlockSolver = {
  solveBlock(period, block, equationsByName, context, options) {
    if (!block.cyclic) {
      const variable = block.equationNames[0];
      if (!variable) {
        throw new Error(`Empty block encountered at period ${period}`);
      }
      const equation = equationsByName.get(variable);
      if (!equation) {
        throw new Error(`Missing equation for variable: ${variable}`);
      }
      context.setCurrentValue(variable, equation.evaluate(context));
      return;
    }

    const variables = block.equationNames;
    const x0 = variables.map((variable) => context.lagValue(variable));
    let iterationsUsed = 0;
    let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];

    setCurrentValues(context, variables, x0);
    const g0 = residuals(variables, equationsByName, context);
    const d0 = finiteDifferenceJacobian(variables, equationsByName, context, x0, g0);
    let currentInv = invert(d0);
    let currentStep = multiplyMatrixVector(currentInv, negate(g0));
    let current = add(x0, currentStep);
    lastDiagnostics = buildStepDiagnostics(variables, x0, current);

    if (converged(x0, current, options.tolerance)) {
      setCurrentValues(context, variables, current);
      return;
    }

    for (let iteration = 1; iteration < options.maxIterations; iteration += 1) {
      iterationsUsed = iteration + 1;
      setCurrentValues(context, variables, current);
      const g = residuals(variables, equationsByName, context);
      const u = multiplyMatrixVector(currentInv, g);
      const denominator = dot(currentStep, add(currentStep, u));

      if (Math.abs(denominator) < 1e-12) {
        const jacobian = finiteDifferenceJacobian(variables, equationsByName, context, current, g);
        currentInv = invert(jacobian);
      } else {
        const outer = outerProduct(u, currentStep);
        scaleInPlace(outer, 1 / denominator);
        currentInv = subtract(currentInv, multiplyMatrices(outer, currentInv));
      }

      const step = multiplyMatrixVector(currentInv, negate(g));
      const candidate = add(current, step);
      lastDiagnostics = buildStepDiagnostics(variables, current, candidate);

      if (converged(current, candidate, options.tolerance)) {
        setCurrentValues(context, variables, candidate);
        return;
      }

      current = candidate;
      currentStep = step;
    }

    throwConvergenceError({
      solverMethod: "Broyden",
      period,
      block,
      options,
      iterationsUsed: iterationsUsed || 1,
      variables: lastDiagnostics
    });
  }
};

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

function residuals(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: import("../engine/context").SolverContext
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
  context: import("../engine/context").SolverContext,
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

function converged(previous: number[], next: number[], tolerance: number): boolean {
  for (let index = 0; index < previous.length; index += 1) {
    const relative =
      Math.abs((previous[index] ?? 0) - (next[index] ?? 0)) / (Math.abs(next[index] ?? 0) + 1e-15);
    if (!Number.isFinite(relative) || relative >= tolerance) {
      return false;
    }
  }
  return true;
}

function setCurrentValues(
  context: import("../engine/context").SolverContext,
  variables: string[],
  values: number[]
): void {
  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    if (variable) {
      context.setCurrentValue(variable, values[index] ?? NaN);
    }
  }
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
