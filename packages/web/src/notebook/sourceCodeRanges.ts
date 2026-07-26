import {
  notebookToMarkdown,
  serializeNotebookCell,
  type NotebookSourceDiagnostic,
  type NotebookSourceFormat
} from "./document";
import type { NotebookDocument } from "./types";
import { parseLenientJsonValue } from "@sfcr/notebook-core";
import { stringifyJsonWithCompactLeaves } from "../lib/jsonFormat";

export interface SourceRange {
  from: number;
  to: number;
}

export function resolveDiagnosticRange(
  issue: NotebookSourceDiagnostic,
  documentLength: number
): { from: number; to: number } {
  const from = Math.max(0, Math.min(issue.offset ?? 0, documentLength));
  const desiredTo = issue.endOffset ?? from + 1;
  const to = Math.max(from + (documentLength > from ? 1 : 0), Math.min(desiredTo, documentLength));
  return { from, to };
}

export function resolveSelectedCellSourceRange(args: {
  document: NotebookDocument;
  format: NotebookSourceFormat;
  selectedCellId: string | null;
  source: string;
}): SourceRange | null {
  if (!args.selectedCellId) {
    return null;
  }

  const cell = args.document.cells.find((candidate) => candidate.id === args.selectedCellId);
  if (!cell) {
    return null;
  }

  if (args.format === "json") {
    const serializedCell = stringifyJsonWithCompactLeaves(serializeNotebookCell(cell));
    const exactMatchIndex = args.source.indexOf(serializedCell);
    if (exactMatchIndex >= 0) {
      return {
        from: exactMatchIndex,
        to: exactMatchIndex + serializedCell.length
      };
    }

    return resolveJsonCellSourceRange(args.source, cell.id);
  }

  if (args.format === "yaml") {
    return resolveYamlCellSourceRange(args.source, cell.id);
  }

  const markdownSource = notebookToMarkdown({
    ...args.document,
    cells: [cell]
  });
  const sectionSource = markdownSource.replace(/^#\s+.+?\n\n/, "").trim();
  const exactMatchIndex = args.source.indexOf(sectionSource);
  if (exactMatchIndex < 0) {
    return null;
  }

  return {
    from: exactMatchIndex,
    to: exactMatchIndex + sectionSource.length
  };
}

function resolveYamlCellSourceRange(source: string, cellId: string): SourceRange | null {
  const idPattern = new RegExp(`(^|\\n)(\\s*-\\s+id:\\s+|\\s+id:\\s+)["']?${escapeRegExp(cellId)}["']?(?:\\s|$)`);
  const match = source.match(idPattern);
  if (!match || match.index == null) {
    return null;
  }

  const idLineStart = match.index + match[1].length;
  const wrapperStart = findYamlWrappedCellStart(source, idLineStart) ?? idLineStart;
  const wrapperIndent = resolveYamlWrapperIndent(source, wrapperStart);
  const nextCellPattern = new RegExp(`\\n${escapeRegExp(wrapperIndent)}-\\s+[A-Za-z][\\w-]*:\\s*`, "g");
  nextCellPattern.lastIndex = wrapperStart + 1;
  const nextMatch = nextCellPattern.exec(source);
  return {
    from: wrapperStart,
    to: nextMatch?.index ?? source.length
  };
}

function findYamlWrappedCellStart(source: string, from: number): number | null {
  let scanIndex = from;
  while (scanIndex > 0) {
    const lineStart = source.lastIndexOf("\n", scanIndex - 1) + 1;
    const lineEnd = source.indexOf("\n", lineStart);
    const line = source.slice(lineStart, lineEnd >= 0 ? lineEnd : source.length);
    if (/^\s*-\s+[A-Za-z][\w-]*:\s*$/.test(line)) {
      return lineStart;
    }
    if (lineStart === 0) {
      break;
    }
    scanIndex = lineStart - 1;
  }
  return null;
}

function resolveYamlWrapperIndent(source: string, wrapperStart: number): string {
  const lineEnd = source.indexOf("\n", wrapperStart);
  const line = source.slice(wrapperStart, lineEnd >= 0 ? lineEnd : source.length);
  const indentMatch = line.match(/^(\s*)-\s+/);
  return indentMatch?.[1] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveJsonCellSourceRange(source: string, cellId: string): SourceRange | null {
  const idToken = `"id": "${cellId}"`;
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const matchIndex = source.indexOf(idToken, searchIndex);
    if (matchIndex < 0) {
      return null;
    }

    const objectStart = findEnclosingJsonObjectStart(source, matchIndex);
    if (objectStart == null) {
      return null;
    }

    const objectEnd = findMatchingJsonObjectEnd(source, objectStart);
    if (objectEnd == null) {
      return null;
    }

    try {
      const parsed = parseLenientJsonValue(source.slice(objectStart, objectEnd + 1)) as { id?: unknown };
      if (parsed.id === cellId) {
        return {
          from: objectStart,
          to: objectEnd + 1
        };
      }
    } catch {
      // Continue searching in case the enclosing object was not the cell object.
    }

    searchIndex = matchIndex + idToken.length;
  }

  return null;
}

function findEnclosingJsonObjectStart(source: string, anchorIndex: number): number | null {
  const objectStack: number[] = [];
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < anchorIndex; index += 1) {
    const character = source[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      objectStack.push(index);
      continue;
    }

    if (character === "}") {
      objectStack.pop();
    }
  }

  return objectStack.at(-1) ?? null;
}

function findMatchingJsonObjectEnd(source: string, startIndex: number): number | null {
  let inString = false;
  let isEscaped = false;
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}
