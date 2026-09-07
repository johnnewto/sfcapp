// @vitest-environment jsdom

import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { notebookHasUnsavedChanges, isNotebookNavigationLoadLabel } from "../src/notebook/notebookAppHelpers";
import { App, clickCellToolsItem, screen, setupAppTestEnv, userEvent } from "./appTestUtils";

setupAppTestEnv();

describe("notebookHasUnsavedChanges", () => {
  it("returns true when the notebook session is unnamed", () => {
    expect(
      notebookHasUnsavedChanges({
        hasEditHistory: false,
        hasImportPreview: false,
        hasPendingImportTextChanges: false,
        isUnnamedNotebookSession: true
      })
    ).toBe(true);
  });

  it("returns true when import text is pending", () => {
    expect(
      notebookHasUnsavedChanges({
        hasEditHistory: false,
        hasImportPreview: false,
        hasPendingImportTextChanges: true,
        isUnnamedNotebookSession: false
      })
    ).toBe(true);
  });

  it("ignores journal edits when a version session is autosaving", () => {
    expect(
      notebookHasUnsavedChanges({
        hasEditHistory: true,
        hasImportPreview: false,
        hasPendingImportTextChanges: false,
        isUnnamedNotebookSession: false,
        hasAutosavedVersionSession: true
      })
    ).toBe(false);
  });

  it("still treats journal edits as unsaved without a version session", () => {
    expect(
      notebookHasUnsavedChanges({
        hasEditHistory: true,
        hasImportPreview: false,
        hasPendingImportTextChanges: false,
        isUnnamedNotebookSession: false,
        hasAutosavedVersionSession: false
      })
    ).toBe(true);
  });
});

describe("isNotebookNavigationLoadLabel", () => {
  it("recognizes notebook navigation load labels", () => {
    expect(isNotebookNavigationLoadLabel("template load")).toBe(true);
    expect(isNotebookNavigationLoadLabel("variant load")).toBe(true);
    expect(isNotebookNavigationLoadLabel("cell edit")).toBe(false);
    expect(isNotebookNavigationLoadLabel("source import")).toBe(false);
  });
});

describe("unsaved navigation guards", () => {
  it("does not prompt when switching pristine templates without edits", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    window.location.hash = "#/notebook";

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });
    await user.selectOptions(templatePicker, "sim");
    expect(confirm).not.toHaveBeenCalled();

    await user.selectOptions(templatePicker, "bmw");
    expect(confirm).not.toHaveBeenCalled();

    confirm.mockRestore();
  }, 15000);

  it("prompts before switching notebooks from the template picker", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    window.location.hash = "#/notebook";

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });
    expect(templatePicker).toHaveValue("bmw");

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    const yExpression = within(equationsCell).getByDisplayValue("Cs + Is");
    await user.type(yExpression, " ");
    await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

    await user.selectOptions(templatePicker, "sim");

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    confirm.mockRestore();
  }, 15000);

});
