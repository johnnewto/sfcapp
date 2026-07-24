import { describe, expect, it } from "vitest";

import { runAbmSim } from "@sfcr/core";

import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("ABM-SIM notebook template", () => {
  it("loads and runs the Monte Carlo baseline", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const baselineRunCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
        cell.type === "run" && cell.id === "baseline-run"
    );

    expect(baselineRunCell).toBeDefined();
    expect(baselineRunCell?.engine).toBe("abm");
    expect(baselineRunCell?.abmModel).toBe("abm-sim");
    if (!baselineRunCell) {
      throw new Error("Expected ABM-SIM baseline run cell.");
    }

    const bandChart = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "chart" }> =>
        cell.type === "chart" && cell.id === "chart-output"
    );
    expect(bandChart?.showMcBands).toBe(true);

    const result = runAbmSim({
      ...(baselineRunCell.abm ?? {}),
      periods: baselineRunCell.periods,
      // Keep the smoke test fast while still exercising MC averaging.
      // Keep household count high enough that labour supply does not bind Y.
      monteCarlo: 6,
      households: 200
    });

    expect(result.options.periods).toBe(100);
    expect(result.series.Y).toHaveLength(100);
    expect(result.series.H_d).toHaveLength(100);
    expect(result.series.Y_p10).toHaveLength(100);
    expect(result.series.Y_p90).toHaveLength(100);

    const pre =
      (result.series.Y![40]! + result.series.Y![45]! + result.series.Y![50]! + result.series.Y![55]!) / 4;
    const post =
      (result.series.Y![80]! + result.series.Y![85]! + result.series.Y![90]! + result.series.Y![95]!) / 4;
    expect(post).toBeGreaterThan(pre + 1);

    let maxGap = 0;
    for (let t = 0; t < 100; t++) {
      maxGap = Math.max(maxGap, Math.abs(result.series.H_d![t]! - result.series.H_s![t]!));
    }
    expect(maxGap).toBeLessThan(1e-6);
  });
});
