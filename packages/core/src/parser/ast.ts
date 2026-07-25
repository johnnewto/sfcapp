export type Expr =
  | NumberExpr
  | VariableExpr
  | LagExpr
  | DiffExpr
  | IntegralExpr
  | MatrixColumnSumExpr
  | UnaryExpr
  | BinaryExpr
  | IfExpr
  | FunctionExpr;

export interface NumberExpr {
  type: "Number";
  value: number;
}

export interface VariableExpr {
  type: "Variable";
  name: string;
}

export interface LagExpr {
  type: "Lag";
  /** Bare variable name for lag(variable) compatibility with display/unit visitors. */
  name: string;
  expr: Expr;
  offset: number;
}

export interface DiffExpr {
  type: "Diff";
  name: string;
}

export interface IntegralExpr {
  type: "Integral";
  expr: Expr;
}

export interface MatrixColumnSumExpr {
  type: "MatrixColumnSum";
  columnRef: string;
}

export interface UnaryExpr {
  type: "Unary";
  op: "-";
  expr: Expr;
}

export interface BinaryExpr {
  type: "Binary";
  op: "+" | "-" | "*" | "/" | ">" | ">=" | "<" | "<=" | "==" | "!=" | "&&" | "||";
  left: Expr;
  right: Expr;
}

export interface IfExpr {
  type: "If";
  condition: Expr;
  whenTrue: Expr;
  whenFalse: Expr;
}

export interface FunctionExpr {
  type: "Function";
  name: "exp" | "log" | "abs" | "sqrt" | "floor" | "min" | "max" | "pow" | "runif";
  args: Expr[];
}
