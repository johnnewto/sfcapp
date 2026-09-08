import type { SimulationResult } from "@sfcr/core";
import { describe, expect, it } from "vitest";

import type { HydraulicsCell, MatrixCell } from "../src/notebook/types";
import {
  formatHydraulicsTankValue,
  hydraulicsGridToUnit,
  hydraulicsUnitToGrid,
  layoutFromResolved,
  mergeHydraulicsLayout,
  resolveHydraulicsScene,
  seedHydraulicsLayout
} from "../src/notebook/hydraulics";

function pcTransactionMatrix(): MatrixCell {
  return {
    id: "transaction-flow",
    type: "matrix",
    title: "PC TFM",
    accountingKind: "transaction-flow",
    columns: ["Households", "Firms", "Government", "CB current", "CB capital", "Sum"],
    sectors: ["Households", "Firms", "Government", "Central bank", "Central bank", ""],
    rows: [
      { label: "Consumption", values: ["-C", "+C", "", "", "", "0"] },
      { label: "Govt. expenditures", values: ["", "+G", "-G", "", "", "0"] },
      { label: "Income", values: ["+Y", "-Y", "", "", "", "0"] },
      { label: "Interest", values: ["+lag(r) * lag(Bh)", "", "-lag(r) * lag(Bs)", "+lag(r) * lag(Bcb)", "", "0"] },
      { label: "CB profits", values: ["", "", "+lag(r) * lag(Bcb)", "-lag(r) * lag(Bcb)", "", "0"] },
      { label: "Taxes", values: ["-TX", "", "+TX", "", "", "0"] },
      { label: "Change money", values: ["-(Hh - lag(Hh))", "", "", "", "+(Hs - lag(Hs))", "0"] },
      { label: "Change bills", values: ["-(Bh - lag(Bh))", "", "+(Bs - lag(Bs))", "", "-(Bcb - lag(Bcb))", "0"] },
      { label: "Sum", values: ["0", "0", "0", "0", "0", "0"] }
    ]
  };
}

function pcBalanceSheet(): MatrixCell {
  return {
    id: "balance-sheet",
    type: "matrix",
    title: "PC BS",
    accountingKind: "balance-sheet",
    columns: ["Households", "Firms", "Government", "Central bank", "Sum"],
    sectors: ["Households", "Firms", "Government", "Central bank", ""],
    rows: [
      { label: "Money", values: ["+Hh", "", "", "-Hs", "0"] },
      { label: "Bills", values: ["+Bh", "", "-Bs", "+Bcb", "0"] },
      { label: "Balance", values: ["-V", "", "+V", "", "0"] },
      { label: "Sum", values: ["0", "0", "0", "0", "0"] }
    ]
  };
}

describe("hydraulics scene", () => {
  it("seeds three PC sectors, Hh/Bh/Bs tanks with polarity, and C/G/Y/TX pipes", () => {
    const layout = seedHydraulicsLayout(pcTransactionMatrix(), pcBalanceSheet());
    expect(layout.sectors?.map((sector) => sector.id)).toEqual(["Households", "Firms", "Government"]);

    const tanks = new Map((layout.tanks ?? []).map((tank) => [tank.id, tank]));
    expect([...tanks.keys()].sort()).toEqual(["Bh", "Bs", "Hh"]);
    expect(tanks.get("Hh")?.polarity).toBe("asset");
    expect(tanks.get("Bh")?.polarity).toBe("asset");
    expect(tanks.get("Bs")?.polarity).toBe("liability");
    expect(tanks.get("Hh")?.sectorId).toBe("Households");
    expect(tanks.get("Bs")?.sectorId).toBe("Government");

    const pipeKeys = (layout.pipes ?? []).map((pipe) => pipe.variable ?? pipe.expression ?? pipe.id);
    expect(pipeKeys).toEqual(expect.arrayContaining(["C", "G", "Y", "TX"]));
    expect(pipeKeys.some((key) => key.includes("lag(Bh)"))).toBe(true);
    expect(pipeKeys.some((key) => /Hh|Hs|Bcb/.test(key))).toBe(false);
  });

  it("seeds sector and tank positions on the integer grid", () => {
    const layout = seedHydraulicsLayout(pcTransactionMatrix(), pcBalanceSheet());
    for (const sector of layout.sectors ?? []) {
      expect(Number.isInteger(sector.x)).toBe(true);
      expect(Number.isInteger(sector.y)).toBe(true);
    }
    for (const tank of layout.tanks ?? []) {
      expect(Number.isInteger(tank.x)).toBe(true);
      expect(Number.isInteger(tank.y)).toBe(true);
    }
  });

  it("reads integer grid cells and legacy 0–1 fractions", () => {
    expect(hydraulicsGridToUnit(16, "x")).toBeCloseTo(0.4);
    expect(hydraulicsGridToUnit(0.16, "x")).toBeCloseTo(0.16);
    expect(hydraulicsUnitToGrid(0.4, "x")).toBe(16);
    expect(layoutFromResolved({
      sectors: [{ id: "Government", label: "Government", x: 0.4, y: 0.25 }],
      tanks: [],
      pipes: [],
      errors: []
    }).sectors[0]).toMatchObject({ x: 16, y: 6 });
  });

  it("lets explicit coordinates win while still seeding missing nodes", () => {
    const seeded = seedHydraulicsLayout(pcTransactionMatrix(), pcBalanceSheet());
    const merged = mergeHydraulicsLayout(seeded, {
      sectors: [{ id: "Government", x: 0.11, y: 0.09 }],
      tanks: [{ id: "Hh", sectorId: "Households", x: 0.91, y: 0.77 }]
    });

    const government = merged.sectors?.find((sector) => sector.id === "Government");
    const households = merged.sectors?.find((sector) => sector.id === "Households");
    const hh = merged.tanks?.find((tank) => tank.id === "Hh");
    const bs = merged.tanks?.find((tank) => tank.id === "Bs");

    expect(government).toMatchObject({ x: 0.11, y: 0.09 });
    expect(households?.x).toBeCloseTo(seeded.sectors?.find((sector) => sector.id === "Households")?.x ?? -1);
    expect(hh).toMatchObject({ x: 0.91, y: 0.77 });
    expect(bs).toBeDefined();
    expect(merged.pipes?.length).toBeGreaterThan(0);
  });

  it("resolves an empty-layout cell from the referenced matrices", () => {
    const transactionMatrix = pcTransactionMatrix();
    const balanceMatrix = pcBalanceSheet();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: {
        transactionMatrixCellId: "transaction-flow",
        balanceMatrixCellId: "balance-sheet"
      }
    };

    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : cellId === "balance-sheet" ? balanceMatrix : null),
      () => null,
      0
    );

    expect(scene.errors).toEqual([]);
    expect(scene.sectors).toHaveLength(3);
    expect(scene.tanks.map((tank) => tank.id).sort()).toEqual(["Bh", "Bs", "Hh"]);
    expect(scene.tanks.find((tank) => tank.id === "Bs")?.polarity).toBe("liability");
  });

  it("applies authored pipe style including arrowSize 0", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        pipes: [
          {
            id: "C",
            from: { kind: "sector", id: "Households" },
            to: { kind: "sector", id: "Firms" },
            variable: "C",
            color: "#e67e22",
            arrowSize: 0,
            animationSpeed: 0,
            widthScale: 2,
            dashed: true,
            tokenCount: 0,
            opacity: 0.4
          }
        ]
      }
    };

    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : null),
      () => null,
      0
    );
    const consumption = scene.pipes.find((pipe) => pipe.id === "C");
    expect(consumption).toMatchObject({
      color: "#e67e22",
      arrowSize: 0,
      animationSpeed: 0,
      widthScale: 2,
      dashed: true,
      tokenCount: 0,
      opacity: 0.4
    });
  });

  it("preserves authored pipe ports", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        pipes: [
          {
            id: "C",
            from: { kind: "sector", id: "Households", port: "w" },
            to: { kind: "sector", id: "Firms", port: "e" },
            variable: "C"
          }
        ]
      }
    };

    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : null),
      () => null,
      0
    );
    const consumption = scene.pipes.find((pipe) => pipe.id === "C");
    expect(consumption?.from).toEqual({ kind: "sector", id: "Households", port: "w" });
    expect(consumption?.to).toEqual({ kind: "sector", id: "Firms", port: "e" });
  });

  it("binds tank values from the selected period", () => {
    const transactionMatrix = pcTransactionMatrix();
    const balanceMatrix = pcBalanceSheet();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: {
        transactionMatrixCellId: "transaction-flow",
        balanceMatrixCellId: "balance-sheet",
        sourceRunCellId: "run-1"
      }
    };
    const result: SimulationResult = {
      series: {
        Hh: new Float64Array([0, 21.4]),
        Bh: new Float64Array([0, 64.865]),
        Bs: new Float64Array([0, 80])
      },
      blocks: [],
      model: { equations: [], externals: {}, initialValues: {} },
      options: { periods: 2, solverMethod: "NEWTON", tolerance: 1e-6, maxIterations: 40 }
    };

    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : cellId === "balance-sheet" ? balanceMatrix : null),
      (cellId) => (cellId === "run-1" ? result : null),
      1
    );

    expect(scene.tanks.find((tank) => tank.id === "Hh")?.value).toBeCloseTo(21.4);
    expect(scene.tanks.find((tank) => tank.id === "Bs")?.value).toBeCloseTo(80);
  });

  it("formats tank values compactly for the canvas", () => {
    expect(formatHydraulicsTankValue(null)).toBe("—");
    expect(formatHydraulicsTankValue(0)).toBe("0");
    expect(formatHydraulicsTankValue(21.4)).toBe("21.4");
    expect(formatHydraulicsTankValue(80)).toBe("80.0");
    expect(formatHydraulicsTankValue(1250)).toBe("1.3k");
  });
});
