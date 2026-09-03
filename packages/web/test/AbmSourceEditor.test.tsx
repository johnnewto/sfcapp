// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbmSourceEditor } from "../src/notebook/AbmSourceEditor";

function ControlledAbmSourceEditor({
  initialValue,
  onSelectVariable,
  parameterNames
}: {
  initialValue: string;
  onSelectVariable?: (variableName: string) => void;
  parameterNames?: Set<string>;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <>
      <AbmSourceEditor
        value={value}
        onChange={setValue}
        onSelectVariable={onSelectVariable}
        parameterNames={parameterNames}
      />
      <output data-testid="source">{value}</output>
    </>
  );
}

function readSource(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("source").textContent ?? "{}") as Record<string, unknown>;
}

const completeSource = JSON.stringify({
  id: "abm-model",
  type: "abm-model",
  title: "ABM",
  modelId: "abm",
  customExtension: { keep: true },
  populations: [
    {
      name: "households",
      size: 10,
      state: ["income"],
      params: {
        alpha: { value: 0.5 },
        beta: { draw: "uniform", lo: 0.1, hi: 0.9 }
      }
    }
  ],
  params: { tax: 0.2 },
  state: { aggregates: { Y: 0 } },
  ticks: [
    { do: [["Y", "sum(income)", "Output"]] },
    { for: { households: [["income", "Y / 10"]] } },
    { "hire-lottery": { demand: "N_d", spread: "s", cap: "households", into: "N" } },
    { shuffle: "households" },
    {
      "ration-fcfs": {
        population: "households",
        demand: "demand",
        supply: "Y",
        into: "served"
      }
    }
  ],
  record: {
    series: ["Y"],
    bands: ["Y"],
    micro: [{ population: "households", agents: ["first", "last"], variables: ["income"] }],
    descriptions: { Y: "Output" }
  },
  check: { left: "Y", right: "Y", tolerance: 1e-8 }
});

afterEach(cleanup);

describe("AbmSourceEditor", () => {
  it("edits setup, populations, and equations while preserving unknown fields", () => {
    render(<ControlledAbmSourceEditor initialValue={completeSource} />);

    fireEvent.change(screen.getByLabelText("ABM model ID"), { target: { value: "updated-abm" } });
    fireEvent.change(screen.getByLabelText("Global parameters tax Value"), {
      target: { value: "0.3" }
    });
    fireEvent.change(screen.getByLabelText("Population 1 size"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Tick 1 Do equation 1 expression"), {
      target: { value: "sum(income) * 2" }
    });

    const source = readSource();
    expect(source.modelId).toBe("updated-abm");
    expect(source.params).toEqual({ tax: 0.3 });
    expect(source.customExtension).toEqual({ keep: true });
    expect(source.populations).toEqual([
      expect.objectContaining({ name: "households", size: 20, state: ["income"] })
    ]);
    expect(source.ticks).toEqual(
      expect.arrayContaining([{ do: [["Y", "sum(income) * 2", "Output"]] }])
    );
  });

  it("renders and edits every supported tick operation", () => {
    render(<ControlledAbmSourceEditor initialValue={completeSource} />);

    expect(screen.getByLabelText("Tick 1 operation")).toHaveValue("do");
    expect(screen.getByLabelText("Tick 2 operation")).toHaveValue("for");
    expect(screen.getByLabelText("Tick 3 operation")).toHaveValue("hire-lottery");
    expect(screen.getByLabelText("Tick 4 operation")).toHaveValue("shuffle");
    expect(screen.getByLabelText("Tick 5 operation")).toHaveValue("ration-fcfs");

    fireEvent.change(screen.getByLabelText("Tick 4 shuffle population"), {
      target: { value: "workers" }
    });
    fireEvent.change(screen.getByLabelText("ration-fcfs supply"), { target: { value: "available" } });
    fireEvent.click(screen.getByLabelText("Move tick 5 up"));

    const ticks = readSource().ticks as unknown[];
    expect(ticks[3]).toEqual({
      "ration-fcfs": {
        population: "households",
        demand: "demand",
        supply: "available",
        into: "served"
      }
    });
    expect(ticks[4]).toEqual({ shuffle: "workers" });
  });

  it("switches recording defaults and edits probes and checks", () => {
    const source = JSON.stringify({
      id: "minimal",
      type: "abm-model",
      title: "Minimal",
      modelId: "minimal",
      populations: [{ name: "agents", size: 2, state: ["x"] }],
      ticks: [{ for: { agents: [["x", "1"]] } }]
    });
    render(<ControlledAbmSourceEditor initialValue={source} />);

    const defaults = screen.getByLabelText("Use default ABM recording");
    expect(defaults).toBeChecked();
    fireEvent.click(defaults);
    fireEvent.click(screen.getByRole("button", { name: "Add micro probe" }));
    fireEvent.change(screen.getByLabelText("Micro probe 1 population"), {
      target: { value: "agents" }
    });
    fireEvent.change(screen.getByLabelText("Micro probe 1 variables"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Enable stock-flow check"));
    fireEvent.change(screen.getByLabelText("Stock-flow check left variable"), {
      target: { value: "X" }
    });

    const next = readSource();
    expect(next.record).toEqual({
      micro: [{ population: "agents", agents: ["first", "last"], variables: ["x"] }]
    });
    expect(next.check).toEqual({ left: "X", right: "", tolerance: 1e-8 });
  });

  it("keeps invalid JSON intact and directs users to JSON repair", () => {
    const invalid = '{"type":"abm-model",';
    render(<ControlledAbmSourceEditor initialValue={invalid} />);

    expect(screen.getByText(/switch to JSON to repair/i)).toBeInTheDocument();
    expect(screen.getByTestId("source")).toHaveTextContent(invalid);
  });

  it("colors variables and opens the variable inspector from formula tokens", () => {
    const onSelectVariable = vi.fn();
    const sourceWithParam = JSON.stringify({
      ...JSON.parse(completeSource),
      ticks: [{ do: [["Y", "tax * sum(income)", "Output"]] }]
    });
    render(
      <ControlledAbmSourceEditor
        initialValue={sourceWithParam}
        onSelectVariable={onSelectVariable}
        parameterNames={new Set(["tax", "alpha"])}
      />
    );

    expect(document.querySelectorAll(".formula-token").length).toBeGreaterThan(0);
    expect(document.querySelector(".formula-uppercase")).toBeTruthy();
    expect(document.querySelector(".formula-parameter")).toBeTruthy();

    const expressionPreview = screen
      .getByLabelText("Tick 1 Do equation 1 expression")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    fireEvent.mouseDown(within(expressionPreview as HTMLElement).getByText("income"));
    expect(onSelectVariable).toHaveBeenCalledWith("income");
  });

  it("exposes Target and Expression column resize splitters on equation tables", () => {
    const { container } = render(<ControlledAbmSourceEditor initialValue={completeSource} />);
    const aggregateShell = container.querySelector(
      '[aria-label="Tick 1 Do"].equation-grid-shell'
    );
    const agentShell = container.querySelector(
      '[aria-label="Tick 2 For"].equation-grid-shell'
    );
    expect(aggregateShell).toBeInstanceOf(HTMLDivElement);
    expect(agentShell).toBeInstanceOf(HTMLDivElement);
    if (!(aggregateShell instanceof HTMLDivElement) || !(agentShell instanceof HTMLDivElement)) {
      throw new Error("Expected equation shells.");
    }

    const variableSeparator = within(aggregateShell).getByRole("separator", {
      name: /resize variable column/i
    });
    const expressionSeparator = within(aggregateShell).getByRole("separator", {
      name: /resize expression column/i
    });

    expect(aggregateShell.style.getPropertyValue("--eq-col-variable-width")).toBe("160px");
    expect(aggregateShell.style.getPropertyValue("--eq-col-expression-width")).toBe("280px");

    fireEvent.mouseDown(variableSeparator, { button: 0, clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 240 });
    fireEvent.mouseUp(document);

    expect(aggregateShell.style.getPropertyValue("--eq-col-variable-width")).toBe("200px");
    expect(agentShell.style.getPropertyValue("--eq-col-variable-width")).toBe("200px");

    fireEvent.mouseDown(expressionSeparator, { button: 0, clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 460 });
    fireEvent.mouseUp(document);

    expect(aggregateShell.style.getPropertyValue("--eq-col-expression-width")).toBe("340px");
    expect(agentShell.style.getPropertyValue("--eq-col-expression-width")).toBe("340px");
  });

  it("colors population state, parameters, and recorded series names", () => {
    const onSelectVariable = vi.fn();
    render(
      <ControlledAbmSourceEditor
        initialValue={completeSource}
        onSelectVariable={onSelectVariable}
        parameterNames={new Set(["alpha", "tax"])}
      />
    );

    const statePreview = screen
      .getByLabelText("Population 1 state variables")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(statePreview.querySelector(".formula-lowercase")).toBeTruthy();

    const paramPreview = screen
      .getByLabelText("Population 1 parameter 1 name")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(paramPreview.querySelector(".formula-parameter")).toBeTruthy();

    const seriesPreview = screen
      .getByLabelText("Recorded macro series 1")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(seriesPreview.querySelector(".formula-uppercase")).toBeTruthy();

    fireEvent.mouseDown(within(statePreview as HTMLElement).getByText("income"));
    expect(onSelectVariable).toHaveBeenCalledWith("income");
  });

  it("colors For, Shuffle, and Ration population fields and supports inspect", () => {
    const onSelectVariable = vi.fn();
    render(
      <ControlledAbmSourceEditor
        initialValue={completeSource}
        onSelectVariable={onSelectVariable}
      />
    );

    const forPreview = screen
      .getByLabelText("Tick 2 agent population")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(within(forPreview as HTMLElement).getByText("households")).toHaveClass("formula-lowercase");

    const shufflePreview = screen
      .getByLabelText("Tick 4 shuffle population")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(within(shufflePreview as HTMLElement).getByText("households")).toHaveClass(
      "formula-lowercase"
    );

    const rationPreview = screen
      .getByLabelText("ration-fcfs population")
      .closest(".highlighted-formula-input")!
      .querySelector(".highlighted-formula-preview")!;
    expect(within(rationPreview as HTMLElement).getByText("households")).toHaveClass(
      "formula-lowercase"
    );

    fireEvent.mouseDown(within(forPreview as HTMLElement).getByText("households"));
    expect(onSelectVariable).toHaveBeenCalledWith("households");
  });
});
