// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HydraulicsCanvas,
  HYDRAULICS_LABEL_CLEARANCE_PX,
  HYDRAULICS_SECTOR_WIDTH,
  HYDRAULICS_TANK_HEIGHT,
  HYDRAULICS_VIEW_HEIGHT,
  HYDRAULICS_VIEW_WIDTH,
  buildHydraulicsSplinePath,
  placeHydraulicsNodeLabel,
  placeHydraulicsPipeLabel,
  portsForBox,
  portsForNode,
  resolvePipeEnd,
  snapHydraulicsLabelOffset,
  snapHydraulicsNodeLabelOffset
} from "../src/components/HydraulicsCanvas";
import { HYDRAULICS_GRID_COLS, HYDRAULICS_GRID_ROWS, snapHydraulicsPoint, type ResolvedHydraulicsScene } from "../src/notebook/hydraulics";

afterEach(() => {
  cleanup();
});

const scene: ResolvedHydraulicsScene = {
  sectors: [
    {
      id: "Government",
      label: "Government",
      fill: "#f8fafc",
      stroke: "#334155",
      opacity: 1,
      x: 0.2,
      y: 0.25,
      labelOffsetX: null,
      labelOffsetY: null
    },
    {
      id: "Firms",
      label: "Firms",
      fill: "#f8fafc",
      stroke: "#334155",
      opacity: 1,
      x: 0.8,
      y: 0.25,
      labelOffsetX: null,
      labelOffsetY: null
    }
  ],
  tanks: [
    {
      id: "Bs",
      sectorId: "Government",
      label: "Bs",
      polarity: "liability",
      color: "#c0392b",
      x: 0.2,
      y: 0.6,
      value: 10,
      maxLevel: null,
      runMaxAbs: 20,
      maxAbs: 20,
      fill: 0.5,
      labelOffsetX: null,
      labelOffsetY: null
    }
  ],
  pipes: [
    {
      id: "G",
      from: { kind: "sector", id: "Government" },
      to: { kind: "sector", id: "Firms" },
      label: "G",
      variable: "G",
      waypoints: [],
      magnitude: 20,
      strokeWidth: 4,
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
};

function mockSvgRect(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: HYDRAULICS_VIEW_WIDTH,
      bottom: HYDRAULICS_VIEW_HEIGHT,
      width: HYDRAULICS_VIEW_WIDTH,
      height: HYDRAULICS_VIEW_HEIGHT,
      toJSON() {
        return {};
      }
    }) as DOMRect;
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function dispatchPointer(target: EventTarget, type: string, clientX: number, clientY: number): void {
  const EventCtor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  target.dispatchEvent(
    new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY
    })
  );
}

describe("HydraulicsCanvas", () => {
  it("writes dragged sector coordinates on pointer up", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );

    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const government = screen.getByTestId("hydraulics-sector-Government");

    act(() => {
      dispatchPointer(government, "pointerdown", 200, 155);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 400, 200);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 400, 200);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const layout = onLayoutChange.mock.calls.at(-1)?.[0];
    const moved = layout.sectors.find((sector: { id: string }) => sector.id === "Government");
    expect(moved.x).toBe(16);
    expect(moved.y).toBe(8);
  });

  it("does not persist layout when a sector is clicked without moving", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );

    const restoreRect = mockSvgRect();
    const government = screen.getByTestId("hydraulics-sector-Government");

    act(() => {
      dispatchPointer(government, "pointerdown", 200, 155);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 200, 155);
    });
    restoreRect();

    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("retargets a pipe end when it snaps to a tank", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );

    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const handle = screen.getByTestId("hydraulics-pipe-end-G-to");

    act(() => {
      dispatchPointer(handle, "pointerdown", 800, 155);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 200, 372);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 200, 372);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const layout = onLayoutChange.mock.calls.at(-1)?.[0];
    const pipe = layout.pipes.find((entry: { id: string }) => entry.id === "G");
    expect(pipe.to).toEqual({ kind: "tank", id: "Bs", port: "c" });
  });

  it("stores the named tank port when a pipe end snaps to the tank rim", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );

    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const handle = screen.getByTestId("hydraulics-pipe-end-G-to");
    const topY = (0.6 - HYDRAULICS_TANK_HEIGHT / 2 / HYDRAULICS_VIEW_HEIGHT) * HYDRAULICS_VIEW_HEIGHT;

    act(() => {
      dispatchPointer(handle, "pointerdown", 800, 155);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 200, topY);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 200, topY);
    });
    restoreRect();

    const pipe = onLayoutChange.mock.calls.at(-1)?.[0].pipes.find((entry: { id: string }) => entry.id === "G");
    expect(pipe.to).toEqual({ kind: "tank", id: "Bs", port: "n" });
  });

  it("keeps a stored west port even when the other node is to the east", () => {
    const start = resolvePipeEnd(
      { kind: "sector", id: "Government", port: "w" },
      { x: 0.8, y: 0.25 },
      scene.sectors,
      scene.tanks
    );
    const auto = resolvePipeEnd(
      { kind: "sector", id: "Government" },
      { x: 0.8, y: 0.25 },
      scene.sectors,
      scene.tanks
    );

    expect(start.x).toBeCloseTo(0.2 - HYDRAULICS_SECTOR_WIDTH / 2 / HYDRAULICS_VIEW_WIDTH);
    expect(start.y).toBeCloseTo(0.25);
    expect(auto.x).toBeCloseTo(0.2 + HYDRAULICS_SECTOR_WIDTH / 2 / HYDRAULICS_VIEW_WIDTH);
  });

  it("places sector long-side extras on the snap grid", () => {
    const government = scene.sectors[0]!;
    const ports = portsForNode("sector", government);
    const names = ports.map((entry) => entry.port);

    expect(names).toEqual(expect.arrayContaining(["nne", "nnw", "sse", "ssw"]));
    expect(names).not.toContain("ene");
    for (const { point } of ports) {
      const snapped = snapHydraulicsPoint(point);
      expect(snapped.x).toBeCloseTo(point.x);
      expect(snapped.y).toBeCloseTo(point.y);
    }

    const nne = ports.find((entry) => entry.port === "nne")?.point;
    expect(nne?.x).toBeCloseTo(government.x + 2 / HYDRAULICS_GRID_COLS);
    expect(nne?.y).toBeCloseTo(government.y - 2 / HYDRAULICS_GRID_ROWS);
  });

  it("places box ports every two cells on the snap grid", () => {
    const box = {
      id: "frame",
      label: "",
      x: 0.5,
      y: 0.5,
      width: 12 / HYDRAULICS_GRID_COLS,
      height: 8 / HYDRAULICS_GRID_ROWS,
      fill: "#7dd3fc",
      fillOpacity: 0.2,
      stroke: "#64748b",
      dashed: false,
      labelOffsetX: null,
      labelOffsetY: null
    };
    const ports = portsForBox(box);
    const names = ports.map((entry) => entry.port);
    expect(names).toEqual(expect.arrayContaining(["n+2", "n+4", "e+2", "ne", "c"]));
    expect(names).not.toContain("nne");
    for (const { point } of ports) {
      const snapped = snapHydraulicsPoint(point);
      expect(snapped.x).toBeCloseTo(point.x);
      expect(snapped.y).toBeCloseTo(point.y);
    }
    const nPlus2 = ports.find((entry) => entry.port === "n+2")?.point;
    expect(nPlus2?.x).toBeCloseTo(box.x + 2 / HYDRAULICS_GRID_COLS);
    expect(nPlus2?.y).toBeCloseTo(box.y - 4 / HYDRAULICS_GRID_ROWS);
  });

  it("snaps a pipe end to a box n+2 port", () => {
    const onLayoutChange = vi.fn();
    const withBox: ResolvedHydraulicsScene = {
      ...scene,
      boxes: [
        {
          id: "frame",
          label: "",
          x: 0.5,
          y: 0.5,
          width: 12 / HYDRAULICS_GRID_COLS,
          height: 8 / HYDRAULICS_GRID_ROWS,
          fill: "#7dd3fc",
          fillOpacity: 0.2,
          stroke: "#64748b",
          dashed: false,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ]
    };
    render(
      <HydraulicsCanvas scene={withBox} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );
    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const handle = screen.getByTestId("hydraulics-pipe-end-G-to");
    const nPlus2X = (0.5 + 2 / HYDRAULICS_GRID_COLS) * HYDRAULICS_VIEW_WIDTH;
    const nPlus2Y = (0.5 - 4 / HYDRAULICS_GRID_ROWS) * HYDRAULICS_VIEW_HEIGHT;

    act(() => {
      dispatchPointer(handle, "pointerdown", 800, 155);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", nPlus2X, nPlus2Y);
    });
    act(() => {
      dispatchPointer(window, "pointerup", nPlus2X, nPlus2Y);
    });
    restoreRect();

    const pipe = onLayoutChange.mock.calls.at(-1)?.[0].pipes.find((entry: { id: string }) => entry.id === "G");
    expect(pipe.to).toEqual({ kind: "box", id: "frame", port: "n+2" });
  });

  it("places tank long-side extras on the snap grid", () => {
    const tank = { x: 8 / 40, y: 14 / 24 };
    const ports = portsForNode("tank", tank);
    const names = ports.map((entry) => entry.port);

    expect(names).toEqual(expect.arrayContaining(["ene", "ese", "wnw", "wsw"]));
    expect(names).not.toContain("nne");
    for (const { point } of ports) {
      const snapped = snapHydraulicsPoint(point);
      expect(snapped.x).toBeCloseTo(point.x);
      expect(snapped.y).toBeCloseTo(point.y);
    }
  });

  it("shows the tank variable value on the tank", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
    const tank = screen.getByTestId("hydraulics-tank-Bs");
    expect(tank).toHaveTextContent("Bs");
    expect(tank).toHaveTextContent("10.0");
  });

  it("renders Greek and super/subscript markup in diagram labels", () => {
    const labeled: ResolvedHydraulicsScene = {
      ...scene,
      sectors: [{ ...scene.sectors[0]!, label: "theta" }],
      tanks: [{ ...scene.tanks[0]!, label: "lambda10" }],
      pipes: [{ ...scene.pipes[0]!, label: "H^P" }]
    };
    render(<HydraulicsCanvas scene={labeled} layoutLocked tool="select" />);

    const pipeLabel = screen.getByTestId("hydraulics-pipe-label-G");
    expect(pipeLabel).toHaveTextContent("HP");
    expect(pipeLabel.querySelector("tspan")).toHaveAttribute("baseline-shift", "super");
    expect(pipeLabel.querySelector("tspan")).toHaveTextContent("P");

    expect(screen.getByTestId("hydraulics-tank-Bs")).toHaveTextContent("λ10");
    expect(screen.getByTestId("hydraulics-tank-Bs").querySelector("tspan")).toHaveAttribute("baseline-shift", "sub");
    expect(screen.getByTestId("hydraulics-sector-Government")).toHaveTextContent("θ");
  });

  it("renders lag() as a prime and * as a bullet on pipe labels", () => {
    const labeled: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, label: "lag(r) * lag(Bh)" }]
    };
    render(<HydraulicsCanvas scene={labeled} layoutLocked tool="select" />);

    const pipeLabel = screen.getByTestId("hydraulics-pipe-label-G");
    expect(pipeLabel).toHaveTextContent("r' • Bh'");
    expect(pipeLabel.textContent).not.toContain("lag");
    expect(pipeLabel.textContent).not.toContain("*");
    const primes = [...pipeLabel.querySelectorAll("tspan")].filter((node) => node.textContent === "'");
    expect(primes).toHaveLength(2);
    expect(primes[0]).toHaveAttribute("baseline-shift", "super");
  });

  it("renders authored sector fill, stroke, and opacity", () => {
    const colored: ResolvedHydraulicsScene = {
      ...scene,
      sectors: [{ ...scene.sectors[0]!, fill: "#dbeafe", stroke: "#1d4ed8", opacity: 0.5 }]
    };
    render(<HydraulicsCanvas scene={colored} layoutLocked tool="select" />);
    const rect = screen.getByTestId("hydraulics-sector-Government").querySelector("rect");
    expect(rect).toHaveAttribute("fill", "#dbeafe");
    expect(rect).toHaveAttribute("stroke", "#1d4ed8");
    expect(rect).toHaveAttribute("opacity", "0.5");
  });

  it("renders the flow magnitude under the pipe label", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
    const value = screen.getByTestId("hydraulics-pipe-value-G");
    const label = screen.getByTestId("hydraulics-pipe-label-G");
    expect(value).toHaveTextContent("20.0");
    expect(Number(value.getAttribute("y"))).toBeGreaterThan(Number(label.getAttribute("y")));
  });

  it("omits the pipe value when there is no variable or expression", () => {
    const unlabeled: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, variable: undefined, expression: undefined, magnitude: null }]
    };
    render(<HydraulicsCanvas scene={unlabeled} layoutLocked tool="select" />);
    expect(screen.getByTestId("hydraulics-pipe-label-G")).toBeInTheDocument();
    expect(screen.queryByTestId("hydraulics-pipe-value-G")).not.toBeInTheDocument();
  });

  it("keeps the pipe stroke solid and puts the march on an overlay", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
    expect(screen.getByTestId("hydraulics-pipe-flow-G")).toHaveClass("hydraulics-pipe-flow");
    expect(screen.getByTestId("hydraulics-pipe-flow-G")).not.toHaveClass("is-animated");
    expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("hydraulics-pipe-overlay", "is-animated");
    expect(screen.getByTestId("hydraulics-pipe-overlay-G")).not.toHaveClass("is-reversed");
  });

  it("reverses the dash overlay when flow magnitude is negative", () => {
    const negative: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, magnitude: -20 }]
    };
    render(<HydraulicsCanvas scene={negative} layoutLocked tool="select" />);
    expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass(
      "hydraulics-pipe-overlay",
      "is-animated",
      "is-reversed"
    );
  });

  it("hides the dash overlay when flow magnitude is zero", () => {
    const zeroFlow: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, magnitude: 0, flowAnimationSpeed: 0 }]
    };
    render(<HydraulicsCanvas scene={zeroFlow} layoutLocked tool="select" />);
    expect(screen.queryByTestId("hydraulics-pipe-overlay-G")).toBeNull();
  });

  it("hides the dash overlay when the pipe has no flow binding", () => {
    const unbound: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [
        {
          ...scene.pipes[0]!,
          variable: undefined,
          expression: undefined,
          magnitude: null,
          flowAnimationSpeed: 0
        }
      ]
    };
    render(<HydraulicsCanvas scene={unbound} layoutLocked tool="select" />);
    expect(screen.queryByTestId("hydraulics-pipe-overlay-G")).toBeNull();
  });

  it("does not draw a flow overlay when reduced motion is preferred", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked prefersReducedMotion tool="select" />);
    expect(screen.queryByTestId("hydraulics-pipe-overlay-G")).toBeNull();
  });

  it("places an auto label above the pipe until dragged", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" />);
    const expected = placeHydraulicsPipeLabel(scene.pipes[0]!, scene.sectors, scene.tanks);
    const label = screen.getByTestId("hydraulics-pipe-label-G");
    expect(Number(label.getAttribute("x"))).toBeCloseTo(expected.x);
    expect(Number(label.getAttribute("y"))).toBeCloseTo(expected.y);
    expect(expected.y).toBeLessThan(0.25 * HYDRAULICS_VIEW_HEIGHT);
  });

  it("moves the label along the pipe when labelT is authored", () => {
    const start = placeHydraulicsPipeLabel(
      { ...scene.pipes[0]!, labelT: 0, labelOffset: 0 },
      scene.sectors,
      scene.tanks
    );
    const end = placeHydraulicsPipeLabel(
      { ...scene.pipes[0]!, labelT: 1, labelOffset: 0 },
      scene.sectors,
      scene.tanks
    );
    expect(end.x).toBeGreaterThan(start.x);
  });

  it("snaps label offset to half grid cells", () => {
    const cellPx = HYDRAULICS_VIEW_HEIGHT / HYDRAULICS_GRID_ROWS;
    expect(snapHydraulicsLabelOffset(0)).toBe(0);
    expect(snapHydraulicsLabelOffset(cellPx)).toBe(1);
    expect(snapHydraulicsLabelOffset(cellPx * 0.5)).toBe(0.5);
    expect(snapHydraulicsLabelOffset(-cellPx * 1.4)).toBe(-1.5);
    expect(snapHydraulicsLabelOffset(1_000)).toBe(12);
    expect(snapHydraulicsLabelOffset(2)).toBe(0);
    expect(snapHydraulicsLabelOffset(HYDRAULICS_LABEL_CLEARANCE_PX)).toBe(0.5);
    const colPx = HYDRAULICS_VIEW_WIDTH / HYDRAULICS_GRID_COLS;
    expect(snapHydraulicsNodeLabelOffset(colPx * 0.5, "x")).toBe(0.5);
    expect(snapHydraulicsNodeLabelOffset(-colPx * 2.4, "x")).toBe(-2.5);
  });

  it("persists labelT and a snapped offset after the label is dragged", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );

    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const label = screen.getByTestId("hydraulics-pipe-label-G");

    act(() => {
      dispatchPointer(label, "pointerdown", 500, 120);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 720, 40);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 720, 40);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const pipe = onLayoutChange.mock.calls.at(-1)?.[0].pipes.find((entry: { id: string }) => entry.id === "G");
    expect(pipe.labelT).toEqual(expect.any(Number));
    expect(pipe.labelT).toBeGreaterThan(0.5);
    expect(pipe.labelT).toBeLessThanOrEqual(1);
    expect(Number.isInteger(pipe.labelOffset * 2)).toBe(true);
    expect(pipe.labelOffset).toBeGreaterThan(0);
  });

  it("places a sector label at the authored x/y offset", () => {
    const government = scene.sectors[0]!;
    const auto = placeHydraulicsNodeLabel("sector", government);
    const moved = placeHydraulicsNodeLabel("sector", { ...government, labelOffsetX: 2.5, labelOffsetY: -1 });
    expect(moved.x).toBeCloseTo(auto.x + 2.5 * (HYDRAULICS_VIEW_WIDTH / HYDRAULICS_GRID_COLS));
    expect(moved.y).toBeCloseTo(auto.y - HYDRAULICS_VIEW_HEIGHT / HYDRAULICS_GRID_ROWS);
  });

  it("persists a dragged sector label offset", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="select" onLayoutChange={onLayoutChange} />
    );
    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const label = screen.getByTestId("hydraulics-sector-label-Government");

    act(() => {
      dispatchPointer(label, "pointerdown", 200, 155);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 250, 90);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 250, 90);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const sector = onLayoutChange.mock.calls.at(-1)?.[0].sectors.find((entry: { id: string }) => entry.id === "Government");
    expect(sector.labelOffsetX).toBe(2);
    expect(sector.labelOffsetY).toBe(-2.5);
  });

  it("reports a pipe context menu at the pointer", () => {
    const onContextMenu = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked tool="select" onContextMenu={onContextMenu} />
    );

    fireEvent.contextMenu(screen.getByTestId("hydraulics-pipe-G"), { clientX: 120, clientY: 80 });

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: "pipe", id: "G" },
        clientX: 120,
        clientY: 80
      })
    );
  });

  it("reports a waypoint context menu", () => {
    const onContextMenu = vi.fn();
    const withWaypoint: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, waypoints: [{ x: 0.5, y: 0.15 }] }]
    };
    render(
      <HydraulicsCanvas
        scene={withWaypoint}
        layoutLocked={false}
        tool="select"
        onContextMenu={onContextMenu}
      />
    );

    fireEvent.contextMenu(screen.getByTestId("hydraulics-waypoint-G-0"), { clientX: 40, clientY: 50 });

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: "waypoint", pipeId: "G", index: 0 }
      })
    );
  });

  it("draws a cubic spline through waypoints instead of a polyline", () => {
    const withWaypoint: ResolvedHydraulicsScene = {
      ...scene,
      pipes: [{ ...scene.pipes[0]!, waypoints: [{ x: 0.5, y: 0.12 }] }]
    };
    render(<HydraulicsCanvas scene={withWaypoint} layoutLocked tool="select" />);

    const d = screen.getByTestId("hydraulics-pipe-G").getAttribute("d") ?? "";
    expect(d).toMatch(/ C /);
    expect(d).not.toMatch(/ L /);
  });

  it("builds cubic segments that pass through each spline guide", () => {
    const d = buildHydraulicsSplinePath([
      { x: 0.2, y: 0.25 },
      { x: 0.5, y: 0.1 },
      { x: 0.8, y: 0.25 }
    ]);
    const endX = 0.8 * HYDRAULICS_VIEW_WIDTH;
    const endY = 0.25 * HYDRAULICS_VIEW_HEIGHT;
    const midX = 0.5 * HYDRAULICS_VIEW_WIDTH;
    const midY = 0.1 * HYDRAULICS_VIEW_HEIGHT;

    expect(d.startsWith(`M ${0.2 * HYDRAULICS_VIEW_WIDTH} ${0.25 * HYDRAULICS_VIEW_HEIGHT}`)).toBe(true);
    expect(d).toContain(`C `);
    expect(d).toContain(`${midX} ${midY}`);
    expect(d.endsWith(`${endX} ${endY}`)).toBe(true);
    expect(d).not.toMatch(/ L /);
  });

  it("draws boxes behind pipes, sectors, and tanks", () => {
    const withBox: ResolvedHydraulicsScene = {
      ...scene,
      boxes: [
        {
          id: "frame",
          label: "Region",
          x: 0.5,
          y: 0.5,
          width: 12 / HYDRAULICS_GRID_COLS,
          height: 8 / HYDRAULICS_GRID_ROWS,
          fill: "#7dd3fc",
          fillOpacity: 0.2,
          stroke: "#64748b",
          dashed: false,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ]
    };
    render(<HydraulicsCanvas scene={withBox} layoutLocked tool="select" />);

    const box = screen.getByTestId("hydraulics-box-frame");
    const pipe = screen.getByTestId("hydraulics-pipe-G");
    const sector = screen.getByTestId("hydraulics-sector-Government");
    const tank = screen.getByTestId("hydraulics-tank-Bs");
    expect(box.compareDocumentPosition(pipe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(sector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(tank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adds a box at the clicked point", () => {
    const onLayoutChange = vi.fn();
    render(
      <HydraulicsCanvas scene={scene} layoutLocked={false} tool="add-box" onLayoutChange={onLayoutChange} />
    );
    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });

    act(() => {
      dispatchPointer(svg, "pointerdown", 500, 310);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const layout = onLayoutChange.mock.calls.at(-1)?.[0];
    expect(layout.boxes).toHaveLength(1);
    expect(layout.boxes[0]).toMatchObject({
      id: "box",
      x: 20,
      y: 12,
      width: 12,
      height: 8,
      fill: "#7dd3fc",
      fillOpacity: 0.2,
      stroke: "#64748b"
    });
  });

  it("persists a resized box from the east handle", () => {
    const onLayoutChange = vi.fn();
    const withBox: ResolvedHydraulicsScene = {
      ...scene,
      boxes: [
        {
          id: "frame",
          label: "",
          x: 0.5,
          y: 0.5,
          width: 12 / HYDRAULICS_GRID_COLS,
          height: 8 / HYDRAULICS_GRID_ROWS,
          fill: "#7dd3fc",
          fillOpacity: 0.2,
          stroke: "#64748b",
          dashed: true,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ]
    };
    render(
      <HydraulicsCanvas
        scene={withBox}
        layoutLocked={false}
        selected={{ kind: "box", id: "frame" }}
        tool="select"
        onLayoutChange={onLayoutChange}
      />
    );
    const restoreRect = mockSvgRect();
    const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
    const handle = screen.getByTestId("hydraulics-box-handle-frame-e");

    act(() => {
      dispatchPointer(handle, "pointerdown", 650, 310);
    });
    act(() => {
      dispatchPointer(svg, "pointermove", 800, 310);
    });
    act(() => {
      dispatchPointer(window, "pointerup", 800, 310);
    });
    restoreRect();

    expect(onLayoutChange).toHaveBeenCalled();
    const box = onLayoutChange.mock.calls.at(-1)?.[0].boxes.find((entry: { id: string }) => entry.id === "frame");
    expect(box.width).toBe(18);
    expect(box.x).toBe(23);
    expect(box.height).toBe(8);
    expect(box.y).toBe(12);
    expect(box.dashed).toBe(true);
  });

  describe("pipe flow animation timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps a motionless dashed overlay after ten seconds", () => {
      render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("is-animated");

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      const overlay = screen.getByTestId("hydraulics-pipe-overlay-G");
      expect(overlay).toHaveClass("hydraulics-pipe-overlay");
      expect(overlay).not.toHaveClass("is-animated");
    });

    it("restarts the overlay when interactionEpoch changes", () => {
      const { rerender } = render(
        <HydraulicsCanvas scene={scene} layoutLocked tool="select" interactionEpoch={1} />
      );

      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("is-animated");

      rerender(<HydraulicsCanvas scene={scene} layoutLocked tool="select" interactionEpoch={2} />);

      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("is-animated");

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).not.toHaveClass("is-animated");
    });

    it("restarts the overlay on pointer interaction after it has timed out", () => {
      render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).not.toHaveClass("is-animated");

      const svg = screen.getByRole("img", { name: "Hydraulics diagram" });
      act(() => {
        dispatchPointer(svg, "pointerdown", 10, 10);
      });

      expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("is-animated");
    });
  });
});
