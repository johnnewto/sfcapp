// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HydraulicsCanvas,
  HYDRAULICS_SECTOR_WIDTH,
  HYDRAULICS_TANK_HEIGHT,
  HYDRAULICS_VIEW_HEIGHT,
  HYDRAULICS_VIEW_WIDTH,
  resolvePipeEnd
} from "../src/components/HydraulicsCanvas";
import type { ResolvedHydraulicsScene } from "../src/notebook/hydraulics";

afterEach(() => {
  cleanup();
});

const scene: ResolvedHydraulicsScene = {
  sectors: [
    { id: "Government", label: "Government", x: 0.2, y: 0.25 },
    { id: "Firms", label: "Firms", x: 0.8, y: 0.25 }
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
      maxAbs: 20,
      fill: 0.5
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
      animationSpeed: 1,
      widthScale: 1,
      dashed: false,
      tokenCount: 3,
      opacity: 1
    }
  ],
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

  it("shows the tank variable value on the tank", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
    const tank = screen.getByTestId("hydraulics-tank-Bs");
    expect(tank).toHaveTextContent("Bs");
    expect(tank).toHaveTextContent("10.0");
  });

  it("keeps the pipe stroke solid and puts the march on an overlay", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked tool="select" />);
    expect(screen.getByTestId("hydraulics-pipe-flow-G")).toHaveClass("hydraulics-pipe-flow");
    expect(screen.getByTestId("hydraulics-pipe-flow-G")).not.toHaveClass("is-animated");
    expect(screen.getByTestId("hydraulics-pipe-overlay-G")).toHaveClass("hydraulics-pipe-overlay", "is-animated");
  });

  it("does not draw a flow overlay when reduced motion is preferred", () => {
    render(<HydraulicsCanvas scene={scene} layoutLocked prefersReducedMotion tool="select" />);
    expect(screen.queryByTestId("hydraulics-pipe-overlay-G")).toBeNull();
  });
});
