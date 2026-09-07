// @vitest-environment jsdom

import { render, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  App,
  fireEvent,
  expectVariableInspectorOpen,
  setSuccessfulNotebookRunner,
  setupAppTestEnv,
  showCollapsedNotebookCell,
  screen,
  userEvent
} from "./appTestUtils";

setupAppTestEnv();

async function expandCellIfCollapsed(
  cell: HTMLElement,
  user: { click: (element: Element) => Promise<unknown> }
): Promise<void> {
  if (within(cell).queryByRole("table", { name: /model equations/i })) {
    return;
  }

  const shown = await showCollapsedNotebookCell(user, cell);
  if (!shown) {
    await user.click(screen.getAllByRole("button", { name: /^expand all$/i })[0]);
  }

  await waitFor(() => {
    expect(within(cell).getByRole("table", { name: /model equations/i })).toBeInTheDocument();
  });
}

describe("Notebook variable inspector floating pin", () => {
  it("pins the inspector into a floating panel and docks it again", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected BMW equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);
    const yRowButton = within(equationsCell).getByRole("button", { name: /^Y\b/i });
    fireEvent.click(yRowButton);
    await expectVariableInspectorOpen();

    const railInspector = document.getElementById("notebook-inspect-panel");
    expect(railInspector).not.toBeNull();
    if (!(railInspector instanceof HTMLElement)) {
      throw new Error("Expected variable inspector in the rail.");
    }

    await user.click(within(railInspector).getByRole("button", { name: /pin in floating panel/i }));

    const floatingDialog = await screen.findByRole("dialog", { name: "Variable inspector" });
    expect(floatingDialog).toBeInTheDocument();
    expect(within(floatingDialog).getByRole("heading", { name: /^Y\b/i })).toBeInTheDocument();
    expect(document.getElementById("notebook-inspect-pinned-placeholder")).not.toBeNull();
    expect(document.querySelector(".notebook-rail #notebook-inspect-panel")).toBeNull();

    await user.click(within(floatingDialog).getByRole("button", { name: /^dock inspector$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Variable inspector" })).not.toBeInTheDocument();
    });
    await expectVariableInspectorOpen();
    expect(document.getElementById("notebook-inspect-pinned-placeholder")).toBeNull();
    expect(document.querySelector(".notebook-rail #notebook-inspect-panel")).not.toBeNull();
  }, 15000);
});
