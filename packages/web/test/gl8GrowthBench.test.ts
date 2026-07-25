import { describe, expect, it } from "vitest";

import { buildOrderedBlocks, parseEquation, runBaseline, runScenario } from "@sfcr/core";

import { buildRuntimeConfig } from "../src/lib/editorModel";
import { buildEditorStateForNotebookModel, resolveRunCellModelKey } from "../src/notebook/modelSections";
import { getNotebookTemplateDocument } from "../src/notebook/templates";
import {
  createScenarioBaselineSnapshot,
  resolveModelIdFromRunCellKey,
  resolveRunCellOptions
} from "../src/notebook/useNotebookRunner";
import type { RunCell } from "../src/notebook/types";

/**
 * One-shot microbench for GL8 GROWTH equation solve time (no charts / worker).
 *
 * Run explicitly:
 *   pnpm --filter @sfcr/web bench:gl8-growth
 *
 * Excluded from default `test` / `test:fast` suites.
 */
describe("gl8-growth core microbench", () => {
  it("times baseline and all scenario solves", () => {
    const document = getNotebookTemplateDocument("gl8-growth");
    const runCells = document.cells.filter((cell): cell is RunCell => cell.type === "run");
    expect(runCells.length).toBeGreaterThan(0);

    const baselineCell = runCells.find((cell) => cell.mode === "baseline");
    expect(baselineCell).toBeDefined();
    if (!baselineCell) {
      throw new Error("Missing baseline run cell");
    }

    const editor = buildEditorStateForNotebookModel(document, baselineCell);
    expect(editor).not.toBeNull();
    if (!editor) {
      throw new Error("Missing editor for baseline");
    }

    const modelKey = resolveRunCellModelKey(document.cells, baselineCell);
    const runtime = buildRuntimeConfig(editor, {
      notebookCells: document.cells,
      modelId: resolveModelIdFromRunCellKey(modelKey) ?? undefined,
      runCellId: baselineCell.id
    });
    const baselineOptions = resolveRunCellOptions(runtime.options, baselineCell);

    const parsed = runtime.model.equations.map((equation) =>
      parseEquation(equation.name, equation.expression, {
        matrixColumnSums: runtime.model.matrixColumnSums
      })
    );
    const ordered = buildOrderedBlocks(parsed);
    const cyclicSizes = ordered.blocks
      .filter((block) => block.cyclic)
      .map((block) => block.equationNames.length);

    // Warmup so first-run JIT / parse cost does not dominate the timed baseline.
    runBaseline(runtime.model, { ...baselineOptions, periods: Math.min(5, baselineOptions.periods) });

    const baselineStarted = performance.now();
    const baseline = runBaseline(runtime.model, baselineOptions);
    const baselineMs = performance.now() - baselineStarted;

    const scenarioRows: Array<{ id: string; periods: number; ms: number }> = [];
    let scenariosMs = 0;

    for (const cell of runCells) {
      if (cell.mode !== "scenario") {
        continue;
      }
      const runOptions = resolveRunCellOptions(runtime.options, cell);
      const snapshot = createScenarioBaselineSnapshot(
        baseline,
        cell.baselineStartPeriod,
        runtime.model
      );
      const started = performance.now();
      runScenario(snapshot, cell.scenario ?? { shocks: [] }, runOptions);
      const ms = performance.now() - started;
      scenariosMs += ms;
      scenarioRows.push({ id: cell.id, periods: runOptions.periods, ms });
    }

    const totalMs = baselineMs + scenariosMs;
    const lines = [
      "GL8 GROWTH core microbench (runBaseline/runScenario only)",
      `  equations=${runtime.model.equations.length} blocks=${ordered.blocks.length} cyclicSizes=[${cyclicSizes.join(",")}]`,
      `  solver=${baselineOptions.solverMethod} tol=${baselineOptions.tolerance} maxIter=${baselineOptions.maxIterations}`,
      `  baseline ${baselineCell.id} periods=${baselineOptions.periods}: ${baselineMs.toFixed(1)} ms`,
      ...scenarioRows.map(
        (row) => `  scenario ${row.id} periods=${row.periods}: ${row.ms.toFixed(1)} ms`
      ),
      `  ALL scenarios: ${scenariosMs.toFixed(1)} ms`,
      `  TOTAL solver: ${totalMs.toFixed(1)} ms`,
      `  baseline share: ${((100 * baselineMs) / totalMs).toFixed(1)}%`,
      `  scenarios share: ${((100 * scenariosMs) / totalMs).toFixed(1)}%`
    ];
    console.log(`\n${lines.join("\n")}\n`);

    expect(Number.isFinite(baseline.series.Y?.[baselineOptions.periods - 1] ?? NaN)).toBe(true);
    expect(totalMs).toBeGreaterThan(0);
  }, 120_000);
});
