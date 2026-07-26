import { describe, expect, it } from "vitest";

import { normalizeAbmSpec, runAbmSpec } from "@sfcr/core";
import { abmSpecFromCell, validateNotebookDocument } from "@sfcr/notebook-core";

import { abmRunOverridesFromCell } from "../src/notebook/abmRunOverrides";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("ABM-SIM notebook template", () => {
  it("loads with an abm-model cell and runs the Monte Carlo baseline", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    expect(validateNotebookDocument(document)).toEqual([]);

    const abmModelCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "abm-model" }> =>
        cell.type === "abm-model" && cell.id === "abm-sim-model"
    );
    expect(abmModelCell).toBeDefined();
    expect(abmModelCell?.modelId).toBe("abm-sim");
    // Param `#` comments may harvest into record.descriptions; no series/micro allowlist.
    expect((abmModelCell?.record as { series?: unknown } | undefined)?.series).toBeUndefined();
    expect((abmModelCell?.record as { micro?: unknown } | undefined)?.micro).toBeUndefined();
    expect(JSON.stringify(abmModelCell?.ticks)).toMatch(/Output \/ income \(MC mean\)/);

    const normalized = normalizeAbmSpec(abmSpecFromCell(abmModelCell!));
    expect(normalized.record.series).toContain("AD");
    expect(normalized.record.series).toContain("Y");
    expect(normalized.record.micro).toEqual([
      {
        population: "households",
        agents: ["first", "last"],
        variables: ["h", "yd", "cd", "c", "y", "e"]
      }
    ]);

    const baselineRunCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
        cell.type === "run" && cell.id === "baseline-run"
    );

    expect(baselineRunCell).toBeDefined();
    expect(baselineRunCell?.engine).toBe("abm");
    expect(baselineRunCell?.sourceModelId).toBe("abm-sim");
    if (!baselineRunCell || !abmModelCell) {
      throw new Error("Expected ABM-SIM abm-model and baseline run cells.");
    }

    const balanceSheet = document.cells.find(
      (cell) => cell.type === "matrix" && cell.id === "balance-sheet"
    );
    expect(balanceSheet).toBeDefined();

    const bandChart = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "chart" }> =>
        cell.type === "chart" && cell.id === "chart-output"
    );
    expect(bandChart?.showMcBands).toBe(true);

    const overrides = abmRunOverridesFromCell(
      {
        ...(baselineRunCell.abm ?? {}),
        monteCarlo: 6,
        households: 200
      },
      baselineRunCell.periods
    );
    const result = runAbmSpec(abmSpecFromCell(abmModelCell), overrides);

    expect(result.options.periods).toBe(100);
    expect(result.series.Y).toHaveLength(100);
    expect(result.series.H_d).toHaveLength(100);
    expect(result.series.AD).toHaveLength(100);
    expect(result.series.TAX).toHaveLength(100);
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

    // Matrix identity at a late period: H_d ≈ H_s (MC means).
    const late = 90;
    expect(Math.abs(result.series.H_d![late]! - result.series.H_s![late]!)).toBeLessThan(1e-6);
  });
});
