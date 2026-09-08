import type { SimulationResult } from "@sfcr/core";
import { describe, expect, it } from "vitest";

import type { HydraulicsCell, MatrixCell } from "../src/notebook/types";
import {
  canonicalHydraulicsBoxPort,
  hydraulicsBoxPortCellDelta,
  hydraulicsBoxPorts,
  parseHydraulicsBoxPort
} from "../src/notebook/types";
import {
  createResolvedHydraulicsBox,
  DEFAULT_PIPE_FLOW_ANIMATION_SPEED,
  formatHydraulicsTankValue,
  hydraulicsGridToUnit,
  hydraulicsUnitToGrid,
  layoutFromResolved,
  mergeHydraulicsLayout,
  resizeHydraulicsBox,
  resolveHydraulicsScene,
  scaleHydraulicsPipeAnimationSpeed,
  seedHydraulicsLayout,
  HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR
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
      sectors: [
        {
          id: "Government",
          label: "Government",
          fill: "#f8fafc",
          stroke: "#334155",
          opacity: 1,
          x: 0.4,
          y: 0.25,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ],
      tanks: [],
      pipes: [],
      boxes: [],
      errors: []
    }).sectors[0]).toMatchObject({ x: 16, y: 6 });
    const autoPipe = layoutFromResolved({
      sectors: [],
      tanks: [],
      pipes: [
        {
          id: "G",
          from: { kind: "point", x: 0.2, y: 0.25 },
          to: { kind: "point", x: 0.8, y: 0.25 },
          label: "G",
          waypoints: [],
          magnitude: null,
          strokeWidth: 2,
          color: "#334155",
          arrowSize: 8,
          flowAnimationSpeed: 1,
          widthScale: 1,
          dashed: false,
          tokenCount: 3,
          opacity: 1,
          labelT: null,
          labelOffset: null
        }
      ],
      boxes: [],
      errors: []
    }).pipes[0];
    expect(autoPipe).not.toHaveProperty("labelT");
    expect(autoPipe).not.toHaveProperty("labelOffset");
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
            widthScale: 2,
            dashed: true,
            tokenCount: 0,
            opacity: 0.4,
            labelT: 0.25,
            labelOffset: 2
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
      flowAnimationSpeed: 0,
      widthScale: 2,
      dashed: true,
      tokenCount: 0,
      opacity: 0.4,
      labelT: 0.25,
      labelOffset: 2
    });
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "C")).toMatchObject({
      labelT: 0.25,
      labelOffset: 2
    });
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "C")).not.toHaveProperty(
      "animationSpeed"
    );
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
    expect(scene.tanks.find((tank) => tank.id === "Hh")?.runMaxAbs).toBeCloseTo(21.4);
    expect(scene.tanks.find((tank) => tank.id === "Hh")?.maxLevel).toBeNull();
    expect(scene.tanks.find((tank) => tank.id === "Hh")?.fill).toBeCloseTo(1);
  });

  it("applies authored sector fill, stroke, and opacity", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        sectors: [
          {
            id: "Households",
            x: 8,
            y: 5,
            fill: "#dbeafe",
            stroke: "#1d4ed8",
            opacity: 0.6
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
    expect(scene.sectors.find((entry) => entry.id === "Households")).toMatchObject({
      fill: "#dbeafe",
      stroke: "#1d4ed8",
      opacity: 0.6
    });
    expect(layoutFromResolved(scene).sectors.find((entry) => entry.id === "Households")).toMatchObject({
      fill: "#dbeafe",
      stroke: "#1d4ed8",
      opacity: 0.6
    });
  });

  it("uses authored tank maxLevel for fill instead of the run max", () => {
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
      },
      layout: {
        tanks: [{ id: "Hh", sectorId: "Households", x: 8, y: 14, maxLevel: 42.8 }]
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
    const hh = scene.tanks.find((tank) => tank.id === "Hh");
    expect(hh?.value).toBeCloseTo(21.4);
    expect(hh?.runMaxAbs).toBeCloseTo(21.4);
    expect(hh?.maxLevel).toBeCloseTo(42.8);
    expect(hh?.maxAbs).toBeCloseTo(42.8);
    expect(hh?.fill).toBeCloseTo(0.5);
    expect(layoutFromResolved(scene).tanks.find((tank) => tank.id === "Hh")).toMatchObject({
      maxLevel: 42.8
    });
  });

  it("scales pipe width and dash speed from expression magnitude", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: {
        transactionMatrixCellId: "transaction-flow",
        sourceRunCellId: "run-1"
      },
      layout: {
        sectors: [
          { id: "Households", x: 8, y: 5 },
          { id: "Firms", x: 20, y: 5 }
        ],
        pipes: [
          {
            id: "big",
            from: { kind: "sector", id: "Households" },
            to: { kind: "sector", id: "Firms" },
            label: "C",
            expression: "C"
          },
          {
            id: "small",
            from: { kind: "sector", id: "Firms" },
            to: { kind: "sector", id: "Households" },
            label: "half",
            expression: "C / 2"
          },
          {
            id: "unbound",
            from: { kind: "sector", id: "Households" },
            to: { kind: "sector", id: "Firms" },
            label: "note"
          }
        ]
      }
    };
    const result: SimulationResult = {
      series: {
        C: new Float64Array([40])
      },
      blocks: [],
      model: { equations: [], externals: {}, initialValues: {} },
      options: { periods: 1, solverMethod: "NEWTON", tolerance: 1e-6, maxIterations: 40 }
    };

    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : null),
      (cellId) => (cellId === "run-1" ? result : null),
      0
    );
    const big = scene.pipes.find((pipe) => pipe.id === "big");
    const small = scene.pipes.find((pipe) => pipe.id === "small");
    const unbound = scene.pipes.find((pipe) => pipe.id === "unbound");
    expect(big?.label).toBe("C");
    expect(big?.magnitude).toBeCloseTo(40);
    expect(small?.magnitude).toBeCloseTo(20);
    expect(big?.strokeWidth).toBeGreaterThan(small?.strokeWidth ?? 0);
    expect(big?.flowAnimationSpeed).toBeCloseTo(DEFAULT_PIPE_FLOW_ANIMATION_SPEED);
    expect(small?.flowAnimationSpeed).toBeCloseTo(
      DEFAULT_PIPE_FLOW_ANIMATION_SPEED *
        (HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR +
          (1 - HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR) * 0.5)
    );
    expect(unbound?.magnitude).toBeNull();
    expect(unbound?.flowAnimationSpeed).toBe(0);
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "big")).toMatchObject({
      label: "C",
      expression: "C"
    });
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "big")).not.toHaveProperty(
      "flowAnimationSpeed"
    );
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "big")).not.toHaveProperty(
      "animationSpeed"
    );
  });

  it("keeps dash animation still without magnitude or at zero", () => {
    expect(scaleHydraulicsPipeAnimationSpeed(null, 10)).toBe(0);
    expect(scaleHydraulicsPipeAnimationSpeed(0, 10)).toBe(0);
    expect(scaleHydraulicsPipeAnimationSpeed(0, 0)).toBe(0);
    expect(scaleHydraulicsPipeAnimationSpeed(10, 10)).toBeCloseTo(DEFAULT_PIPE_FLOW_ANIMATION_SPEED);
    expect(scaleHydraulicsPipeAnimationSpeed(5, 10)).toBeCloseTo(
      DEFAULT_PIPE_FLOW_ANIMATION_SPEED *
        (HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR +
          0.5 * (1 - HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR))
    );
  });

  it("formats tank values compactly for the canvas", () => {
    expect(formatHydraulicsTankValue(null)).toBe("—");
    expect(formatHydraulicsTankValue(0)).toBe("0");
    expect(formatHydraulicsTankValue(21.4)).toBe("21.4");
    expect(formatHydraulicsTankValue(80)).toBe("80.0");
    expect(formatHydraulicsTankValue(1250)).toBe("1.3k");
  });

  it("does not seed boxes from matrices", () => {
    const layout = seedHydraulicsLayout(pcTransactionMatrix(), pcBalanceSheet());
    expect(layout.boxes).toEqual([]);
  });

  it("round-trips authored boxes including transparent fill", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        boxes: [
          {
            id: "frame",
            label: "Households",
            x: 20,
            y: 12,
            width: 12,
            height: 8,
            fill: "#fde68a",
            fillOpacity: 0,
            stroke: "#b45309",
            dashed: true
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
    const box = scene.boxes.find((entry) => entry.id === "frame");
    expect(box).toMatchObject({
      label: "Households",
      fill: "#fde68a",
      fillOpacity: 0,
      stroke: "#b45309",
      dashed: true
    });
    expect(layoutFromResolved(scene).boxes).toEqual([
      expect.objectContaining({
        id: "frame",
        label: "Households",
        x: 20,
        y: 12,
        width: 12,
        height: 8,
        fill: "#fde68a",
        fillOpacity: 0,
        stroke: "#b45309",
        dashed: true
      })
    ]);
  });

  it("round-trips authored node label offsets", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        sectors: [{ id: "Households", x: 8, y: 5, labelOffsetX: 2.5, labelOffsetY: -1 }],
        tanks: [{ id: "Hh", sectorId: "Households", x: 8, y: 14, labelOffsetX: 0.5, labelOffsetY: 3 }],
        boxes: [{ id: "frame", x: 20, y: 12, width: 12, height: 8, labelOffsetX: -2, labelOffsetY: 4 }]
      }
    };
    const scene = resolveHydraulicsScene(
      cell,
      (cellId) => (cellId === "transaction-flow" ? transactionMatrix : null),
      () => null,
      0
    );
    expect(scene.sectors.find((entry) => entry.id === "Households")).toMatchObject({
      labelOffsetX: 2.5,
      labelOffsetY: -1
    });
    expect(scene.tanks.find((entry) => entry.id === "Hh")).toMatchObject({
      labelOffsetX: 0.5,
      labelOffsetY: 3
    });
    expect(scene.boxes.find((entry) => entry.id === "frame")).toMatchObject({
      labelOffsetX: -2,
      labelOffsetY: 4
    });
    expect(layoutFromResolved(scene).sectors.find((entry) => entry.id === "Households")).toMatchObject({
      labelOffsetX: 2.5,
      labelOffsetY: -1
    });
  });

  it("snaps authored label offsets to half cells", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        sectors: [{ id: "Households", x: 8, y: 5, labelOffsetX: 1.4, labelOffsetY: -0.6 }],
        pipes: [
          {
            id: "G",
            from: { kind: "sector", id: "Households" },
            to: { kind: "sector", id: "Firms" },
            labelOffset: 0.74
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
    expect(scene.sectors.find((entry) => entry.id === "Households")).toMatchObject({
      labelOffsetX: 1.5,
      labelOffsetY: -0.5
    });
    expect(scene.pipes.find((entry) => entry.id === "G")?.labelOffset).toBe(0.5);
  });

  it("keeps the opposite edge fixed while resizing a box", () => {
    const box = createResolvedHydraulicsBox("frame", 0.5, 0.5);
    const resized = resizeHydraulicsBox(box, "e", { x: 0.8, y: 0.5 });
    expect(resized.width).toBeCloseTo(18 / 40);
    expect(resized.x).toBeCloseTo(23 / 40);
    expect(resized.y).toBeCloseTo(box.y);
    expect(resized.height).toBeCloseTo(box.height);
  });

  it("names box rim ports every two cells from each side midpoint", () => {
    const ports = hydraulicsBoxPorts(12, 8);
    expect(ports).toEqual(
      expect.arrayContaining(["c", "n", "n+2", "n+4", "n-2", "ne", "e", "e+2", "e-2", "se"])
    );
    expect(ports).not.toContain("n+6");
    expect(ports).not.toContain("e+4");
    expect(ports).not.toContain("nne");
    expect(parseHydraulicsBoxPort("n+2")).toEqual({ kind: "edge", side: "n", offset: 2 });
    expect(hydraulicsBoxPortCellDelta("n+2", 12, 8)).toEqual({ dx: 2, dy: -4 });
    expect(canonicalHydraulicsBoxPort("n+6", 12, 8)).toBe("ne");
  });

  it("preserves authored box pipe ports", () => {
    const transactionMatrix = pcTransactionMatrix();
    const cell: HydraulicsCell = {
      id: "pc-hydraulics",
      type: "hydraulics",
      title: "PC hydraulics",
      source: { transactionMatrixCellId: "transaction-flow" },
      layout: {
        boxes: [{ id: "frame", x: 20, y: 12, width: 12, height: 8 }],
        pipes: [
          {
            id: "flow",
            from: { kind: "box", id: "frame", port: "n+2" },
            to: { kind: "sector", id: "Firms", port: "w" }
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
    const flow = scene.pipes.find((pipe) => pipe.id === "flow");
    expect(flow?.from).toEqual({ kind: "box", id: "frame", port: "n+2" });
    expect(layoutFromResolved(scene).pipes.find((pipe) => pipe.id === "flow")?.from).toEqual({
      kind: "box",
      id: "frame",
      port: "n+2"
    });
  });
});
