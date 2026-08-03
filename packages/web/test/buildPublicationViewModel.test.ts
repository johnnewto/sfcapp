import { describe, expect, it } from "vitest";

import { buildPublicationViewModel, buildPublicationContentsEntries } from "../src/publication/buildPublicationViewModel";
import { createNotebookFromTemplate } from "../src/notebook/templates";

describe("buildPublicationViewModel", () => {
  it("splits body and appendix sections for bmw", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });

    expect(viewModel.bodySections.some((section) => section.cell.type === "markdown")).toBe(true);
    expect(viewModel.bodySections.some((section) => section.cell.type === "matrix")).toBe(true);
    expect(viewModel.bodySections.some((section) => section.cell.type === "run")).toBe(true);
    expect(viewModel.appendixSections.some((section) => section.cell.type === "run")).toBe(false);
    expect(viewModel.appendixSections.some((section) => section.cell.type === "solver")).toBe(true);
  });

  it("routes matrix-sourced sequence cells to the body and skips other sequence sources", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });

    const matrixSequenceCells = document.cells.filter(
      (cell) => cell.type === "sequence" && cell.source.kind === "matrix"
    );
    expect(matrixSequenceCells.length).toBeGreaterThan(0);

    const sequenceBodySections = viewModel.bodySections.filter(
      (section) => section.kind === "sequence"
    );
    expect(sequenceBodySections.length).toBe(matrixSequenceCells.length);
    expect(
      sequenceBodySections.every((section) => section.cell.type === "sequence")
    ).toBe(true);

    // Non-matrix sequence sources (e.g. cld/dependency) never become publication sections.
    const nonMatrixSequenceIds = document.cells
      .filter((cell) => cell.type === "sequence" && cell.source.kind !== "matrix")
      .map((cell) => cell.id);
    const allSectionIds = [...viewModel.bodySections, ...viewModel.appendixSections].map(
      (section) => section.anchorId
    );
    for (const id of nonMatrixSequenceIds) {
      expect(allSectionIds).not.toContain(id);
    }
  });

  it("filters embed mode to a single eligible cell", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "embed",
      embedCellId: "intro"
    });

    expect(viewModel.bodySections).toHaveLength(1);
    expect(viewModel.bodySections[0]?.anchorId).toBe("intro");
    expect(viewModel.appendixSections).toHaveLength(0);
  });

  it("returns empty body sections when embed cell is missing", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "embed",
      embedCellId: null
    });

    expect(viewModel.bodySections).toHaveLength(0);
  });

  it("builds contents entries from titled body sections", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });

    const entries = buildPublicationContentsEntries(viewModel.bodySections, viewModel.appendixSections);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.some((entry) => entry.anchorId === "intro")).toBe(true);
    expect(entries.every((entry) => entry.title.length > 0)).toBe(true);
  });

  it("includes appendix sections in contents under an Appendix heading", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });

    expect(viewModel.appendixSections.length).toBeGreaterThan(0);

    const entries = buildPublicationContentsEntries(viewModel.bodySections, viewModel.appendixSections);
    const appendixHeading = entries.find((entry) => entry.anchorId === "appendix");
    expect(appendixHeading).toEqual({
      anchorId: "appendix",
      title: "Appendix",
      level: 0
    });

    const appendixIndex = entries.findIndex((entry) => entry.anchorId === "appendix");
    expect(appendixIndex).toBeGreaterThanOrEqual(0);

    for (const section of viewModel.appendixSections) {
      const title = section.cell.title.trim();
      if (!title) {
        continue;
      }
      const entry = entries.find((item) => item.anchorId === section.anchorId);
      expect(entry).toEqual({
        anchorId: section.anchorId,
        title,
        level: 1
      });
      expect(entries.indexOf(entry!)).toBeGreaterThan(appendixIndex);
    }
  });

  it("nests non-markdown contents entries under markdown sections", () => {
    const document = createNotebookFromTemplate("bmw");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "bmw",
      mode: "publish"
    });

    const entries = buildPublicationContentsEntries(viewModel.bodySections, viewModel.appendixSections);
    const byAnchor = new Map(entries.map((entry) => [entry.anchorId, entry]));

    expect(byAnchor.get("intro")?.level).toBe(0);
    expect(byAnchor.get("balance-sheet")?.level).toBe(1);

    const markdownLevels = viewModel.bodySections
      .filter((section) => section.cell.type === "markdown")
      .map((section) => byAnchor.get(section.anchorId)?.level);
    const nestedLevels = viewModel.bodySections
      .filter((section) => section.cell.type !== "markdown")
      .map((section) => byAnchor.get(section.anchorId)?.level)
      .filter((level): level is 0 | 1 => level !== undefined);

    expect(markdownLevels.every((level) => level === 0)).toBe(true);
    expect(nestedLevels.length).toBeGreaterThan(0);
    expect(nestedLevels.every((level) => level === 1)).toBe(true);
  });

  it("places abm-model cells in body in notebook order", () => {
    const document = createNotebookFromTemplate("abm-sim");
    const viewModel = buildPublicationViewModel({
      document,
      templateId: "abm-sim",
      mode: "publish"
    });

    const abmBody = viewModel.bodySections.filter((section) => section.cell.type === "abm-model");
    expect(abmBody).toHaveLength(1);
    expect(abmBody[0]?.kind).toBe("abm-model");
    expect(abmBody[0]?.anchorId).toBe("abm-sim-model");
    expect(viewModel.appendixSections.some((section) => section.cell.type === "abm-model")).toBe(
      false
    );

    const bodyIds = viewModel.bodySections.map((section) => section.anchorId);
    const documentBodyOrder = document.cells
      .filter((cell) =>
        viewModel.bodySections.some((section) => section.anchorId === cell.id)
      )
      .map((cell) => cell.id);
    expect(bodyIds).toEqual(documentBodyOrder);

    const introIndex = bodyIds.indexOf("intro");
    const abmIndex = bodyIds.indexOf("abm-sim-model");
    expect(introIndex).toBeGreaterThanOrEqual(0);
    expect(abmIndex).toBe(introIndex + 1);
  });

  it("includes chart-grid cells in body publication sections", () => {
    const document = createNotebookFromTemplate("italy-sfc");
    const chartGridCells = document.cells.filter((cell) => cell.type === "chart-grid");

    expect(chartGridCells.length).toBeGreaterThan(0);

    const viewModel = buildPublicationViewModel({
      document,
      templateId: "italy-sfc",
      mode: "publish"
    });

    const chartGridSections = viewModel.bodySections.filter(
      (section) => section.cell.type === "chart-grid" && section.kind === "chart"
    );

    expect(chartGridSections).toHaveLength(chartGridCells.length);
  });
});
