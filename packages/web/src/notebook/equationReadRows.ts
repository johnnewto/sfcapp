import { isRowComment, type EquationListItem } from "@sfcr/notebook-core";

import { isEquationRowHiddenBySectionCollapse } from "./equationSectionCollapse";

export type VisibleEquationReadItem =
  | { index: number; key: string; kind: "comment" }
  | { index: number; key: string; kind: "equation" }
  | { key: string; kind: "implicit" };

export function collectVisibleEquationReadItems(
  equations: readonly EquationListItem[],
  collapsedSectionIds: ReadonlySet<string>,
  includeImplicit = false
): VisibleEquationReadItem[] {
  const items: VisibleEquationReadItem[] = [];

  equations.forEach((row, index) => {
    if (isRowComment(row)) {
      items.push({ index, key: row.id, kind: "comment" });
      return;
    }

    if (isEquationRowHiddenBySectionCollapse(equations, collapsedSectionIds, index)) {
      return;
    }

    items.push({ index, key: row.id, kind: "equation" });
  });

  if (includeImplicit) {
    items.push({ key: "implicit-matrix-integration", kind: "implicit" });
  }

  return items;
}

export function estimateEquationReadItemSize(item: VisibleEquationReadItem): number {
  switch (item.kind) {
    case "comment":
      return 44;
    case "implicit":
      return 72;
    default:
      return 36;
  }
}
