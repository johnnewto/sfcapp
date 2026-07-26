import type { Expr } from "@sfcr/core";

import type { VariableDescriptions } from "./variableDescriptions";

export function explainEquationExpression(
  equationName: string,
  expression: Expr,
  variableDescriptions: VariableDescriptions
): string {
  const left = describeVariable(equationName, variableDescriptions, { capitalize: true });
  const right = explainExpr(expression, variableDescriptions);
  return `${left} equals ${right}.`;
}

export function explainDerivativeBalanceEquation(
  stockName: string,
  rhsExpression: Expr,
  variableDescriptions: VariableDescriptions
): string {
  const left = `The change in ${describeVariable(stockName, variableDescriptions)}`;
  const right = explainExpr(rhsExpression, variableDescriptions);
  return `${left} equals ${right}.`;
}

function explainExpr(expr: Expr, variableDescriptions: VariableDescriptions): string {
  switch (expr.type) {
    case "Number":
      return formatNumber(expr.value);
    case "Variable":
      return describeVariable(expr.name, variableDescriptions);
    case "Lag":
      return `last period's ${describeVariable(expr.name, variableDescriptions)}`;
    case "Diff":
      return `the change in ${describeVariable(expr.name, variableDescriptions)}`;
    case "MatrixColumnSum":
      return `the matrix column flow ${expr.columnRef}`;
    case "Integral":
      return `the accumulated value of ${explainExpr(expr.expr, variableDescriptions)}`;
    case "Unary":
      return `negative ${wrapIfNeeded(expr.expr, variableDescriptions)}`;
    case "If":
      return `if ${explainCondition(expr.condition, variableDescriptions)}, then ${explainExpr(expr.whenTrue, variableDescriptions)}, otherwise ${explainExpr(expr.whenFalse, variableDescriptions)}`;
    case "Function":
      return explainFunction(expr.name, expr.args, variableDescriptions);
    case "Binary":
      return explainBinary(expr, variableDescriptions);
    default:
      return formatNumber(0);
  }
}

function explainBinary(
  expr: Extract<Expr, { type: "Binary" }>,
  variableDescriptions: VariableDescriptions
): string {
  if (expr.op === "*") {
    return explainMultiplication(expr.left, expr.right, variableDescriptions);
  }

  const left = wrapIfNeeded(expr.left, variableDescriptions);
  const right = wrapIfNeeded(expr.right, variableDescriptions);

  switch (expr.op) {
    case "+":
      return `${left} plus ${right}`;
    case "-":
      return `${left} minus ${right}`;
    case "/":
      return `${left} divided by ${right}`;
    case ">":
      return `${left} is greater than ${right}`;
    case ">=":
      return `${left} is greater than or equal to ${right}`;
    case "<":
      return `${left} is less than ${right}`;
    case "<=":
      return `${left} is less than or equal to ${right}`;
    case "==":
      return `${left} is equal to ${right}`;
    case "!=":
      return `${left} is not equal to ${right}`;
    case "&&":
      return `${left} and ${right}`;
    case "||":
      return `${left} or ${right}`;
  }
}

function explainMultiplication(
  left: Expr,
  right: Expr,
  variableDescriptions: VariableDescriptions
): string {
  if (isLaggedRate(left) && isLaggedStock(right)) {
    return `interest on last period's ${describeVariable(right.name, variableDescriptions)}, computed as last period's ${describeVariable(left.name, variableDescriptions)} multiplied by last period's ${describeVariable(right.name, variableDescriptions)}`;
  }
  if (isLaggedRate(right) && isLaggedStock(left)) {
    return `interest on last period's ${describeVariable(left.name, variableDescriptions)}, computed as last period's ${describeVariable(right.name, variableDescriptions)} multiplied by last period's ${describeVariable(left.name, variableDescriptions)}`;
  }

  return `${wrapIfNeeded(left, variableDescriptions)} multiplied by ${wrapIfNeeded(right, variableDescriptions)}`;
}

function explainFunction(
  name: string,
  args: Expr[],
  variableDescriptions: VariableDescriptions
): string {
  const explainedArgs = args.map((arg) => wrapIfNeeded(arg, variableDescriptions));

  switch (name) {
    case "min":
      return `the minimum of ${explainedArgs.join(" and ")}`;
    case "max":
      return `the maximum of ${explainedArgs.join(" and ")}`;
    case "abs":
      return `the absolute value of ${explainedArgs[0] ?? "the expression"}`;
    case "floor":
      return `the floor of ${explainedArgs[0] ?? "the expression"}`;
    case "sqrt":
      return `the square root of ${explainedArgs[0] ?? "the expression"}`;
    case "pow":
      return `${explainedArgs[0] ?? "the expression"} raised to the power of ${
        explainedArgs[1] ?? "the exponent"
      }`;
    case "log":
      return `the logarithm of ${explainedArgs[0] ?? "the expression"}`;
    case "exp":
      return `the exponential of ${explainedArgs[0] ?? "the expression"}`;
    case "random.uniform":
      return `a uniform random draw between ${explainedArgs[0] ?? "low"} and ${explainedArgs[1] ?? "high"}`;
    default:
      return `${name} of ${explainedArgs.join(", ")}`;
  }
}

function explainCondition(expr: Expr, variableDescriptions: VariableDescriptions): string {
  return explainExpr(expr, variableDescriptions);
}

function wrapIfNeeded(expr: Expr, variableDescriptions: VariableDescriptions): string {
  if (expr.type === "Binary" || expr.type === "If") {
    return `(${explainExpr(expr, variableDescriptions)})`;
  }
  return explainExpr(expr, variableDescriptions);
}

function describeVariable(
  name: string,
  variableDescriptions: VariableDescriptions,
  options?: { capitalize?: boolean }
): string {
  const description = variableDescriptions.get(name.trim())?.trim();
  const value = description && description.length > 0 ? description : name.trim();
  return options?.capitalize ? capitalize(value) : value;
}

function isLaggedRate(expr: Expr): expr is Extract<Expr, { type: "Lag" }> {
  return expr.type === "Lag" && /^[Rr]/.test(expr.name);
}

function isLaggedStock(expr: Expr): expr is Extract<Expr, { type: "Lag" }> {
  return expr.type === "Lag" && /^[A-Z]/.test(expr.name);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
