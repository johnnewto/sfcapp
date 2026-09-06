import { useCallback, useEffect, useMemo, useState } from "react";

import { isRowComment, type EquationListItem } from "@sfcr/notebook-core";

const EQUATION_SECTION_COLLAPSE_STORAGE_PREFIX = "sfcr.equation-section-collapse.";

/** Collapse every section on first view when the equation list is this large. */
export const AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD = 80;

export function equationSectionCollapseStorageKey(cellId: string): string {
  return `${EQUATION_SECTION_COLLAPSE_STORAGE_PREFIX}${cellId}`;
}

export function shouldAutoCollapseEquationSections(equationCount: number): boolean {
  return equationCount > AUTO_COLLAPSE_EQUATION_SECTION_THRESHOLD;
}

export function resolveEquationSectionCollapsedIds({
  collapsibleSectionIds,
  equationCount,
  storedIds,
  validSectionIds
}: {
  collapsibleSectionIds: readonly string[];
  equationCount: number;
  storedIds: readonly string[] | null;
  validSectionIds: ReadonlySet<string>;
}): Set<string> {
  if (storedIds) {
    return filterCollapsedSectionIds(storedIds, validSectionIds);
  }
  if (shouldAutoCollapseEquationSections(equationCount) && collapsibleSectionIds.length > 0) {
    return filterCollapsedSectionIds(collapsibleSectionIds, validSectionIds);
  }
  return new Set();
}

export function sectionCommentHasEquations(
  equations: readonly EquationListItem[],
  commentIndex: number
): boolean {
  for (let index = commentIndex + 1; index < equations.length; index += 1) {
    if (isRowComment(equations[index])) {
      return false;
    }
    return true;
  }
  return false;
}

export function collectCollapsibleSectionCommentIds(
  equations: readonly EquationListItem[],
  sectionBoundaries: ReadonlyMap<string, unknown>
): string[] {
  const ids: string[] = [];
  equations.forEach((row, index) => {
    if (!isRowComment(row) || !sectionBoundaries.has(row.id)) {
      return;
    }
    if (sectionCommentHasEquations(equations, index)) {
      ids.push(row.id);
    }
  });
  return ids;
}

export function isEquationRowHiddenBySectionCollapse(
  equations: readonly EquationListItem[],
  collapsedSectionIds: ReadonlySet<string>,
  rowIndex: number
): boolean {
  const row = equations[rowIndex];
  if (!row || isRowComment(row)) {
    return false;
  }

  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    const prior = equations[index];
    if (isRowComment(prior)) {
      return collapsedSectionIds.has(prior.id);
    }
  }

  return false;
}

function collectSectionCommentIds(equations: readonly EquationListItem[]): Set<string> {
  const ids = new Set<string>();
  equations.forEach((row) => {
    if (isRowComment(row)) {
      ids.add(row.id);
    }
  });
  return ids;
}

function filterCollapsedSectionIds(
  collapsedSectionIds: Iterable<string>,
  validSectionIds: ReadonlySet<string>
): Set<string> {
  const filtered = new Set<string>();
  for (const sectionId of collapsedSectionIds) {
    if (validSectionIds.has(sectionId)) {
      filtered.add(sectionId);
    }
  }
  return filtered;
}

function parseStoredCollapsedSectionIds(raw: string): string[] | null {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    const ids = parsed.filter((value): value is string => typeof value === "string");
    // Legacy writes stored [] on first mount even when the user never chose.
    // Treat that as unset so large models can still auto-collapse.
    return ids.length === 0 ? null : ids;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { ids?: unknown }).ids)) {
    return (parsed as { ids: unknown[] }).ids.filter((value): value is string => typeof value === "string");
  }
  return null;
}

function readStoredCollapsedSectionIds(storageKey: string): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    return parseStoredCollapsedSectionIds(raw);
  } catch {
    return null;
  }
}

function writeStoredCollapsedSectionIds(storageKey: string, collapsedSectionIds: ReadonlySet<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ ids: [...collapsedSectionIds] }));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function collapsedSectionIdsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
}

export function useEquationSectionCollapseState(
  cellId: string,
  equations: readonly EquationListItem[],
  collapsibleSectionIds: readonly string[] = []
): {
  collapsedSectionIds: Set<string>;
  collapseAllSections(): void;
  expandAllSections(): void;
  hasCollapsibleSections: boolean;
  isSectionCollapsed(sectionId: string): boolean;
  toggleSectionCollapse(sectionId: string): void;
} {
  const collapsibleSectionIdSet = useMemo(
    () => new Set(collapsibleSectionIds),
    [collapsibleSectionIds]
  );
  const validSectionIds = useMemo(() => {
    const ids = collectSectionCommentIds(equations);
    for (const sectionId of collapsibleSectionIds) {
      ids.add(sectionId);
    }
    return ids;
  }, [collapsibleSectionIds, equations]);
  const validSectionIdsKey = useMemo(() => [...validSectionIds].sort().join("\n"), [validSectionIds]);
  const collapsibleSectionIdsKey = useMemo(
    () => [...collapsibleSectionIdSet].sort().join("\n"),
    [collapsibleSectionIdSet]
  );
  const storageKey = useMemo(() => equationSectionCollapseStorageKey(cellId), [cellId]);
  const equationCount = equations.length;

  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() =>
    resolveEquationSectionCollapsedIds({
      collapsibleSectionIds,
      equationCount,
      storedIds: readStoredCollapsedSectionIds(storageKey),
      validSectionIds
    })
  );

  useEffect(() => {
    setCollapsedSectionIds((current) => {
      const next = resolveEquationSectionCollapsedIds({
        collapsibleSectionIds,
        equationCount,
        storedIds: readStoredCollapsedSectionIds(storageKey),
        validSectionIds
      });
      return collapsedSectionIdsEqual(current, next) ? current : next;
    });
    // collapsibleSectionIdsKey / validSectionIdsKey stand in for the Set/array identities.
  }, [collapsibleSectionIdsKey, equationCount, storageKey, validSectionIdsKey]);

  useEffect(() => {
    setCollapsedSectionIds((current) => {
      const filtered = filterCollapsedSectionIds(current, validSectionIds);
      if (filtered.size === current.size && [...filtered].every((id) => current.has(id))) {
        return current;
      }
      return filtered;
    });
  }, [validSectionIdsKey]);

  useEffect(() => {
    writeStoredCollapsedSectionIds(storageKey, collapsedSectionIds);
  }, [collapsedSectionIds, storageKey]);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setCollapsedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const isSectionCollapsed = useCallback(
    (sectionId: string) => collapsedSectionIds.has(sectionId),
    [collapsedSectionIds]
  );

  const expandAllSections = useCallback(() => {
    setCollapsedSectionIds(new Set());
  }, []);

  const collapseAllSections = useCallback(() => {
    if (collapsibleSectionIdSet.size === 0) {
      return;
    }
    setCollapsedSectionIds(new Set(collapsibleSectionIdSet));
  }, [collapsibleSectionIdSet]);

  return {
    collapsedSectionIds,
    collapseAllSections,
    expandAllSections,
    hasCollapsibleSections: collapsibleSectionIdSet.size > 0,
    isSectionCollapsed,
    toggleSectionCollapse
  };
}
