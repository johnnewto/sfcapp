// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEGEND_MENU_CLOSE_DELAY_MS,
  LEGEND_MENU_OPEN_DELAY_MS,
  ResultChart,
  resolveMinScenarioShockLabelX
} from "../src/components/ResultChart";

afterEach(() => {
  cleanup();
});

function hasTextContent(expected: RegExp) {
  return (_content: string, node: Element | null) => {
    if (!node?.textContent || !expected.test(node.textContent)) {
      return false;
    }

    return Array.from(node.children).every(
      (child) => !child.textContent || !expected.test(child.textContent)
    );
  };
}

describe("ResultChart", () => {
  it("renders scenario shock bands with start and end markers", () => {
    render(
      <ResultChart
        scenarioShocks={[
          {
            color: "#6366f1",
            endPeriodInclusive: 8,
            shockIndex: 1,
            startPeriodInclusive: 5,
            variables: [{ name: "alpha1", originalValueText: "0.75", valueText: "0.7" }]
          }
        ]}
        series={[{ name: "Y", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]}
      />
    );

    expect(document.querySelectorAll(".chart-scenario-shock")).toHaveLength(1);
    expect(document.querySelectorAll(".chart-scenario-shock line")).toHaveLength(2);
    expect(document.querySelector(".chart-scenario-shock foreignObject")).not.toBeNull();
    expect(screen.getByText("0.75", { selector: ".scenario-shock-original" })).toBeInTheDocument();
    expect(screen.getByText("α", { selector: ".chart-scenario-shock-band-label .variable-math-label" })).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".chart-scenario-shock-band-label sub" })).toBeInTheDocument();
  });

  it("keeps scenario shock labels inside the plot area away from the y axis title", () => {
    render(
      <ResultChart
        scenarioShocks={[
          {
            color: "#6366f1",
            endPeriodInclusive: 3,
            shockIndex: 1,
            startPeriodInclusive: 1,
            variables: [{ name: "Gd", originalValueText: "20", valueText: "30" }]
          }
        ]}
        series={[{ name: "Y", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]}
      />
    );

    const foreignObject = document.querySelector(".chart-scenario-shock foreignObject");
    expect(foreignObject).not.toBeNull();
    expect(Number(foreignObject?.getAttribute("x"))).toBeGreaterThanOrEqual(
      resolveMinScenarioShockLabelX({ axisMode: "shared", leftPadding: 56 })
    );
  });

  it("estimates scenario shock label inset from axis title width", () => {
    expect(resolveMinScenarioShockLabelX({ axisMode: "shared", leftPadding: 56 })).toBeCloseTo(77.4, 1);
    expect(
      resolveMinScenarioShockLabelX({ axisMode: "separate", leftPadding: 140, primarySeriesName: "alpha1" })
    ).toBeCloseTo(150.96, 1);
  });

  it("calls onInspectScenarioShockVariable when a shock variable label is clicked", () => {
    const onInspectScenarioShockVariable = vi.fn();
    render(
      <ResultChart
        onInspectScenarioShockVariable={onInspectScenarioShockVariable}
        scenarioShocks={[
          {
            color: "#6366f1",
            endPeriodInclusive: 8,
            shockIndex: 1,
            startPeriodInclusive: 5,
            variables: [{ name: "alpha1", originalValueText: "0.75", valueText: "0.7" }]
          }
        ]}
        series={[{ name: "Y", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^Inspect variable alpha1$/i })
    );
    expect(onInspectScenarioShockVariable).toHaveBeenCalledWith("alpha1");
  });

  it("renders a shared left axis by default", () => {
    render(
      <ResultChart
        series={[
          { name: "P", values: [2, 3, 5, 4] },
          { name: "POLR", values: [10, 15, 25, 20] },
          { name: "NR", values: [900, 850, 700, 600] }
        ]}
      />
    );

    expect(
      screen.getByRole("img", { name: /simulation result chart with shared left axis/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/Shared axis: .* to /i))).toBeInTheDocument();
  });

  it("renders multiple left-axis labels in separate mode", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "P", values: [2, 3, 5, 4] },
          { name: "POLR", values: [10, 15, 25, 20] },
          { name: "NR", values: [900, 850, 700, 600] }
        ]}
      />
    );

    expect(
      screen.getByRole("img", { name: /simulation result chart with multiple left axes/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText("P").length).toBeGreaterThan(0);
    expect(screen.getAllByText("POLR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NR").length).toBeGreaterThan(0);
    expect(
      Array.from(document.querySelectorAll(".chart-axis > text"))
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
    ).toEqual(expect.arrayContaining(["P", "POL", "NR"]));
    expect(screen.getByText(hasTextContent(/P: .* to /i))).toBeInTheDocument();
  });

  it("staggers neighboring separate-axis titles onto two rows", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "Yd", values: [2, 3, 5, 4] },
          { name: "W", values: [10, 15, 25, 20] },
          { name: "Y", values: [900, 850, 700, 600] }
        ]}
      />
    );

    const axisTitleY = (label: string) => {
      const node = Array.from(document.querySelectorAll(".chart-axis > text")).find(
        (candidate) => candidate.textContent?.trim() === label
      );
      if (!node) {
        throw new Error(`Expected axis title ${label}.`);
      }
      return Number(node.getAttribute("y"));
    };

    // The middle axis (index 1) sits on the higher row, outer axes on the lower row.
    expect(axisTitleY("W")).toBeLessThan(axisTitleY("Yd"));
    expect(axisTitleY("W")).toBeLessThan(axisTitleY("Y"));
    expect(axisTitleY("Yd")).toEqual(axisTitleY("Y"));
  });

  it("truncates long separate-axis titles to three characters", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          {
            name: "Share of money balances",
            values: [25, 25, 25]
          },
          {
            name: "Share of bills",
            values: [75, 75, 75]
          }
        ]}
      />
    );

    const axisTitles = Array.from(document.querySelectorAll(".chart-axis > text"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    expect(axisTitles).toEqual(expect.arrayContaining(["Sha", "Sha"]));
  });

  it("defaults the x-axis title to yr", () => {
    render(
      <ResultChart
        series={[
          { name: "y", values: [1, 2, 3] }
        ]}
      />
    );

    expect(screen.getByText("yr")).toBeInTheDocument();
  });

  it("shows shared y-axis unit below the lowest tick label", () => {
    render(
      <ResultChart
        yAxis={{ unit: "$" }}
        series={[
          { name: "y", values: [1, 2, 3] }
        ]}
      />
    );

    expect(screen.getByText("Value")).toBeInTheDocument();
    const unitLabel = document.querySelector(".chart-axis-unit-label");
    expect(unitLabel?.textContent).toBe("$");
  });

  it("shows per-series unit below the lowest tick label in separate mode", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          {
            name: "Share of money balances",
            unit: "%",
            values: [25, 25, 25]
          }
        ]}
      />
    );

    expect(screen.getByText("Sha")).toBeInTheDocument();
    const unitLabel = document.querySelector(".chart-axis-unit-label");
    expect(unitLabel?.textContent).toBe("%");
  });

  it("renders superscripted variable names in chart legends and scales", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "H^P", values: [2, 3, 5, 4] },
          { name: "B^{CB}", values: [10, 15, 25, 20] }
        ]}
      />
    );

    expect(screen.getByText("P", { selector: ".chart-legend sup" })).toBeInTheDocument();
    expect(screen.getByText("CB", { selector: ".chart-legend sup" })).toBeInTheDocument();
    expect(screen.getByText("CB", { selector: ".chart-scale sup" })).toBeInTheDocument();
  });

  it("adds a variable from the legend picker", async () => {
    const user = userEvent.setup();
    const handleAddVariable = vi.fn();

    render(
      <ResultChart
        addVariableOptions={["A", "B", "C"]}
        onAddVariable={handleAddVariable}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] }
        ]}
        variableDescriptions={new Map([["C", "Household consumption"]])}
      />
    );

    await user.click(screen.getByRole("button", { name: /add chart variable/i }));

    const menu = screen.getByRole("listbox", { name: /available chart variables/i });
    expect(within(menu).getByRole("option", { name: /C/i })).toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /A/i })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("option", { name: /C/i }));

    expect(handleAddVariable).toHaveBeenCalledWith("C");
    expect(screen.queryByRole("listbox", { name: /available chart variables/i })).not.toBeInTheDocument();
  });

  it("opens legend variable actions from right-click", async () => {
    const user = userEvent.setup();
    const handleMoveVariable = vi.fn();
    const handleRemoveVariable = vi.fn();

    render(
      <ResultChart
        onMoveVariable={handleMoveVariable}
        onRemoveVariable={handleRemoveVariable}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] },
          { name: "C", values: [30, 31, 32, 33] }
        ]}
      />
    );

    const legendB = screen.getByText("B").closest(".legend-item");
    if (!legendB) {
      throw new Error("Expected B legend item.");
    }

    fireEvent.contextMenu(legendB);

    const menu = screen.getByRole("menu", { name: /B chart variable actions/i });
    await user.click(within(menu).getByRole("menuitem", { name: /move left/i }));

    expect(handleMoveVariable).toHaveBeenCalledWith("B", "left");
    expect(screen.queryByRole("menu", { name: /B chart variable actions/i })).not.toBeInTheDocument();

    fireEvent.contextMenu(legendB);
    await user.click(
      screen.getByRole("menuitem", { name: /remove from chart/i })
    );

    expect(handleRemoveVariable).toHaveBeenCalledWith("B");
  });

  it("opens legend variable actions from the label", async () => {
    const user = userEvent.setup();
    const handleMoveVariable = vi.fn();
    const handleRemoveVariable = vi.fn();

    render(
      <ResultChart
        onMoveVariable={handleMoveVariable}
        onRemoveVariable={handleRemoveVariable}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] },
          { name: "C", values: [30, 31, 32, 33] }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /^B chart variable actions$/i }));

    const menu = screen.getByRole("menu", { name: /B chart variable actions/i });
    await user.click(within(menu).getByRole("menuitem", { name: /move right/i }));

    expect(handleMoveVariable).toHaveBeenCalledWith("B", "right");
    expect(screen.queryByRole("menu", { name: /B chart variable actions/i })).not.toBeInTheDocument();
  });

  it("keeps the legend menu open on a second label click", async () => {
    const user = userEvent.setup();

    render(
      <ResultChart
        onRemoveVariable={vi.fn()}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] }
        ]}
      />
    );

    const label = screen.getByRole("button", { name: /^B chart variable actions$/i });
    await user.click(label);
    expect(screen.getByRole("menu", { name: /B chart variable actions/i })).toBeInTheDocument();

    await user.click(label);
    expect(screen.getByRole("menu", { name: /B chart variable actions/i })).toBeInTheDocument();
  });

  it("opens legend variable actions on hover after a delay", async () => {
    vi.useFakeTimers();
    try {
      const handleRemoveVariable = vi.fn();

      render(
        <ResultChart
          onRemoveVariable={handleRemoveVariable}
          series={[
            { name: "A", values: [2, 3, 5, 4] },
            { name: "B", values: [10, 15, 25, 20] }
          ]}
        />
      );

      const legendB = screen
        .getByRole("button", { name: /^B chart variable actions$/i })
        .closest(".legend-item");
      if (!legendB) {
        throw new Error("Expected B legend item.");
      }

      fireEvent.mouseEnter(legendB);
      expect(screen.queryByRole("menu", { name: /B chart variable actions/i })).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGEND_MENU_OPEN_DELAY_MS - 1);
      });
      expect(screen.queryByRole("menu", { name: /B chart variable actions/i })).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole("menu", { name: /B chart variable actions/i })).toBeInTheDocument();

      fireEvent.mouseLeave(legendB);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGEND_MENU_CLOSE_DELAY_MS);
      });
      expect(screen.queryByRole("menu", { name: /B chart variable actions/i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the legend variable tooltip while the actions menu is open", async () => {
    vi.useFakeTimers();
    try {
      render(
        <ResultChart
          onRemoveVariable={vi.fn()}
          series={[{ name: "Y", values: [10, 12, 14, 16] }]}
          variableDescriptions={new Map([["Y", "Income = GDP"]])}
        />
      );

      const label = screen.getByRole("button", { name: /^Y chart variable actions$/i });
      const legendItem = label.closest(".legend-item");
      if (!legendItem) {
        throw new Error("Expected Y legend item.");
      }
      const tooltipAnchor = legendItem.querySelector(".legend-item-tooltip-anchor");
      if (!(tooltipAnchor instanceof HTMLElement)) {
        throw new Error("Expected legend tooltip anchor.");
      }

      fireEvent.mouseEnter(legendItem);
      fireEvent.mouseEnter(tooltipAnchor);
      expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGEND_MENU_OPEN_DELAY_MS);
      });
      expect(screen.getByRole("menu", { name: /Y chart variable actions/i })).toBeInTheDocument();
      expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");

      fireEvent.mouseLeave(tooltipAnchor);
      expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a series from the legend actions menu", async () => {
    const user = userEvent.setup();
    const handleRemoveVariable = vi.fn();

    render(
      <ResultChart
        onRemoveVariable={handleRemoveVariable}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /^B chart variable actions$/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove from chart/i }));

    expect(handleRemoveVariable).toHaveBeenCalledWith("B");
  });

  it("portals the legend actions menu to document.body", async () => {
    const user = userEvent.setup();

    render(
      <ResultChart
        onRemoveVariable={vi.fn()}
        series={[
          { name: "A", values: [2, 3, 5, 4] },
          { name: "B", values: [10, 15, 25, 20] }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /^B chart variable actions$/i }));

    const menu = screen.getByRole("menu", { name: /B chart variable actions/i });
    expect(menu).toHaveClass("chart-legend-context-menu", "chart-legend-menu-portal");
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.top).toMatch(/px$/);
    expect(menu.style.left).toMatch(/px$/);
  });

  it("allows removing the last series from the legend actions menu", async () => {
    const user = userEvent.setup();
    const handleRemoveVariable = vi.fn();

    render(
      <ResultChart
        onRemoveVariable={handleRemoveVariable}
        series={[{ name: "A", values: [2, 3, 5, 4] }]}
      />
    );

    await user.click(screen.getByRole("button", { name: /^A chart variable actions$/i }));
    await user.click(screen.getByRole("menuitem", { name: /remove from chart/i }));

    expect(handleRemoveVariable).toHaveBeenCalledWith("A");
  });

  it("shows a variable picker when the chart has no series", async () => {
    const user = userEvent.setup();
    const handleAddVariable = vi.fn();

    render(
      <ResultChart
        addVariableOptions={["Y", "C"]}
        onAddVariable={handleAddVariable}
        series={[]}
        title="Empty graph"
      />
    );

    expect(screen.getByText("Add a variable to graph")).toBeInTheDocument();
    const picker = screen.getByRole("listbox", { name: "Available chart variables" });
    expect(within(picker).getByRole("option", { name: /Y/i })).toBeInTheDocument();

    await user.click(within(picker).getByRole("option", { name: /C/i }));
    expect(handleAddVariable).toHaveBeenCalledWith("C");
  });

  it("keeps separate-axis tick rows aligned by using the same tick count on each axis", () => {
    render(
      <ResultChart
        axisMode="separate"
        yAxisTickCount={6}
        series={[
          { name: "A", values: [0.11, 0.13, 0.17, 0.19] },
          { name: "B", values: [120, 180, 260, 310] }
        ]}
      />
    );

    const axisGroups = Array.from(document.querySelectorAll(".chart-axis"));
    expect(axisGroups).toHaveLength(2);

    const tickLabelCounts = axisGroups.map(
      (axisGroup) => axisGroup.querySelectorAll("text").length - 1
    );

    expect(tickLabelCounts).toEqual([6, 6]);
  });

  it("buckets variables onto shared axes with axisGroups", () => {
    render(
      <ResultChart
        axisGroups={[["A", "B"], ["C"]]}
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [20, 22, 24, 26] },
          { name: "C", values: [900, 850, 700, 600] }
        ]}
      />
    );

    expect(
      screen.getByRole("img", { name: /simulation result chart with multiple left axes/i })
    ).toBeInTheDocument();

    expect(document.querySelectorAll(".chart-axis")).toHaveLength(2);

    const axisTitles = Array.from(document.querySelectorAll(".chart-axis > text"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    expect(axisTitles).toEqual(expect.arrayContaining(["A, B", "C"]));

    const scaleEntries = Array.from(document.querySelectorAll(".chart-scale-multi > span"))
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => /^[ABC]:/.test(text));
    const boundsFor = (name: string) =>
      scaleEntries.find((text) => text.startsWith(`${name}:`))?.replace(/^[ABC]:/, "").trim();

    expect(boundsFor("A")).toBeDefined();
    expect(boundsFor("A")).toEqual(boundsFor("B"));
    expect(boundsFor("A")).not.toEqual(boundsFor("C"));
  });

  it("supports includeZero on a shared auto range", () => {
    render(
      <ResultChart
        sharedRange={{ includeZero: true }}
        series={[
          { name: "P", values: [2, 3, 5, 4] },
          { name: "POLR", values: [10, 15, 25, 20] }
        ]}
      />
    );

    expect(screen.getByText(hasTextContent(/Shared axis: -1\.00 to 26\.0/i))).toBeInTheDocument();
  });

  it("supports manual shared and per-series ranges", () => {
    render(
      <ResultChart
        axisMode="separate"
        sharedRange={{ min: -10, max: 10 }}
        series={[
          { name: "P", values: [2, 3, 5, 4] },
          { name: "POLR", values: [10, 15, 25, 20] }
        ]}
        seriesRanges={{
          P: { min: 0, max: 10 },
          POLR: { includeZero: true }
        }}
      />
    );

    expect(screen.getByText(hasTextContent(/P: 0\.000 to 10\.0/i))).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/POLR: -1\.00 to 26\.0/i))).toBeInTheDocument();
  });

  it("snaps similar separate auto axes when enabled", () => {
    render(
      <ResultChart
        axisMode="separate"
        axisSnapTolarance={0.2}
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [11, 13, 15, 17] }
        ]}
      />
    );

    expect(screen.getByText(hasTextContent(/A: 9\.76 to 17\.2/i))).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/B: 9\.76 to 17\.2/i))).toBeInTheDocument();
  });

  it("does not snap manual per-series ranges", () => {
    render(
      <ResultChart
        axisMode="separate"
        axisSnapTolarance={0.5}
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [11, 13, 15, 17] }
        ]}
        seriesRanges={{
          A: { min: 0, max: 20 }
        }}
      />
    );

    expect(screen.getByText(hasTextContent(/A: 0\.000 to 20\.0/i))).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/B: 10\.8 to 17\.2/i))).toBeInTheDocument();
  });

  it("uses the supplied auto time-range defaults", () => {
    render(
      <ResultChart
        series={[
          { name: "A", values: [10, 12, 14, 16, 18, 20] },
          { name: "B", values: [5, 6, 7, 8, 9, 10] }
        ]}
        timeRangeDefaults={{ startPeriodInclusive: 3, endPeriodInclusive: 5 }}
      />
    );

    expect(screen.getByText(/Time axis: 3 to 5/i)).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/Shared axis: 6\.56 to 18\.4/i))).toBeInTheDocument();
  });

  it("supports manual time ranges", () => {
    render(
      <ResultChart
        series={[
          { name: "A", values: [10, 12, 14, 16, 18, 20] },
          { name: "B", values: [5, 6, 7, 8, 9, 10] }
        ]}
        timeRangeInclusive={[2, 4]}
      />
    );

    expect(screen.getByText(/Time axis: 2 to 4/i)).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/Shared axis: 5\.60 to 16\.4/i))).toBeInTheDocument();
  });

  it("renders reference overlays as dotted traces and includes them in the auto scale", () => {
    const { container } = render(
      <ResultChart
        overlaySeries={[{ name: "A", values: [0, 30] }]}
        series={[{ name: "A", values: [10, 20] }]}
      />
    );

    expect(container.querySelector('polyline[stroke-dasharray="5 5"]')).not.toBeNull();
    expect(screen.getByText(hasTextContent(/Shared axis: -1\.20 to 31\.2/i))).toBeInTheDocument();
  });

  it("renders the reference trace label in the chart legend", () => {
    render(
      <ResultChart
        overlaySeries={[{ name: "A", values: [0, 30] }]}
        referenceTraceLegendLabel="----: observed"
        series={[{ name: "A", values: [10, 20] }]}
      />
    );

    const label = screen.getByText("----: observed");
    expect(label.closest(".chart-legend")).not.toBeNull();
    expect(label.closest(".legend-item-reference-trace")).not.toBeNull();
  });

  it("thickens the dotted overlay when its matching trace is hovered", () => {
    const { container } = render(
      <ResultChart
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
        overlaySeries={[
          { name: "A", values: [9, 11, 13, 15] },
          { name: "B", values: [29, 31, 33, 35] }
        ]}
      />
    );

    const chart = screen.getByRole("img", { name: /simulation result chart with shared left axis/i });
    chart.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 900,
        height: 360
      }) as DOMRect;

    const overlay = container.querySelector('polyline[stroke-dasharray="5 5"]');
    expect(overlay).toHaveAttribute("stroke-width", "2");

    fireEvent.mouseMove(chart, { clientX: 330, clientY: 250 });

    expect(screen.getByText(/A • Period 2/i)).toBeInTheDocument();
    expect(overlay).toHaveAttribute("stroke-width", "3");
  });

  it("uses nice y-axis tick spacing with 0 or 5 endings", () => {
    render(
      <ResultChart
        series={[
          { name: "A", values: [0.101, 0.214, 0.327, 0.441] },
          { name: "B", values: [0.151, 0.264, 0.377, 0.491] }
        ]}
      />
    );

    expect(screen.getAllByText("0.200").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.300").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.213")).not.toBeInTheDocument();
  });

  it("supports niceScale to expand auto bounds to nicer values", () => {
    render(
      <ResultChart
        niceScale
        series={[
          { name: "A", values: [0.112, 0.176, 0.243, 0.298] },
          { name: "B", values: [0.101, 0.166, 0.231, 0.287] }
        ]}
      />
    );

    expect(screen.getByText(hasTextContent(/Shared axis: 0\.100 to 0\.300/i))).toBeInTheDocument();
  });

  it("highlights the nearest trace and shows a hover tooltip", () => {
    render(
      <ResultChart
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
      />
    );

    const chart = screen.getByRole("img", { name: /simulation result chart with shared left axis/i });
    chart.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 900,
        height: 360
      }) as DOMRect;

    fireEvent.mouseMove(chart, { clientX: 330, clientY: 250 });

    expect(screen.getByText(/A • Period 2/i)).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/Value:\s*12\.0/i))).toBeInTheDocument();
    expect(screen.getByText("A").closest(".legend-item")).toHaveClass("is-active");
    expect(screen.getByText("B").closest(".legend-item")).toHaveClass("is-dimmed");
  });

  it("shows the variable description in the hover tooltip when available", () => {
    render(
      <ResultChart
        series={[
          { name: "Y", values: [10, 12, 14, 16] },
          { name: "C", values: [30, 32, 34, 36] }
        ]}
        variableDescriptions={new Map([["Y", "Description"]])}
      />
    );

    const chart = screen.getByRole("img", { name: /simulation result chart with shared left axis/i });
    chart.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 900,
        height: 360
      }) as DOMRect;

    fireEvent.mouseMove(chart, { clientX: 330, clientY: 250 });

    expect(screen.getByText(/Y • Description/i)).toBeInTheDocument();
    expect(screen.getByText(hasTextContent(/Value:\s*12\.0/i))).toBeInTheDocument();
  });

  it("colors negative hover values red", () => {
    render(
      <ResultChart
        series={[
          { name: "A", values: [-10, -12, -14, -16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
      />
    );

    const chart = screen.getByRole("img", { name: /simulation result chart with shared left axis/i });
    chart.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 900,
        height: 360
      }) as DOMRect;

    fireEvent.mouseMove(chart, { clientX: 330, clientY: 250 });

    const negativeValue = screen.getByText("-12.0");
    expect(negativeValue).toHaveAttribute("fill", "#b42318");
  });

  it("colors negative scale bounds red", () => {
    const { container } = render(
      <ResultChart
        series={[
          { name: "A", values: [-10, -12, -14, -16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
      />
    );

    const negativeBound = container.querySelector(".chart-scale .numeric-value-negative");
    expect(negativeBound).not.toBeNull();
    expect(negativeBound).toHaveTextContent(/-/);
    expect(negativeBound).toHaveClass("numeric-value-negative");
  });

  it("highlights the matching legend and axis in multi-axis mode on hover", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "A", values: [10, 10, 10, 10] },
          { name: "B", values: [30, 35, 30, 30] }
        ]}
      />
    );

    const chart = screen.getByRole("img", { name: /simulation result chart with multiple left axes/i });
    chart.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 900,
        height: 360
      }) as DOMRect;

    fireEvent.mouseMove(chart, { clientX: 330, clientY: 60 });

    const legend = chart.parentElement?.querySelector(".chart-legend");
    if (!legend) {
      throw new Error("Expected chart legend.");
    }

    const legendA = within(legend).getByText("A").closest(".legend-item");
    const legendB = within(legend).getByText("B").closest(".legend-item");

    expect(legendA).toHaveClass("is-dimmed");
    expect(legendB).toHaveClass("is-active");
    expect(screen.getByText(/B • Period 2/i)).toBeInTheDocument();
  });

  it("applies hover highlighting when hovering the legend and left-hand axis", () => {
    render(
      <ResultChart
        axisMode="separate"
        selectedIndex={1}
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
      />
    );

    const legendItems = screen.getAllByText("B");
    const legendItem = legendItems[0]?.closest(".legend-item");
    if (!legendItem) {
      throw new Error("Expected legend item.");
    }

    fireEvent.mouseEnter(legendItem);

    expect(legendItem).toHaveClass("is-active");
    expect(screen.getByText(/B • Period 2/i)).toBeInTheDocument();

    fireEvent.mouseLeave(legendItem);

    const axisLabel = screen.getAllByText("A").find((node) => node.closest(".chart-axis"));
    const axisGroup = axisLabel?.closest(".chart-axis");
    if (!axisGroup) {
      throw new Error("Expected chart axis.");
    }

    fireEvent.mouseEnter(axisGroup);

    expect(axisGroup).toHaveClass("is-active");
    expect(screen.getByText(/A • Period 2/i)).toBeInTheDocument();
  });

  it("toggles legend traces on and off", async () => {
    const user = userEvent.setup();

    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "A", values: [10, 12, 14, 16] },
          { name: "B", values: [30, 32, 34, 36] }
        ]}
      />
    );

    const hideBButton = screen.getByRole("button", { name: /hide b trace/i });

    expect(hideBButton).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".chart-axis")).toHaveLength(2);

    await user.click(hideBButton);

    expect(screen.getByRole("button", { name: /show b trace/i })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelectorAll(".chart-axis")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /show b trace/i }).closest(".legend-item")).toHaveClass("is-hidden");

    await user.click(screen.getByRole("button", { name: /show b trace/i }));

    expect(screen.getByRole("button", { name: /hide b trace/i })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".chart-axis")).toHaveLength(2);
  });

  it("adds variable description tooltips to legend and scale labels", () => {
    render(
      <ResultChart
        axisMode="separate"
        series={[
          { name: "Y", values: [10, 12, 14, 16] },
          { name: "C", values: [8, 9, 10, 11] }
        ]}
        variableDescriptions={
          new Map([
            ["Y", "Income = GDP"],
            ["C", "Consumption"]
          ])
        }
      />
    );

    fireEvent.mouseEnter(screen.getAllByText("Y")[0]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");

    fireEvent.mouseLeave(screen.getAllByText("Y")[0]!);
    fireEvent.mouseEnter(screen.getAllByText("C")[0]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Consumption");
  });

  it("shows an ephemeral time range slider for long series by default", () => {
    render(
      <ResultChart
        series={[
          {
            name: "A",
            values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
          }
        ]}
      />
    );

    expect(
      screen.getByRole("img", { name: /simulation result chart with shared left axis and time range slider/i })
    ).toBeInTheDocument();
    expect(document.querySelector(".chart-time-range-slider")).not.toBeNull();
    expect(screen.getByText(/Time axis: 1 to 12/i)).toBeInTheDocument();
  });

  it("hides the time range slider for short series and when disabled", () => {
    const { rerender } = render(
      <ResultChart
        series={[{ name: "A", values: [10, 11, 12, 13, 14, 15, 16, 17, 18] }]}
      />
    );

    expect(document.querySelector(".chart-time-range-slider")).toBeNull();

    rerender(
      <ResultChart
        series={[
          {
            name: "A",
            values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
          }
        ]}
        timeRangeSlider={false}
      />
    );

    expect(document.querySelector(".chart-time-range-slider")).toBeNull();
    expect(
      screen.getByRole("img", { name: /simulation result chart with shared left axis(?! and time range slider)/i })
    ).toBeInTheDocument();
  });

  it("initializes the slider window from timeRangeInclusive", () => {
    render(
      <ResultChart
        series={[
          {
            name: "A",
            values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
          }
        ]}
        timeRangeInclusive={[3, 8]}
      />
    );

    expect(screen.getByText(/Time axis: 3 to 8/i)).toBeInTheDocument();
  });

  it("does not reset the slider range when the parent re-renders with a fresh defaults object", () => {
    const longSeries = [
      {
        name: "A",
        values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
      }
    ];

    const { rerender } = render(
      <ResultChart
        series={longSeries}
        timeRangeInclusive={[4, 12]}
        timeRangeDefaults={{ startPeriodInclusive: 1, endPeriodInclusive: 12 }}
        title="Chart 0"
      />
    );

    expect(screen.getByText(/Time axis: 4 to 12/i)).toBeInTheDocument();

    rerender(
      <ResultChart
        series={longSeries}
        timeRangeInclusive={[4, 12]}
        timeRangeDefaults={{ startPeriodInclusive: 1, endPeriodInclusive: 12 }}
        title="Chart 1"
      />
    );

    expect(screen.getByText(/Time axis: 4 to 12/i)).toBeInTheDocument();
  });

  it("offers Store and Clear range actions when a change handler is provided", () => {
    const onTimeRangeInclusiveChange = vi.fn();
    const longSeries = [
      {
        name: "A",
        values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
      }
    ];

    const { rerender } = render(
      <ResultChart series={longSeries} onTimeRangeInclusiveChange={onTimeRangeInclusiveChange} />
    );

    const storeButton = screen.getByRole("button", { name: /store time range/i });
    expect(storeButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: /clear stored time range/i })).not.toBeInTheDocument();

    rerender(
      <ResultChart
        series={longSeries}
        timeRangeInclusive={[3, 8]}
        onTimeRangeInclusiveChange={onTimeRangeInclusiveChange}
      />
    );

    expect(screen.getByRole("button", { name: /store time range/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /clear stored time range/i }));
    expect(onTimeRangeInclusiveChange).toHaveBeenCalledWith(undefined);
  });

  it("does not show range store actions without a change handler", () => {
    render(
      <ResultChart
        series={[
          {
            name: "A",
            values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
          }
        ]}
        timeRangeInclusive={[3, 8]}
      />
    );

    expect(screen.queryByRole("button", { name: /store time range/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear stored time range/i })).not.toBeInTheDocument();
  });
});
