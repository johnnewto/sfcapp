// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EquationsCellAskAiPanel } from "../src/notebook/components/EquationsCellAskAiPanel";
import type { NotebookAssistantSnapshot } from "../src/notebook/notebookAssistantTools";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import type { EquationsCell } from "../src/notebook/types";

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

function buildEquationsCellFixture() {
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
      outputs: {},
      status: {}
    },
    selectedCellId: cell.id,
    selectedPeriodIndex: 0
  };

  return { cell, document, snapshot };
}

describe("EquationsCellAskAiPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    runScopedNotebookAssistantProposal.mockReset();
  });

  it("asks with equations-cell-ask scope and shows the answer", async () => {
    const user = userEvent.setup();
    const { cell, document, snapshot } = buildEquationsCellFixture();

    runScopedNotebookAssistantProposal.mockResolvedValue({
      blocked: [],
      inlinePatch: null,
      patch: null,
      scopeViolations: [],
      semanticSummary: [],
      text: "The household block links disposable income to consumption demand.",
      toolResults: []
    });

    render(
      <EquationsCellAskAiPanel
        betaPassword=""
        cell={cell}
        document={document}
        model="gpt-5.4-mini"
        resultCount={0}
        selectedPeriodIndex={0}
        snapshot={snapshot}
        onClose={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/^request$/i), "Explain the household block");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => {
      expect(runScopedNotebookAssistantProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Explain the household block",
          scope: {
            kind: "equations-cell-ask",
            cellId: "equations-newton",
            modelId: "equations-newton"
          }
        })
      );
    });

    expect(
      await screen.findByText(/household block links disposable income/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  });
});
