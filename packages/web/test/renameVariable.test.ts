import { describe, expect, it } from "vitest";

import {
  countVariableReferences,
  patchEquationInNotebook,
  renameVariableInNotebook,
  replaceIdentifierInSource
} from "../src/notebook/renameVariable";
import type {
  ChartCell,
  EquationsCell,
  ExternalsCell,
  InitialValuesCell,
  MarkdownCell,
  MatrixCell,
  NotebookCell,
  RunCell,
  SolverCell,
  TableCell
} from "../src/notebook/types";

describe("renameVariable", () => {
  it("replaces whole identifiers without touching longer names", () => {
    expect(replaceIdentifierInSource("Y + YD", "Y", "Y2")).toBe("Y2 + YD");
    expect(replaceIdentifierInSource("lag(Y)", "Y", "Y2")).toBe("lag(Y2)");
  });

  it("renames equations and matrix entries for a model", () => {
    const cells: NotebookCell[] = [
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [
          { id: "eq-y", name: "Y", expression: "Cs + G" },
          { id: "eq-c", name: "C", expression: "alpha1 * Y" }
        ]
      },
      {
        id: "matrix",
        type: "matrix",
        title: "Matrix",
        sourceRunCellId: "run-a",
        columns: ["A"],
        rows: [{ label: "Flow", values: ["+Y"] }]
      },
      {
        id: "run-a",
        type: "run",
        title: "Run",
        mode: "baseline",
        periods: 10,
        resultKey: "run",
        sourceModelId: "model-a"
      }
    ] satisfies NotebookCell[];

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "Y", "Y2");
    const equations = next.find((cell): cell is EquationsCell => cell.type === "equations");
    const matrix = next.find((cell): cell is MatrixCell => cell.type === "matrix");

    expect(equations?.equations.find((row) => row.id === "eq-y")?.name).toBe("Y2");
    expect(equations?.equations.find((row) => row.id === "eq-c")?.expression).toBe("alpha1 * Y2");
    expect(matrix?.rows[0]?.values[0]).toBe("+Y2");
    expect(countVariableReferences(cells, { kind: "modelId", modelId: "model-a" }, "Y").referenceCount).toBeGreaterThan(
      0
    );
  });

  it("counts and renames variable mentions in markdown scoped to the nearest model", () => {
    const cells: NotebookCell[] = [
      {
        id: "intro",
        type: "markdown",
        title: "Intro",
        source: "Income `Y` tracks consumption `C`."
      },
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [{ id: "eq-y", name: "Y", expression: "C" }]
      },
      {
        id: "other-model",
        type: "equations",
        title: "Other",
        modelId: "model-b",
        equations: [{ id: "eq-y2", name: "Y", expression: "1" }]
      },
      {
        id: "far-markdown",
        type: "markdown",
        title: "Far",
        source: "Unrelated mention of Y."
      }
    ] satisfies NotebookCell[];

    const introCount = countVariableReferences(cells, { kind: "modelId", modelId: "model-a" }, "Y");
    expect(introCount.cellCount).toBe(2);
    expect(introCount.referenceCount).toBe(2);
    expect(introCount.affectedCells).toEqual([
      expect.objectContaining({ cellId: "intro", cellType: "markdown", referenceCount: 1 }),
      expect.objectContaining({ cellId: "equations", cellType: "equations", referenceCount: 1 })
    ]);

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "Y", "Y2");
    const intro = next.find((cell): cell is MarkdownCell => cell.id === "intro");
    const equations = next.find((cell): cell is EquationsCell => cell.id === "equations");
    const farMarkdown = next.find((cell): cell is MarkdownCell => cell.id === "far-markdown");

    expect(intro?.source).toContain("Y2");
    expect(intro?.source).not.toMatch(/`Y`/);
    expect(equations?.equations[0]?.name).toBe("Y2");
    expect(farMarkdown?.source).toBe("Unrelated mention of Y.");
  });

  it("renames lag() references across equations", () => {
    const cells: NotebookCell[] = [
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [
          { id: "eq-y", name: "Y", expression: "lag(Y) + C" },
          { id: "eq-c", name: "C", expression: "alpha * lag(Y)" }
        ]
      }
    ] satisfies NotebookCell[];

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "Y", "Y2");
    const equations = next.find((cell): cell is EquationsCell => cell.type === "equations");

    expect(equations?.equations.find((row) => row.id === "eq-y")?.expression).toBe("lag(Y2) + C");
    expect(equations?.equations.find((row) => row.id === "eq-c")?.expression).toBe("alpha * lag(Y2)");
  });

  it("keeps lag() renames when patching the edited equation draft", () => {
    const cells: NotebookCell[] = [
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [
          { id: "eq-y", name: "Y", expression: "lag(Y) + C" },
          { id: "eq-c", name: "C", expression: "alpha * lag(Y)" }
        ]
      }
    ] satisfies NotebookCell[];

    const renameDialog = {
      equationId: "eq-y",
      oldName: "Y",
      name: "Y2",
      expression: "lag(Y) + C"
    };

    let nextCells = renameVariableInNotebook(
      cells,
      { kind: "modelId", modelId: "model-a" },
      renameDialog.oldName,
      renameDialog.name
    );
    nextCells = patchEquationInNotebook(nextCells, { kind: "modelId", modelId: "model-a" }, renameDialog.equationId, {
      name: renameDialog.name,
      expression: replaceIdentifierInSource(
        renameDialog.expression,
        renameDialog.oldName,
        renameDialog.name
      )
    });

    const equations = nextCells.find((cell): cell is EquationsCell => cell.type === "equations");
    expect(equations?.equations.find((row) => row.id === "eq-y")?.expression).toBe("lag(Y2) + C");
    expect(equations?.equations.find((row) => row.id === "eq-c")?.expression).toBe("alpha * lag(Y2)");
  });

  it("renames across initial values, solver, charts, tables, and scenario shocks", () => {
    const cells: NotebookCell[] = [
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [
          { id: "eq-se", name: "s^e", expression: "beta * s + lag(s^e)" },
          { id: "eq-s", name: "s", expression: "c + g" }
        ]
      },
      {
        id: "initial-values",
        type: "initial-values",
        title: "Initial values",
        modelId: "model-a",
        initialValues: [
          { id: "iv-se", name: "s^e", valueText: "120" },
          { id: "iv-s", name: "s", valueText: "100" }
        ]
      },
      {
        id: "externals",
        type: "externals",
        title: "Externals",
        modelId: "model-a",
        externals: [{ id: "ext-beta", name: "beta", kind: "constant", valueText: "0.5" }]
      },
      {
        id: "solver",
        type: "solver",
        title: "Solver",
        modelId: "model-a",
        options: {
          solverMethod: "GAUSS_SEIDEL",
          toleranceText: "1e-15",
          maxIterations: 200,
          defaultInitialValueText: "1e-15",
          hiddenLeftVariable: "s^e",
          hiddenRightVariable: "s",
          hiddenToleranceText: "0.001",
          relativeHiddenTolerance: false,
          periods: 10
        }
      },
      {
        id: "run-a",
        type: "run",
        title: "Baseline",
        mode: "baseline",
        periods: 10,
        resultKey: "baseline",
        sourceModelId: "model-a"
      },
      {
        id: "chart",
        type: "chart",
        title: "Chart",
        sourceRunCellId: "run-a",
        variables: ["s^e", "s"],
        axisMode: "shared",
        seriesRanges: {
          "s^e": { includeZero: true }
        }
      },
      {
        id: "table",
        type: "table",
        title: "Table",
        sourceRunCellId: "run-a",
        variables: ["s^e"]
      },
      {
        id: "run-scenario",
        type: "run",
        title: "Scenario",
        mode: "scenario",
        periods: 10,
        resultKey: "scenario",
        sourceModelId: "model-a",
        baselineRunCellId: "run-a",
        scenario: {
          shocks: [
            {
              rangeInclusive: [1, 2],
              variables: {
                "s^e": { kind: "constant", value: 999 }
              }
            }
          ]
        }
      }
    ] satisfies NotebookCell[];

    expect(countVariableReferences(cells, { kind: "modelId", modelId: "model-a" }, "s^e")).toEqual({
      affectedCells: [
        { cellId: "equations", cellTitle: "Equations", cellType: "equations", referenceCount: 2 },
        { cellId: "initial-values", cellTitle: "Initial values", cellType: "initial-values", referenceCount: 1 },
        { cellId: "solver", cellTitle: "Solver", cellType: "solver", referenceCount: 1 },
        { cellId: "chart", cellTitle: "Chart", cellType: "chart", referenceCount: 2 },
        { cellId: "table", cellTitle: "Table", cellType: "table", referenceCount: 1 },
        { cellId: "run-scenario", cellTitle: "Scenario", cellType: "run", referenceCount: 1 }
      ],
      cellCount: 6,
      referenceCount: 8
    });

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "s^e", "s2^e");
    const equations = next.find((cell): cell is EquationsCell => cell.type === "equations");
    const initialValues = next.find((cell): cell is InitialValuesCell => cell.type === "initial-values");
    const solver = next.find((cell): cell is SolverCell => cell.type === "solver");
    const chart = next.find((cell): cell is ChartCell => cell.type === "chart");
    const table = next.find((cell): cell is TableCell => cell.type === "table");
    const scenarioRun = next.find((cell): cell is RunCell => cell.id === "run-scenario");

    expect(equations?.equations.find((row) => row.id === "eq-se")?.name).toBe("s2^e");
    expect(equations?.equations.find((row) => row.id === "eq-se")?.expression).toBe(
      "beta * s + lag(s2^e)"
    );
    expect(initialValues?.initialValues.find((row) => row.id === "iv-se")?.name).toBe("s2^e");
    expect(solver?.options.hiddenLeftVariable).toBe("s2^e");
    expect(chart?.variables).toEqual(["s2^e", "s"]);
    expect(chart?.seriesRanges).toEqual({ "s2^e": { includeZero: true } });
    expect(table?.variables).toEqual(["s2^e"]);
    expect(Object.keys(scenarioRun?.scenario?.shocks[0]?.variables ?? {})).toEqual(["s2^e"]);
  });

  it("renames identifiers inside chart expression series", () => {
    const cells: NotebookCell[] = [
      {
        id: "run-a",
        type: "run",
        title: "Run",
        mode: "baseline",
        periods: 10,
        resultKey: "baseline",
        sourceModelId: "model-a"
      },
      {
        id: "chart",
        type: "chart",
        title: "Chart",
        sourceRunCellId: "run-a",
        series: [
          { expression: "100 * h_h / v", label: "Money share" },
          { expression: "100 * b_h / v", label: "Bill share" }
        ],
        seriesRanges: {
          "Money share": { min: 20, max: 25 }
        }
      }
    ] satisfies NotebookCell[];

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "h_h", "cash");
    const chart = next.find((cell): cell is ChartCell => cell.type === "chart");

    expect(chart?.series).toEqual([
      { expression: "100 * cash / v", label: "Money share" },
      { expression: "100 * b_h / v", label: "Bill share" }
    ]);
    expect(chart?.seriesRanges).toEqual({ "Money share": { min: 20, max: 25 } });
  });

  it("renames derivative-balance equation targets when the underlying stock is renamed", () => {
    const cells: NotebookCell[] = [
      {
        id: "equations",
        type: "equations",
        title: "Equations",
        modelId: "model-a",
        equations: [
          { id: "eq-ls", name: "d(Ls)", expression: "d(Ld)" },
          { id: "eq-ld", name: "Ld", expression: "2" }
        ]
      }
    ] satisfies NotebookCell[];

    const next = renameVariableInNotebook(cells, { kind: "modelId", modelId: "model-a" }, "Ls", "Loans");
    const equations = next.find((cell): cell is EquationsCell => cell.type === "equations");

    expect(equations?.equations.find((row) => row.id === "eq-ls")?.name).toBe("d(Loans)");
    expect(equations?.equations.find((row) => row.id === "eq-ls")?.expression).toBe("d(Ld)");
  });

  it("counts ABM-model params, tick expressions, charts, and run overrides", () => {
    const cells: NotebookCell[] = [
      {
        id: "abm-sim-model",
        type: "abm-model",
        title: "ABM-SIM specification",
        modelId: "abm-sim",
        populations: [{ name: "households", size: 10, state: ["h"] }],
        params: { pr: 1.1, theta: 0.2 },
        ticks: [
          { do: [["Y", "pr * N", "Output"]] },
          { do: [["Nd", "AD / pr"]] }
        ],
        record: { series: ["Y"], descriptions: { Y: "Output uses pr in ticks" } },
        check: { left: "H_d", right: "H_s", tolerance: "1e-9" }
      },
      {
        id: "baseline-run",
        type: "run",
        title: "Monte Carlo baseline",
        mode: "baseline",
        engine: "abm",
        sourceModelId: "abm-sim",
        periods: 10,
        resultKey: "baseline",
        abm: { pr: 1.1, households: 10 }
      },
      {
        id: "chart-output",
        type: "chart",
        title: "Output",
        sourceRunCellId: "baseline-run",
        variables: ["Y"]
      }
    ];

    const prUsages = countVariableReferences(cells, { kind: "modelId", modelId: "abm-sim" }, "pr");
    expect(prUsages.affectedCells.map((entry) => entry.cellId).sort()).toEqual([
      "abm-sim-model",
      "baseline-run"
    ]);
    expect(prUsages.referenceCount).toBeGreaterThanOrEqual(4);

    const yUsages = countVariableReferences(cells, { kind: "modelId", modelId: "abm-sim" }, "Y");
    expect(yUsages.affectedCells.some((entry) => entry.cellId === "chart-output")).toBe(true);
    expect(yUsages.affectedCells.some((entry) => entry.cellId === "abm-sim-model")).toBe(true);

    const renamed = renameVariableInNotebook(cells, { kind: "modelId", modelId: "abm-sim" }, "pr", "prod");
    const abm = renamed.find((cell): cell is Extract<NotebookCell, { type: "abm-model" }> => cell.type === "abm-model");
    const run = renamed.find((cell): cell is RunCell => cell.type === "run");
    expect((abm?.params as Record<string, number> | undefined)?.prod).toBe(1.1);
    expect((abm?.params as Record<string, number> | undefined)?.pr).toBeUndefined();
    expect((abm?.ticks as Array<{ do?: unknown[] }>)[0]?.do?.[0]).toEqual([
      "Y",
      "prod * N",
      "Output"
    ]);
    expect(run?.abm?.prod).toBe(1.1);
    expect(run?.abm?.pr).toBeUndefined();
  });
});
