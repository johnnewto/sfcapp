import type { BlockSolver } from "./types";
import { throwConvergenceError, type ConvergenceVariableDiagnostic } from "./convergenceFailure";

export const gaussSeidelSolver: BlockSolver = {
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

    let lastDiagnostics: ConvergenceVariableDiagnostic[] = [];

    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
      let converged = true;
      const iterationDiagnostics: ConvergenceVariableDiagnostic[] = [];

      for (const variable of block.equationNames) {
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

      if (converged) {
        return;
      }
    }

    throwConvergenceError({
      solverMethod: "Gauss-Seidel",
      period,
      block,
      options,
      iterationsUsed: options.maxIterations,
      variables: lastDiagnostics
    });
  }
};
