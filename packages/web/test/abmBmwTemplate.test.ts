import { describe, expect, it } from "vitest";

import { normalizeAbmSpec, runAbmSpec } from "@sfcr/core";
import { abmSpecFromCell, validateNotebookDocument } from "@sfcr/notebook-core";

import { abmRunOverridesFromCell } from "../src/notebook/abmRunOverrides";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("ABM-BMW notebook template", () => {
  it("loads with an abm-model cell and runs the Monte Carlo baseline", () => {
    const document = getNotebookTemplateDocument("abm-bmw");
    expect(validateNotebookDocument(document)).toEqual([]);

    const abmModelCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "abm-model" }> =>
        cell.type === "abm-model" && cell.id === "abm-bmw-model"
    );
    expect(abmModelCell).toBeDefined();
    expect(abmModelCell?.modelId).toBe("abm-bmw");

    const normalized = normalizeAbmSpec(abmSpecFromCell(abmModelCell!));
    expect(normalized.record.series).toContain("Y");
    expect(normalized.record.series).toContain("K");
    expect(normalized.record.series).toContain("M_h");
    expect(normalized.record.micro).toEqual([
      {
        population: "households",
        agents: ["first", "last"],
        variables: ["m", "yd", "cd", "c", "wage", "e"]
      }
    ]);

    const baselineRunCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
        cell.type === "run" && cell.id === "baseline-run"
    );
    expect(baselineRunCell?.engine).toBe("abm");
    expect(baselineRunCell?.sourceModelId).toBe("abm-bmw");
    if (!baselineRunCell || !abmModelCell) {
      throw new Error("Expected ABM-BMW abm-model and baseline run cells.");
    }

    const overrides = abmRunOverridesFromCell(
      {
        ...(baselineRunCell.abm ?? {}),
        monteCarlo: 4,
        households: 100
      },
      baselineRunCell.periods
    );
    const result = runAbmSpec(abmSpecFromCell(abmModelCell), overrides);

    expect(result.options.periods).toBe(150);
    expect(result.series.Y).toHaveLength(150);
    expect(result.series.K).toHaveLength(150);
    expect(result.series.M_h).toHaveLength(150);
    expect(result.series.I).toHaveLength(150);

    let maxGap = 0;
    for (let t = 0; t < 150; t++) {
      maxGap = Math.max(maxGap, Math.abs(result.series.M_h![t]! - result.series.M_s![t]!));
    }
    expect(maxGap).toBeLessThan(1e-6);

    // Late-sample output should be in a plausible BMW range (frictionless ~200).
    const late =
      (result.series.Y![120]! +
        result.series.Y![130]! +
        result.series.Y![140]! +
        result.series.Y![149]!) /
      4;
    expect(late).toBeGreaterThan(50);
    expect(late).toBeLessThan(250);

    // Loans track deposits and capital in this closure.
    const t = 140;
    expect(Math.abs(result.series.M_h![t]! - result.series.L![t]!)).toBeLessThan(1e-6);
    expect(Math.abs(result.series.K![t]! - result.series.L![t]!)).toBeLessThan(1e-6);
  });
});
