// @vitest-environment jsdom

import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  App,
  fireEvent,
  screen,
  setSuccessfulNotebookRunner,
  setupAppTestEnv,
  userEvent
} from "./appTestUtils";
import { EQUATION_ROLE_COLUMN_COLLAPSED_STORAGE_KEY } from "../src/hooks/useEquationValueColumnsCollapse";
import { previewNotebookPatch } from "../src/notebook/notebookPatch";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import type { NotebookAssistantInlinePatch } from "../src/notebook/notebookAssistantRuntime";

const runScopedNotebookAssistantProposal = vi.hoisted(() => vi.fn());

vi.mock("../src/notebook/notebookAssistantProposalRunner", () => ({
  runScopedNotebookAssistantProposal
}));

vi.mock("../src/notebook/notebookAssistantRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notebook/notebookAssistantRuntime")>();
  return {
    ...actual,
    NOTEBOOK_ASSISTANT_API_URL: "http://localhost:8787/v1/notebook-assistant/ask"
  };
});

setupAppTestEnv();

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  runScopedNotebookAssistantProposal.mockReset();
  window.localStorage.setItem(EQUATION_ROLE_COLUMN_COLLAPSED_STORAGE_KEY, "false");
});

function buildChartVariablesPatch(document = createNotebookFromTemplate("bmw")) {
  const patch = {
    description: "Update chart variables.",
    operations: [
      {
        op: "replace" as const,
        path: "/cells/by-id/baseline-chart/variables",
        value: ["YD", "Cd"]
      }
    ]
  };
  const inlinePatch: NotebookAssistantInlinePatch = {
    isJsonVisible: false,
    patch,
    preview: previewNotebookPatch(document, patch),
    status: "ready"
  };
  return { document, inlinePatch, patch };
}

function buildEquationCdPatch(document = createNotebookFromTemplate("bmw")) {
  const equationsCell = document.cells.find((cell) => cell.type === "equations" && cell.id === "equations-newton");
  if (!equationsCell || equationsCell.type !== "equations") {
    throw new Error("Expected equations-newton.");
  }
  const cdIndex = equationsCell.equations.findIndex((row) => "name" in row && row.name === "Cd");
  const patch = {
    description: "Update equation 'Cd'.",
    operations: [
      {
        op: "replace" as const,
        path: `/cells/by-id/equations-newton/equations/${cdIndex}/expression`,
        value: "alpha0 + 0.8 * alpha1 * YD + alpha2 * lag(Mh)"
      }
    ]
  };
  const inlinePatch: NotebookAssistantInlinePatch = {
    isJsonVisible: false,
    patch,
    preview: previewNotebookPatch(document, patch),
    status: "ready"
  };
  return { inlinePatch, patch };
}

async function expandEquationsCellIfCollapsed(
  cell: HTMLElement,
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  if (within(cell).queryByRole("table", { name: /model equations/i })) {
    return;
  }
  const showButton = within(cell).queryByRole("button", { name: /^show$/i });
  if (showButton) {
    await user.click(showButton);
  }
  await waitFor(() => {
    expect(within(cell).getByRole("table", { name: /model equations/i })).toBeInTheDocument();
  });
}

describe("App cell Ask AI", () => {
  it("applies, discards, and undoes a chart Ask AI proposal through the notebook journal", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    const { inlinePatch, patch } = buildChartVariablesPatch();
    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [],
      inlinePatch,
      patch,
      scopeViolations: [],
      semanticSummary: ["variables: Y, YD, Cd, Id, W → YD, Cd"],
      text: "Proposed change prepared.",
      toolResults: []
    });

    render(<App />);

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected baseline chart article.");
    }

    await user.click(within(chartArticle).getByRole("button", { name: /^ask ai$/i }));
    const askPanel = within(chartArticle).getByRole("region", {
      name: /ask ai for chart baseline headline variables/i
    });

    fireEvent.change(within(askPanel).getByLabelText(/^request$/i), {
      target: { value: "Show YD and Cd" }
    });
    await user.click(within(askPanel).getByRole("button", { name: /prepare update/i }));

    await waitFor(() => {
      expect(runScopedNotebookAssistantProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Show YD and Cd",
          scope: { kind: "chart-update", cellId: "baseline-chart" }
        })
      );
    });

    expect(await within(askPanel).findByText(/variables: .* → YD, Cd/i)).toBeInTheDocument();
    await user.click(within(askPanel).getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(screen.getByText(/applied cell ai patch/i)).toBeInTheDocument();
    });

    await user.click(within(askPanel).getByRole("button", { name: /^undo$/i }));
    await waitFor(() => {
      expect(screen.getByText(/undid assistant patch/i)).toBeInTheDocument();
    });

    // Fresh proposal then discard (no journal apply).
    const discarded = buildChartVariablesPatch();
    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [],
      inlinePatch: discarded.inlinePatch,
      patch: discarded.patch,
      scopeViolations: [],
      semanticSummary: ["variables: Y, YD, Cd, Id, W → YD, Cd"],
      text: "Proposed change prepared.",
      toolResults: []
    });

    fireEvent.change(within(askPanel).getByLabelText(/^request$/i), {
      target: { value: "Show YD and Cd again" }
    });
    await user.click(within(askPanel).getByRole("button", { name: /prepare update/i }));
    expect(await within(askPanel).findByRole("button", { name: /^apply$/i })).toBeEnabled();
    await user.click(within(askPanel).getByRole("button", { name: /^discard$/i }));
    await waitFor(() => {
      expect(within(askPanel).getByText(/discarded/i)).toBeInTheDocument();
    });
    expect(within(askPanel).getByRole("button", { name: /^apply$/i })).toBeDisabled();
  }, 45000);

  it("rejects an invalid chart Ask AI proposal without an apply action", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [
        {
          name: "createUpdateChartVariablesPatch",
          args: { chartId: "scenario-1-chart", variables: ["Y"] }
        }
      ],
      inlinePatch: null,
      patch: null,
      scopeViolations: ["All tool requests were blocked for this chart-update scope (createUpdateChartVariablesPatch)."],
      semanticSummary: [],
      text: "Prepare a validated update for chart cell 'baseline-chart' only.",
      toolResults: []
    });

    render(<App />);

    const chartHeading = screen.getByRole("heading", { name: /baseline headline variables/i });
    const chartArticle = chartHeading.closest("article");
    expect(chartArticle).not.toBeNull();
    if (!chartArticle) {
      throw new Error("Expected baseline chart article.");
    }

    await user.click(within(chartArticle).getByRole("button", { name: /^ask ai$/i }));
    const askPanel = within(chartArticle).getByRole("region", {
      name: /ask ai for chart baseline headline variables/i
    });

    fireEvent.change(within(askPanel).getByLabelText(/^request$/i), {
      target: { value: "Change another chart" }
    });
    await user.click(within(askPanel).getByRole("button", { name: /prepare update/i }));

    expect(await within(askPanel).findByText(/blocked for this chart-update scope/i)).toBeInTheDocument();
    expect(within(askPanel).queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  }, 30000);

  it("applies and undoes an equation-row Ask AI proposal", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    const { inlinePatch, patch } = buildEquationCdPatch();
    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [],
      inlinePatch,
      patch,
      scopeViolations: [],
      semanticSummary: ["Cd: alpha0 + alpha1 * YD + alpha2 * lag(Mh) → alpha0 + 0.8 * alpha1 * YD + alpha2 * lag(Mh)"],
      text: "Proposed change prepared.",
      toolResults: []
    });

    render(<App />);

    const equationsArticle = document.getElementById("equations-newton");
    expect(equationsArticle).not.toBeNull();
    if (!equationsArticle) {
      throw new Error("Expected equations-newton cell article.");
    }

    await expandEquationsCellIfCollapsed(equationsArticle, user);

    const roleExpand = within(equationsArticle).queryByRole("button", { name: /expand role column/i });
    if (roleExpand) {
      await user.click(roleExpand);
    }

    const cdRow = equationsArticle.querySelector('[data-variable="Cd"]');
    expect(cdRow).not.toBeNull();
    if (!(cdRow instanceof HTMLElement)) {
      throw new Error("Expected Cd equation row.");
    }

    // Role column may still be auto-collapsed in narrow jsdom; expand via header toggle if needed.
    if (!within(cdRow).queryByRole("button", { name: /^ask ai$/i })) {
      const expandRole = within(equationsArticle).queryByRole("button", {
        name: /expand role column/i
      });
      if (expandRole) {
        await user.click(expandRole);
      }
    }

    const rowAskAi =
      within(cdRow).queryByRole("button", { name: /^ask ai$/i }) ??
      within(equationsArticle).getAllByRole("button", { name: /^ask ai$/i }).find((button) =>
        Boolean(button.closest('[data-variable="Cd"]'))
      );

    if (!rowAskAi) {
      // Fallback: open cell-level Ask AI is read-only; use context menu on the row.
      fireEvent.contextMenu(cdRow);
      const menuAskAi = await screen.findByRole("menuitem", { name: /^ask ai$/i });
      await user.click(menuAskAi);
    } else {
      await user.click(rowAskAi);
    }

    const askPanel = within(equationsArticle).getByRole("region", { name: /ask ai for equation cd/i });
    fireEvent.change(within(askPanel).getByLabelText(/^request$/i), {
      target: { value: "Scale alpha1 by 0.8" }
    });
    await user.click(within(askPanel).getByRole("button", { name: /^ask$/i }));

    await waitFor(() => {
      expect(runScopedNotebookAssistantProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Scale alpha1 by 0.8",
          scope: {
            kind: "equation-update",
            cellId: "equations-newton",
            modelId: "equations-newton",
            variable: "Cd"
          }
        })
      );
    });

    expect(await within(askPanel).findByText(/0\.8 \* alpha1/i)).toBeInTheDocument();
    await user.click(within(askPanel).getByRole("button", { name: /^apply$/i }));
    await waitFor(() => {
      expect(screen.getByText(/applied cell ai patch/i)).toBeInTheDocument();
    });

    await user.click(within(askPanel).getByRole("button", { name: /^undo$/i }));
    await waitFor(() => {
      expect(screen.getByText(/undid assistant patch/i)).toBeInTheDocument();
    });
  }, 45000);
});
