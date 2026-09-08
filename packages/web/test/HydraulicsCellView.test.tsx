// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HydraulicsCell, NotebookCell } from "../src/notebook/types";
import { HydraulicsCellView } from "../src/notebook/components/HydraulicsCellView";

afterEach(() => {
  cleanup();
});

function dispatchPointer(target: EventTarget, type: string): void {
  const EventCtor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  target.dispatchEvent(
    new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      button: 0
    })
  );
}

const hydraulicsCell: HydraulicsCell = {
  id: "pc-hydraulics",
  type: "hydraulics",
  title: "PC hydraulics",
  source: { transactionMatrixCellId: "missing" },
  layout: {
    sectors: [
      { id: "Government", label: "Government", x: 6, y: 5 },
      { id: "Firms", label: "Firms", x: 20, y: 4 }
    ],
    pipes: [
      {
        id: "G",
        from: { kind: "sector", id: "Government" },
        to: { kind: "sector", id: "Firms" },
        variable: "G",
        waypoints: [{ x: 20, y: 8 }]
      }
    ]
  }
};

function renderHydraulics(onCellChange = vi.fn(), cell: HydraulicsCell = hydraulicsCell) {
  render(
    <HydraulicsCellView
      cell={cell}
      cells={[] as NotebookCell[]}
      maxPeriodIndex={0}
      onCellChange={onCellChange}
      runner={{ getResult: () => null }}
      selectedPeriodIndex={0}
    />
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /lock layout/i }));
  return onCellChange;
}

const authoredLabelCell: HydraulicsCell = {
  ...hydraulicsCell,
  layout: {
    ...hydraulicsCell.layout,
    pipes: [
      {
        ...hydraulicsCell.layout!.pipes![0]!,
        labelT: 0.25,
        labelOffset: 3
      }
    ]
  }
};

describe("HydraulicsCellView context menu", () => {
  it("deletes only the waypoint from the right-click menu", () => {
    const onCellChange = renderHydraulics();

    fireEvent.contextMenu(screen.getByTestId("hydraulics-waypoint-G-0"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete waypoint" }));

    expect(onCellChange).toHaveBeenCalled();
    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    const pipe = next.layout?.pipes?.find((entry) => entry.id === "G");
    expect(pipe).toBeDefined();
    expect(pipe?.waypoints ?? []).toEqual([]);
  });

  it("deletes the pipe from a waypoint menu", () => {
    const onCellChange = renderHydraulics();

    fireEvent.contextMenu(screen.getByTestId("hydraulics-waypoint-G-0"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete pipe" }));

    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    expect(next.layout?.pipes?.some((entry) => entry.id === "G")).toBe(false);
  });

  it("offers reverse and duplicate on a pipe menu", () => {
    renderHydraulics();

    fireEvent.contextMenu(screen.getByTestId("hydraulics-pipe-G"));

    expect(screen.getByRole("menuitem", { name: "Add waypoint" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reverse direction" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset label position" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("clears an authored label from the pipe context menu", () => {
    const onCellChange = renderHydraulics(vi.fn(), authoredLabelCell);

    fireEvent.contextMenu(screen.getByTestId("hydraulics-pipe-G"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset label position" }));

    const next = onCellChange.mock.calls.at(-1)?.[1](authoredLabelCell) as HydraulicsCell;
    const pipe = next.layout?.pipes?.find((entry) => entry.id === "G");
    expect(pipe).not.toHaveProperty("labelT");
    expect(pipe).not.toHaveProperty("labelOffset");
  });

  it("flips labelT when the pipe is reversed", () => {
    const onCellChange = renderHydraulics(vi.fn(), authoredLabelCell);

    fireEvent.contextMenu(screen.getByTestId("hydraulics-pipe-G"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reverse direction" }));

    const next = onCellChange.mock.calls.at(-1)?.[1](authoredLabelCell) as HydraulicsCell;
    const pipe = next.layout?.pipes?.find((entry) => entry.id === "G");
    expect(pipe?.labelT).toBeCloseTo(0.75);
    expect(pipe?.labelOffset).toBe(3);
  });

  it("authors labelT from the along-pipe inspector slider", () => {
    const onCellChange = renderHydraulics();

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-pipe-G"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Label position along pipe"), { target: { value: "25" } });

    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    const pipe = next.layout?.pipes?.find((entry) => entry.id === "G");
    expect(pipe?.labelT).toBeCloseTo(0.25);
    expect(pipe?.labelOffset).toBe(0);
  });

  it("authors labelOffset from the inspector slider", () => {
    const onCellChange = renderHydraulics(vi.fn(), authoredLabelCell);

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-pipe-G"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Label offset from pipe"), { target: { value: "-2.5" } });

    const next = onCellChange.mock.calls.at(-1)?.[1](authoredLabelCell) as HydraulicsCell;
    const pipe = next.layout?.pipes?.find((entry) => entry.id === "G");
    expect(pipe?.labelT).toBeCloseTo(0.25);
    expect(pipe?.labelOffset).toBe(-2.5);
  });

  it("adds a box from the canvas context menu", () => {
    const onCellChange = renderHydraulics();

    fireEvent.contextMenu(screen.getByRole("img", { name: "Hydraulics diagram" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add box" }));

    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    expect(next.layout?.boxes).toHaveLength(1);
    expect(next.layout?.boxes?.[0]).toMatchObject({
      id: "box",
      width: 12,
      height: 8,
      fill: "#7dd3fc",
      fillOpacity: 0.2
    });
  });

  it("authors a dashed border from the box inspector", () => {
    const cell: HydraulicsCell = {
      ...hydraulicsCell,
      layout: {
        ...hydraulicsCell.layout,
        boxes: [
          {
            id: "frame",
            x: 20,
            y: 12,
            width: 12,
            height: 8,
            fill: "#7dd3fc",
            fillOpacity: 0.2,
            stroke: "#64748b"
          }
        ]
      }
    };
    const onCellChange = renderHydraulics(vi.fn(), cell);

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-box-frame"), "pointerdown");
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /dashed border/i }));

    const next = onCellChange.mock.calls.at(-1)?.[1](cell) as HydraulicsCell;
    expect(next.layout?.boxes?.find((entry) => entry.id === "frame")?.dashed).toBe(true);
  });

  it("lists n+2 among box pipe ports in the inspector", () => {
    const cell: HydraulicsCell = {
      ...hydraulicsCell,
      layout: {
        ...hydraulicsCell.layout,
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
    renderHydraulics(vi.fn(), cell);

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-pipe-flow"), "pointerdown");
    });

    expect(screen.getByRole("combobox", { name: /from port/i })).toHaveDisplayValue("North +2 (n+2)");
    expect(screen.getByRole("option", { name: "North +4 (n+4)" })).toBeInTheDocument();
  });

  it("authors sector fill and border from the inspector", () => {
    const onCellChange = renderHydraulics();

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-sector-Government"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Sector fill color"), { target: { value: "#dbeafe" } });
    fireEvent.change(screen.getByLabelText("Sector border color"), { target: { value: "#1d4ed8" } });

    const fillPatch = onCellChange.mock.calls.at(-2)?.[1](hydraulicsCell) as HydraulicsCell;
    const borderPatch = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    expect(fillPatch.layout?.sectors?.find((entry) => entry.id === "Government")?.fill).toBe("#dbeafe");
    expect(borderPatch.layout?.sectors?.find((entry) => entry.id === "Government")?.stroke).toBe("#1d4ed8");
  });

  it("authors sector opacity from the inspector", () => {
    const onCellChange = renderHydraulics();

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-sector-Government"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Sector opacity"), { target: { value: "40" } });

    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    expect(next.layout?.sectors?.find((entry) => entry.id === "Government")?.opacity).toBeCloseTo(0.4);
  });

  it("authors sector label offsets from the inspector sliders", () => {
    const onCellChange = renderHydraulics();

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-sector-Government"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Label offset X"), { target: { value: "1.5" } });

    const next = onCellChange.mock.calls.at(-1)?.[1](hydraulicsCell) as HydraulicsCell;
    const sector = next.layout?.sectors?.find((entry) => entry.id === "Government");
    expect(sector?.labelOffsetX).toBe(1.5);
    expect(sector?.labelOffsetY).toBe(0);
  });

  it("authors a tank maxLevel from the inspector", () => {
    const cell: HydraulicsCell = {
      ...hydraulicsCell,
      layout: {
        ...hydraulicsCell.layout,
        tanks: [{ id: "Bs", sectorId: "Government", x: 6, y: 14, variable: "Bs" }]
      }
    };
    const onCellChange = renderHydraulics(vi.fn(), cell);

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-tank-Bs"), "pointerdown");
    });
    fireEvent.change(screen.getByLabelText("Tank max level"), { target: { value: "100" } });

    const next = onCellChange.mock.calls.at(-1)?.[1](cell) as HydraulicsCell;
    expect(next.layout?.tanks?.find((entry) => entry.id === "Bs")?.maxLevel).toBe(100);
  });

  it("clears authored tank maxLevel from the inspector", () => {
    const cell: HydraulicsCell = {
      ...hydraulicsCell,
      layout: {
        ...hydraulicsCell.layout,
        tanks: [{ id: "Bs", sectorId: "Government", x: 6, y: 14, variable: "Bs", maxLevel: 100 }]
      }
    };
    const onCellChange = renderHydraulics(vi.fn(), cell);

    act(() => {
      dispatchPointer(screen.getByTestId("hydraulics-tank-Bs"), "pointerdown");
    });
    expect(screen.getByLabelText("Tank max level")).toHaveValue(100);
    fireEvent.change(screen.getByLabelText("Tank max level"), { target: { value: "" } });

    const cleared = onCellChange.mock.calls.at(-1)?.[1](cell) as HydraulicsCell;
    expect(cleared.layout?.tanks?.find((entry) => entry.id === "Bs")).not.toHaveProperty("maxLevel");
  });
});
