// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { SimulationResult } from "@sfcr/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PublicationHydraulics } from "../src/publication/components/PublicationHydraulics";
import type { HydraulicsCell, NotebookCell, RunCell } from "../src/notebook/types";

afterEach(() => {
  cleanup();
});

const runCell: RunCell = {
  id: "run-1",
  mode: "baseline",
  periods: 2,
  resultKey: "baseline",
  sourceModelId: "model",
  title: "Baseline",
  type: "run"
};

const hydraulicsCell: HydraulicsCell = {
  id: "pc-hydraulics",
  type: "diagram",
  title: "PC hydraulics",
  source: {
    transactionMatrixCellId: "missing",
    sourceRunCellId: "run-1"
  },
  layout: {
    sectors: [
      { id: "Government", label: "Government", x: 6, y: 5 },
      { id: "Firms", label: "Firms", x: 20, y: 5 }
    ],
    pipes: [
      {
        id: "G",
        from: { kind: "sector", id: "Government" },
        to: { kind: "sector", id: "Firms" },
        label: "G",
        variable: "G"
      }
    ]
  }
};

const result: SimulationResult = {
  series: {
    G: new Float64Array([10, 20])
  },
  blocks: [],
  model: { equations: [], externals: {}, initialValues: {} },
  options: { periods: 2, solverMethod: "NEWTON", tolerance: 1e-6, maxIterations: 40 }
};

describe("PublicationHydraulics", () => {
  it("animates bound pipe flow overlays in publish view", () => {
    render(
      <PublicationHydraulics
        cell={hydraulicsCell}
        cells={[runCell, hydraulicsCell] as NotebookCell[]}
        getResult={(cellId) => (cellId === "run-1" ? result : null)}
        selectedPeriodIndex={1}
      />
    );

    const overlay = screen.getByTestId("hydraulics-pipe-overlay-G");
    expect(overlay).toHaveClass("hydraulics-pipe-overlay", "is-animated");
    expect(overlay).not.toHaveClass("is-reversed");
  });

  it("reverses the publish overlay when flow is negative", () => {
    const negative: SimulationResult = {
      ...result,
      series: { G: new Float64Array([-5, -12]) }
    };
    render(
      <PublicationHydraulics
        cell={hydraulicsCell}
        cells={[runCell, hydraulicsCell] as NotebookCell[]}
        getResult={(cellId) => (cellId === "run-1" ? negative : null)}
        selectedPeriodIndex={1}
      />
    );

    expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("is-animated", "is-reversed");
  });
});
