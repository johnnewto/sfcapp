// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssistantMarkdown } from "../src/components/AssistantMarkdown";

afterEach(() => {
  cleanup();
});

describe("AssistantMarkdown", () => {
  it("renders known variable mentions in plain prose as variable labels", () => {
    render(
      <AssistantMarkdown
        text="Watch H^P as yd^{HS} adjusts."
        variableDescriptions={new Map([
          ["H^P", "High-powered money"],
          ["yd^{HS}", "Household disposable income"]
        ])}
      />
    );

    expect(screen.getByText("P", { selector: ".assistant-variable-code sup" })).toBeInTheDocument();
    expect(screen.getByText("HS", { selector: ".assistant-variable-code sup" })).toBeInTheDocument();
  });

  it("renders math-like inline code variables even without descriptions", () => {
    render(
      <AssistantMarkdown text="`x` = exp(`eps0` + `eps1` * log(lag(`xr`)) + `eps2` * log(`y^F`))" />
    );

    expect(screen.getAllByText("ε")).toHaveLength(3);
    expect(screen.getByText("0", { selector: ".assistant-variable-code sub" })).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".assistant-variable-code sub" })).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".assistant-variable-code sub" })).toBeInTheDocument();
    expect(screen.getByText("F", { selector: ".assistant-variable-code sup" })).toBeInTheDocument();
  });

  it("leaves ordinary inline code alone when it is not a known or math-like variable", () => {
    render(<AssistantMarkdown text="Use `exp` and `log` in formulas." />);

    expect(screen.getByText("exp", { selector: "code:not(.assistant-variable-code)" })).toBeInTheDocument();
    expect(screen.getByText("log", { selector: "code:not(.assistant-variable-code)" })).toBeInTheDocument();
  });

  it("renders equation code blocks without dark code-cell styling", () => {
    const { container } = render(
      <AssistantMarkdown text={"```\n`x` = exp(`eps0` + `eps1` * log(`y^F`))\n```"} />
    );

    expect(container.querySelector("pre > .assistant-equation-code")).not.toBeNull();
    expect(screen.getAllByText("ε")).toHaveLength(2);
    expect(screen.getByText("F", { selector: ".assistant-equation-code sup" })).toBeInTheDocument();
  });

  it("can make rendered variable mentions clickable", () => {
    const selectedVariables: string[] = [];

    render(
      <AssistantMarkdown
        text="Scenario raises alpha0 for later periods."
        onSelectVariable={(variableName) => selectedVariables.push(variableName)}
        variableDescriptions={new Map([["alpha0", "Autonomous consumption"]])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /inspect variable alpha0/i }));

    expect(selectedVariables).toEqual(["alpha0"]);
    expect(screen.getByText("0", { selector: ".assistant-variable-button sub" })).toBeInTheDocument();
  });

  it("renders inline markdown with clickable variable mentions", () => {
    const selectedVariables: string[] = [];
    const { container } = render(
      <h2>
        <AssistantMarkdown
          inline
          text="**Run** alpha0"
          onSelectVariable={(variableName) => selectedVariables.push(variableName)}
          variableDescriptions={new Map([["alpha0", "Autonomous consumption"]])}
        />
      </h2>
    );

    expect(container.querySelector("p")).toBeNull();
    expect(screen.getByText("Run", { selector: "strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /inspect variable alpha0/i }));

    expect(selectedVariables).toEqual(["alpha0"]);
    expect(screen.getByText("0", { selector: ".assistant-variable-button sub" })).toBeInTheDocument();
  });

  it("colors externals with formula-parameter like equation formulas", () => {
    const { container } = render(
      <AssistantMarkdown
        text="Tune `alpha1` and watch `Y`."
        parameterNames={new Set(["alpha1"])}
        variableDescriptions={
          new Map([
            ["alpha1", "Propensity to consume"],
            ["Y", "Output"]
          ])
        }
      />
    );

    expect(container.querySelector(".assistant-variable-code.formula-parameter")).not.toBeNull();
    expect(container.querySelector(".assistant-variable-code.formula-uppercase")).not.toBeNull();
  });

  it("keeps ordinary code blocks as code blocks", () => {
    const { container } = render(<AssistantMarkdown text={"```json\n{ \"x\": 1 }\n```"} />);

    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector(".assistant-equation-code")).toBeNull();
  });
});
