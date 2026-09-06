// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { diagnoseBuildRuntime } from "../src/lib/editorModel";
import { EquationsCellView } from "../src/notebook/components/ModelEquationViews";
import type { EquationsCell, SolverCell } from "../src/notebook/types";

vi.mock("../src/lib/editorModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/editorModel")>();
  return {
    ...actual,
    diagnoseBuildRuntime: vi.fn((editor: Parameters<typeof actual.diagnoseBuildRuntime>[0]) =>
      actual.diagnoseBuildRuntime(editor)
    )
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const equationsCell: EquationsCell = {
  id: "equations",
  type: "equations",
  title: "Equations",
  modelId: "m1",
  equations: [{ id: "eq-y", name: "Y", expression: "G", desc: "" }]
};

const solverCell: SolverCell = {
  id: "solver",
  type: "solver",
  title: "Solver",
  modelId: "m1",
  options: {
    periods: 8,
    solverMethod: "GAUSS_SEIDEL",
    toleranceText: "1e-8",
    maxIterations: 50,
    defaultInitialValueText: "0",
    hiddenLeftVariable: "",
    hiddenRightVariable: "",
    hiddenToleranceText: "0.00001",
    relativeHiddenTolerance: false
  }
};

const externals = [{ id: "ext-g", name: "G", kind: "constant" as const, valueText: "20" }];

describe("EquationsCellView diagnostics memo", () => {
  it("does not re-run diagnoseBuildRuntime when only currentValues change", () => {
    const diagnose = vi.mocked(diagnoseBuildRuntime);
    const viewProps = {
      cell: equationsCell,
      cells: [equationsCell, solverCell],
      equationAi: null,
      externals,
      initialValuesCount: 0,
      onChange: () => undefined,
      onReplaceCells: () => undefined,
      onToggleCollapsed: () => undefined,
      onVariableInspectRequest: () => undefined,
      selectedPeriodIndex: 0,
      solverCell,
      title: "Equations"
    };

    const { rerender } = render(
      <EquationsCellView {...viewProps} currentValues={{ Y: 1, G: 20 }} />
    );
    const callsAfterFirstRender = diagnose.mock.calls.length;
    expect(callsAfterFirstRender).toBeGreaterThan(0);

    rerender(<EquationsCellView {...viewProps} currentValues={{ Y: 99, G: 20 }} />);
    expect(diagnose.mock.calls.length).toBe(callsAfterFirstRender);
  });
});
