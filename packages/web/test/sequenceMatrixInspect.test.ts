import { describe, expect, it } from "vitest";

import type { SimulationResult } from "@sfcr/core";

import {
  resolveHydraulicsRunCellId,
  resolveInspectBundleForRunCell
} from "../src/notebook/sequenceMatrixInspect";
import { createNotebookFromTemplate } from "../src/notebook/templates";

const result: SimulationResult = {
  series: { G: new Float64Array([20, 20]) },
  blocks: [],
  model: { equations: [], externals: {}, initialValues: {} },
  options: { periods: 2, solverMethod: "NEWTON", tolerance: 1e-6, maxIterations: 40 }
};

describe("sequenceMatrixInspect", () => {
  it("fills missing descriptions from the stock-flow diagram's bound run", () => {
    const document = createNotebookFromTemplate("gl2-pc");
    const diagramCell = document.cells.find((cell) => cell.type === "diagram");
    expect(diagramCell?.type).toBe("diagram");
    if (diagramCell?.type !== "diagram") {
      return;
    }

    const sourceRunCellId = resolveHydraulicsRunCellId(diagramCell, document.cells);
    expect(sourceRunCellId).toBe("baseline-run");

    const bundle = resolveInspectBundleForRunCell(
      document.cells,
      { getResult: (cellId) => (cellId === "baseline-run" ? result : null) },
      0,
      new Map(),
      sourceRunCellId
    );

    expect(bundle.variableDescriptions.get("G")).toMatch(/Government expenditure/i);
    expect(bundle.currentValues.G).toBe(20);
  });
});
