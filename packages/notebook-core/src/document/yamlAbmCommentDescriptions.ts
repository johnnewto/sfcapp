import {
  isMap,
  isScalar,
  isSeq,
  type Document as YamlDocument,
  type Pair,
  type YAMLMap,
  type YAMLSeq
} from "yaml";

import type { AbmModelCell, NotebookCell, NotebookDocument } from "../types";

function trimComment(comment: string | null | undefined): string | undefined {
  if (typeof comment !== "string") {
    return undefined;
  }
  const trimmed = comment.replace(/^\s+/, "").replace(/\s+$/, "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scalarKey(node: unknown): string | null {
  if (!isScalar(node) || node.value == null) {
    return null;
  }
  return String(node.value);
}

function readMapValueComment(pair: Pair): string | undefined {
  const value = pair.value as { comment?: string | null } | null | undefined;
  return trimComment(value?.comment ?? null);
}

/**
 * Harvest trailing `# ...` comments from abm-model YAML into descriptions:
 * - `params` / population `params` map values → `record.descriptions`
 *   (trailing value comments win over block comments above the key)
 * - tick `do`/`for` equation rows with only `[name, expr]` → third description slot
 *
 * Explicit third-slot / `record.descriptions` entries win over comments.
 */
export function applyAbmInlineCommentDescriptions(
  yamlDocument: YamlDocument,
  notebook: Pick<NotebookDocument, "cells"> | Partial<NotebookDocument>
): void {
  if (!Array.isArray(notebook.cells) || !yamlDocument.contents) {
    return;
  }

  const cellsNode = isMap(yamlDocument.contents)
    ? yamlDocument.contents.get("cells", true)
    : null;
  if (!isSeq(cellsNode)) {
    return;
  }

  cellsNode.items.forEach((cellNode, index) => {
    if (!isMap(cellNode)) {
      return;
    }
    const abmRoot = cellNode.get("abm-model", true);
    if (!isMap(abmRoot)) {
      return;
    }

    const notebookCell = notebook.cells?.[index];
    const abmCell =
      notebookCell && isAbmModelCell(notebookCell)
        ? notebookCell
        : findAbmCellById(notebook.cells ?? [], readAbmCellId(abmRoot));
    if (!abmCell) {
      return;
    }

    const descriptions = collectExistingDescriptions(abmCell);
    harvestParamMapComments(abmRoot.get("params", true), descriptions);
    harvestPopulationParamComments(abmRoot.get("populations", true), descriptions);
    harvestTickEquationComments(abmRoot.get("ticks", true), abmCell, descriptions);
    writeRecordDescriptions(abmCell, descriptions);
  });
}

function isAbmModelCell(cell: NotebookCell): cell is AbmModelCell {
  return cell.type === "abm-model";
}

function findAbmCellById(cells: NotebookCell[], id: string | null): AbmModelCell | null {
  if (!id) {
    return null;
  }
  return cells.find((cell): cell is AbmModelCell => cell.type === "abm-model" && cell.id === id) ?? null;
}

function readAbmCellId(abmRoot: YAMLMap): string | null {
  const idNode = abmRoot.get("id", true);
  return isScalar(idNode) && idNode.value != null ? String(idNode.value) : null;
}

function collectExistingDescriptions(cell: AbmModelCell): Record<string, string> {
  const descriptions: Record<string, string> = {};

  const absorb = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return;
    }
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        descriptions[name] = value.trim();
      }
    }
  };

  if (Array.isArray(cell.record)) {
    for (const item of cell.record) {
      if (item && typeof item === "object" && !Array.isArray(item) && "descriptions" in item) {
        absorb((item as { descriptions?: unknown }).descriptions);
      }
    }
    return descriptions;
  }

  const record =
    cell.record && typeof cell.record === "object" ? (cell.record as Record<string, unknown>) : {};
  absorb(record.descriptions);
  return descriptions;
}

function writeRecordDescriptions(cell: AbmModelCell, descriptions: Record<string, string>): void {
  if (Object.keys(descriptions).length === 0) {
    return;
  }

  if (Array.isArray(cell.record)) {
    const directives = cell.record.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : item
    );
    const existingIdx = directives.findIndex(
      (item) => item && typeof item === "object" && !Array.isArray(item) && "descriptions" in item
    );
    if (existingIdx >= 0) {
      const entry = directives[existingIdx] as Record<string, unknown>;
      const prior =
        entry.descriptions && typeof entry.descriptions === "object" && !Array.isArray(entry.descriptions)
          ? (entry.descriptions as Record<string, unknown>)
          : {};
      entry.descriptions = { ...prior, ...descriptions };
      directives[existingIdx] = entry;
    } else {
      directives.push({ descriptions });
    }
    cell.record = directives as AbmModelCell["record"];
    return;
  }

  const record =
    cell.record && typeof cell.record === "object" && !Array.isArray(cell.record)
      ? { ...(cell.record as Record<string, unknown>) }
      : {};
  record.descriptions = descriptions;
  cell.record = record as AbmModelCell["record"];
}

function harvestParamMapComments(paramsNode: unknown, into: Record<string, string>): void {
  if (!isMap(paramsNode)) {
    return;
  }

  for (const pair of paramsNode.items as Pair[]) {
    const key = scalarKey(pair.key);
    if (!key || into[key]) {
      continue;
    }
    // Prefer trailing value comments (`alpha1: {…} # desc`) over block comments above the key.
    const trailing = readMapValueComment(pair);
    if (trailing) {
      into[key] = trailing;
      continue;
    }
    const beforeKey = trimComment((pair.key as { commentBefore?: string | null }).commentBefore);
    if (beforeKey) {
      into[key] = beforeKey;
    }
  }

  // Comment above the first key is stored on the map (`commentBefore`) when there is
  // no per-key trailing / key-before comment.
  const firstPair = paramsNode.items[0] as Pair | undefined;
  const firstKey = firstPair ? scalarKey(firstPair.key) : null;
  const mapBefore = trimComment(paramsNode.commentBefore);
  if (firstKey && mapBefore && !into[firstKey]) {
    into[firstKey] = mapBefore;
  }
}

function harvestPopulationParamComments(populationsNode: unknown, into: Record<string, string>): void {
  if (!isSeq(populationsNode)) {
    return;
  }
  for (const pop of populationsNode.items) {
    if (!isMap(pop)) {
      continue;
    }
    harvestParamMapComments(pop.get("params", true), into);
  }
}

function harvestTickEquationComments(
  ticksNode: unknown,
  cell: AbmModelCell,
  descriptions: Record<string, string>
): void {
  const cellTicks = Array.isArray(cell.ticks) ? cell.ticks : null;
  if (!isSeq(ticksNode) || !cellTicks) {
    return;
  }

  ticksNode.items.forEach((tickNode, tickIndex) => {
    if (!isMap(tickNode)) {
      return;
    }
    const cellTick = cellTicks[tickIndex];
    if (!cellTick || typeof cellTick !== "object") {
      return;
    }

    const doRows = tickNode.get("do", true);
    if (isSeq(doRows) && "do" in (cellTick as Record<string, unknown>)) {
      applyEquationRowComments(doRows, (cellTick as { do: unknown }).do, descriptions);
    }

    const forBody = tickNode.get("for", true);
    if (isMap(forBody) && "for" in (cellTick as Record<string, unknown>)) {
      const cellFor = (cellTick as { for: Record<string, unknown> }).for;
      if (cellFor && typeof cellFor === "object") {
        for (const pair of forBody.items as Pair[]) {
          const population = scalarKey(pair.key);
          if (!population) {
            continue;
          }
          applyEquationRowComments(pair.value, cellFor[population], descriptions);
        }
      }
    }

    // Typed ticks: { kind: "aggregate"|"agent", equations: [...] }
    const equations = tickNode.get("equations", true);
    if (isSeq(equations) && "equations" in (cellTick as Record<string, unknown>)) {
      applyEquationRowComments(equations, (cellTick as { equations: unknown }).equations, descriptions);
    }
  });
}

function applyEquationRowComments(
  yamlRows: unknown,
  cellRows: unknown,
  descriptions: Record<string, string>
): void {
  if (!isSeq(yamlRows) || !Array.isArray(cellRows)) {
    return;
  }

  yamlRows.items.forEach((rowNode, index) => {
    const cellRow = cellRows[index];
    if (!Array.isArray(cellRow) || cellRow.length < 2) {
      return;
    }
    const name = String(cellRow[0] ?? "").trim();
    if (!name) {
      return;
    }

    const comment = trimComment((rowNode as { comment?: string | null })?.comment);
    if (!comment) {
      return;
    }

    if (cellRow.length === 2) {
      cellRow.push(comment);
    }
    if (!descriptions[name]) {
      descriptions[name] = comment;
    }
  });
}
