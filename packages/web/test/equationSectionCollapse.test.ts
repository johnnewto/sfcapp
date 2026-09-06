// @vitest-environment jsdom

import { inferEquationSectionBoundaries, isRowComment } from "@sfcr/notebook-core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD,
  collectCollapsibleSectionCommentIds,
  equationSectionCollapseStorageKey,
  isEquationRowHiddenBySectionCollapse,
  resolveEquationSectionCollapsedIds,
  sectionCommentHasEquations,
  shouldAutoCollapseEquationSections,
  useEquationSectionCollapseState
} from "../src/notebook/equationSectionCollapse";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("equation section collapse", () => {
  const equations = [
    { id: "c1", kind: "comment" as const, text: "Household credit" },
    { id: "eq-1", name: "Lhd", expression: "1" },
    { id: "eq-2", name: "nl", expression: "2" },
    { id: "c2", kind: "comment" as const, text: "Production Firms" },
    { id: "eq-3", name: "Y", expression: "3" }
  ];

  it("detects whether a section comment has following equations", () => {
    expect(sectionCommentHasEquations(equations, 0)).toBe(true);
    expect(sectionCommentHasEquations(equations, 3)).toBe(true);
    expect(sectionCommentHasEquations([equations[3]], 0)).toBe(false);
  });

  it("collects collapsible section comments that have boundary signatures", () => {
    const boundaries = new Map([
      ["c1", { functionName: "Household_credit", inputs: ["P"], outputs: ["Lhd"] }],
      ["c2", { functionName: "Production_Firms", inputs: ["Cs"], outputs: ["Y"] }]
    ]);

    expect(collectCollapsibleSectionCommentIds(equations, boundaries)).toEqual(["c1", "c2"]);
    expect(collectCollapsibleSectionCommentIds(equations, new Map())).toEqual([]);
  });

  it("hides equation rows under a collapsed section comment", () => {
    const collapsed = new Set(["c1"]);
    expect(isEquationRowHiddenBySectionCollapse(equations, collapsed, 1)).toBe(true);
    expect(isEquationRowHiddenBySectionCollapse(equations, collapsed, 2)).toBe(true);
    expect(isEquationRowHiddenBySectionCollapse(equations, collapsed, 4)).toBe(false);
    expect(isEquationRowHiddenBySectionCollapse(equations, new Set(), 1)).toBe(false);
  });

  it("auto-collapses sections only above the equation-count threshold", () => {
    expect(shouldAutoCollapseEquationSections(AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD)).toBe(false);
    expect(shouldAutoCollapseEquationSections(AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD + 1)).toBe(true);
  });

  it("collapses every collapsible section when the list is large and unset", () => {
    const validSectionIds = new Set(["c1", "c2", "orphan"]);
    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds: ["c1", "c2"],
      equationCount: AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD + 1,
      storedIds: null,
      validSectionIds
    });
    expect([...collapsed].sort()).toEqual(["c1", "c2"]);
  });

  it("leaves small equation lists expanded when unset", () => {
    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds: ["c1", "c2"],
      equationCount: AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD,
      storedIds: null,
      validSectionIds: new Set(["c1", "c2"])
    });
    expect(collapsed.size).toBe(0);
  });

  it("keeps an explicit expand-all preference on large lists", () => {
    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds: ["c1", "c2"],
      equationCount: 400,
      storedIds: [],
      validSectionIds: new Set(["c1", "c2"])
    });
    expect(collapsed.size).toBe(0);
  });

  it("restores a stored subset of collapsed sections", () => {
    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds: ["c1", "c2"],
      equationCount: 400,
      storedIds: ["c2", "gone"],
      validSectionIds: new Set(["c1", "c2"])
    });
    expect([...collapsed]).toEqual(["c2"]);
  });

  it("auto-collapses DEFINE 1.1 sections when there is no stored preference", () => {
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
    expect(collapsibleSectionIds.length).toBeGreaterThan(0);
    expect(equationsCell.equations.length).toBeGreaterThan(AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD);

    const collapsed = resolveEquationSectionCollapsedIds({
      collapsibleSectionIds,
      equationCount: equationsCell.equations.length,
      storedIds: null,
      validSectionIds: new Set(collapsibleSectionIds)
    });
    expect(collapsed.size).toBe(collapsibleSectionIds.length);

    const hiddenEquationCount = equationsCell.equations.filter(
      (row, index) =>
        !isRowComment(row) &&
        isEquationRowHiddenBySectionCollapse(equationsCell.equations, collapsed, index)
    ).length;
    expect(hiddenEquationCount).toBeGreaterThan(80);
  });
});

describe("useEquationSectionCollapseState auto-collapse", () => {
  const cellId = "equations";
  const storageKey = equationSectionCollapseStorageKey(cellId);
  const sectionIds = ["c1", "c2"];
  const largeEquations = Array.from({ length: AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD + 1 }, (_, index) => {
    if (index === 0) {
      return { id: "c1", kind: "comment" as const, text: "One" };
    }
    if (index === 40) {
      return { id: "c2", kind: "comment" as const, text: "Two" };
    }
    return { id: `eq-${index}`, name: `X${index}`, expression: "1" };
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts with every section collapsed for a large unset model", () => {
    const { result } = renderHook(() =>
      useEquationSectionCollapseState(cellId, largeEquations, sectionIds)
    );
    expect([...result.current.collapsedSectionIds].sort()).toEqual(["c1", "c2"]);
  });

  it("treats a legacy empty array as unset and auto-collapses large models", () => {
    window.localStorage.setItem(storageKey, "[]");
    const { result } = renderHook(() =>
      useEquationSectionCollapseState(cellId, largeEquations, sectionIds)
    );
    expect([...result.current.collapsedSectionIds].sort()).toEqual(["c1", "c2"]);
  });

  it("keeps expand-all after it is persisted in the object format", () => {
    const { result } = renderHook(() =>
      useEquationSectionCollapseState(cellId, largeEquations, sectionIds)
    );
    act(() => {
      result.current.expandAllSections();
    });
    expect(result.current.collapsedSectionIds.size).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "")).toEqual({ ids: [] });

    const { result: reloaded } = renderHook(() =>
      useEquationSectionCollapseState(cellId, largeEquations, sectionIds)
    );
    expect(reloaded.current.collapsedSectionIds.size).toBe(0);
  });
});
