import { describe, expect, it } from "vitest";

import type { SimulationResult } from "@sfcr/core";

import { buildMcBandsForChart } from "../src/notebook/chartSeries";

function stubResult(series: Record<string, number[]>): SimulationResult {
  return {
    series: Object.fromEntries(
      Object.entries(series).map(([name, values]) => [name, Float64Array.from(values)])
    ),
    blocks: [],
    model: { equations: [{ name: "_", expression: "0" }], externals: {}, initialValues: {} },
    options: {
      periods: 3,
      solverMethod: "GAUSS_SEIDEL",
      tolerance: 1,
      maxIterations: 1
    }
  };
}

describe("buildMcBandsForChart", () => {
  it("resolves p10/p90 companions when showMcBands is enabled", () => {
    const bands = buildMcBandsForChart(
      { showMcBands: true, variables: ["Y"] },
      stubResult({
        Y: [10, 11, 12],
        Y_p10: [9, 10, 11],
        Y_p90: [11, 12, 13]
      }),
      [{ name: "Y", highlightKey: "Y" }]
    );

    expect(bands).toHaveLength(1);
    expect(bands[0]?.kind).toBe("percentile");
    expect(bands[0]?.lo).toEqual([9, 10, 11]);
    expect(bands[0]?.hi).toEqual([11, 12, 13]);
  });

  it("falls back to min/max companions", () => {
    const bands = buildMcBandsForChart(
      { showMcBands: true, variables: ["Y"] },
      stubResult({
        Y: [10, 11, 12],
        Y_min: [8, 9, 10],
        Y_max: [12, 13, 14]
      }),
      [{ name: "Y", highlightKey: "Y" }]
    );

    expect(bands[0]?.kind).toBe("minmax");
  });

  it("is a no-op when showMcBands is false", () => {
    expect(
      buildMcBandsForChart(
        { showMcBands: false, variables: ["Y"] },
        stubResult({ Y: [1, 2, 3], Y_p10: [0, 1, 2], Y_p90: [2, 3, 4] }),
        [{ name: "Y", highlightKey: "Y" }]
      )
    ).toEqual([]);
  });
});
