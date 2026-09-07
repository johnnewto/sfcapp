// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DelegatedFormulaTooltip, FORMULA_TOOLTIP_ATTR } from "../src/components/InstantTooltip";
import { highlightFormula } from "../src/components/EquationGridEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    }
  } as DOMRect;
}

describe("DelegatedFormulaTooltip", () => {
  it("keeps the tip beside the token when the pointer moves onto a prime or script", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains("instant-tooltip-bubble")) {
        return rect(0, 0, 120, 32);
      }
      if (this.classList.contains("formula-token")) {
        return rect(80, 240, 48, 18);
      }
      return rect(0, 0, 0, 0);
    });

    render(
      <>
        <DelegatedFormulaTooltip />
        <div>
          {highlightFormula("lag(Y)", new Set(), undefined, new Map([["Y", "Output"]]))}
        </div>
      </>
    );

    const token = document.querySelector(".formula-token") as HTMLElement;
    const prime = token.querySelector("sup.lag-prime") as HTMLElement;
    expect(token.getAttribute(FORMULA_TOOLTIP_ATTR)).toContain("Output");
    expect(prime).toBeTruthy();

    fireEvent.pointerOver(token);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Output");
    expect(tooltip).toHaveStyle({ top: "198px" });

    fireEvent.pointerOver(prime);
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "198px", left: "44px" });
  });
});
