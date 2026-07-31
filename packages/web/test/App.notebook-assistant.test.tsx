// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  App,
  fireEvent,
  notebookRunnerMock,
  screen,
  setSuccessfulNotebookRunner,
  setupAppTestEnv,
  userEvent
} from "./appTestUtils";
import { setNotebookAssistantGlobalEditEnabledForTests } from "../src/notebook/notebookCellAi";

setupAppTestEnv();

describe("App notebook assistant", () => {
  afterEach(() => {
    cleanup();
    setNotebookAssistantGlobalEditEnabledForTests(null);
    vi.unstubAllGlobals();
  });

  it("keeps the scrubber visible when undo clears runner outputs before rerun", async () => {
    window.location.hash = "#/notebook";
    setSuccessfulNotebookRunner();

    render(<App />);

    expect(screen.getByLabelText(/simulation period navigation/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^assistant$/i }));
    expect(screen.getByLabelText(/notebook assistant composer/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/manual patch json/i));

    // Prefer stable by-id paths — numeric /cells/<index>/... drifts when BMW cells change.
    const patch = JSON.stringify([
      {
        op: "replace",
        path: "/cells/by-id/baseline-newton/periods",
        value: 40
      }
    ]);

    const patchInput = document.getElementById("notebook-assistant-patch-json") as HTMLTextAreaElement;
    expect(patchInput).toBeTruthy();
    fireEvent.change(patchInput, { target: { value: patch } });

    fireEvent.click(screen.getByRole("button", { name: /preview patch/i }));
    await waitFor(() => {
      expect(screen.getByText(/patch preview: valid/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^apply patch$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^apply patch$/i }));

    notebookRunnerMock.outputs = {};
    notebookRunnerMock.status = {};
    notebookRunnerMock.errors = {};

    fireEvent.click(screen.getByRole("button", { name: /undo patch/i }));
    expect(screen.getByLabelText(/simulation period navigation/i)).toBeInTheDocument();
  }, 45000);

  it("keeps Ask-only composer without the Edit mode toggle by default", async () => {
    window.location.hash = "#/notebook";

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /^assistant$/i }));
    expect(screen.queryByRole("button", { name: /edit mode/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeInTheDocument();
    expect(screen.getByText(/use ask ai on charts or equations/i)).toBeInTheDocument();
  }, 30000);

  it("runs a gated Edit-mode assistant turn with tool follow-ups and a proposed patch", async () => {
    setNotebookAssistantGlobalEditEnabledForTests(true);
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    const responses = [
      {
        output_text: `\`\`\`json
{
  "notebookAssistantToolRequests": [
    {
      "name": "getMatrix",
      "args": {
        "cellId": "matrix"
      }
    }
  ]
}
\`\`\``
      },
      {
        output_text: `\`\`\`json
{
  "notebookAssistantToolRequests": [
    {
      "name": "getMatrix",
      "args": {}
    }
  ]
}
\`\`\``
      },
      {
        output_text: `\`\`\`json
{
  "notebookAssistantToolRequests": [
    {
      "name": "createUpdateMatrixPatch",
      "args": {
        "matrixId": "balance-sheet",
        "columns": ["Households", "Production firms", "Banks", "Government", "Sum"],
        "sectors": ["Households", "Firms", "Banks", "Government", ""],
        "rows": [
          { "band": "Deposits", "label": "Money deposits", "values": ["+Mh", "", "-Ms", "", "0"] },
          { "band": "Loans", "label": "Loans", "values": ["", "-Ld", "+Ls", "", "0"] },
          { "band": "Government bills", "label": "Government bills", "values": ["+Bh", "", "+Bb", "-Bs", "0"] },
          { "band": "Investment", "label": "Fixed capital", "values": ["", "+K", "", "", "+K"] },
          { "band": "Balance", "label": "Balance (net worth)", "values": ["-Vh", "-V", "0", "+Vg", "0"] },
          { "band": "Sum", "label": "Sum", "values": ["0", "0", "0", "0", "0"] }
        ]
      }
    }
  ]
}
\`\`\``
      }
    ];
    const fetchMock = vi.fn(async (input: string) => {
      if (input !== "http://localhost:8787/v1/notebook-assistant/ask") {
        throw new Error(`Unexpected fetch call: ${input}`);
      }
      const next = responses.shift();
      if (!next) {
        throw new Error("Unexpected extra assistant request.");
      }
      return completedSseResponse(next.output_text);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("tab", { name: /^assistant$/i }));
    await user.click(screen.getByRole("button", { name: /edit mode/i }));
    fireEvent.change(screen.getByLabelText(/question/i), {
      target: { value: "add a govt sector to the matricies" }
    });
    await user.click(screen.getByRole("button", { name: /prepare edit/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(screen.getByText(/proposed change prepared/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /apply patch/i }).length).toBeGreaterThan(0);
  }, 45000);
});

function completedSseResponse(outputText: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          output_text: outputText
        }
      })}\n\n`,
      "data: [DONE]\n\n"
    ].join(""),
    {
      headers: {
        "Content-Type": "text/event-stream"
      }
    }
  );
}
