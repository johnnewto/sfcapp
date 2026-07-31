// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBaseline } from "@sfcr/core";

import { bmwBaselineModel, bmwBaselineOptions } from "../../core/src/fixtures/bmw";
import {
  ChartCellAskAiPanel,
  isNotebookChartCellAiEnabled
} from "../src/notebook/components/ChartCellAskAiPanel";
import { isNotebookCellAiEnabled } from "../src/notebook/notebookCellAi";
import type { NotebookAssistantInlinePatch } from "../src/notebook/notebookAssistantRuntime";
import type { NotebookAssistantSnapshot } from "../src/notebook/notebookAssistantTools";
import { previewNotebookPatch } from "../src/notebook/notebookPatch";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import type { ChartCell } from "../src/notebook/types";

const bmwResult = runBaseline(bmwBaselineModel, bmwBaselineOptions);

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

function buildChartFixture() {
  const document = createNotebookFromTemplate("bmw");
  const cell = document.cells.find((entry): entry is ChartCell => entry.id === "baseline-chart" && entry.type === "chart");
  if (!cell) {
    throw new Error("Expected baseline-chart cell.");
  }

  const snapshot: NotebookAssistantSnapshot = {
    document,
    runtime: {
      errors: {},
      outputs: {
        "baseline-newton": {
          type: "result",
          result: bmwResult
        }
      },
      status: {
        "baseline-newton": "success"
      }
    },
    selectedCellId: cell.id,
    selectedPeriodIndex: 0
  };

  return { cell, document, snapshot };
}

describe("ChartCellAskAiPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    runScopedNotebookAssistantProposal.mockReset();
  });

  it("reports chart cell AI as enabled in development when an API URL is configured", () => {
    expect(isNotebookChartCellAiEnabled()).toBe(true);
    expect(isNotebookCellAiEnabled()).toBe(true);
  });

  it("prepares, previews, and applies a scoped chart variables proposal", async () => {
    const user = userEvent.setup();
    const { cell, document, snapshot } = buildChartFixture();
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

    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [],
      inlinePatch,
      patch,
      scopeViolations: [],
      semanticSummary: ["variables: Y, YD, Cd, Id, W → YD, Cd"],
      text: "Proposed change prepared.",
      toolResults: []
    });

    const onApplied = vi.fn();
    const onUndoApplied = vi.fn();
    const onClose = vi.fn();

    render(
      <ChartCellAskAiPanel
        betaPassword=""
        cell={cell}
        document={document}
        model="gpt-5.4-mini"
        resultCount={1}
        selectedPeriodIndex={0}
        snapshot={snapshot}
        undoAvailable={false}
        onApplied={onApplied}
        onClose={onClose}
        onUndoApplied={onUndoApplied}
      />
    );

    await user.type(screen.getByLabelText(/^request$/i), "Show YD and Cd");
    await user.click(screen.getByRole("button", { name: /prepare update/i }));

    await waitFor(() => {
      expect(runScopedNotebookAssistantProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Show YD and Cd",
          scope: { kind: "chart-update", cellId: "baseline-chart" }
        })
      );
    });

    expect(await screen.findByText(/variables: .* → YD, Cd/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: expect.stringContaining("chart-ai-baseline-chart"),
        patch,
        document: expect.objectContaining({
          cells: expect.arrayContaining([
            expect.objectContaining({
              id: "baseline-chart",
              variables: ["YD", "Cd"]
            })
          ])
        })
      })
    );
  });

  it("keeps apply disabled when the scoped proposal is invalid", async () => {
    const user = userEvent.setup();
    const { cell, document, snapshot } = buildChartFixture();

    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [
        {
          name: "createUpdateChartVariablesPatch",
          args: { chartId: "other-chart", variables: ["YD"] }
        }
      ],
      inlinePatch: null,
      patch: null,
      scopeViolations: ["All tool requests were blocked for this chart-update scope (createUpdateChartVariablesPatch)."],
      semanticSummary: [],
      text: "Prepare a validated update for chart cell 'baseline-chart' only.",
      toolResults: []
    });

    render(
      <ChartCellAskAiPanel
        betaPassword=""
        cell={cell}
        document={document}
        model="gpt-5.4-mini"
        resultCount={1}
        selectedPeriodIndex={0}
        snapshot={snapshot}
        undoAvailable={false}
        onApplied={vi.fn()}
        onClose={vi.fn()}
        onUndoApplied={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/^request$/i), "Change another chart");
    await user.click(screen.getByRole("button", { name: /prepare update/i }));

    expect(await screen.findByText(/blocked for this chart-update scope/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  });
});
