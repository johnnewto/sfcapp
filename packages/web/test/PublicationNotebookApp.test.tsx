// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNotebookFromTemplate } from "../src/notebook/templates";
import { PublicationNotebookApp } from "../src/publication/PublicationNotebookApp";
import { writePublicationLiveSession } from "../src/publication/publicationLiveSession";

const runAllMock = vi.fn(async () => undefined);

vi.mock("../src/notebook/useNotebookRunner", () => ({
  useNotebookRunner: () => ({
    errors: {},
    getPreviousResult: vi.fn(() => null),
    getResult: vi.fn(() => null),
    outputs: {},
    runAll: runAllMock,
    runCell: vi.fn(async () => undefined),
    status: {}
  })
}));

afterEach(() => {
  cleanup();
  runAllMock.mockClear();
  window.sessionStorage.clear();
});

describe("PublicationNotebookApp", () => {
  it("renders template markdown and auto-runs simulations", async () => {
    render(
      <PublicationNotebookApp
        route={{
          mode: "publish",
          source: "template",
          templateId: "bmw",
          cellId: null,
          embedCellId: null
        }}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: /BMW/i })).toBeInTheDocument();
    expect(screen.getByText(/adapts the BMW vignette/i)).toBeInTheDocument();
    expect(runAllMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByText(/Running simulations/i)).not.toBeInTheDocument();
    });

    expect(screen.getByRole("complementary", { name: "Contents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "Notebook" }).length).toBeGreaterThan(0);
  }, 15000);

  it("links Open interactive notebook to /notebook/<id>, not the publish landing", async () => {
    writePublicationLiveSession({
      document: createNotebookFromTemplate("bmw"),
      returnUrl: "/"
    });

    render(
      <PublicationNotebookApp
        route={{
          mode: "publish",
          source: "template",
          templateId: "bmw",
          cellId: null,
          embedCellId: null
        }}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Running simulations/i)).not.toBeInTheDocument();
    });

    const links = screen.getAllByRole("link", { name: "Open interactive notebook" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/notebook/bmw");
    }
  }, 15000);

  it("uses a live-session notebook return URL when it still points at the editor", async () => {
    writePublicationLiveSession({
      document: createNotebookFromTemplate("bmw"),
      returnUrl: "/notebook/bmw/intro"
    });

    render(
      <PublicationNotebookApp
        route={{
          mode: "publish",
          source: "live",
          templateId: null,
          cellId: null,
          embedCellId: null
        }}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Running simulations/i)).not.toBeInTheDocument();
    });

    const links = screen.getAllByRole("link", { name: "Open interactive notebook" });
    expect(links[0]).toHaveAttribute("href", "/notebook/bmw/intro");
  }, 15000);

  it("renders a single embed cell when requested", async () => {
    render(
      <PublicationNotebookApp
        route={{
          mode: "embed",
          source: "template",
          templateId: "bmw",
          cellId: null,
          embedCellId: "intro"
        }}
      />
    );

    expect(screen.getByText(/adapts the BMW vignette/i)).toBeInTheDocument();
    expect(screen.queryByText(/SFCApp publication/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Appendix$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Contents" })).not.toBeInTheDocument();
  });

  it("shows an embed hint when the cell query param is missing", () => {
    render(
      <PublicationNotebookApp
        route={{
          mode: "embed",
          source: "template",
          templateId: "bmw",
          cellId: null,
          embedCellId: null
        }}
      />
    );

    expect(screen.getByText(/requires a/i)).toBeInTheDocument();
  });
});
