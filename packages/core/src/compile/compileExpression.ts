import type { Expr } from "../parser/ast";
import type { SolverContext } from "../engine/context";

export type CompiledExpression = (context: SolverContext) => number;

interface CompileHelpers {
  truthy(value: number | boolean): boolean;
  isMatrixFlow(name: string, context: SolverContext): boolean;
  requireShifted(context: SolverContext, offset: number): SolverContext;
  call(name: string, args: number[]): number;
}

const HELPERS: CompileHelpers = {
  truthy(value) {
    if (typeof value === "boolean") {
      return value;
    }
    return Math.abs(value) > 1e-15;
  },
  isMatrixFlow(name, context) {
    const key = name.trim();
    return key.includes(".") && context.matrixColumnSums != null && key in context.matrixColumnSums;
  },
  requireShifted(context, offset) {
    if (!context.shifted) {
      throw new Error("lag(<expression>) requires a period-aware solver context.");
    }
    return context.shifted(offset);
  },
  call(name, args) {
    switch (name) {
      case "exp":
        return Math.exp(args[0] ?? NaN);
      case "log":
        return Math.log(args[0] ?? NaN);
      case "abs":
        return Math.abs(args[0] ?? NaN);
      case "sqrt":
        return Math.sqrt(args[0] ?? NaN);
      case "floor":
        return Math.floor(args[0] ?? NaN);
      case "min":
        return Math.min(args[0] ?? NaN, args[1] ?? NaN);
      case "max":
        return Math.max(args[0] ?? NaN, args[1] ?? NaN);
      case "pow":
        return Math.pow(args[0] ?? NaN, args[1] ?? NaN);
      default:
        throw new Error(`Unsupported function: ${name}`);
    }
  }
};

/**
 * Compile an expression AST once to a JS function. Emit only allowlisted ops that
 * read through SolverContext (same semantics as evaluateExpression).
 */
export function compileExpression(expr: Expr): CompiledExpression {
  const body = emit(expr, "context");
  // Allowlisted AST → JS only; helpers are fixed runtime support, not user code.
  const factory = new Function(
    "helpers",
    `"use strict";
return function compiledExpression(context) {
  return (${body});
};`
  ) as (helpers: CompileHelpers) => CompiledExpression;

  return factory(HELPERS);
}

function emit(expr: Expr, ctx: string): string {
  switch (expr.type) {
    case "Number":
      return Number.isFinite(expr.value) ? String(expr.value) : "NaN";
    case "Variable": {
      const name = JSON.stringify(expr.name);
      if (expr.name === "dt") {
        return "1";
      }
      return `(helpers.isMatrixFlow(${name}, ${ctx})
        ? (function () {
            var evaluate = ${ctx}.evaluateMatrixColumnSum;
            if (!evaluate) {
              throw new Error("Matrix column flow is not bound: " + ${name});
            }
            return evaluate(${name});
          })()
        : ${ctx}.currentValue(${name}))`;
    }
    case "Lag": {
      if (expr.expr.type === "Variable" && expr.expr.name === "dt") {
        return "1";
      }
      if (expr.expr.type === "Variable") {
        return `${ctx}.lagValue(${JSON.stringify(expr.expr.name)}, ${expr.offset})`;
      }
      const inner = emit(expr.expr, "shiftedCtx");
      return `(function () {
        var shiftedCtx = helpers.requireShifted(${ctx}, ${expr.offset});
        return (${inner});
      })()`;
    }
    case "Diff":
      if (expr.name === "dt") {
        return "0";
      }
      return `${ctx}.diffValue(${JSON.stringify(expr.name)})`;
    case "MatrixColumnSum": {
      const columnRef = JSON.stringify(expr.columnRef);
      return `(function () {
        var evaluate = ${ctx}.evaluateMatrixColumnSum;
        if (!evaluate) {
          throw new Error("Matrix column sum is not bound: sum(" + ${columnRef} + ")");
        }
        return evaluate(${columnRef});
      })()`;
    }
    case "Integral":
      throw new Error("Integral I(...) must be used as the outermost RHS of an equation.");
    case "Unary":
      return `(-(${emit(expr.expr, ctx)}))`;
    case "If":
      return `(helpers.truthy(${emit(expr.condition, ctx)})
        ? (${emit(expr.whenTrue, ctx)})
        : (${emit(expr.whenFalse, ctx)}))`;
    case "Function": {
      if (expr.name === "runif") {
        const lo = emit(expr.args[0]!, ctx);
        const hi = emit(expr.args[1]!, ctx);
        return `(function () {
        var randomUniform = ${ctx}.randomUniform;
        if (!randomUniform) {
          throw new Error("runif(lo, hi) requires a solver context with randomUniform.");
        }
        return randomUniform(${lo}, ${hi});
      })()`;
      }
      const args = expr.args.map((arg) => emit(arg, ctx)).join(", ");
      return `helpers.call(${JSON.stringify(expr.name)}, [${args}])`;
    }
    case "Binary": {
      const left = emit(expr.left, ctx);
      const right = emit(expr.right, ctx);
      switch (expr.op) {
        case "+":
        case "-":
        case "*":
        case "/":
          return `((${left}) ${expr.op} (${right}))`;
        case ">":
        case ">=":
        case "<":
        case "<=":
          return `(helpers.truthy((${left}) ${expr.op} (${right})) ? 1 : 0)`;
        case "==":
          return `(helpers.truthy(Math.abs((${left}) - (${right})) < 1e-12) ? 1 : 0)`;
        case "!=":
          return `(helpers.truthy(Math.abs((${left}) - (${right})) >= 1e-12) ? 1 : 0)`;
        case "&&":
          return `(helpers.truthy(helpers.truthy(${left}) && helpers.truthy(${right})) ? 1 : 0)`;
        case "||":
          return `(helpers.truthy(helpers.truthy(${left}) || helpers.truthy(${right})) ? 1 : 0)`;
      }
    }
  }
}
