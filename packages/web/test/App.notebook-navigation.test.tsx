// @vitest-environment jsdom

import { render, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  App,
  fireEvent,
  getFormulaTokensByText,
  notebookRunnerMock,
  openNotebookCommandsPanel,
  screen,
  clickForDeferredVariableInspect,
  expectVariableInspectorOpen,
  setSuccessfulNotebookRunner,
  setupAppTestEnv,
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

  const showButton = within(cell).queryByRole("button", { name: /^show$/i });
  if (showButton) {
    await user.click(showButton);
  } else {
    await user.click(screen.getAllByRole("button", { name: /^expand all$/i })[0]);
  }

  await waitFor(() => {
    expect(within(cell).getByRole("table", { name: /model equations/i })).toBeInTheDocument();
  });
}

function openCellContextMenu(cell: HTMLElement): void {
  const contextMenuTarget = cell.querySelector(".notebook-cell-content");
  if (!(contextMenuTarget instanceof HTMLElement)) {
    throw new Error("Expected notebook cell content.");
  }
  fireEvent.contextMenu(contextMenuTarget);
}

function getEquationRowButton(cell: HTMLElement, name: RegExp): HTMLElement {
  const button = within(cell)
    .getAllByRole("button", { name })
    .find((candidate): candidate is HTMLElement => {
      const row = candidate.closest('[role="row"]');
      return row instanceof HTMLElement && !row.classList.contains("notebook-model-view-row-section");
    });
  if (!button) {
    throw new Error(`Expected equation row button matching ${name}.`);
  }
  return button;
}

describe("App notebook navigation and inspection", () => {
  it("renders the BMW notebook route and equation details after expanding the model cell", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });

    expect(templatePicker).toHaveValue("bmw");
    expect(within(templatePicker).getByRole("option", { name: /^BMW$/i })).toBeInTheDocument();
    expect(within(templatePicker).getByRole("option", { name: /^SIM$/i })).toBeInTheDocument();
    const commandsPanel = await openNotebookCommandsPanel(user);
    expect(within(commandsPanel).getByText(/bmw browser notebook/i)).toBeInTheDocument();
    expect(within(commandsPanel).getByRole("button", { name: /^run all$/i })).toBeInTheDocument();
    expect(within(commandsPanel).getByRole("button", { name: /validate/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /bmw balance sheet/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /bmw transactions-flow matrix/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /bmw transaction flow sequence/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /baseline run with newton/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^hide$/i }).length).toBeGreaterThan(0);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);

    expect(within(equationsCell).getAllByText("Variable").length).toBeGreaterThan(0);
    expect(within(equationsCell).getAllByText("Expression").length).toBeGreaterThan(0);

    const yToken = within(equationsCell)
      .getAllByText("Y")
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.classList.contains("formula-token")
      );
    expect(yToken).toBeDefined();
    if (!yToken) {
      throw new Error("Expected formula token for Y");
    }

    fireEvent.mouseEnter(yToken);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Income = GDP");
  }, 10000);

  it("shows unnamed in the template picker after a template edit", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });
    expect(templatePicker).toHaveValue("bmw");

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);
    const yRowButton = getEquationRowButton(equationsCell, /^Y\b/i);
    const yRow = yRowButton.closest('[role="row"]');
    if (!(yRow instanceof HTMLElement)) {
      throw new Error("Expected Y equation row.");
    }
    const yExpression = within(yRow)
      .getAllByTitle("Double-click to edit")
      .find((node) => node.classList.contains("notebook-model-view-expression"));
    if (!yExpression) {
      throw new Error("Expected Y expression cell.");
    }
    fireEvent.doubleClick(yExpression);
    const expressionInput = within(equationsCell).getByRole("textbox", {
      name: /equation \d+ expression/i
    });
    fireEvent.change(expressionInput, { target: { value: "Cs + Is + 1" } });
    await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(templatePicker).toHaveValue("__unnamed__");
    });
    expect(within(templatePicker).getByRole("option", { name: /unnamed \(bmw\)/i })).toBeInTheDocument();
  }, 10000);

  it("shows a larger equation syntax dialog from help while editing equations", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);
    await user.click(within(equationsCell).getByRole("button", { name: /^edit$/i }));
    await user.click(within(equationsCell).getByRole("button", { name: /^help$/i }));

    const dialog = screen.getByRole("dialog", { name: /equation syntax/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/core forms/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/I\(flowExpr\)/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/stock-flow guidance/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/equation roles/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Auto/)).toBeInTheDocument();
    expect(within(dialog).getByText(/inferred from the equation structure and description/i)).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole("dialog", { name: /equation syntax/i })).not.toBeInTheDocument();
  }, 15000);

  it("can show external values inside the notebook equations cell expression view", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);

    expect(getFormulaTokensByText(equationsCell, "α0")).toHaveLength(0);
    expect(getFormulaTokensByText(equationsCell, "α1")).toHaveLength(0);
    expect(
      within(equationsCell)
        .getAllByText("20")
        .some((node) => node.className.includes("formula-token"))
    ).toBe(true);
    expect(
      within(equationsCell)
        .getAllByText("0.75")
        .some((node) => node.className.includes("formula-token"))
    ).toBe(true);

    await user.click(within(equationsCell).getByRole("button", { name: /show external names/i }));

    expect(getFormulaTokensByText(equationsCell, "α0").length).toBeGreaterThan(0);
    expect(getFormulaTokensByText(equationsCell, "α1").length).toBeGreaterThan(0);

    await user.click(within(equationsCell).getByRole("button", { name: /show external values/i }));

    expect(getFormulaTokensByText(equationsCell, "α0")).toHaveLength(0);
    expect(getFormulaTokensByText(equationsCell, "α1")).toHaveLength(0);
  });

  it("dims other notebook cells while a linked editor is active", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!(equationsCell instanceof HTMLElement)) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);
    await user.click(within(equationsCell).getByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "false");

    const notebookSheet = screen.getByRole("region", { name: /notebook sheet/i });
    expect(notebookSheet.className).toContain("notebook-has-active-editor");
    expect(equationsCell.className).toContain("notebook-cell-is-active-editor");
    await user.click(screen.getByRole("tab", { name: /^contents$/i }));
    const activeOutlineItem = screen
      .getAllByRole("button", { name: /bmw model/i })
      .map((button) => button.closest("li"))
      .find((item): item is HTMLLIElement => item instanceof HTMLLIElement);
    expect(activeOutlineItem?.className).toContain("notebook-outline-item-is-active");

    await user.click(screen.getByRole("tab", { name: /^editor$/i }));
    expect(document.querySelector(".notebook-source-selected-cell-line")).toBeNull();

    await user.click(within(equationsCell).getByRole("button", { name: /^cancel$/i }));
    expect(notebookSheet.className).not.toContain("notebook-has-active-editor");
    expect(equationsCell.className).not.toContain("notebook-cell-is-active-editor");
  }, 15000);

  it("auto-runs notebook cells on load", async () => {
    window.location.hash = "#/notebook";

    render(<App />);

    await waitFor(() => {
      expect(notebookRunnerMock.runAll).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a toast with wall time after running all notebook cells", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    notebookRunnerMock.runAll.mockClear();

    const commandsPanel = await openNotebookCommandsPanel(user);
    await user.click(within(commandsPanel).getByRole("button", { name: /^run all$/i }));

    await waitFor(() => {
      expect(notebookRunnerMock.runAll).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/ran all notebook cells in /i)).toBeInTheDocument();
    });
  });

  it(
    "supports right-click cell actions for moving and deleting notebook cells",
    async () => {
      const user = userEvent.setup();
      window.location.hash = "#/notebook";

      render(<App />);

      expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("button", { name: /bmw model/i }).length).toBeGreaterThan(0);

      const introCell = document.getElementById("intro");
      expect(introCell).toBeInstanceOf(HTMLElement);
      if (!(introCell instanceof HTMLElement)) {
        throw new Error("Expected intro notebook cell article.");
      }

      openCellContextMenu(introCell);

      const initialMenu = screen.getByRole("menu", { name: /cell actions for overview/i });
      expect(within(initialMenu).getByRole("menuitem", { name: /move up/i })).toBeDisabled();

      await user.click(within(initialMenu).getByRole("menuitem", { name: /move down/i }));

      const cellsAfterMove = Array.from(document.querySelectorAll(".notebook-canvas article"));
      expect(cellsAfterMove[1]).toHaveAttribute("id", "intro");

      const movedIntroCell = document.getElementById("intro");
      expect(movedIntroCell).toBeInstanceOf(HTMLElement);
      if (!(movedIntroCell instanceof HTMLElement)) {
        throw new Error("Expected moved intro notebook cell article.");
      }

      openCellContextMenu(movedIntroCell);

      const movedMenu = screen.getByRole("menu", { name: /cell actions for overview/i });
      await user.click(within(movedMenu).getByRole("menuitem", { name: /delete/i }));
      const deleteDialog = screen.getByRole("dialog", { name: /delete overview/i });
      expect(deleteDialog).toHaveTextContent(/delete overview from this notebook/i);

      await user.click(within(deleteDialog).getByRole("button", { name: /cancel/i }));
      expect(document.getElementById("intro")).not.toBeNull();

      openCellContextMenu(movedIntroCell);
      await user.click(within(screen.getByRole("menu", { name: /cell actions for overview/i })).getByRole("menuitem", { name: /delete/i }));
      await user.click(within(screen.getByRole("dialog", { name: /delete overview/i })).getByRole("button", { name: /^delete$/i }));

      expect(document.getElementById("intro")).toBeNull();
      expect(screen.queryByRole("heading", { name: /^overview$/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: /^assistant$/i }));
      expect(screen.queryByRole("button", { name: /bmw model/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: /^contents$/i }));
      expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("button", { name: /bmw model/i }).length).toBeGreaterThan(0);
    },
    15000
  );

  it("supports adding notebook cells from the right-click type picker", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const introCell = document.getElementById("intro");
    expect(introCell).toBeInstanceOf(HTMLElement);
    if (!(introCell instanceof HTMLElement)) {
      throw new Error("Expected intro notebook cell article.");
    }

    openCellContextMenu(introCell);
    const introMenu = screen.getByRole("menu", { name: /cell actions for overview/i });

    fireEvent.mouseEnter(within(introMenu).getByRole("menuitem", { name: /add cell/i }));
    const introInsertMenu = screen.getByRole("menu", { name: /add cell below options/i });

    expect(within(introInsertMenu).getByRole("menuitem", { name: /^run$/i })).toBeEnabled();
    expect(within(introInsertMenu).getByRole("menuitem", { name: /^chart$/i })).toBeEnabled();

    await user.click(within(introInsertMenu).getByRole("menuitem", { name: /^markdown$/i }));

    const cellsAfterMarkdownInsert = Array.from(document.querySelectorAll(".notebook-canvas article"));
    expect(cellsAfterMarkdownInsert[1]).toHaveAttribute("id", "note");
    expect(screen.getByRole("heading", { name: /^new note$/i })).toBeInTheDocument();

    const noteCell = document.getElementById("note");
    expect(noteCell).toBeInstanceOf(HTMLElement);
    if (!(noteCell instanceof HTMLElement)) {
      throw new Error("Expected inserted note cell article.");
    }

    openCellContextMenu(noteCell);
    const noteMenu = screen.getByRole("menu", { name: /cell actions for new note/i });
    fireEvent.mouseEnter(within(noteMenu).getByRole("menuitem", { name: /add cell/i }));
    const noteInsertMenu = screen.getByRole("menu", { name: /add cell below options/i });
    await user.click(within(noteInsertMenu).getByRole("menuitem", { name: /^chart$/i }));

    const cellsAfterChartInsert = Array.from(document.querySelectorAll(".notebook-canvas article"));
    expect(cellsAfterChartInsert[2]).toHaveAttribute("id", "chart");
    expect(screen.getByRole("heading", { name: /^new chart$/i })).toBeInTheDocument();
  });

  it("renders BMW transaction-flow matrix values with flow units inferred from the full expression", () => {
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).not.toBeNull();
    if (!matrixCell) {
      throw new Error("Expected BMW transactions-flow matrix article.");
    }

    const interestDepositsRow = within(matrixCell).getByText("Interest on deposits").closest("tr");
    expect(interestDepositsRow).not.toBeNull();
    expect(interestDepositsRow?.textContent).toMatch(/rm.*Mh/i);
    expect(interestDepositsRow?.textContent).toMatch(/rm.*Ms/i);
    expect(interestDepositsRow?.textContent).toMatch(/\$[0-9.,]+\/yr/);

    const changeDepositsRow = within(matrixCell).getByText("Ch. deposits").closest("tr");
    expect(changeDepositsRow).not.toBeNull();
    expect(changeDepositsRow?.textContent).toMatch(/d\((?:K|Mh|Ms)\)/);
    expect(changeDepositsRow?.textContent).toMatch(/\$[0-9.,]+\/yr/);
  });

  it("opens the notebook variable inspector from markdown and scenario run mentions", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const scenarioHeading = screen.getByRole("heading", { name: /^scenario 1$/i });
    const scenarioArticle = scenarioHeading.closest("article");
    expect(scenarioArticle).not.toBeNull();
    if (!(scenarioArticle instanceof HTMLElement)) {
      throw new Error("Expected scenario markdown article.");
    }

    await user.click(
      within(scenarioArticle).getAllByRole("button", { name: /^Inspect variable alpha0$/i })[0]
    );

    expect(document.getElementById("notebook-inspect-panel")).not.toBeNull();
    let inspectorHeading = document.querySelector(".variable-inspector-panel h3");
    expect(inspectorHeading).not.toBeNull();
    expect(inspectorHeading?.textContent).toMatch(/α|alpha/i);
    expect(inspectorHeading?.querySelector("sub")?.textContent).toBe("0");

    const scenarioRunHeading = screen.getByRole("heading", {
      name: /scenario 1: autonomous consumption shock/i
    });
    const scenarioRunArticle = scenarioRunHeading.closest("article");
    expect(scenarioRunArticle).not.toBeNull();
    if (!(scenarioRunArticle instanceof HTMLElement)) {
      throw new Error("Expected scenario run article.");
    }

    const shockVariableList = within(scenarioRunArticle).getByRole("list");
    await user.click(
      within(shockVariableList).getByRole("button", { name: /^Inspect variable alpha0$/i })
    );

    expect(document.getElementById("notebook-inspect-panel")).not.toBeNull();
    inspectorHeading = document.querySelector(".variable-inspector-panel h3");
    expect(inspectorHeading).not.toBeNull();
    expect(inspectorHeading?.textContent).toMatch(/α|alpha/i);
    expect(inspectorHeading?.querySelector("sub")?.textContent).toBe("0");
  });

  it("opens the notebook variable inspector from the model equations table", async () => {
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
    expect(within(equationsCell).getByText(/^Role$/i)).toBeInTheDocument();

    const yRowButton = within(equationsCell).getByRole("button", { name: /^Y\b/i });
    const yRow = yRowButton.closest('[role="row"]');
    expect(yRow).not.toBeNull();
    if (!(yRow instanceof HTMLElement)) {
      throw new Error("Expected Y row in model equations table.");
    }
    expect(within(yRow).getByText(/^Identity$/i)).toBeInTheDocument();

    fireEvent.click(yRowButton);
    await expectVariableInspectorOpen();

    const inspector = document.getElementById("notebook-inspect-panel");
    expect(inspector).not.toBeNull();
    if (!(inspector instanceof HTMLElement)) {
      throw new Error("Expected variable inspector container.");
    }

    const inspectorHeading = within(inspector).getByRole("heading", { name: /^Y\b/i });
    expect(inspectorHeading).toBeInTheDocument();

    expect(within(inspector).getByText(/^Equation role$/i)).toBeInTheDocument();
    expect(within(inspector).getByText(/^Identity$/i)).toBeInTheDocument();
    expect(within(inspector).getByText(/^Declared$/i)).toBeInTheDocument();
  }, 15000);

  it("edits the defining equation expression from the inspect panel", async () => {
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

    const inspector = document.getElementById("notebook-inspect-panel");
    expect(inspector).not.toBeNull();
    if (!(inspector instanceof HTMLElement)) {
      throw new Error("Expected variable inspector container.");
    }

    const inspectorEquationDisplay = within(inspector).getByTitle(/^Double-click expression to edit$/i);
    await user.dblClick(inspectorEquationDisplay);
    const expressionField = within(inspector).getByRole("textbox", { name: /^Expression for Y$/i });
    fireEvent.change(expressionField, { target: { value: "Cs + Is + G" } });
    await user.click(within(inspector).getByRole("button", { name: /^Apply$/i }));

    const inspectorEquation = inspector.querySelector(".inspector-equation-display");
    expect(inspectorEquation?.textContent).toMatch(/Cs/);
    expect(inspectorEquation?.textContent).toMatch(/Is/);
    expect(inspectorEquation?.textContent).toMatch(/G/);

    const yRowAfterEdit = within(equationsCell).getByRole("button", { name: /^Y\b/i }).closest('[role="row"]');
    expect(yRowAfterEdit?.textContent).toMatch(/G/);
  }, 15000);

  it("shows variable descriptions for lowercase rate tokens in the BMW transaction-flow matrix", async () => {
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).not.toBeNull();
    if (!matrixCell) {
      throw new Error("Expected BMW transactions-flow matrix article.");
    }

    const rmToken = within(matrixCell)
      .getAllByText("rm")
      .find((node) => node.className.includes("formula-token"));
    expect(rmToken).toBeDefined();
    if (!rmToken) {
      throw new Error("Expected matrix token for rm.");
    }

    fireEvent.mouseEnter(rmToken);
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Rate of interest on bank deposits");
    });
    expect(screen.getByRole("tooltip").textContent).toMatch(/Rate of interest on bank deposits\s*1\/yr/i);
    fireEvent.mouseLeave(rmToken);
  });

  it("edits a matrix entry inline in the run view with per-cell apply and cancel", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).not.toBeNull();
    if (!matrixCell) {
      throw new Error("Expected BMW transactions-flow matrix article.");
    }

    const consumptionRow = within(matrixCell).getByText("Consumption").closest("tr");
    expect(consumptionRow).not.toBeNull();
    if (!consumptionRow) {
      throw new Error("Expected consumption row in BMW transaction-flow matrix.");
    }

    const firmsDemandEntry = within(consumptionRow)
      .getAllByTitle("Double-click to edit")
      .find((node) => node.textContent?.includes("Cd"));
    expect(firmsDemandEntry).toBeDefined();
    if (!firmsDemandEntry) {
      throw new Error("Expected editable +Cd matrix entry.");
    }
    fireEvent.doubleClick(firmsDemandEntry);

    const entryInput = within(matrixCell).getByRole("textbox", {
      name: /matrix entry for row/i
    });
    expect(entryInput).toHaveValue("+Cd");

    fireEvent.change(entryInput, { target: { value: "+CdEdited" } });
    await user.click(within(matrixCell).getByRole("button", { name: /^apply$/i }));
    expect(screen.getByRole("dialog", { name: /rename variable across notebook/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^no$/i }));

    const updatedEntry = within(consumptionRow)
      .getAllByTitle("Double-click to edit")
      .find((node) => node.textContent?.includes("CdEdited"));
    expect(updatedEntry).toBeDefined();
    expect(within(matrixCell).queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();

    if (!updatedEntry) {
      throw new Error("Expected editable +CdEdited matrix entry for cancel test.");
    }
    fireEvent.doubleClick(updatedEntry);
    const cancelInput = within(matrixCell).getByRole("textbox", {
      name: /matrix entry for row/i
    });
    fireEvent.change(cancelInput, { target: { value: "+CdDraft" } });
    await user.click(within(matrixCell).getByRole("button", { name: /^cancel$/i }));

    expect(
      within(consumptionRow)
        .getAllByTitle("Double-click to edit")
        .some((node) => node.textContent?.includes("CdEdited"))
    ).toBe(true);
    expect(
      within(consumptionRow)
        .getAllByTitle("Double-click to edit")
        .some((node) => node.textContent?.includes("CdDraft"))
    ).toBe(false);
  }, 15000);

  it("edits an equation row inline without opening cell edit mode", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const equationsCell = document.getElementById("equations-newton");
    expect(equationsCell).not.toBeNull();
    if (!equationsCell) {
      throw new Error("Expected equations cell article.");
    }

    await expandCellIfCollapsed(equationsCell, user);

    const yRowButton = within(equationsCell).getByRole("button", { name: /^Y\b/i });
    const yRow = yRowButton.closest('[role="row"]');
    expect(yRow).not.toBeNull();
    if (!yRow) {
      throw new Error("Expected Y equation row.");
    }

    const yExpression = within(yRow)
      .getAllByTitle("Double-click to edit")
      .find((node) => node.classList.contains("notebook-model-view-expression"));
    expect(yExpression).toBeDefined();
    if (!yExpression) {
      throw new Error("Expected Y expression cell.");
    }
    fireEvent.doubleClick(yExpression);

    const expressionInput = within(equationsCell).getByRole("textbox", {
      name: /equation \d+ expression/i
    });
    fireEvent.change(expressionInput, { target: { value: "WBd + AF + 1" } });
    await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

    expect(yRow.textContent).toMatch(/AF \+ 1/);
    expect(within(equationsCell).queryByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it(
    "renames a variable only in the edited row when rename dialog answer is No",
    async () => {
      const user = userEvent.setup();
      window.location.hash = "#/notebook";
      setSuccessfulNotebookRunner();

      render(<App />);

      const equationsCell = document.getElementById("equations-newton");
      expect(equationsCell).not.toBeNull();
      if (!equationsCell) {
        throw new Error("Expected equations cell article.");
      }

      await expandCellIfCollapsed(equationsCell, user);

      const yRowButton = within(equationsCell).getByRole("button", { name: /^Y\b/i });
      const yRow = yRowButton.closest('[role="row"]');
      expect(yRow).not.toBeNull();
      if (!yRow) {
        throw new Error("Expected Y equation row.");
      }

      fireEvent.doubleClick(within(yRow).getAllByTitle("Double-click to edit")[0] ?? yRowButton);

      const variableInput = within(equationsCell).getByRole("textbox", {
        name: /equation \d+ variable/i
      });
      fireEvent.change(variableInput, { target: { value: "YOnly" } });
      await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

      expect(screen.getByRole("dialog", { name: /rename variable across notebook/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^no$/i }));

      expect(within(equationsCell).getByRole("button", { name: /^YOnly\b/i })).toBeInTheDocument();
      const cdRow = getEquationRowButton(equationsCell, /^Cd\b/i).closest('[role="row"]');
      expect(cdRow?.textContent).toMatch(/YD/);
      expect(cdRow?.textContent).not.toMatch(/YOnly/);
    },
    20000
  );

  it(
    "renames a variable across the model when rename dialog answer is Yes",
    async () => {
      const user = userEvent.setup();
      window.location.hash = "#/notebook";
      setSuccessfulNotebookRunner();

      render(<App />);

      const equationsCell = document.getElementById("equations-newton");
      expect(equationsCell).not.toBeNull();
      if (!equationsCell) {
        throw new Error("Expected equations cell article.");
      }

      await expandCellIfCollapsed(equationsCell, user);

      const mhRowButton = within(equationsCell).getByRole("button", { name: /^Mh\b/i });
      const mhRow = mhRowButton.closest('[role="row"]');
      expect(mhRow).not.toBeNull();
      if (!mhRow) {
        throw new Error("Expected Mh equation row.");
      }

      fireEvent.doubleClick(within(mhRow).getAllByTitle("Double-click to edit")[0] ?? mhRowButton);

      const variableInput = within(equationsCell).getByRole("textbox", {
        name: /equation \d+ variable/i
      });
      fireEvent.change(variableInput, { target: { value: "Mh2" } });
      await user.click(within(equationsCell).getByRole("button", { name: /^apply$/i }));

      expect(screen.getByRole("dialog", { name: /rename variable across notebook/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^yes$/i }));

      expect(within(equationsCell).getByRole("button", { name: /^Mh2\b/i })).toBeInTheDocument();
      const cdRow = getEquationRowButton(equationsCell, /^Cd\b/i).closest('[role="row"]');
      expect(cdRow?.textContent).toMatch(/Mh2/);

      const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
      const matrixCell = matrixHeading.closest("article");
      expect(matrixCell?.textContent).toMatch(/Mh2/);
    },
    20000
  );

  it("edits a plain matrix reference to a diff without opening the rename dialog", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).not.toBeNull();
    if (!matrixCell) {
      throw new Error("Expected BMW transactions-flow matrix article.");
    }

    const consumptionRow = within(matrixCell).getByText("Consumption").closest("tr");
    expect(consumptionRow).not.toBeNull();
    if (!consumptionRow) {
      throw new Error("Expected consumption row.");
    }

    const cdEntry = within(consumptionRow)
      .getAllByTitle("Double-click to edit")
      .find((node) => node.textContent?.includes("+Cd"));
    expect(cdEntry).toBeDefined();
    if (!cdEntry) {
      throw new Error("Expected +Cd matrix entry.");
    }

    fireEvent.doubleClick(cdEntry);

    const entryInput = within(matrixCell).getByRole("textbox", {
      name: /matrix entry for row/i
    });
    fireEvent.change(entryInput, { target: { value: "d(Cd)" } });
    await user.click(within(matrixCell).getByRole("button", { name: /^apply$/i }));

    expect(screen.queryByRole("dialog", { name: /rename variable across notebook/i })).not.toBeInTheDocument();
    expect(consumptionRow.textContent).toContain("d(Cd)");
  });

  it("updates notebook variable inspector history controls after selecting related variables", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const matrixHeading = screen.getByRole("heading", { name: /bmw transactions-flow matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).not.toBeNull();
    if (!matrixCell) {
      throw new Error("Expected BMW transactions-flow matrix article.");
    }

    const rmToken = within(matrixCell)
      .getAllByText("rm")
      .find((node) => node.className.includes("formula-token"));
    expect(rmToken).toBeDefined();
    if (!rmToken) {
      throw new Error("Expected matrix token for rm.");
    }

    await clickForDeferredVariableInspect(rmToken);

    const inspector = document.getElementById("notebook-inspect-panel");
    expect(inspector).not.toBeNull();
    if (!(inspector instanceof HTMLElement)) {
      throw new Error("Expected variable inspector container.");
    }

    const backButton = within(inspector).getByRole("button", { name: /^Go back$/i });
    const forwardButton = within(inspector).getByRole("button", { name: /^Go forward$/i });
    expect(backButton).toHaveAttribute("title", "Go back");
    expect(forwardButton).toHaveAttribute("title", "Go forward");
    expect(backButton).toBeDisabled();
    expect(forwardButton).toBeDisabled();

    const affectedEquationsHeading = within(inspector).getByText(/^Affected equations$/i);
    const affectedEquationsSection = affectedEquationsHeading.closest(".inspector-section");
    expect(affectedEquationsSection).not.toBeNull();
    if (!(affectedEquationsSection instanceof HTMLElement)) {
      throw new Error("Expected affected equations section.");
    }

    const ydEquation = within(affectedEquationsSection)
      .getAllByRole("code")
      .find((node) => node.textContent?.includes("YD"));
    expect(ydEquation).toBeDefined();
    if (!ydEquation) {
      throw new Error("Expected affected equation code block for YD.");
    }

    await user.click(within(ydEquation).getByRole("button", { name: /^Inspect variable YD$/i }));
    let currentInspector = document.getElementById("notebook-inspect-panel");
    expect(currentInspector).toBeInstanceOf(HTMLElement);
    if (!(currentInspector instanceof HTMLElement)) {
      throw new Error("Expected current variable inspector container.");
    }
    expect(within(currentInspector).getByRole("heading", { name: /^YD\b/i })).toBeInTheDocument();
    let currentBackButton = within(currentInspector).getByRole("button", { name: /^Go back$/i });
    let currentForwardButton = within(currentInspector).getByRole("button", { name: /^Go forward$/i });
    expect(currentBackButton).not.toBeDisabled();
    expect(currentForwardButton).toBeDisabled();

  }, 15000);

  it("loads a notebook template from the hash path", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook/gl2-pc";

    render(<App />);

    const commandsPanel = await openNotebookCommandsPanel(user);
    expect(within(commandsPanel).getByText(/gl2 pc notebook/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /pc balance sheet/i })).toBeInTheDocument();
  });

  it("renders all input-output table rows for 3io-pc templates with repeated row labels", async () => {
    window.location.hash = "#/notebook/3io-pc";

    render(<App />);

    const matrixHeading = await screen.findByRole("heading", { name: /table 3: input-output matrix/i });
    const matrixCell = matrixHeading.closest("article");
    expect(matrixCell).toBeInstanceOf(HTMLElement);
    if (!(matrixCell instanceof HTMLElement)) {
      throw new Error("Expected 3io-pc input-output matrix article.");
    }

    expect(within(matrixCell).getByRole("rowheader", { name: "Agriculture (production)" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "Manufacturing (production)" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "Services (production)" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "Value added" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "- Labour income" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "- Capital income" })).toBeInTheDocument();
    expect(within(matrixCell).getByRole("rowheader", { name: "Output" })).toBeInTheDocument();
    expect(within(matrixCell).queryByRole("columnheader", { name: "Band" })).not.toBeInTheDocument();
    expect(within(matrixCell).getByRole("columnheader", { name: "Row" })).toBeInTheDocument();
  });

  it("loads a notebook cell section from the pathname", async () => {
    history.replaceState(history.state, "", "/notebook/bmw/transaction-flow-sequence");

    render(<App />);

    await waitFor(() => {
      const cell = document.getElementById("transaction-flow-sequence");
      expect(cell).not.toBeNull();
      expect(cell).toHaveClass("notebook-cell-is-selected");
    });

    expect(screen.getByRole("button", { name: /^Multiport$/i })).toHaveClass("is-active");
    expect(window.location.pathname).toBe("/notebook/bmw/transaction-flow-sequence");
    expect(window.location.hash).toBe("");
  }, 30000);

  it("updates the pathname only from the cell context menu URL action", async () => {
    const user = userEvent.setup();
    history.replaceState(history.state, "", "/notebook/bmw");

    render(<App />);

    const sequenceCell = document.getElementById("transaction-flow-sequence");
    expect(sequenceCell).toBeInstanceOf(HTMLElement);
    if (!(sequenceCell instanceof HTMLElement)) {
      throw new Error("Expected transaction-flow-sequence notebook cell article.");
    }

    await user.click(sequenceCell);
    expect(window.location.pathname).toBe("/notebook/bmw");

    const outlinePanel = document.getElementById("notebook-outline-panel");
    expect(outlinePanel).toBeInstanceOf(HTMLElement);
    if (!(outlinePanel instanceof HTMLElement)) {
      throw new Error("Expected notebook outline panel.");
    }
    await user.click(
      within(outlinePanel).getByRole("button", { name: /transaction flow sequence/i })
    );
    expect(window.location.pathname).toBe("/notebook/bmw");

    openCellContextMenu(sequenceCell);
    await user.click(
      within(screen.getByRole("menu", { name: /cell actions for bmw transaction flow sequence/i })).getByRole(
        "menuitem",
        { name: /^url$/i }
      )
    );

    expect(window.location.pathname).toBe("/notebook/bmw/transaction-flow-sequence");
    expect(screen.getByText(/updated url for bmw transaction flow sequence/i)).toBeInTheDocument();
  });

  it("switches notebook templates from the command bar", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const commandsPanel = await openNotebookCommandsPanel(user);
    expect(within(commandsPanel).getByText(/bmw browser notebook/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    await waitFor(() => {
      expect(within(commandsPanel).getByText(/gl6 dis notebook/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /dis balance sheet/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /dis transactions-flow matrix/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /dis equation dependency graph/i })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /^dis model$/i }).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/notebook/gl6-dis");
    expect(window.location.hash).toBe("");
  });

  it("renders notebook contents titles through the shared math label component", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "opensimplest-levy");
    await user.click(screen.getByRole("tab", { name: /^contents$/i }));

    const outlinePanel = document.getElementById("notebook-outline-panel");
    expect(outlinePanel).not.toBeNull();
    if (!(outlinePanel instanceof HTMLElement)) {
      throw new Error("Expected notebook outline panel.");
    }

    expect(within(outlinePanel).getByText(/^overview$/i).closest(".variable-math-label")).not.toBeNull();
    expect(screen.getAllByText(/opensi?mplest levy/i).length).toBeGreaterThan(0);
  });

  it("renders BMW transaction-flow sequence across multiport, swimlane, and lifelines modes", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    const sequenceHeading = screen.getByRole("heading", { name: /bmw transaction flow sequence/i });
    const sequenceCell = sequenceHeading.closest("article");
    expect(sequenceCell).not.toBeNull();
    if (!(sequenceCell instanceof HTMLElement)) {
      throw new Error("Expected BMW transaction flow sequence article.");
    }

    const showButton = within(sequenceCell).queryByRole("button", { name: /^show$/i });
    if (showButton) {
      await user.click(showButton);
    }

    expect(
      within(sequenceCell).getByRole("region", { name: /transaction flow diagram/i })
    ).toBeInTheDocument();
    expect(within(sequenceCell).getByRole("button", { name: /^multiport$/i })).toHaveClass("is-active");
    expect(
      within(sequenceCell).getByRole("region", {
        name: /animated multiport transaction flow diagram/i
      })
    ).toBeInTheDocument();
    expect(within(sequenceCell).queryByRole("img", { name: /sequence diagram/i })).not.toBeInTheDocument();

    await user.click(within(sequenceCell).getByRole("button", { name: /^swimlane$/i }));

    await waitFor(() => {
      expect(sequenceCell.querySelector(".transaction-flow-edge__path")).not.toBeNull();
    });
    expect(within(sequenceCell).getByRole("button", { name: /^swimlane$/i })).toHaveClass("is-active");
    expect(within(sequenceCell).queryByRole("img", { name: /sequence diagram/i })).not.toBeInTheDocument();

    await user.click(within(sequenceCell).getByRole("button", { name: /^lifelines$/i }));

    expect(within(sequenceCell).getByRole("img", { name: /sequence diagram/i })).toBeInTheDocument();
    expect(
      within(sequenceCell).queryByRole("region", { name: /transaction flow diagram/i })
    ).not.toBeInTheDocument();
  }, 15000);

  it("shows dependency summary without a graph canvas for DIS equation dependencies", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.selectOptions(screen.getByLabelText(/notebook template/i), "gl6-dis");

    const sequenceHeading = screen.getByRole("heading", { name: /dis equation dependency graph/i });
    const sequenceCell = sequenceHeading.closest("article");
    expect(sequenceCell).not.toBeNull();
    if (!(sequenceCell instanceof HTMLElement)) {
      throw new Error("Expected DIS equation dependency graph article.");
    }

    const showButton = within(sequenceCell).queryByRole("button", { name: /^show$/i });
    if (showButton) {
      await user.click(showButton);
    }

    expect(
      within(sequenceCell).getByRole("region", { name: /equation dependency summary/i })
    ).toBeInTheDocument();
    expect(within(sequenceCell).getByRole("button", { name: /show exogenous/i })).toBeInTheDocument();
    expect(
      within(sequenceCell).queryByRole("region", { name: /transaction flow diagram/i })
    ).not.toBeInTheDocument();
    expect(
      within(sequenceCell).queryByRole("region", { name: /dependency graph/i })
    ).not.toBeInTheDocument();
  });
});
