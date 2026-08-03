// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicationContents } from "../src/publication/PublicationContents";
import { buildPublicationContentsEntries, buildPublicationViewModel } from "../src/publication/buildPublicationViewModel";
import { createNotebookFromTemplate } from "../src/notebook/templates";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PublicationContents", () => {
  it("renders body section titles and scrolls on click", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });
    const entries = buildPublicationContentsEntries(viewModel.bodySections, viewModel.appendixSections);
    const overviewEntry = entries.find((entry) => entry.anchorId === "intro");
    expect(overviewEntry).toBeDefined();

    const target = window.document.createElement("section");
    target.id = "intro";
    window.document.body.append(target);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(
      <PublicationContents
        activeAnchorId={null}
        entries={entries.slice(0, 3)}
        interactiveNotebookHref="/notebook/bmw"
        isPrint={false}
        onOpenGraph={vi.fn()}
        printHref="/print/live"
        route={{
          mode: "publish",
          source: "live",
          templateId: null,
          cellId: null,
          embedCellId: null
        }}
        showCatalog
      />
    );

    expect(screen.getByRole("complementary", { name: "Contents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contents" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Notebook" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open interactive notebook" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Print view" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open Graph" }).length).toBeGreaterThan(0);

    const overviewLink = screen.getByRole("link", { name: overviewEntry!.title });
    expect(overviewLink.closest("li")).toHaveAttribute("data-level", "0");

    const renderedEntries = entries.slice(0, 3);
    const nestedEntry = renderedEntries.find((entry) => entry.level === 1);
    expect(nestedEntry).toBeDefined();
    expect(screen.getByRole("link", { name: nestedEntry!.title }).closest("li")).toHaveAttribute(
      "data-level",
      "1"
    );

    fireEvent.click(overviewLink);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(replaceState).toHaveBeenCalledWith(null, "", expect.stringContaining("/publish/live/intro"));
  });
});
