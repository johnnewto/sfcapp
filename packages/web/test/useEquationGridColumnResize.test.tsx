// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EQUATION_GRID_EXPRESSION_WIDTH_STORAGE_KEY,
  EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY,
  useEquationGridColumnResize
} from "../src/hooks/useEquationGridColumnResize";

afterEach(() => {
  cleanup();
  document.body.classList.remove("panel-splitter-body-lock");
  window.localStorage.clear();
});

function EquationGridResizeFixture({
  isEmbedded = false,
  syncGroup,
  label = "Equations"
}: {
  isEmbedded?: boolean;
  syncGroup?: string;
  label?: string;
} = {}) {
  const columnResize = useEquationGridColumnResize({ isEmbedded, syncGroup });

  return (
    <div
      ref={columnResize.shellRef}
      className={`equation-grid-shell${columnResize.shellClassName ? ` ${columnResize.shellClassName}` : ""}`.trim()}
      data-testid={label}
      style={{ width: 960 }}
    >
      <div className="equation-grid-header" role="row">
        <span>#</span>
        <span ref={columnResize.variableHeaderRef}>Variable</span>
        <span ref={columnResize.expressionHeaderRef}>Expression</span>
        <span>Role</span>
        <span>Description</span>
        <span>Status</span>
        <span />
        <div {...columnResize.variableResizeHandleProps} />
        <div {...columnResize.expressionResizeHandleProps} />
      </div>
    </div>
  );
}

describe("useEquationGridColumnResize", () => {
  it("updates variable column width while dragging", () => {
    const { container } = render(<EquationGridResizeFixture />);
    const shell = container.querySelector(".equation-grid-shell");
    const separator = screen.getByRole("separator", { name: /resize variable column/i });

    expect(shell).toBeInstanceOf(HTMLDivElement);
    if (!(shell instanceof HTMLDivElement)) {
      throw new Error("Expected equation grid shell.");
    }

    expect(shell.style.getPropertyValue("--eq-col-variable-width")).toBe("140px");
    expect(shell.style.getPropertyValue("--eq-col-expression-width")).toBe("320px");

    fireEvent.mouseDown(separator, { button: 0, clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 360 });

    expect(shell.style.getPropertyValue("--eq-col-variable-width")).toBe("200px");
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(document.body).toHaveClass("panel-splitter-body-lock");

    fireEvent.mouseUp(document);

    expect(document.body).not.toHaveClass("panel-splitter-body-lock");
    expect(window.localStorage.getItem(EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY.workspace)).toBe(
      "200"
    );
  });

  it("updates expression column width while dragging", () => {
    const { container } = render(<EquationGridResizeFixture />);
    const shell = container.querySelector(".equation-grid-shell");
    const separator = screen.getByRole("separator", { name: /resize expression column/i });

    expect(shell).toBeInstanceOf(HTMLDivElement);
    if (!(shell instanceof HTMLDivElement)) {
      throw new Error("Expected equation grid shell.");
    }

    fireEvent.mouseDown(separator, { button: 0, clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 560 });
    fireEvent.mouseUp(document);

    expect(shell.style.getPropertyValue("--eq-col-expression-width")).toBe("380px");
    expect(separator).toHaveAttribute("aria-valuenow", "380");
    expect(
      window.localStorage.getItem(EQUATION_GRID_EXPRESSION_WIDTH_STORAGE_KEY.workspace)
    ).toBe("380");
  });

  it("uses separate storage for embedded grids", () => {
    const { unmount } = render(<EquationGridResizeFixture isEmbedded />);
    const separator = screen.getByRole("separator", { name: /resize variable column/i });

    fireEvent.mouseDown(separator, { button: 0, clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 330 });
    fireEvent.mouseUp(document);

    expect(
      window.localStorage.getItem(EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY.embedded)
    ).toBe("190");
    expect(
      window.localStorage.getItem(EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY.workspace)
    ).toBeNull();

    unmount();
    cleanup();

    render(<EquationGridResizeFixture />);
    const workspaceShell = document.querySelector(".equation-grid-shell");
    expect(workspaceShell).toHaveStyle({ "--eq-col-variable-width": "140px" });
  });

  it("supports keyboard resizing", () => {
    const { container } = render(<EquationGridResizeFixture />);
    const shell = container.querySelector(".equation-grid-shell");
    const separator = screen.getByRole("separator", { name: /resize variable column/i });

    expect(shell).toBeInstanceOf(HTMLDivElement);
    if (!(shell instanceof HTMLDivElement)) {
      throw new Error("Expected equation grid shell.");
    }

    separator.focus();
    fireEvent.keyDown(separator, { key: "ArrowRight" });

    expect(shell.style.getPropertyValue("--eq-col-variable-width")).toBe("148px");
    expect(separator).toHaveAttribute("aria-valuenow", "148");
  });

  it("syncs live widths across instances in the same sync group", () => {
    render(
      <>
        <EquationGridResizeFixture isEmbedded syncGroup="abm-equations" label="grid-a" />
        <EquationGridResizeFixture isEmbedded syncGroup="abm-equations" label="grid-b" />
      </>
    );

    const shellA = screen.getByTestId("grid-a");
    const shellB = screen.getByTestId("grid-b");
    const separatorA = within(shellA).getByRole("separator", { name: /resize variable column/i });

    fireEvent.mouseDown(separatorA, { button: 0, clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 360 });
    fireEvent.mouseUp(document);

    expect(shellA.style.getPropertyValue("--eq-col-variable-width")).toBe("220px");
    expect(shellB.style.getPropertyValue("--eq-col-variable-width")).toBe("220px");
  });
});
