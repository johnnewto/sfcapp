import { wrapContextWithMatrixColumnSums } from "../engine/matrixColumnSum";
import type { SolverContext } from "../engine/context";
import type { MatrixColumnSumLocations } from "../parser/dependencies";
import { parseEquation, type ParsedEquation } from "../parser/parse";
import type { SimulationResult } from "../result/result";
import { solveLinearSystem } from "../solver/linearSolve";

export interface TransitionMatrixAnalysis {
  period: number;
  variables: string[];
  residual: number[];
  residualNorm: number;
  A0: number[][];
  A1: number[][];
  T: number[][];
}

export interface PeriodValueOverride {
  current?: number;
  lag?: number;
}

export interface TransitionMatrixOptions {
  valueOverrides?: Record<string, PeriodValueOverride>;
}

interface PeriodValues {
  current: number;
  lag: number;
}

class TransitionAnalysisContext implements SolverContext {
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

export function computeTransitionMatrix(
  result: SimulationResult,
  period: number,
  options?: TransitionMatrixOptions
): TransitionMatrixAnalysis {
  validatePeriod(result, period);

  const matrixColumnSums = result.model.matrixColumnSums ?? {};
  const matrixColumnSumLocations = result.model.matrixColumnSumLocations;
  const parsed = result.model.equations.map((equation) =>
    parseEquation(equation.name, equation.expression, { matrixColumnSums })
  );
  const equationsByName = new Map(parsed.map((equation) => [equation.name, equation]));
  const variables = parsed.map((equation) => equation.name);

  const values = buildPeriodValues(result, period, options?.valueOverrides);
  const rawContext = new TransitionAnalysisContext(values);
  const context = wrapContextWithMatrixColumnSums(
    rawContext,
    matrixColumnSums,
    matrixColumnSumLocations
  );

  const residual = computeResidualVector(variables, equationsByName, context);
  const { A0, A1 } = computeLocalJacobians(
    variables,
    equationsByName,
    rawContext,
    matrixColumnSums,
    matrixColumnSumLocations
  );
  const T = computeTransitionMatrixFromJacobians(A0, A1);

  return {
    period,
    variables,
    residual,
    residualNorm: maxAbs(residual),
    A0,
    A1,
    T
  };
}

function validatePeriod(result: SimulationResult, period: number): void {
  if (!Number.isInteger(period)) {
    throw new Error(`Transition matrix period must be an integer, received ${period}`);
  }

  if (period <= 0) {
    throw new Error(`Transition matrix period must be greater than 0, received ${period}`);
  }

  if (period >= result.options.periods) {
    throw new Error(
      `Transition matrix period must be less than ${result.options.periods}, received ${period}`
    );
  }
}

function buildPeriodValues(
  result: SimulationResult,
  period: number,
  valueOverrides?: Record<string, PeriodValueOverride>
): Map<string, PeriodValues> {
  const values = new Map<string, PeriodValues>();

  for (const [name, series] of Object.entries(result.series)) {
    if (period >= series.length || period - 1 >= series.length) {
      throw new Error(`Missing series values for variable ${name} at period ${period}`);
    }

    const entry: PeriodValues = {
      current: series[period] ?? NaN,
      lag: series[period - 1] ?? NaN
    };
    const override = valueOverrides?.[name];
    if (override?.current !== undefined) {
      entry.current = override.current;
    }
    if (override?.lag !== undefined) {
      entry.lag = override.lag;
    }

    values.set(name, entry);
  }

  return values;
}

function computeResidualVector(
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

function computeLocalJacobians(
  variables: string[],
  equationsByName: Map<string, ParsedEquation>,
  context: TransitionAnalysisContext,
  matrixColumnSums: Record<string, string[]>,
  matrixColumnSumLocations?: MatrixColumnSumLocations
): { A0: number[][]; A1: number[][] } {
  const wrappedContext = wrapContextWithMatrixColumnSums(
    context,
    matrixColumnSums,
    matrixColumnSumLocations
  );
  const baseResidual = computeResidualVector(variables, equationsByName, wrappedContext);

  const A0 = Array.from({ length: variables.length }, () =>
    new Array<number>(variables.length).fill(0)
  );
  const A1 = Array.from({ length: variables.length }, () =>
    new Array<number>(variables.length).fill(0)
  );

  for (let col = 0; col < variables.length; col += 1) {
    const variable = variables[col];
    if (!variable) {
      continue;
    }

    const baseCurrent = context.currentValue(variable);
    const step = finiteDifferenceStep(baseCurrent);
    context.setCurrentValue(variable, baseCurrent + step);
    const shiftedCurrentResidual = computeResidualVector(
      variables,
      equationsByName,
      wrappedContext
    );
    context.setCurrentValue(variable, baseCurrent);

    for (let row = 0; row < variables.length; row += 1) {
      A0[row]![col] = ((shiftedCurrentResidual[row] ?? 0) - (baseResidual[row] ?? 0)) / step;
    }
  }

  for (let col = 0; col < variables.length; col += 1) {
    const variable = variables[col];
    if (!variable) {
      continue;
    }

    const baseLag = context.lagValue(variable);
    const step = finiteDifferenceStep(baseLag);
    context.setLagValue(variable, baseLag + step);
    const shiftedLagResidual = computeResidualVector(variables, equationsByName, wrappedContext);
    context.setLagValue(variable, baseLag);

    for (let row = 0; row < variables.length; row += 1) {
      A1[row]![col] = ((shiftedLagResidual[row] ?? 0) - (baseResidual[row] ?? 0)) / step;
    }
  }

  return { A0, A1 };
}

function computeTransitionMatrixFromJacobians(A0: number[][], A1: number[][]): number[][] {
  const n = A0.length;
  const T = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let col = 0; col < n; col += 1) {
    const rhs = A1.map((row) => -(row[col] ?? 0));
    const solution = solveLinearSystem(A0, rhs);
    for (let row = 0; row < n; row += 1) {
      T[row]![col] = solution[row] ?? 0;
    }
  }

  return T;
}

function finiteDifferenceStep(value: number): number {
  return 1e-7 * Math.max(1, Math.abs(value));
}

function maxAbs(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}
