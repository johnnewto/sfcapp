// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbmModelCellView } from "../src/notebook/components/AbmModelCellView";
import type { AbmModelCell } from "@sfcr/notebook-core";

afterEach(cleanup);

const cell = {
  id: "abm-model",
  type: "abm-model",
  title: "ABM",
  modelId: "abm",
  populations: [{ name: "households", size: 10, state: ["cd", "c"] }],
  ticks: [
    {
      for: {
        households: [["cd", "0.5 * y", "Planned demand"]]
      }
    },
    { shuffle: "households" },
    {
      "ration-fcfs": {
        population: "households",
        demand: "cd",
        supply: "hPool",
        into: "c"
      }
    }
  ],
  record: { series: ["c"], descriptions: { c: "Household consumption" } }
} as AbmModelCell;

describe("AbmModelCellView", () => {
  it("shows ration-fcfs demand and supply like an equation", () => {
    const onInspect = vi.fn();
    render(
      <AbmModelCellView cell={cell} onVariableInspectRequest={({ selectedVariable }) => onInspect(selectedVariable)} />
    );

    const equation = screen.getByText(/← ration-fcfs\(/).closest("li");
    expect(equation).toBeTruthy();
    expect(within(equation as HTMLElement).getByText("cd")).toBeInTheDocument();
    expect(within(equation as HTMLElement).getByText("hPool")).toBeInTheDocument();
    expect(within(equation as HTMLElement).getByText("c")).toBeInTheDocument();

    fireEvent.click(within(equation as HTMLElement).getByText("cd"));
    expect(onInspect).toHaveBeenCalledWith("cd");
  });

  it("colors population names green and makes them inspectable on for/shuffle ticks", () => {
    const onInspect = vi.fn();
    const { container } = render(
      <AbmModelCellView cell={cell} onVariableInspectRequest={({ selectedVariable }) => onInspect(selectedVariable)} />
    );

    const tickItems = container.querySelectorAll(".notebook-abm-model-ticks > li");
    expect(tickItems.length).toBeGreaterThanOrEqual(2);

    const forLabel = tickItems[0]!.querySelector(":scope > div");
    expect(forLabel).toHaveTextContent(/^For/);
    expect(forLabel!.querySelector(".abm-source-tick-operation-label")).toHaveTextContent("For");
    const forPopulation = within(forLabel as HTMLElement).getByRole("button", { name: "households" });
    expect(forPopulation.querySelector(".formula-lowercase")).toBeTruthy();

    const shuffleLabel = tickItems[1]!.querySelector(":scope > div");
    expect(shuffleLabel).toHaveTextContent(/^Shuffle/);
    expect(shuffleLabel!.querySelector(".abm-source-tick-operation-label")).toHaveTextContent(
      "Shuffle"
    );
    const shufflePopulation = within(shuffleLabel as HTMLElement).getByRole("button", {
      name: "households"
    });
    expect(shufflePopulation.querySelector(".formula-lowercase")).toBeTruthy();

    fireEvent.click(shufflePopulation);
    expect(onInspect).toHaveBeenCalledWith("households");

    expect(
      within(tickItems[1] as HTMLElement).getByText(
        /Build a new queue of agent IDs using Fisher–Yates shuffle/i
      )
    ).toBeInTheDocument();
  });
});
