// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VariableMathLabel } from "../src/components/VariableMathLabel";

afterEach(() => {
  cleanup();
});

describe("VariableMathLabel", () => {
  it("renders grouped superscripts and subscripts locally", () => {
    render(<VariableMathLabel name="yd^{HS}_1" />);

    expect(screen.getByText("HS", { selector: "sup" })).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "sub" })).toBeInTheDocument();
  });

  it("renders Greek parameter prefixes as symbols with suffix subscripts", () => {
    render(<VariableMathLabel name="lambda10" />);

    expect(screen.getByText("λ")).toBeInTheDocument();
    expect(screen.getByText("10", { selector: "sub" })).toBeInTheDocument();
  });

  it("renders Greek parameters with digit-and-letter class suffixes", () => {
    render(
      <>
        <VariableMathLabel name="alpha1p" />
        <VariableMathLabel name="alpha2r" />
        <VariableMathLabel name="alpha0r" />
      </>
    );

    expect(screen.getAllByText("α")).toHaveLength(3);
    expect(screen.getByText("1p", { selector: "sub" })).toBeInTheDocument();
    expect(screen.getByText("2r", { selector: "sub" })).toBeInTheDocument();
    expect(screen.getByText("0r", { selector: "sub" })).toBeInTheDocument();
  });

  it("renders standalone Greek parameter names as symbols", () => {
    render(<VariableMathLabel name="theta" />);

    expect(screen.getByText("θ")).toBeInTheDocument();
  });

  it("does not treat short Greek names as prefixes for ordinary words", () => {
    render(<VariableMathLabel name="pin" />);

    expect(screen.getByText("pin")).toBeInTheDocument();
  });

  it("renders capitalized Greek parameter names as uppercase symbols", () => {
    render(<VariableMathLabel name="Delta1" />);

    expect(screen.getByText("Δ")).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "sub" })).toBeInTheDocument();
  });

  it("renders eps aliases as epsilon symbols", () => {
    render(
      <>
        <VariableMathLabel name="eps2" />
        <VariableMathLabel name="Eps3" />
      </>
    );

    expect(screen.getByText("ε")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "sub" })).toBeInTheDocument();
    expect(screen.getByText("Ε")).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "sub" })).toBeInTheDocument();
  });

  it("does not treat capitalized Greek names as letter prefixes", () => {
    render(<VariableMathLabel name="DeltaK" />);

    expect(screen.getByText("DeltaK")).toBeInTheDocument();
  });

  it("renders lag() and [-1] as a primed variable and * as a bullet", () => {
    render(<VariableMathLabel name="lag(r^F) * B[-1]" />);

    const label = document.querySelector(".variable-math-label");
    expect(label?.textContent).toContain("•");
    expect(label?.textContent).not.toContain("lag");
    expect(label?.textContent).not.toContain("*");
    expect(screen.getByText("F", { selector: "sup" })).toBeInTheDocument();
    expect(screen.getAllByText("'", { selector: "sup" })).toHaveLength(2);
  });
});
