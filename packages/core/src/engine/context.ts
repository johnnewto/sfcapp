import type { MatrixColumnSumBindings, MatrixColumnSumLocations } from "../parser/dependencies";

export interface SolverContext {
  currentValue(variable: string): number;
  lagValue(variable: string, offset?: number): number;
  diffValue(variable: string): number;
  setCurrentValue(variable: string, value: number): void;
  hasSeries(variable: string): boolean;
  shifted?(offset: number): SolverContext;
  evaluateMatrixColumnSum?(columnRef: string): number;
  /**
   * Uniform draw on `[lo, hi)`. Used by `random.uniform(low, high, size)` in expressions.
   * ABM contexts bind this to the Monte Carlo RNG; equation solvers omit it.
   */
  randomUniform?(lo: number, hi: number): number;
  matrixColumnSums?: MatrixColumnSumBindings;
  matrixColumnSumLocations?: MatrixColumnSumLocations;
}
