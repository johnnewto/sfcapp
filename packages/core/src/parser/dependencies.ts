import type { SolverContext } from "../engine/context";
import { isSkippableMatrixCellSource } from "../engine/matrixCellSource";
import type { Expr } from "./ast";
import { parseExpression } from "./parse";

const DT_VARIABLE = "dt";

export interface MatrixColumnCellLocation {
  matrixTitle: string;
  rowLabel: string;
  columnLabel: string;
}

/** Parallel to each string[] in matrixColumnSums — same order, same length. */
export type MatrixColumnSumLocations = Record<string, MatrixColumnCellLocation[]>;

export type MatrixColumnSumBindings = Record<string, string[]>;

function isBareMatrixColumnFlowRef(name: string, matrixColumnSums?: MatrixColumnSumBindings): boolean {
  const key = name.trim();
  return key.includes(".") && matrixColumnSums != null && key in matrixColumnSums;
}

function matrixColumnSumSources(
  columnRef: string,
  matrixColumnSums?: MatrixColumnSumBindings
): string[] {
  return matrixColumnSums?.[columnRef.trim()] ?? [];
}

function stripLeadingPlus(source: string): string {
  return source.startsWith("+") ? source.slice(1).trimStart() : source;
}

function collectDependenciesFromMatrixCellSources(
  sources: string[],
  matrixColumnSums?: MatrixColumnSumBindings
): { current: Set<string>; lag: Set<string> } {
  const current = new Set<string>();
  const lag = new Set<string>();

  for (const source of sources) {
    const trimmed = source.trim();
    if (isSkippableMatrixCellSource(trimmed)) {
      continue;
    }

    try {
      const expression = parseExpression(stripLeadingPlus(trimmed));
      for (const name of collectCurrentDependencies(expression, matrixColumnSums)) {
        current.add(name);
      }
      for (const name of collectLagDependencies(expression, matrixColumnSums)) {
        lag.add(name);
      }
    } catch {
      // Ignore invalid matrix cell sources during dependency extraction.
    }
  }

  return { current, lag };
}

export function extractMatrixColumnSumRefs(expr: Expr, refs = new Set<string>()): string[] {
  switch (expr.type) {
    case "MatrixColumnSum":
      refs.add(expr.columnRef);
      break;
    case "Variable":
      if (expr.name.includes(".")) {
        refs.add(expr.name);
      }
      break;
    case "Unary":
      extractMatrixColumnSumRefs(expr.expr, refs);
      break;
    case "Binary":
      extractMatrixColumnSumRefs(expr.left, refs);
      extractMatrixColumnSumRefs(expr.right, refs);
      break;
    case "If":
      extractMatrixColumnSumRefs(expr.condition, refs);
      extractMatrixColumnSumRefs(expr.whenTrue, refs);
      extractMatrixColumnSumRefs(expr.whenFalse, refs);
      break;
    case "Integral":
      extractMatrixColumnSumRefs(expr.expr, refs);
      break;
    case "Function":
      for (const arg of expr.args) {
        extractMatrixColumnSumRefs(arg, refs);
      }
      break;
    default:
      break;
  }

  return [...refs];
}

export function extractMatrixColumnSumRefsFromSource(source: string): string[] {
  const trimmed = source.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return extractMatrixColumnSumRefs(parseExpression(trimmed));
  } catch {
    return [];
  }
}

export function evaluateExpression(expr: Expr, context: SolverContext): number {
  switch (expr.type) {
    case "Number":
      return expr.value;
    case "Variable":
      if (expr.name === DT_VARIABLE) {
        return 1;
      }
      if (isBareMatrixColumnFlowRef(expr.name, context.matrixColumnSums)) {
        const evaluate = context.evaluateMatrixColumnSum;
        if (!evaluate) {
          throw new Error(`Matrix column flow is not bound: ${expr.name}`);
        }
        return evaluate(expr.name);
      }
      return context.currentValue(expr.name);
    case "Lag":
      if (expr.expr.type === "Variable" && expr.expr.name === DT_VARIABLE) {
        return 1;
      }
      if (expr.expr.type === "Variable") {
        return context.lagValue(expr.expr.name, expr.offset);
      }
      if (!context.shifted) {
        throw new Error("lag(<expression>) requires a period-aware solver context.");
      }
      return evaluateExpression(expr.expr, context.shifted(expr.offset));
    case "Diff":
      if (expr.name === DT_VARIABLE) {
        return 0;
      }
      return context.diffValue(expr.name);
    case "MatrixColumnSum": {
      const evaluate = context.evaluateMatrixColumnSum;
      if (!evaluate) {
        throw new Error(`Matrix column sum is not bound: sum(${expr.columnRef})`);
      }
      return evaluate(expr.columnRef);
    }
    case "Integral":
      throw new Error("Integral I(...) must be used as the outermost RHS of an equation.");
    case "Unary":
      return -evaluateExpression(expr.expr, context);
    case "If":
      return truthy(evaluateExpression(expr.condition, context))
        ? evaluateExpression(expr.whenTrue, context)
        : evaluateExpression(expr.whenFalse, context);
    case "Function":
      if (expr.name === "runif") {
        const randomUniform = context.randomUniform;
        if (!randomUniform) {
          throw new Error("runif(lo, hi) requires a solver context with randomUniform.");
        }
        const lo = evaluateExpression(expr.args[0]!, context);
        const hi = evaluateExpression(expr.args[1]!, context);
        return randomUniform(lo, hi);
      }
      return evaluateFunction(expr.name, expr.args.map((arg) => evaluateExpression(arg, context)));
    case "Binary": {
      const leftValue = evaluateExpression(expr.left, context);
      const rightValue = evaluateExpression(expr.right, context);
      switch (expr.op) {
        case "+":
          return leftValue + rightValue;
        case "-":
          return leftValue - rightValue;
        case "*":
          return leftValue * rightValue;
        case "/":
          return leftValue / rightValue;
        case ">":
          return truthy(leftValue > rightValue) ? 1 : 0;
        case ">=":
          return truthy(leftValue >= rightValue) ? 1 : 0;
        case "<":
          return truthy(leftValue < rightValue) ? 1 : 0;
        case "<=":
          return truthy(leftValue <= rightValue) ? 1 : 0;
        case "==":
          return truthy(Math.abs(leftValue - rightValue) < 1e-12) ? 1 : 0;
        case "!=":
          return truthy(Math.abs(leftValue - rightValue) >= 1e-12) ? 1 : 0;
        case "&&":
          return truthy(truthy(leftValue) && truthy(rightValue)) ? 1 : 0;
        case "||":
          return truthy(truthy(leftValue) || truthy(rightValue)) ? 1 : 0;
      }
    }
  }
}

export function collectCurrentDependencies(
  expr: Expr,
  matrixColumnSums?: MatrixColumnSumBindings
): Set<string> {
  switch (expr.type) {
    case "Number":
      return new Set<string>();
    case "Lag":
      return new Set<string>();
    case "Variable":
      if (expr.name === DT_VARIABLE) {
        return new Set<string>();
      }
      if (isBareMatrixColumnFlowRef(expr.name, matrixColumnSums)) {
        return collectDependenciesFromMatrixCellSources(
          matrixColumnSumSources(expr.name, matrixColumnSums),
          matrixColumnSums
        ).current;
      }
      return new Set<string>([expr.name]);
    case "Diff":
      if (expr.name === DT_VARIABLE) {
        return new Set<string>();
      }
      return new Set<string>([expr.name]);
    case "MatrixColumnSum": {
      const sources = matrixColumnSums?.[expr.columnRef.trim()] ?? [];
      const collected = collectDependenciesFromMatrixCellSources(sources, matrixColumnSums);
      return collected.current;
    }
    case "Integral":
      return collectCurrentDependencies(expr.expr, matrixColumnSums);
    case "Unary":
      return collectCurrentDependencies(expr.expr, matrixColumnSums);
    case "If":
      return unionSets(
        collectCurrentDependencies(expr.condition, matrixColumnSums),
        collectCurrentDependencies(expr.whenTrue, matrixColumnSums),
        collectCurrentDependencies(expr.whenFalse, matrixColumnSums)
      );
    case "Function":
      return unionSets(...expr.args.map((arg) => collectCurrentDependencies(arg, matrixColumnSums)));
    case "Binary":
      return unionSets(
        collectCurrentDependencies(expr.left, matrixColumnSums),
        collectCurrentDependencies(expr.right, matrixColumnSums)
      );
  }
}

export function collectLagDependencies(
  expr: Expr,
  matrixColumnSums?: MatrixColumnSumBindings
): Set<string> {
  switch (expr.type) {
    case "Number":
      return new Set<string>();
    case "Variable":
      if (isBareMatrixColumnFlowRef(expr.name, matrixColumnSums)) {
        return collectDependenciesFromMatrixCellSources(
          matrixColumnSumSources(expr.name, matrixColumnSums),
          matrixColumnSums
        ).lag;
      }
      return new Set<string>();
    case "Lag":
      if (expr.expr.type === "Variable" && expr.expr.name === DT_VARIABLE) {
        return new Set<string>();
      }
      return unionSets(
        collectCurrentDependencies(expr.expr, matrixColumnSums),
        collectLagDependencies(expr.expr, matrixColumnSums)
      );
    case "Diff":
      if (expr.name === DT_VARIABLE) {
        return new Set<string>();
      }
      return new Set<string>([expr.name]);
    case "MatrixColumnSum": {
      const sources = matrixColumnSums?.[expr.columnRef.trim()] ?? [];
      return collectDependenciesFromMatrixCellSources(sources, matrixColumnSums).lag;
    }
    case "Integral":
      return collectLagDependencies(expr.expr, matrixColumnSums);
    case "Unary":
      return collectLagDependencies(expr.expr, matrixColumnSums);
    case "If":
      return unionSets(
        collectLagDependencies(expr.condition, matrixColumnSums),
        collectLagDependencies(expr.whenTrue, matrixColumnSums),
        collectLagDependencies(expr.whenFalse, matrixColumnSums)
      );
    case "Function":
      return unionSets(...expr.args.map((arg) => collectLagDependencies(arg, matrixColumnSums)));
    case "Binary":
      return unionSets(
        collectLagDependencies(expr.left, matrixColumnSums),
        collectLagDependencies(expr.right, matrixColumnSums)
      );
  }
}

function evaluateFunction(name: string, values: number[]): number {
  switch (name) {
    case "exp":
      return Math.exp(values[0] ?? NaN);
    case "log":
      return Math.log(values[0] ?? NaN);
    case "abs":
      return Math.abs(values[0] ?? NaN);
    case "sqrt":
      return Math.sqrt(values[0] ?? NaN);
    case "floor":
      return Math.floor(values[0] ?? NaN);
    case "min":
      return Math.min(values[0] ?? NaN, values[1] ?? NaN);
    case "max":
      return Math.max(values[0] ?? NaN, values[1] ?? NaN);
    case "pow":
      return Math.pow(values[0] ?? NaN, values[1] ?? NaN);
    default:
      throw new Error(`Unsupported function: ${name}`);
  }
}

function unionSets(...sets: ReadonlyArray<Set<string>>): Set<string> {
  const result = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      result.add(value);
    }
  }
  return result;
}

function truthy(value: number | boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return Math.abs(value) > 1e-15;
}
