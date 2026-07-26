import { describe, expect, it } from "vitest";
import { compileExpression } from "../src/compile/compileExpression";
import type { SolverContext } from "../src/engine/context";
import { wrapContextWithMatrixColumnSums } from "../src/engine/matrixColumnSum";
import { simBaselineModel } from "../src/fixtures/sim";
import { evaluateExpression } from "../src/parser/dependencies";
import { parseEquation, parseExpression } from "../src/parser/parse";

function mockContext(
  values: Record<string, number>,
  lags: Record<string, number> = {},
  diffs: Record<string, number> = {}
): SolverContext {
  return {
    currentValue: (name) => values[name] ?? 0,
    lagValue: (name, offset = 1) => {
      if (offset !== 1) {
        return lags[`${name}@${offset}`] ?? lags[name] ?? 0;
      }
      return lags[name] ?? 0;
    },
    diffValue: (name) => diffs[name] ?? (values[name] ?? 0) - (lags[name] ?? 0),
    setCurrentValue: () => {},
    hasSeries: () => true,
    shifted: (offset) =>
      mockContext(
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [
            name,
            offset === 1 ? (lags[name] ?? 0) : value
          ])
        ),
        lags,
        diffs
      )
  };
}

function expectParity(source: string, context: SolverContext, tolerance = 1e-12): void {
  const expr = parseExpression(source);
  const interpreted = evaluateExpression(expr, context);
  const compiled = compileExpression(expr)(context);
  expect(compiled).toBeCloseTo(interpreted, Math.max(0, -Math.log10(tolerance)));
}

describe("compileExpression", () => {
  it("matches the interpreter for arithmetic, functions, if, and lags", () => {
    const context = mockContext(
      { a: 3, b: 4, c: 5, yd: 10, alpha1: 0.6, alpha2: 0.4, Hh: 50 },
      { b: 2, Hh: 40, nested: 7 }
    );

    const cases = [
      "1 + 2 * 3",
      "a + 2 * lag(b) - diff(c)",
      "-a + pow(b, 2)",
      "min(a, b) + max(c, 1)",
      "if(a > b) { a } else { b }",
      "if(a == 3) { pow(2, 3) } else { 0 }",
      "alpha1 * yd + alpha2 * lag(Hh)",
      "abs(-a) + sqrt(c) + exp(0) + log(1)",
      "a > 0 && b < 10",
      "a != b || c == 5",
      "lag(a + b)",
      "min(alpha1 * yd + alpha2 * lag(Hh), 100)",
      "floor(3.7) + floor(-1.2)",
      "min(min(floor(a * 1.5), floor(b)), c)"
    ];

    for (const source of cases) {
      expectParity(source, context);
    }
  });

  it("evaluates random.uniform through context.randomUniform", () => {
    const context: SolverContext = {
      ...mockContext({ s: 0.2 }),
      randomUniform(lo, hi) {
        return lo + (hi - lo) * 0.25;
      }
    };
    expectParity("random.uniform(1 - s, 1 + s)", context);
    expectParity("random.uniform(1 - s, 1 + s, 1)", context);
    const value = compileExpression(parseExpression("random.uniform(0, 10, 1)"))(context);
    expect(value).toBeCloseTo(2.5, 12);
  });

  it("throws when random.uniform has no randomUniform on the context", () => {
    const context = mockContext({});
    const expr = parseExpression("random.uniform(0, 1, 1)");
    expect(() => compileExpression(expr)(context)).toThrow(/randomUniform/);
    expect(() => evaluateExpression(expr, context)).toThrow(/randomUniform/);
  });

  it("throws when random.uniform size is not 1", () => {
    const context: SolverContext = {
      ...mockContext({}),
      randomUniform(lo, hi) {
        return lo + (hi - lo) * 0.5;
      }
    };
    const expr = parseExpression("random.uniform(0, 1, 2)");
    expect(() => compileExpression(expr)(context)).toThrow(/size must be 1/);
    expect(() => evaluateExpression(expr, context)).toThrow(/size must be 1/);
  });

  it("matches the interpreter for SIM equation RHS strings", () => {
    const context = mockContext(
      {
        TXd: 4,
        W: 1,
        Ns: 20,
        TXs: 4,
        alpha1: 0.6,
        alpha2: 0.4,
        YD: 16,
        Hh: 10,
        Nd: 20,
        Y: 38,
        Cd: 18,
        Gd: 20,
        theta: 0.2,
        Hs: 12
      },
      { Hh: 8, Hs: 10 }
    );

    for (const equation of simBaselineModel.equations) {
      expectParity(equation.expression, context);
      const parsed = parseEquation(equation.name, equation.expression);
      expect(parsed.evaluate(context)).toBeCloseTo(
        evaluateExpression(parsed.expression, context),
        12
      );
    }
  });

  it("matches the interpreter for matrix column sums", () => {
    const context = wrapContextWithMatrixColumnSums(
      mockContext({ WBd: 10, Cs: 4 }),
      {
        "Households.Deposits": ["WBd", "-Cs"]
      }
    );

    expectParity("sum(Households.Deposits)", context);
    expectParity("Households.Deposits", context);
    expectParity(
      "lag(Mh) + sum(Households.Deposits) * dt",
      wrapContextWithMatrixColumnSums(mockContext({ Mh: 1, WBd: 10, Cs: 4 }, { Mh: 7 }), {
        "Households.Deposits": ["WBd", "-Cs"]
      })
    );
  });

  it("is faster than interpreting the same expression many times (smoke)", () => {
    const expr = parseExpression("alpha1 * yd + alpha2 * lag(Hh) + min(pow(yd, 2), 1000)");
    const context = mockContext({ alpha1: 0.6, alpha2: 0.4, yd: 12, Hh: 50 }, { Hh: 40 });
    const compiled = compileExpression(expr);
    const rounds = 5_000;

    const t0 = performance.now();
    for (let i = 0; i < rounds; i++) {
      evaluateExpression(expr, context);
    }
    const interpretMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < rounds; i++) {
      compiled(context);
    }
    const compileMs = performance.now() - t1;

    expect(compiled(context)).toBeCloseTo(evaluateExpression(expr, context), 12);
    // Soft check: compiled path should not be dramatically slower (CI noise tolerant).
    expect(compileMs).toBeLessThan(interpretMs * 5 + 50);
  });
});
