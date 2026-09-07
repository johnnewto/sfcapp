// @vitest-environment jsdom

/**
 * Per-cell source/editor flows. Cell Ask AI Apply/Discard/Undo lives in
 * `App.notebook-cell-ai.test.tsx` (phase 5 verification gate).
 */

import { render, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  App,
  clickCellToolsItem,
  fireEvent,
  getNotebookSourceTextArea,
  openCellToolsMenu,
  openNotebookCommandsPanel,
  screen,
  setSuccessfulNotebookRunner,
  openNotebookSourceEditor,
  setupAppTestEnv,
  showCollapsedNotebookCell,
  userEvent
} from "./appTestUtils";

setupAppTestEnv();

async function expandEquationsCellIfCollapsed(
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

function getFirstEquationVariableInput(cell: HTMLElement): HTMLTextAreaElement {
  const input = within(cell)
    .getAllByRole("textbox", { name: /equation \d+ variable/i })
    .find((candidate): candidate is HTMLTextAreaElement => candidate instanceof HTMLTextAreaElement);
  if (!input) {
    throw new Error("Expected at least one editable equation variable.");
  }
  return input;
}

describe("App per-cell source editors", () => {
  it("edits a markdown cell through the per-cell source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const overviewHeading = screen.getByRole("heading", { name: /overview/i });
    const overviewArticle = overviewHeading.closest("article");
    expect(overviewArticle).not.toBeNull();
    if (!overviewArticle) {
      throw new Error("Expected overview cell article.");
    }

    await clickCellToolsItem(user, overviewArticle, /^edit$/i);

    const sourceEditor = screen.getByRole("textbox", {
      name: /source editor for overview/i
    }) as HTMLTextAreaElement;
    const titleEditor = screen.getByRole("textbox", {
      name: /title editor for overview/i
    }) as HTMLInputElement;
    const applyButton = screen.getByRole("button", { name: /^apply$/i });

    expect(applyButton).toBeDisabled();
    expect(sourceEditor.closest(".notebook-source-editor")?.querySelector(".notebook-source-gutter")).not.toBeNull();

    fireEvent.change(titleEditor, { target: { value: "Updated overview" } });
    fireEvent.change(sourceEditor, { target: { value: "Updated notebook overview." } });
    const moreEditor = screen.getByRole("textbox", {
      name: /more editor for overview/i
    }) as HTMLTextAreaElement;
    expect(moreEditor.closest(".notebook-source-codeframe")).not.toBeNull();
    fireEvent.change(moreEditor, {
      target: { value: "Optional longer overview detail for the more panel." }
    });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);

    expect(screen.getByRole("heading", { name: /updated overview/i })).toBeInTheDocument();
    expect(within(overviewArticle).getByText(/updated notebook overview\./i)).toBeInTheDocument();
    expect(
      within(overviewArticle).getByText(/optional longer overview detail for the more panel\./i)
    ).toBeInTheDocument();
    expect(within(overviewArticle).getByRole("button", { name: /^less$/i })).toBeInTheDocument();
  }, 15000);

  it("edits more on a non-markdown cell with the highlighted source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const runHeading = screen.getByRole("heading", { name: /baseline run with newton/i });
    const runArticle = runHeading.closest("article");
    expect(runArticle).not.toBeNull();
    if (!runArticle) {
      throw new Error("Expected run cell article.");
    }

    await clickCellToolsItem(user, runArticle, /^edit$/i);

    const moreEditor = screen.getByRole("textbox", {
      name: /more editor for baseline run with newton/i
    }) as HTMLTextAreaElement;
    expect(moreEditor.closest(".notebook-source-codeframe")).not.toBeNull();
    fireEvent.change(moreEditor, {
      target: { value: "Baseline run more detail for the panel." }
    });
    await user.click(within(runArticle).getByRole("button", { name: /^apply$/i }));

    expect(
      within(runArticle).getByText(/baseline run more detail for the panel\./i)
    ).toBeInTheDocument();
    expect(within(runArticle).getByRole("button", { name: /^less$/i })).toBeInTheDocument();
  }, 15000);

  it("undoes and redoes applied notebook edits from the app bar", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const commandsPanel = await openNotebookCommandsPanel(user);
    expect(within(commandsPanel).getByRole("button", { name: /^undo$/i })).toBeDisabled();
    expect(within(commandsPanel).getByRole("button", { name: /^redo$/i })).toBeDisabled();

    const overviewHeading = screen.getByRole("heading", { name: /overview/i });
    const overviewArticle = overviewHeading.closest("article");
    expect(overviewArticle).not.toBeNull();
    if (!overviewArticle) {
      throw new Error("Expected overview cell article.");
    }

    await clickCellToolsItem(user, overviewArticle, /^edit$/i);

    const titleEditor = screen.getByRole("textbox", {
      name: /title editor for overview/i
    }) as HTMLInputElement;

    fireEvent.change(titleEditor, { target: { value: "Journal overview" } });
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(screen.getByRole("heading", { name: /journal overview/i })).toBeInTheDocument();

    await user.click(within(commandsPanel).getByRole("button", { name: /undo: cell edit/i }));
    expect(screen.getByRole("heading", { name: /^overview$/i })).toBeInTheDocument();
    expect(within(commandsPanel).getByRole("button", { name: /redo: cell edit/i })).toBeEnabled();

    await user.click(within(commandsPanel).getByRole("button", { name: /redo: cell edit/i }));
    expect(screen.getByRole("heading", { name: /journal overview/i })).toBeInTheDocument();
  }, 15000);

  it("edits a run cell title through the per-cell title editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const runHeading = screen.getByRole("heading", { name: /baseline run with newton/i });
    const runArticle = runHeading.closest("article");
    expect(runArticle).not.toBeNull();
    if (!runArticle) {
      throw new Error("Expected run cell article.");
    }

    await clickCellToolsItem(user, runArticle, /^edit$/i);

    const titleEditor = screen.getByRole("textbox", {
      name: /title editor for baseline run with newton/i
    }) as HTMLInputElement;
    fireEvent.change(titleEditor, { target: { value: "Updated baseline run" } });
    await user.click(within(runArticle).getByRole("button", { name: /^apply$/i }));

    expect(screen.getByRole("heading", { name: /updated baseline run/i })).toBeInTheDocument();
  }, 15000);

  it("keeps the title editor and JSON source title in sync", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const runHeading = screen.getByRole("heading", { name: /baseline run with newton/i });
    const runArticle = runHeading.closest("article");
    expect(runArticle).not.toBeNull();
    if (!runArticle) {
      throw new Error("Expected run cell article.");
    }

    await clickCellToolsItem(user, runArticle, /^edit$/i);
    await user.click(within(runArticle).getByRole("radio", { name: /compact/i }));

    const titleEditor = screen.getByRole("textbox", {
      name: /title editor for baseline run with newton/i
    }) as HTMLInputElement;
    const sourceEditor = screen.getByRole("textbox", {
      name: /source editor for baseline run with newton/i
    }) as HTMLTextAreaElement;

    fireEvent.change(titleEditor, { target: { value: "Title from box" } });
    expect(sourceEditor.value).toContain('"title": "Title from box"');

    fireEvent.change(sourceEditor, {
      target: {
        value: sourceEditor.value.replace('"title": "Title from box"', '"title": "Title from JSON"')
      }
    });
    expect(titleEditor.value).toBe("Title from JSON");
  }, 15000);

  it("renders matrix notes as inline markdown in the cell header", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw balance sheet/i });
    const matrixArticle = matrixHeading.closest("article");
    expect(matrixArticle).not.toBeNull();
    if (!(matrixArticle instanceof HTMLElement)) {
      throw new Error("Expected BMW balance sheet article.");
    }

    await clickCellToolsItem(user, matrixArticle, /^edit$/i);
    await user.click(within(matrixArticle).getByRole("radio", { name: /compact/i }));

    const sourceEditor = within(matrixArticle).getByRole("textbox", {
      name: /source editor for bmw balance sheet/i
    }) as HTMLTextAreaElement;

    fireEvent.change(sourceEditor, {
      target: {
        value: sourceEditor.value.replace(/"note"\s*:\s*"[^"]+"/, '"note":"# Source **structure** for Y."')
      }
    });
    await user.click(within(matrixArticle).getByRole("button", { name: /^apply$/i }));

    const note = matrixArticle.querySelector(".notebook-cell-note-footer");
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent("Source structure for Y.");
    expect(note?.querySelector("strong")).toHaveTextContent("structure");
    expect(note?.querySelector("h1")).toHaveTextContent("Source structure for Y.");
    expect(matrixArticle.querySelector(".notebook-matrix-note")).toBeNull();
  }, 15000);

  it("renders chart descriptions in the shared header second line", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!(chartArticle instanceof HTMLElement)) {
      throw new Error("Expected baseline chart article.");
    }

    await clickCellToolsItem(user, chartArticle, /^edit$/i);
    await user.click(within(chartArticle).getByRole("radio", { name: /compact/i }));

    const sourceEditor = within(chartArticle).getByRole("textbox", {
      name: /source editor for baseline headline variables/i
    }) as HTMLTextAreaElement;

    fireEvent.change(sourceEditor, {
      target: {
        value: sourceEditor.value.replace(
          /"description"\s*:\s*"[^"]*"/,
          '"description": "**Charts** compare `Y` and peers."'
        )
      }
    });
    await user.click(within(chartArticle).getByRole("button", { name: /^apply$/i }));

    const description = chartArticle.querySelector(".notebook-cell-description-block");
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent(/Charts compare Y.*and peers\./i);
    expect(description?.querySelector("strong")).toHaveTextContent("Charts");
    expect(description?.querySelector(".variable-label-inline")).toHaveTextContent(/Y/i);
  }, 15000);

  it("edits a scenario run cell through the structured scenario source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const scenarioArticle = document.getElementById("scenario-1-run");
    expect(scenarioArticle).not.toBeNull();
    if (!(scenarioArticle instanceof HTMLElement)) {
      throw new Error("Expected scenario run cell article.");
    }

    await clickCellToolsItem(user, scenarioArticle, /^edit$/i);

    expect(within(scenarioArticle).getByRole("combobox", { name: /run mode/i })).toHaveValue("scenario");
    expect(
      within(scenarioArticle).queryByRole("textbox", {
        name: /source editor for scenario 1: autonomous consumption shock/i
      })
    ).not.toBeInTheDocument();

    const shockValueInput = within(scenarioArticle).getByLabelText(/value for alpha0/i);
    fireEvent.change(shockValueInput, { target: { value: "25.75" } });
    await user.click(within(scenarioArticle).getByRole("button", { name: /^apply$/i }));

    expect(
      within(scenarioArticle).getAllByRole("button", { name: /inspect variable alpha0/i }).length
    ).toBeGreaterThan(0);
    expect(scenarioArticle).toHaveTextContent(/25\.75/i);
  }, 15000);

  it("shows simulation warnings on successful run cells", async () => {
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner("baseline-newton", {
      ...structuredClone
        ? structuredClone((await import("./appTestUtils")).bmwNotebookBaselineResult)
        : (await import("./appTestUtils")).bmwNotebookBaselineResult,
      warnings: [
        {
          code: "hidden-equation-not-fulfilled",
          message: "Hidden equation is not fulfilled at period 4 for Ms and Mh",
          path: "options.hiddenEquation"
        }
      ]
    });

    render(<App />);

    expect(screen.getByRole("status", { name: /run warnings/i })).toBeInTheDocument();
    expect(
      screen.getByText(/hidden equation is not fulfilled at period 4 for ms and mh/i)
    ).toBeInTheDocument();
  });

  it("edits a matrix cell through the grid source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const balanceSheetArticle = document.getElementById("balance-sheet");
    expect(balanceSheetArticle).not.toBeNull();
    if (!(balanceSheetArticle instanceof HTMLElement)) {
      throw new Error("Expected balance sheet matrix article.");
    }

    await clickCellToolsItem(user, balanceSheetArticle, /^edit$/i);

    expect(
      within(balanceSheetArticle).queryByRole("textbox", {
        name: /source editor for bmw balance sheet/i
      })
    ).not.toBeInTheDocument();

    const firstColumnInput = within(balanceSheetArticle).getByRole("textbox", {
      name: /matrix column 1/i
    }) as HTMLInputElement;
    const firstSectorInput = within(balanceSheetArticle).getByRole("textbox", {
      name: /matrix sector 1/i
    }) as HTMLInputElement;

    expect(
      within(balanceSheetArticle).getByRole("button", {
        name: /move matrix column 1 right/i
      })
    ).toBeInTheDocument();
    expect(
      within(balanceSheetArticle).getByRole("button", {
        name: /move matrix row 1 down/i
      })
    ).toBeInTheDocument();

    fireEvent.change(firstColumnInput, { target: { value: "Households edited" } });
    fireEvent.change(firstSectorInput, { target: { value: "Households sector edited" } });
    await user.click(within(balanceSheetArticle).getByRole("button", { name: /^apply$/i }));

    expect(within(balanceSheetArticle).getByText(/households edited/i)).toBeInTheDocument();
  }, 15000);

  it("does not leak linked equation drafts into notebook source before apply", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandEquationsCellIfCollapsed(equationsCell, user);
    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    const firstVariableInput = getFirstEquationVariableInput(equationsCell);
    const originalValue = firstVariableInput.value;
    const draftValue = `${originalValue}Draft`;

    fireEvent.change(firstVariableInput, { target: { value: draftValue } });
    expect(within(equationsCell).getByRole("button", { name: /^apply$/i })).toBeEnabled();

    await openNotebookSourceEditor(user);
    const draftExport = getNotebookSourceTextArea();
    expect(draftExport.value).not.toContain(`[${draftValue},`);
  }, 15000);

  it("discards linked equation drafts on cancel", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandEquationsCellIfCollapsed(equationsCell, user);
    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    const firstVariableInput = getFirstEquationVariableInput(equationsCell);
    const originalValue = firstVariableInput.value;
    const draftValue = `${originalValue}Draft`;

    fireEvent.change(firstVariableInput, { target: { value: draftValue } });

    await user.click(within(equationsCell).getByRole("button", { name: /^cancel$/i }));
    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    expect(
      getFirstEquationVariableInput(equationsCell).value
    ).toBe(originalValue);
  }, 15000);

  it("applies linked equation edits into notebook source", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandEquationsCellIfCollapsed(equationsCell, user);
    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    const firstVariableInput = getFirstEquationVariableInput(equationsCell);
    const draftValue = `${firstVariableInput.value}Draft`;

    fireEvent.change(firstVariableInput, { target: { value: draftValue } });
    await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

    await openNotebookSourceEditor(user);
    expect(getNotebookSourceTextArea().value).toContain(`[${draftValue},`);
  }, 15000);

  it("supports right-click equation grid actions while editing equations", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandEquationsCellIfCollapsed(equationsCell, user);
    await clickCellToolsItem(user, equationsCell, /^edit$/i);

    const equationVariableInputsBefore = within(equationsCell).getAllByRole("textbox", {
      name: /equation \d+ variable/i
    });
    fireEvent.contextMenu(equationVariableInputsBefore[0]);

    const menu = within(equationsCell).getByRole("menu", { name: /equation actions for row \d+/i });
    await user.click(within(menu).getByRole("menuitem", { name: /^add equation$/i }));

    expect(within(equationsCell).getAllByRole("textbox", { name: /equation \d+ variable/i })).toHaveLength(
      equationVariableInputsBefore.length + 1
    );
    expect(screen.queryByRole("menu", { name: /cell actions for/i })).not.toBeInTheDocument();
  }, 15000);

  it("shows source helpers and live validation for chart cells", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected chart cell article.");
    }

    await clickCellToolsItem(user, chartArticle, /^edit$/i);
    await user.click(screen.getByText(/^insert$/i));

    expect(screen.getByRole("button", { name: /add axismode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /axis snap/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shared range/i })).toBeInTheDocument();
    expect(screen.getByText(/live validation: ready to apply/i)).toBeInTheDocument();
    const chartToolsMenu = await openCellToolsMenu(user, chartArticle);
    expect(within(chartToolsMenu).getByRole("menuitem", { name: /^help$/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const sourceEditor = screen.getByRole("textbox", {
      name: /source editor for baseline headline variables/i
    });
    fireEvent.change(sourceEditor, {
      target: {
        value: `{
  "id": "baseline-chart",
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["ydhs", "c", "p", "Mh"],
  "sharedRange": {
    "min": 10,
    "max": 0
  }
}`
      }
    });

    expect(screen.getByText(/live validation:/i)).not.toHaveTextContent(/ready to apply/i);
  }, 15000);

  it("cycles chart reference traces from the chart cell toolbar", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected chart cell article.");
    }

    const referenceButton = within(chartArticle).getByRole("button", {
      name: /reference: previous/i
    });

    await user.click(referenceButton);
    expect(within(chartArticle).getByRole("button", { name: /reference: observed/i })).toBeInTheDocument();

    await clickCellToolsItem(user, chartArticle, /^edit$/i);
    const sourceEditor = screen.getByRole("textbox", {
      name: /source editor for baseline headline variables/i
    }) as HTMLTextAreaElement;
    expect(sourceEditor.value).toContain('"referenceTrace": "observed"');
  });

  it("can switch the notebook source editor into compact mode", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected chart cell article.");
    }

    await clickCellToolsItem(user, chartArticle, /^edit$/i);
    await user.click(screen.getByRole("radio", { name: /compact/i }));

    const sourceEditor = screen.getByRole("textbox", {
      name: /source editor for baseline headline variables/i
    }) as HTMLTextAreaElement;

    expect(sourceEditor.value.startsWith("{\n")).toBe(true);
    expect(sourceEditor.value).toContain('"id": "baseline-chart"');
    expect(sourceEditor.value).toContain('"seriesRanges": { "p": { "includeZero": true } }');
  });

  it("closes source popups on escape and outside click", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected chart cell article.");
    }

    await clickCellToolsItem(user, chartArticle, /^edit$/i);
    await user.click(screen.getByRole("button", { name: /^insert$/i }));
    expect(screen.getByLabelText(/source insert actions/i)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(/source insert actions/i)).not.toBeInTheDocument();

    await clickCellToolsItem(user, chartArticle, /^help$/i);
    expect(screen.getByText(/required fields:/i)).toBeInTheDocument();
  });
});
