// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent as testingFireEvent, screen as testingScreen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { runBaseline as runCoreBaseline } from "@sfcr/core";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

import { bmwBaselineModel, bmwBaselineOptions } from "../../core/src/fixtures/bmw";
import { NotebookApp } from "../src/notebook/NotebookApp";

export const fireEvent = testingFireEvent;
export const screen = testingScreen;
export const userEvent = userEventLib;

export function App(): JSX.Element {
  return <NotebookApp />;
}

export const bmwNotebookBaselineResult = runCoreBaseline(bmwBaselineModel, bmwBaselineOptions);

export let notebookRunnerMock: {
  outputs: Record<string, { type: "result"; result: typeof bmwNotebookBaselineResult }>;
  status: Record<string, "idle" | "running" | "success" | "error">;
  errors: Record<string, string | undefined>;
  historyUpdates?: Record<string, number | undefined>;
  runCell: ReturnType<typeof vi.fn>;
  runAll: ReturnType<typeof vi.fn>;
  getResult: (cellId: string) => typeof bmwNotebookBaselineResult | null;
  getPreviousResult: (cellId: string) => typeof bmwNotebookBaselineResult | null;
};

vi.mock("../src/notebook/useNotebookRunner", () => ({
  useNotebookRunner: () => notebookRunnerMock
}));

vi.mock("../src/notebook/notebookTour", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notebook/notebookTour")>();
  return {
    ...actual,
    maybeStartNotebookTourOnFirstLoad: () => () => {}
  };
});

export function setupAppTestEnv(): void {
  beforeAll(() => {
    if (typeof File !== "undefined" && typeof File.prototype.text !== "function") {
      File.prototype.text = function text(this: File) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(typeof reader.result === "string" ? reader.result : "");
          };
          reader.onerror = () => {
            reject(reader.error ?? new Error("Failed to read file."));
          };
          reader.readAsText(this);
        });
      };
    }

    if (typeof Range !== "undefined") {
      const emptyClientRects = {
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* emptyClientRectIterator() {
          return;
        }
      } as DOMRectList;

      Range.prototype.getClientRects ??= () => emptyClientRects;
      Range.prototype.getBoundingClientRect ??= () => new DOMRect();
    }
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/#/notebook");
    window.localStorage.clear();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    notebookRunnerMock = {
      outputs: {},
      status: {},
      errors: {},
      runCell: vi.fn().mockResolvedValue(undefined),
      runAll: vi.fn().mockResolvedValue(undefined),
      getResult: () => null,
      getPreviousResult: () => null
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });
}

export function setSuccessfulNotebookRunner(
  cellId = "baseline-newton",
  result = bmwNotebookBaselineResult
): void {
  notebookRunnerMock = {
    outputs: {
      [cellId]: { type: "result", result }
    },
    status: { [cellId]: "success" },
    errors: {},
    runCell: vi.fn().mockResolvedValue(undefined),
    runAll: vi.fn().mockResolvedValue(undefined),
    getResult: (requestedCellId: string) => (requestedCellId === cellId ? result : null),
    getPreviousResult: () => null
  };
}

export function getNotebookSourceTextArea(): HTMLTextAreaElement {
  return screen.getByTestId("notebook-source-text") as HTMLTextAreaElement;
}

export function getNotebookSourceEditor(): HTMLElement {
  return screen.getByRole("textbox", { name: /notebook source editor/i });
}

export function setNotebookSourceValue(value: string): void {
  const editor = screen.queryByRole("textbox", { name: /notebook source editor/i });
  const view = editor ? EditorView.findFromDOM(editor) : null;

  if (view) {
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    });
    return;
  }

  fireEvent.change(getNotebookSourceTextArea(), {
    target: { value }
  });
}

export function getFormulaTokensByText(container: HTMLElement, text: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".formula-token")).filter(
    (node) => node.textContent === text
  );
}

export async function openNotebookCommandsPanel(
  user: ReturnType<typeof userEventLib.setup>
): Promise<HTMLElement> {
  const toggle = screen.getByRole("button", { name: /^commands$/i });
  if (toggle.getAttribute("aria-expanded") !== "true") {
    await user.click(toggle);
  }
  return screen.findByRole("dialog", { name: /notebook commands/i });
}

/** Open the YAML source editor rail and wait for CodeMirror to mount. */
export async function openNotebookSourceEditor(
  user: ReturnType<typeof userEventLib.setup>
): Promise<void> {
  const editorTab = screen.getByRole("tab", { name: /^editor$/i });
  if (editorTab.getAttribute("aria-selected") !== "true") {
    await user.click(editorTab);
  }

  await screen.findByRole("textbox", { name: /notebook source editor/i });
  await waitFor(() => {
    if (!document.querySelector(".notebook-code-editor .cm-scroller")) {
      throw new Error("Notebook source editor has not finished mounting yet.");
    }
  });
  expect(screen.getByRole("button", { name: /^save yaml$/i })).toBeInTheDocument();
}

export function getCellToolsButton(cell: HTMLElement): HTMLElement {
  return within(cell).getByRole("button", { name: /^tools$/i });
}

export async function openCellToolsMenu(
  user: { click: (element: Element) => Promise<unknown> },
  cell: HTMLElement
): Promise<HTMLElement> {
  const existing = within(cell).queryByRole("menu", { name: /cell actions/i });
  if (!existing) {
    await user.click(getCellToolsButton(cell));
  }
  return within(cell).getByRole("menu", { name: /cell actions/i });
}

export async function clickCellToolsItem(
  user: { click: (element: Element) => Promise<unknown> },
  cell: HTMLElement,
  name: string | RegExp
): Promise<void> {
  const menu = await openCellToolsMenu(user, cell);
  await user.click(within(menu).getByRole("menuitem", { name }));
}

export async function showCollapsedNotebookCell(
  user: { click: (element: Element) => Promise<unknown> },
  cell: HTMLElement
): Promise<boolean> {
  const showButton = within(cell).queryByRole("button", { name: /^show$/i });
  if (showButton) {
    await user.click(showButton);
    return true;
  }

  return false;
}

export async function expectVariableInspectorOpen(timeout = 3500): Promise<void> {
  await waitFor(
    () => {
      const panel = document.getElementById("notebook-inspect-panel");
      if (!panel) {
        throw new Error("Expected variable inspector panel.");
      }
    },
    { timeout }
  );
}

/** Clicks a variable token that schedules inspect after ~400ms (matrix / equation expression). */
export async function clickForDeferredVariableInspect(target: Element): Promise<void> {
  vi.useFakeTimers();
  try {
    testingFireEvent.click(target);
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
  } finally {
    vi.useRealTimers();
  }
  await expectVariableInspectorOpen();
}

