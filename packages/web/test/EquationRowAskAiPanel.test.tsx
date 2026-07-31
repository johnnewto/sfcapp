// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBaseline } from "@sfcr/core";

import { bmwBaselineModel, bmwBaselineOptions } from "../../core/src/fixtures/bmw";
import { EquationRowAskAiPanel } from "../src/notebook/components/EquationRowAskAiPanel";
import type { NotebookAssistantInlinePatch } from "../src/notebook/notebookAssistantRuntime";
import type { NotebookAssistantSnapshot } from "../src/notebook/notebookAssistantTools";
import { previewNotebookPatch } from "../src/notebook/notebookPatch";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import type { EquationsCell } from "../src/notebook/types";

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

function buildEquationFixture() {
  const document = createNotebookFromTemplate("bmw");
  const cell = document.cells.find(
    (entry): entry is EquationsCell => entry.type === "equations" && entry.id === "equations-newton"
  );
  if (!cell) {
    throw new Error("Expected equations-newton cell.");
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
    selectedPeriodIndex: 0,
    selectedVariable: "Cd"
  };

  return { cell, document, snapshot };
}

describe("EquationRowAskAiPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    runScopedNotebookAssistantProposal.mockReset();
  });

  it("prepares and applies a scoped equation update proposal", async () => {
    const user = userEvent.setup();
    const { cell, document, snapshot } = buildEquationFixture();
    const cdIndex = cell.equations.findIndex((row) => "name" in row && row.name === "Cd");
    const patch = {
      description: "Update equation 'Cd'.",
      operations: [
        {
          op: "replace" as const,
          path: `/cells/by-id/equations-newton/equations/${cdIndex}`,
          value: {
            id: "eq-cd",
            name: "Cd",
            expression: "alpha0 + alpha1 * YD",
            desc: "Consumption goods demand by households",
            role: "behavioral"
          }
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
      semanticSummary: ["Cd: alpha0 + alpha1 * YD + alpha2 * lag(Mh) → alpha0 + alpha1 * YD"],
      text: "Proposed change prepared.",
      toolResults: []
    });

    const onApplied = vi.fn();

    render(
      <EquationRowAskAiPanel
        betaPassword=""
        cell={cell}
        document={document}
        expression="alpha0 + alpha1 * YD + alpha2 * lag(Mh)"
        model="gpt-5.4-mini"
        resultCount={1}
        selectedPeriodIndex={0}
        snapshot={snapshot}
        undoAvailable={false}
        variable="Cd"
        onApplied={onApplied}
        onClose={vi.fn()}
        onUndoApplied={vi.fn()}
      />
    );

    expect(screen.getByText(/current:/i)).toHaveTextContent("Cd = alpha0 + alpha1 * YD + alpha2 * lag(Mh)");

    await user.type(screen.getByLabelText(/^request$/i), "Drop wealth term");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => {
      expect(runScopedNotebookAssistantProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Drop wealth term",
          scope: {
            kind: "equation-update",
            cellId: "equations-newton",
            modelId: "equations-newton",
            variable: "Cd"
          }
        })
      );
    });

    expect(await screen.findByText(/Cd: .* → alpha0 \+ alpha1 \* YD/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: expect.stringContaining("equation-ai-equations-newton-Cd"),
        patch
      })
    );
  });

  it("rejects out-of-scope equation proposals without an apply action", async () => {
    const user = userEvent.setup();
    const { cell, document, snapshot } = buildEquationFixture();

    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [
        {
          name: "createUpdateEquationPatch",
          args: { modelId: "equations-newton", variable: "Y", expression: "Cs" }
        }
      ],
      inlinePatch: null,
      patch: null,
      scopeViolations: ["All tool requests were blocked for this equation-update scope (createUpdateEquationPatch)."],
      semanticSummary: [],
      text: "Prepare a validated update for equation 'Cd' only.",
      toolResults: []
    });

    render(
      <EquationRowAskAiPanel
        betaPassword=""
        cell={cell}
        document={document}
        expression="alpha0 + alpha1 * YD + alpha2 * lag(Mh)"
        model="gpt-5.4-mini"
        resultCount={1}
        selectedPeriodIndex={0}
        snapshot={snapshot}
        undoAvailable={false}
        variable="Cd"
        onApplied={vi.fn()}
        onClose={vi.fn()}
        onUndoApplied={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/^request$/i), "Change Y instead");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(await screen.findByText(/blocked for this equation-update scope/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  });
});
