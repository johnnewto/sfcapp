import { describe, expect, it } from "vitest";

import { runBaseline, runScenario } from "@sfcr/core";

import { buildRuntimeConfig } from "../src/lib/editorModel";
import { buildEditorStateForNotebookModel } from "../src/notebook/modelSections";
import { getNotebookTemplateDocument } from "../src/notebook/templates";
import { createScenarioBaselineSnapshot } from "../src/notebook/useNotebookRunner";

const PAPER_SCENARIO_RUN_IDS = [
  "scenario-1-run",
  "scenario-2-run",
  "scenario-3-run",
  "scenario-4-run",
  "scenario-5-run",
  "scenario-6-run",
  "scenario-7-run",
  "scenario-8-run",
  "scenario-9-run"
] as const;

describe("DEFINE 1.1 paper scenarios", () => {
  it("solves every deterministic paper experiment from 2021", () => {
    const document = getNotebookTemplateDocument("define");
    const baselineRunCell = document.cells.find(
      (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
        cell.type === "run" && cell.id === "baseline-run"
    );
    expect(baselineRunCell).toBeDefined();
    if (!baselineRunCell) {
      throw new Error("missing baseline-run");
    }

    const baselineEditor = buildEditorStateForNotebookModel(document, baselineRunCell);
    if (!baselineEditor) {
      throw new Error("missing baseline editor");
    }
    const baselineRuntime = buildRuntimeConfig(baselineEditor);
    const baseline = runBaseline(baselineRuntime.model, baselineRuntime.options);
    const baselineTemp = baseline.series.TEMP.at(-1) ?? Infinity;

    for (const id of PAPER_SCENARIO_RUN_IDS) {
      const cell = document.cells.find(
        (candidate): candidate is Extract<(typeof document.cells)[number], { type: "run" }> =>
          candidate.type === "run" && candidate.id === id
      );
      expect(cell, id).toBeDefined();
      if (!cell) {
        throw new Error(`missing ${id}`);
      }
      const editor = buildEditorStateForNotebookModel(document, cell);
      if (!editor) {
        throw new Error(`missing editor ${id}`);
      }
      const runtime = buildRuntimeConfig(editor);
      const options = cell.periods == null ? runtime.options : { ...runtime.options, periods: cell.periods };
      const result = runScenario(
        createScenarioBaselineSnapshot(baseline, cell.baselineStartPeriod),
        cell.scenario ?? { shocks: [] },
        options
      );
      expect(result.options.periods, id).toBe(80);
      expect(Number.isFinite(result.series.Y.at(-1) ?? NaN), `${id} Y`).toBe(true);
      expect(Number.isFinite(result.series.TEMP.at(-1) ?? NaN), `${id} TEMP`).toBe(true);
      expect(result.series.TEMP.at(-1) ?? Infinity, `${id} cooler or comparable`).toBeLessThanOrEqual(
        baselineTemp + 0.05
      );
    }
  });
});
