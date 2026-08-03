import { describe, expect, it } from "vitest";

import { normalizeAbmSpec, runAbmSpec } from "@sfcr/core";
import { abmSpecFromCell, validateNotebookDocument } from "@sfcr/notebook-core";

import { abmRunOverridesFromCell } from "../src/notebook/abmRunOverrides";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("ABM-PC notebook template", () => {
  it("loads with an abm-model cell and runs the Monte Carlo baseline", () => {
    const document = getNotebookTemplateDocument("abm-pc");
    expect(validateNotebookDocument(document)).toEqual([]);

    const abmModelCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "abm-model" }> =>
        cell.type === "abm-model" && cell.id === "abm-pc-model"
    );
    expect(abmModelCell).toBeDefined();
    expect(abmModelCell?.modelId).toBe("abm-pc");

    const normalized = normalizeAbmSpec(abmSpecFromCell(abmModelCell!));
    expect(normalized.record.series).toContain("Y");
    expect(normalized.record.series).toContain("B_h");
    expect(normalized.record.series).toContain("H_h");
    expect(normalized.record.micro).toEqual([
      {
        population: "households",
        agents: ["first", "last"],
        variables: ["v", "b", "h", "yd", "cd", "c", "y", "e"]
      }
    ]);

    const baselineRunCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
        cell.type === "run" && cell.id === "baseline-run"
    );
    expect(baselineRunCell?.engine).toBe("abm");
    expect(baselineRunCell?.sourceModelId).toBe("abm-pc");
    if (!baselineRunCell || !abmModelCell) {
      throw new Error("Expected ABM-PC abm-model and baseline run cells.");
    }

    const overrides = abmRunOverridesFromCell(
      {
        ...(baselineRunCell.abm ?? {}),
        monteCarlo: 4,
        households: 80
      },
      baselineRunCell.periods
    );
    const result = runAbmSpec(abmSpecFromCell(abmModelCell), overrides);

    expect(result.options.periods).toBe(100);
    expect(result.series.Y).toHaveLength(100);
    expect(result.series.B_h).toHaveLength(100);
    expect(result.series.H_h).toHaveLength(100);
    expect(result.series.r).toHaveLength(100);

    // Rate shock at period 60: r jumps from 0.025 to 0.035.
    // Interest uses lag(r), so period 60 still pays the pre-shock rate.
    expect(result.series.r![50]!).toBeCloseTo(0.025, 8);
    expect(result.series.r![58]!).toBeCloseTo(0.025, 8);
    expect(result.series.r![59]!).toBeCloseTo(0.035, 8);
    expect(result.series.r![70]!).toBeCloseTo(0.035, 8);

    let maxGap = 0;
    for (let t = 0; t < 100; t++) {
      maxGap = Math.max(maxGap, Math.abs(result.series.H_h![t]! - result.series.H_s![t]!));
    }
    expect(maxGap).toBeLessThan(1e-6);

    // After the rate rise, bill share of wealth should be higher than pre-shock.
    const preBillShare =
      (result.series.B_h![50]! + result.series.B_h![55]!) /
      (result.series.V![50]! + result.series.V![55]!);
    const postBillShare =
      (result.series.B_h![80]! + result.series.B_h![90]!) /
      (result.series.V![80]! + result.series.V![90]!);
    expect(postBillShare).toBeGreaterThan(preBillShare);
  });
});
