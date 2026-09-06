// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EquationRow } from "../src/lib/editorModel";
import { EquationGridEditor } from "../src/components/EquationGridEditor";
import { DelegatedFormulaTooltip } from "../src/components/InstantTooltip";

afterEach(() => {
  cleanup();
});

describe("EquationGridEditor lag rendering", () => {
  it("renders lag(Name) and Name[-1] as primed variables in the preview layer", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-1", name: "YD", expression: "lag(r^F) * lag(B^{CB})" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByDisplayValue("lag(r^F) * lag(B^{CB})")).toBeInTheDocument();
    const expressionPreview = document.querySelectorAll(".highlighted-formula-preview")[1];
    expect(expressionPreview).toHaveTextContent("•");
    expect(expressionPreview).not.toHaveTextContent("*");
    expect(screen.getByText("F", { selector: ".formula-token sup" })).toBeInTheDocument();
    expect(screen.getByText("CB", { selector: ".formula-token sup" })).toBeInTheDocument();
    expect(screen.getAllByText("'", { selector: ".formula-token sup.lag-prime" })).toHaveLength(2);
    expect(screen.queryByText("lag")).not.toBeInTheDocument();
  });

  it("renders bracket lag notation with the same prime styling", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-1", name: "WBd", expression: "-rl[-1] * Ld[-1]" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByDisplayValue("-rl[-1] * Ld[-1]")).toBeInTheDocument();
    const expressionPreview = document.querySelectorAll(".highlighted-formula-preview")[1];
    expect(expressionPreview).toHaveTextContent("'");
    expect(expressionPreview).not.toHaveTextContent("[-1]");
    expect(screen.getAllByText("'", { selector: ".formula-token sup.lag-prime" })).toHaveLength(2);
  });

  it("renders prime lag notation with the same prime styling", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-1", name: "WBd", expression: "-rl' * Ld'" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByDisplayValue("-rl' * Ld'")).toBeInTheDocument();
    const expressionPreview = document.querySelectorAll(".highlighted-formula-preview")[1];
    expect(expressionPreview).toHaveTextContent("•");
    expect(screen.getAllByText("'", { selector: ".formula-token sup.lag-prime" })).toHaveLength(2);
  });
});

function getFormulaTokensByText(container: HTMLElement, text: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".formula-token")).filter(
    (node) => node.textContent === text
  );
}

describe("EquationGridEditor", () => {
  it("renders resizable variable and expression column separators", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("separator", { name: /resize variable column/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: /resize expression column/i })
    ).toBeInTheDocument();
  });

  it("highlights input and output rows on hover and pins output traces on shift-click", () => {
    render(
      <EquationGridEditor
        equations={[
          { id: "eq-y", name: "Y", expression: "C + I" },
          { id: "eq-c", name: "C", expression: "alpha1 * YD" },
          { id: "eq-tax", name: "Tax", expression: "tau * Y" }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={["tau"]}
      />
    );

    const rows = screen.getAllByRole("row");
    const yRow = rows[1];
    const cRow = rows[2];
    const taxRow = rows[3];

    fireEvent.mouseEnter(yRow);
    expect(yRow).toHaveClass("trace-root");
    expect(cRow).toHaveClass("trace-input");
    expect(taxRow).toHaveClass("trace-output");

    fireEvent.click(yRow, { shiftKey: true });
    expect(yRow).toHaveClass("trace-root");
    expect(taxRow).toHaveClass("trace-output");
    expect(cRow).not.toHaveClass("trace-input");
  });

  it("does not color functions or gnd as variables", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-1", name: "Y", expression: "sin(x) + gnd + lag(K)" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByText("sin")).toHaveClass("formula-function");
    expect(screen.getByText("gnd")).toHaveClass("formula-default");
    expect(screen.getByText("K")).toHaveClass("formula-uppercase");
    expect(screen.getByText("'", { selector: ".formula-token sup.lag-prime" })).toBeInTheDocument();
    expect(screen.queryByText("lag")).not.toBeInTheDocument();
  });

  it("renders superscripted variable tokens in the preview layer", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-1", name: "H^P", expression: "B^{CB} + yd^{HS}" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    const cbSuperscript = screen.getByText("CB", { selector: ".formula-token sup" });
    const hsSuperscript = screen.getByText("HS", { selector: ".formula-token sup" });

    expect(cbSuperscript).toBeInTheDocument();
    expect(hsSuperscript).toBeInTheDocument();
  });

  it("clears a pinned trace when the same row and mode are clicked again", () => {
    render(
      <EquationGridEditor
        equations={[
          { id: "eq-y", name: "Y", expression: "C + I" },
          { id: "eq-c", name: "C", expression: "alpha1 * YD" }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    const rows = screen.getAllByRole("row");
    const yRow = rows[1];
    const cRow = rows[2];

    fireEvent.click(yRow);
    expect(yRow).toHaveClass("trace-root");
    expect(cRow).toHaveClass("trace-input");

    fireEvent.click(yRow);
    fireEvent.mouseLeave(yRow);

    expect(yRow).not.toHaveClass("trace-root");
    expect(cRow).not.toHaveClass("trace-input");
  });

  it("shows both input and output traces on click", () => {
    render(
      <EquationGridEditor
        equations={[
          { id: "eq-y", name: "Y", expression: "C + I" },
          { id: "eq-c", name: "C", expression: "alpha1 * YD" },
          { id: "eq-tax", name: "Tax", expression: "tau * Y" }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={["tau"]}
      />
    );

    const rows = screen.getAllByRole("row");
    const yRow = rows[1];
    const cRow = rows[2];
    const taxRow = rows[3];

    fireEvent.click(yRow);

    expect(yRow).toHaveClass("trace-root");
    expect(cRow).toHaveClass("trace-input");
    expect(taxRow).toHaveClass("trace-output");
  });

  it("shows only input traces on ctrl-click", () => {
    render(
      <EquationGridEditor
        equations={[
          { id: "eq-y", name: "Y", expression: "C + I" },
          { id: "eq-c", name: "C", expression: "alpha1 * YD" },
          { id: "eq-tax", name: "Tax", expression: "tau * Y" }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={["tau"]}
      />
    );

    const rows = screen.getAllByRole("row");
    const yRow = rows[1];
    const cRow = rows[2];
    const taxRow = rows[3];

    fireEvent.click(yRow, { ctrlKey: true });

    expect(yRow).toHaveClass("trace-root");
    expect(cRow).toHaveClass("trace-input");
    expect(taxRow).not.toHaveClass("trace-output");
  });

  it("keeps a pinned trace active even while hovering another row", () => {
    render(
      <EquationGridEditor
        equations={[
          { id: "eq-y", name: "Y", expression: "C + I" },
          { id: "eq-c", name: "C", expression: "alpha1 * YD" },
          { id: "eq-tax", name: "Tax", expression: "tau * Y" }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={["tau"]}
      />
    );

    const rows = screen.getAllByRole("row");
    const yRow = rows[1];
    const cRow = rows[2];
    const taxRow = rows[3];

    fireEvent.click(yRow, { shiftKey: true });
    fireEvent.mouseEnter(cRow);

    expect(yRow).toHaveClass("trace-root");
    expect(taxRow).toHaveClass("trace-output");
    expect(cRow).not.toHaveClass("trace-root");
  });

  it("adds trace emphasis to matching tokens while preserving parameter color precedence", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "tau * C + I" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={["tau"]}
      />
    );

    const expressionField = screen.getByDisplayValue("tau * C + I");
    const yRow = expressionField.closest('[role="row"]');

    expect(yRow).not.toBeNull();
    if (!yRow) {
      throw new Error("Expected equation row for traced expression");
    }

    fireEvent.click(yRow, { ctrlKey: true });

    const tauTokens = getFormulaTokensByText(yRow, "τ");
    const yTokens = getFormulaTokensByText(yRow, "Y");
    const cTokens = getFormulaTokensByText(yRow, "C");
    const iTokens = getFormulaTokensByText(yRow, "I");

    expect(tauTokens[0]).toHaveClass("formula-parameter");
    expect(yTokens[0]).toHaveClass("formula-uppercase");
    expect(yTokens.some((token) => token.className.includes("trace-token-root"))).toBe(true);
    expect(cTokens.some((token) => token.className.includes("trace-token-input"))).toBe(true);
    expect(iTokens.some((token) => token.className.includes("trace-token-output"))).toBe(false);
  });

  it("renders and edits a description column", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", desc: "Income = GDP", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    expect(screen.getAllByText("Description").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/equation 1 description/i), {
      target: { value: "Updated description" }
    });

    expect(onChange).toHaveBeenCalledWith([
      { id: "eq-y", name: "Y", desc: "Updated description", expression: "C + I" }
    ]);
  });

  it("edits explicit equation roles from the grid", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit equation role/i }));
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "eq-y", name: "Y", expression: "C + I", role: "identity" }
    ]);
  });

  it("adds instant tooltips to described variable tokens", () => {
    render(
      <>
        <DelegatedFormulaTooltip />
        <EquationGridEditor
          equations={[{ id: "eq-y", name: "Y", desc: "Income = GDP", expression: "alpha1 * Y" }]}
          issues={{}}
          onChange={vi.fn()}
          parameterNames={["alpha1"]}
          variableDescriptions={
            new Map([
              ["Y", "Income = GDP"],
              ["alpha1", "Propensity to consume out of income"]
            ])
          }
          variableUnitMetadata={
            new Map([
              ["Y", { dimensionKind: "flow", baseUnit: "$" }],
              ["alpha1", { dimensionKind: "aux" }]
            ])
          }
        />
      </>
    );

    const alphaToken = getFormulaTokensByText(document.body, "α1")[0];
    expect(alphaToken).toBeDefined();
    if (!alphaToken) {
      throw new Error("Expected formula token for alpha1");
    }

    fireEvent.pointerOver(alphaToken);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Propensity to consume out of income");
    fireEvent.pointerOut(alphaToken);

    const yToken = screen
      .getAllByText("Y")
      .find((node) => node.className.includes("formula-token"));
    expect(yToken).toBeDefined();
    if (!yToken) {
      throw new Error("Expected formula token for Y");
    }

    fireEvent.pointerOver(yToken);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");
    expect(screen.getByRole("tooltip")).toHaveTextContent("$/yr");
  });

  it("adds tooltips to lowercase variable tokens when metadata exists", () => {
    render(
      <>
        <DelegatedFormulaTooltip />
        <EquationGridEditor
          equations={[{ id: "eq-yd", name: "YD", expression: "lag(rl) * lag(Mh)" }]}
          issues={{}}
          onChange={vi.fn()}
          parameterNames={[]}
          variableDescriptions={
            new Map([
              ["rl", "Rate of interest on bank loans"],
              ["Mh", "Bank deposits held by households"]
            ])
          }
          variableUnitMetadata={
            new Map([
              ["rl", { stockFlow: "aux", signature: { time: -1 } }],
              ["Mh", { stockFlow: "stock", signature: { money: 1 } }]
            ])
          }
        />
      </>
    );

    const rlToken = screen
      .getAllByText("rl")
      .find((node) => node.className.includes("formula-token"));
    expect(rlToken).toBeDefined();
    if (!rlToken) {
      throw new Error("Expected formula token for rl");
    }

    fireEvent.pointerOver(rlToken);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Rate of interest on bank loans");
  });

  it("shows a unit badge for the variable column when metadata is present", () => {
    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-mh",
            name: "Mh",
            desc: "Bank deposits held by households",
            expression: "lag(Mh) + YD - C"
          }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
        variableUnitMetadata={new Map([["Mh", { dimensionKind: "stock", baseUnit: "$" }]])}
      />
    );

    expect(screen.getByRole("button", { name: /edit units for mh/i })).toHaveTextContent("$");
  });

  it("edits equation units from the units badge preset dialog", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-mh",
            name: "Mh",
            desc: "Bank deposits held by households",
            expression: "lag(Mh) + YD - C",
            unitMeta: { stockFlow: "stock", signature: { money: 1 } }
          }
        ]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for mh/i }));
    fireEvent.click(screen.getByRole("button", { name: "$/yr" }));

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: "eq-mh",
        name: "Mh",
        desc: "Bank deposits held by households",
        expression: "lag(Mh) + YD - C",
        unitMeta: { stockFlow: "flow", signature: { money: 1, time: -1 } }
      }
    ]);
  });

  it("applies money flow units from the preset list", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-y",
            name: "Y",
            expression: "C + I"
          }
        ]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for y/i }));
    fireEvent.click(screen.getByRole("button", { name: "$/yr" }));

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: "eq-y",
        name: "Y",
        expression: "C + I",
        unitMeta: { stockFlow: "flow", signature: { money: 1, time: -1 } }
      }
    ]);
  });

  it("applies stock item units from the preset list", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-nd",
            name: "Nd",
            expression: "1",
            unitMeta: { stockFlow: "flow", signature: { items: 1, time: -1 } }
          }
        ]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for nd/i }));
    fireEvent.click(screen.getByRole("button", { name: "items" }));

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: "eq-nd",
        name: "Nd",
        expression: "1",
        unitMeta: { stockFlow: "stock", signature: { items: 1 } }
      }
    ]);
  });

  it("disables Suggest when the equation expression is empty", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for y/i }));

    expect(screen.getByRole("button", { name: /suggest units from expression/i })).toBeDisabled();
  });

  it("suggests units from the expression RHS via the unit preset dialog", () => {
    const onChange = vi.fn();
    const variableUnitMetadata = new Map([
      ["C", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }],
      ["I", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }]
    ]);

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
        variableUnitMetadata={variableUnitMetadata}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for y/i }));
    const suggestButton = screen.getByRole("button", { name: /suggest units from expression/i });
    expect(suggestButton).toBeEnabled();

    fireEvent.click(suggestButton);

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: "eq-y",
        name: "Y",
        expression: "C + I",
        unitMeta: { signature: { money: 1, time: -1 } }
      }
    ]);
  });

  it("disables Suggest when the expression RHS cannot infer units", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "unknownVar" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit units for y/i }));

    expect(screen.getByRole("button", { name: /suggest units from expression/i })).toBeDisabled();
  });

  it("mirrors units from additive RHS operands via the footer Suggest units button", () => {
    const onChange = vi.fn();
    const variableUnitMetadata = new Map([
      ["C", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }],
      ["I", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }]
    ]);

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
        variableUnitMetadata={variableUnitMetadata}
      />
    );

    const footerSuggestButton = screen.getByRole("button", {
      name: /suggest units from additive or subtractive rhs operands/i
    });
    expect(footerSuggestButton).toBeEnabled();

    fireEvent.click(footerSuggestButton);

    expect(onChange).toHaveBeenCalledWith([
      {
        id: "eq-y",
        name: "Y",
        expression: "C + I",
        unitMeta: { stockFlow: "flow", signature: { money: 1, time: -1 } }
      }
    ]);
    expect(screen.getByRole("dialog", { name: /suggested equation unit summary/i })).toBeInTheDocument();
    expect(screen.getByText("Y", { selector: ".matrix-unit-meta-dialog-variable" })).toBeInTheDocument();
    expect(screen.getByText("flow · $/yr")).toBeInTheDocument();
    expect(screen.getByText("C + I", { selector: ".matrix-unit-meta-dialog-sources" })).toBeInTheDocument();
  });

  it("shows an empty summary dialog when no mirrored unit updates are available", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /suggest units from additive or subtractive rhs operands/i
      })
    );

    expect(
      screen.getByText(/no additive or subtractive equations had unit updates from tagged operands/i)
    ).toBeInTheDocument();
  });

  it("keeps the footer Suggest units button enabled after applying mirrored updates", () => {
    const onChange = vi.fn();
    const variableUnitMetadata = new Map([
      ["C", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }],
      ["I", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }]
    ]);

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
        variableUnitMetadata={variableUnitMetadata}
      />
    );

    const footerSuggestButton = screen.getByRole("button", {
      name: /suggest units from additive or subtractive rhs operands/i
    });

    fireEvent.click(footerSuggestButton);
    expect(footerSuggestButton).toBeEnabled();
  });

  it("closes the unit popover when clicking outside", () => {
    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-mh",
            name: "Mh",
            desc: "Bank deposits held by households",
            expression: "lag(Mh) + YD - C",
            unitMeta: { stockFlow: "stock", signature: { money: 1 } }
          }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    const trigger = screen.getByRole("button", { name: /edit units for mh/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(document.body);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a Units column header before Description", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    const header = document.querySelector(".equation-grid-header");
    expect(header).toHaveTextContent("Role");
    expect(header).toHaveTextContent("Units");
    expect(header).toHaveTextContent("Description");
    const headerText = header?.textContent ?? "";
    expect(headerText.indexOf("Units")).toBeGreaterThan(headerText.indexOf("Role"));
    expect(headerText.indexOf("Description")).toBeGreaterThan(headerText.indexOf("Units"));
  });

  it("edits equation roles from the role badge popover", () => {
    const onChange = vi.fn();

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit equation role/i }));
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "eq-y", name: "Y", expression: "C + I", role: "identity" }
    ]);
  });

  it("renders unit mismatch errors in the equation status cell and message row", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-v", name: "V", expression: "K + C" }]}
        issues={{
          "equations.0.expression": {
            message: "Cannot combine $ with $/yr using '+'.",
            severity: "error"
          }
        }}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByText("Error")).toBeInTheDocument();
    const message = screen.getByRole("note");
    expect(message).toHaveTextContent("Cannot combine $ with $/yr using '+'.");
    expect(message).toHaveClass("equation-grid-warning-row", "is-error");
  });

  it("renders unit warnings in the equation status cell and message row", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-mh", name: "Mh", expression: "lag(Mh) + YD - C" }]}
        issues={{
          "equations.0.expression": {
            message: "Stock 'Mh' assumes an implicit dt = 1 when adding increment terms.",
            severity: "warning"
          }
        }}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByText("Warning")).toBeInTheDocument();
    const message = screen.getByRole("note");
    expect(message).toHaveTextContent("Stock 'Mh' assumes an implicit dt = 1");
    expect(message).toHaveClass("equation-grid-warning-row", "is-warning");
  });

  it("shows flow units on derivative-balance equation badges", () => {
    render(
      <EquationGridEditor
        equations={[
          {
            id: "eq-ls",
            name: "d(Ls)",
            expression: "d(Ld)",
            unitMeta: { stockFlow: "stock", signature: { money: 1 } }
          }
        ]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByRole("button", { name: /edit units for d\(ls\)/i })).toHaveTextContent("$/yr");
  });

  it("renders d(name) stock warnings that recommend explicit dt", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-ls", name: "Ls", expression: "lag(Ls) + d(Ld)" }]}
        issues={{
          "equations.0.expression": {
            message:
              "Stock 'Ls' uses d(name) as a per-year stock-change term. Prefer adding '* dt' explicitly, e.g. lag(Ls) + d(name) * dt.",
            severity: "warning"
          }
        }}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    expect(screen.getByText("Warning")).toBeInTheDocument();
    const message = screen.getByRole("note");
    expect(message).toHaveTextContent("Prefer adding '* dt' explicitly");
    expect(message).toHaveClass("equation-grid-warning-row", "is-warning");
  });

  it("supports right-click equation actions for adding, moving, and deleting rows", async () => {
    const user = userEvent.setup();
    const initialEquations: EquationRow[] = [
      { id: "eq-y", name: "Y", expression: "C + I" },
      { id: "eq-c", name: "C", expression: "alpha1 * YD" },
      { id: "eq-i", name: "I", expression: "gamma * Y" }
    ];

    function StatefulGridEditor() {
      const [equations, setEquations] = useState(initialEquations);
      return (
        <EquationGridEditor equations={equations} issues={{}} onChange={setEquations} parameterNames={[]} />
      );
    }

    render(<StatefulGridEditor />);

    const getDataRows = () => screen.getAllByRole("row").slice(1);
    const yRow = () => getDataRows()[0]!;
    const cRow = () => getDataRows()[1]!;

    fireEvent.contextMenu(yRow());
    const initialMenu = screen.getByRole("menu", { name: /equation actions for row 1/i });
    expect(within(initialMenu).getByRole("menuitem", { name: /move up/i })).toBeDisabled();

    await user.click(within(initialMenu).getByRole("menuitem", { name: /move down/i }));
    expect(within(getDataRows()[0]!).getByDisplayValue("C")).toBeInTheDocument();
    expect(within(getDataRows()[1]!).getByDisplayValue("Y")).toBeInTheDocument();

    fireEvent.contextMenu(getDataRows()[1]!);
    await user.click(
      within(screen.getByRole("menu", { name: /equation actions for row 2/i })).getByRole("menuitem", {
        name: /move up/i
      })
    );
    expect(within(getDataRows()[0]!).getByDisplayValue("Y")).toBeInTheDocument();
    expect(within(getDataRows()[1]!).getByDisplayValue("C")).toBeInTheDocument();

    fireEvent.contextMenu(yRow());
    await user.click(
      within(screen.getByRole("menu", { name: /equation actions for row 1/i })).getByRole("menuitem", {
        name: /^add equation$/i
      })
    );
    expect(getDataRows()).toHaveLength(4);
    expect(within(getDataRows()[0]!).getByDisplayValue("Y")).toBeInTheDocument();
    expect(within(getDataRows()[1]!).getByLabelText(/equation 2 variable/i)).toHaveValue("");
    expect(within(getDataRows()[2]!).getByDisplayValue("C")).toBeInTheDocument();

    fireEvent.contextMenu(yRow());
    await user.click(
      within(screen.getByRole("menu", { name: /equation actions for row 1/i })).getByRole("menuitem", {
        name: /delete/i
      })
    );
    const deleteDialog = screen.getByRole("dialog", { name: /delete y/i });
    expect(deleteDialog).toHaveTextContent(/delete y from this model/i);

    await user.click(within(deleteDialog).getByRole("button", { name: /cancel/i }));
    expect(within(getDataRows()[0]!).getByDisplayValue("Y")).toBeInTheDocument();

    fireEvent.contextMenu(yRow());
    await user.click(
      within(screen.getByRole("menu", { name: /equation actions for row 1/i })).getByRole("menuitem", {
        name: /delete/i
      })
    );
    await user.click(within(screen.getByRole("dialog", { name: /delete y/i })).getByRole("button", {
      name: /^delete$/i
    }));
    expect(getDataRows()).toHaveLength(3);
    expect(within(getDataRows()[0]!).getByLabelText(/equation 1 variable/i)).toHaveValue("");
    expect(within(getDataRows()[1]!).getByDisplayValue("C")).toBeInTheDocument();
  });

  it("opens the row context menu when right-clicking equation inputs", () => {
    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={vi.fn()}
        parameterNames={[]}
      />
    );

    fireEvent.contextMenu(screen.getByRole("textbox", { name: /equation 1 variable/i }));

    expect(screen.getByRole("menu", { name: /equation actions for row 1/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^add equation$/i })).toBeInTheDocument();
  });

  it("opens the variable unit status dialog from the footer Check units button", () => {
    const onSelectVariable = vi.fn();
    const variableUnitMetadata = new Map([
      ["C", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }],
      ["I", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }]
    ]);

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={vi.fn()}
        onSelectVariable={onSelectVariable}
        parameterNames={[]}
        variableUnitMetadata={variableUnitMetadata}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /check variable unit status/i }));

    const dialog = screen.getByRole("dialog", { name: /variable unit status/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/1 of 1 variable need attention/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Y" })).toBeInTheDocument();
    expect(within(dialog).getByText("Untagged")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Y" }));
    expect(onSelectVariable).toHaveBeenCalledWith("Y");
  });

  it("applies unit edits from the variable unit status dialog", () => {
    const onChange = vi.fn();
    const variableUnitMetadata = new Map([
      ["C", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }],
      ["I", { stockFlow: "flow" as const, signature: { money: 1, time: -1 } }]
    ]);

    render(
      <EquationGridEditor
        equations={[{ id: "eq-y", name: "Y", expression: "C + I" }]}
        issues={{}}
        onChange={onChange}
        parameterNames={[]}
        variableUnitMetadata={variableUnitMetadata}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /check variable unit status/i }));

    const dialog = screen.getByRole("dialog", { name: /variable unit status/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /apply inferred units/i }));

    fireEvent.click(within(dialog).getByRole("button", { name: /apply changes/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "eq-y",
        name: "Y",
        expression: "C + I",
        unitMeta: { signature: { money: 1, time: -1 } }
      })
    ]);
  });
});
