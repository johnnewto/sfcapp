import type { NotebookDocument } from "../types";
import { parseLenientJsonValue } from "../lenientJsonParse";
import { createNotebookSourceDiagnostic, type NotebookSourceDiagnostic } from "./sourcePipeline";
import { offsetToLineColumn } from "./documentUtils";

export function parseJsonNotebookSource(
  source: string
):
  | { ok: true; value: Partial<NotebookDocument> }
  | { diagnostics: NotebookSourceDiagnostic[]; ok: false } {
  try {
    const parsed = parseLenientJsonValue(source) as Partial<NotebookDocument>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        diagnostics: [
          {
            ...createNotebookSourceDiagnostic({
              message: "Notebook JSON must be an object.",
              phase: "parse"
            })
          }
        ],
        ok: false
      };
    }

    return { ok: true, value: parsed };
  } catch (error) {
    return {
      diagnostics: [buildJsonParseDiagnostic(source, error)],
      ok: false
    };
  }
}

function buildJsonParseDiagnostic(source: string, error: unknown): NotebookSourceDiagnostic {
  const message = error instanceof Error ? error.message : "Unable to parse JSON notebook source.";
  const offsetMatch = message.match(/at\s+(\d+)/i) ?? message.match(/position\s+(\d+)/i);
  const offset = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : undefined;
  const position = offset == null ? null : offsetToLineColumn(source, offset);
  return {
    ...createNotebookSourceDiagnostic({
      column: position?.column,
      line: position?.line,
      message: `Notebook JSON parse failed: ${message}`,
      offset,
      phase: "parse"
    }),
    column: position?.column,
    line: position?.line,
    message: `Notebook JSON parse failed: ${message}`,
    offset,
    phase: "parse"
  };
}
