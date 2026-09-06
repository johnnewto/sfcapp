import { inferEquationSectionBoundaries, isRowComment } from "@sfcr/notebook-core";
import { describe, expect, it } from "vitest";

import {
  collectVisibleEquationReadItems,
  estimateEquationReadItemSize
} from "../src/notebook/equationReadRows";
import {
  AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD,
  collectCollapsibleSectionCommentIds,
  resolveEquationSectionCollapsedIds
} from "../src/notebook/equationSectionCollapse";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("collectVisibleEquationReadItems", () => {
  const equations = [
    { id: "c1", kind: "comment" as const, text: "Household credit" },
    { id: "eq-1", name: "Lhd", expression: "1" },
    { id: "eq-2", name: "nl", expression: "2" },
    { id: "c2", kind: "comment" as const, text: "Production Firms" },
    { id: "eq-3", name: "Y", expression: "3" }
  ];

  it("keeps comments and equations when no section is collapsed", () => {
    expect(collectVisibleEquationReadItems(equations, new Set()).map((item) => item.key)).toEqual([
      "c1",
      "eq-1",
      "eq-2",
      "c2",
      "eq-3"
    ]);
  });

  it("omits equations under collapsed sections and can append the implicit row", () => {
    const items = collectVisibleEquationReadItems(equations, new Set(["c1"]), true);
    expect(items.map((item) => `${item.kind}:${item.key}`)).toEqual([
      "comment:c1",
      "comment:c2",
      "equation:eq-3",
      "implicit:implicit-matrix-integration"
    ]);
  });

  it("estimates comment, equation, and implicit heights", () => {
    expect(estimateEquationReadItemSize({ index: 0, key: "c1", kind: "comment" })).toBe(44);
    expect(estimateEquationReadItemSize({ index: 1, key: "eq-1", kind: "equation" })).toBe(36);
    expect(estimateEquationReadItemSize({ key: "implicit-matrix-integration", kind: "implicit" })).toBe(
      72
    );
  });

  it("reduces DEFINE 1.1 virtualizer items to section comments when auto-collapsed", () => {
    const document = getNotebookTemplateDocument("define");
    const equationsCell = document.cells.find((cell) => cell.type === "equations");
    const externalsCell = document.cells.find((cell) => cell.type === "externals");
    expect(equationsCell?.type).toBe("equations");
    if (equationsCell?.type !== "equations" || externalsCell?.type !== "externals") {
      return;
    }

    const collapsibleSectionIds = collectCollapsibleSectionCommentIds(
      equationsCell.equations,
      inferEquationSectionBoundaries({
        equations: equationsCell.equations,
        externals: externalsCell.externals
      })
    );
    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds,
      equationCount: equationsCell.equations.length,
      storedIds: null,
      validSectionIds: new Set(collapsibleSectionIds)
    });
    const visible = collectVisibleEquationReadItems(equationsCell.equations, collapsed);
    const visibleEquations = visible.filter((item) => item.kind === "equation");
    const commentCount = equationsCell.equations.filter(isRowComment).length;
    const dataRowCount = equationsCell.equations.length - commentCount;

    expect(equationsCell.equations.length).toBeGreaterThan(AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD);
    expect(visible.filter((item) => item.kind === "comment")).toHaveLength(commentCount);
    expect(visibleEquations.length).toBeLessThan(dataRowCount);
    expect(visible.length).toBeLessThan(equationsCell.equations.length);
    expect(visibleEquations.length).toBeLessThan(80);
  });
});
