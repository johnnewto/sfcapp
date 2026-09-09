// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createNotebookFromTemplate } from "../src/notebook/templates";
import {
  buildPublicationInspectRequest,
  resolvePublicationInspectContext
} from "../src/publication/publicationInspect";

describe("publicationInspect", () => {
  it("resolves inspect context for bmw equations from the linked run", () => {
    const document = createNotebookFromTemplate("bmw");
    const equationsCell = document.cells.find((cell) => cell.id === "equations-newton");
    expect(equationsCell?.type).toBe("equations");

    if (equationsCell?.type !== "equations") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: equationsCell,
      document,
      getResult: () => null,
      selectedPeriodIndex: 0
    });

    expect(context).not.toBeNull();
    expect(context?.modelSource).toEqual({ sourceModelId: equationsCell.modelId });
    expect(context?.editor.equations.length).toBeGreaterThan(0);
  });

  it("resolves inspect context for abm-model cells", () => {
    const document = createNotebookFromTemplate("abm-sim");
    const abmCell = document.cells.find((cell) => cell.type === "abm-model");
    expect(abmCell?.type).toBe("abm-model");

    if (abmCell?.type !== "abm-model") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: abmCell,
      document,
      getResult: () => null,
      selectedPeriodIndex: 0
    });

    expect(context).not.toBeNull();
    expect(context?.modelSource).toEqual({ sourceModelId: abmCell.modelId });
    expect(context?.sourceRunCellId).toBe("baseline-run");
    expect(context?.editor.equations.some((row) => row.name === "Y")).toBe(true);
    expect(context?.variableDescriptions.get("Y")).toMatch(/Output/i);
  });

  it("resolves markdown inspect context via the nearest abm-model cell", () => {
    const document = createNotebookFromTemplate("abm-sim");
    const intro = document.cells.find((cell) => cell.id === "intro");
    expect(intro?.type).toBe("markdown");

    if (intro?.type !== "markdown") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: intro,
      document,
      getResult: () => null,
      selectedPeriodIndex: 0
    });

    expect(context).not.toBeNull();
    expect(context?.modelSource).toEqual({ sourceModelId: "abm-sim" });
    expect(context?.editor.equations.some((row) => row.name === "AD")).toBe(true);
  });

  it("resolves markdown inspect context via the nearest matrix/run model in bmw", () => {
    const document = createNotebookFromTemplate("bmw");
    const intro = document.cells.find((cell) => cell.id === "intro");
    expect(intro?.type).toBe("markdown");

    if (intro?.type !== "markdown") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: intro,
      document,
      getResult: () => null,
      selectedPeriodIndex: 0
    });

    expect(context).not.toBeNull();
    expect(context?.modelSource).toEqual({ sourceModelId: "equations-newton" });
    expect(context?.sourceRunCellId).toBe("baseline-newton");
  });

  it("builds inspect requests with trimmed variable names", () => {
    const document = createNotebookFromTemplate("bmw");
    const equationsCell = document.cells.find((cell) => cell.id === "equations-newton");
    expect(equationsCell?.type).toBe("equations");

    if (equationsCell?.type !== "equations") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: equationsCell,
      document,
      getResult: () => null,
      selectedPeriodIndex: 0
    });
    expect(context).not.toBeNull();

    if (!context) {
      return;
    }

    const request = buildPublicationInspectRequest({
      context,
      document,
      selectedVariable: " Y "
    });

    expect(request.selectedVariable).toBe("Y");
    expect(request.sourceRunCellId).toBeTruthy();
  });

  it("resolves inspect context for stock-flow diagram cells from the bound run", () => {
    const document = createNotebookFromTemplate("gl2-pc");
    const diagramCell = document.cells.find((cell) => cell.type === "diagram");
    expect(diagramCell?.type).toBe("diagram");

    if (diagramCell?.type !== "diagram") {
      return;
    }

    const context = resolvePublicationInspectContext({
      cell: diagramCell,
      document,
      getResult: (cellId) =>
        cellId === "baseline-run"
          ? {
              series: { G: new Float64Array([20, 20]) },
              blocks: [],
              model: { equations: [], externals: {}, initialValues: {} },
              options: { periods: 2, solverMethod: "NEWTON", tolerance: 1e-6, maxIterations: 40 }
            }
          : null,
      selectedPeriodIndex: 0
    });

    expect(context).not.toBeNull();
    expect(context?.sourceRunCellId).toBe("baseline-run");
    expect(context?.variableDescriptions.get("G")).toMatch(/Government expenditure/i);
    expect(context?.currentValues.G).toBe(20);
  });
});
