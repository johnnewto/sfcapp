import type { ParsedEquation } from "../parser/parse";

import { throwConvergenceError, type ConvergenceVariableDiagnostic } from "./convergenceFailure";
import type { BlockSolver } from "./types";
import { solveLinearSystem } from "./linearSolve";
import type { SolverContext } from "../engine/context";

export const newtonSolver: BlockSolver = {
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
    const x = variables.map((variable) => context.lagValue(variable));
    let iterationsUsed = 0;
    let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];

    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
      iterationsUsed = iteration + 1;
      setCurrentValues(context, variables, x);
      const residual = residuals(variables, equationsByName, context);
      lastDiagnostics = buildResidualDiagnostics(variables, x, residual);

      if (maxAbs(residual) < options.tolerance) {
        return;
      }

      const jacobian = finiteDifferenceJacobian(variables, equationsByName, context, x, residual);
      const delta = solveLinearSystem(
        jacobian,
        residual.map((value) => -value)
      );

      let maxRelative = 0;
      for (let index = 0; index < x.length; index += 1) {
        x[index] = (x[index] ?? 0) + (delta[index] ?? 0);
        const relative = Math.abs(delta[index] ?? 0) / (Math.abs(x[index] ?? 0) + 1e-15);
        maxRelative = Math.max(maxRelative, relative);
      }

      setCurrentValues(context, variables, x);
      if (maxRelative < options.tolerance) {
        return;
      }
    }

    throwConvergenceError({
      solverMethod: "Newton-Raphson",
      period,
      block,
      options,
      iterationsUsed,
      variables: lastDiagnostics
    });
  }
};

function buildResidualDiagnostics(
  variables: string[],
  values: number[],
  residual: number[]
): ConvergenceVariableDiagnostic[] {
  return variables.map((name, index) => {
    const value = values[index] ?? NaN;
    const residualValue = residual[index] ?? NaN;
    return {
      name,
      value,
      residual: residualValue,
      finite: Number.isFinite(value) && Number.isFinite(residualValue)
    };
  });
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
