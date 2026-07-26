import type { NotebookDocument } from "../types";
import { stringifyJsonWithCompactLeaves } from "../jsonFormat";
import { validateNotebookSchemaObject, type NotebookValidationIssue } from "../validation";
import type { CompactYamlFormatOptions } from "./documentTypes";
import { parseJsonNotebookSource } from "./jsonSourceParse";
import { notebookToMarkdown, parseMarkdownNotebookSource } from "./markdownNotebook";
import {
  normalizeNotebookDocument,
  normalizeNotebookObject,
  serializeNotebookCell,
  serializeNotebookDocument
} from "./notebookSerialize";
import {
  analyzeNotebookSourceWithPipeline,
  createNotebookSourceDiagnostic,
  parseNotebookSourceWithPipeline,
  type NotebookSourceAnalysis,
  type NotebookSourceDiagnostic,
  type NotebookSourceFormat,
  type NotebookSourcePipeline
} from "./sourcePipeline";
import { formatLabelForSourceFormat, locateSchemaDiagnosticInSource, looksLikeYamlNotebookSource } from "./schemaDiagnostics";
import { parseYamlNotebookSource } from "./yamlSourceParse";
import { notebookToCompactYaml } from "./yamlCompactEnvelope";

export type { NotebookSourceAnalysis, NotebookSourceDiagnostic, NotebookSourceFormat } from "./sourcePipeline";
export { createNotebookSourceDiagnostic } from "./sourcePipeline";
export type { NotebookScenarioDefinition, NotebookScenarioShock } from "./scenarioFormat";
export { normalizeScenarioFromNotebook, serializeScenarioForNotebook } from "./scenarioFormat";
export type { CompactYamlFormatOptions } from "./documentTypes";

type ParsedNotebookSource =
  | { kind: "json"; value: Partial<NotebookDocument> }
  | { document: NotebookDocument; kind: "markdown" }
  | { kind: "yaml"; value: Partial<NotebookDocument> };

function buildJsonSchemaTarget(value: Partial<NotebookDocument>): unknown {
  try {
    return serializeNotebookDocument(normalizeNotebookObject(value, "JSON"));
  } catch {
    return value;
  }
}

const notebookSourcePipeline: NotebookSourcePipeline<ParsedNotebookSource, NotebookDocument> = {
  buildDocument(parsed) {
    return parsed.kind === "markdown"
      ? parsed.document
      : normalizeNotebookObject(parsed.value, parsed.kind === "yaml" ? "YAML" : "JSON");
  },
  detectFormat: detectNotebookSourceFormat,
  fallbackFormat: "json",
  formatLabel: formatLabelForSourceFormat,
  locateSchemaDiagnostic({ allIssues, format, issue, source }) {
    return locateSchemaDiagnosticInSource(
      source,
      format,
      issue as NotebookValidationIssue,
      allIssues as NotebookValidationIssue[]
    );
  },
  parseSource(source, format) {
    if (format === "json") {
      const parsed = parseJsonNotebookSource(source);
      return parsed.ok
        ? {
            ok: true,
            parsed: { kind: "json", value: parsed.value },
            schemaTarget: buildJsonSchemaTarget(parsed.value)
          }
        : parsed;
    }

    if (format === "yaml") {
      const parsed = parseYamlNotebookSource(source);
      return parsed.ok
        ? {
            ok: true,
            parsed: { kind: "yaml", value: parsed.value },
            schemaTarget: buildJsonSchemaTarget(parsed.value)
          }
        : parsed;
    }

    const parsed = parseMarkdownNotebookSource(source);
    return parsed.ok
      ? {
          ok: true,
          parsed: { document: parsed.document, kind: "markdown" },
          schemaTarget: serializeNotebookDocument(parsed.document)
        }
      : parsed;
  },
  validateSchema: validateNotebookSchemaObject
};

export function notebookToJson(document: NotebookDocument): string {
  return stringifyJsonWithCompactLeaves(serializeNotebookDocument(document));
}

export { notebookToMarkdown, notebookToCompactYaml, serializeNotebookCell };
export { graftYamlComments, type YamlCommentGraftResult } from "./yamlCommentGraft";
export { stampYamlSourceFileName } from "./yamlSourceStamp";
export { applyAbmInlineCommentDescriptions } from "./yamlAbmCommentDescriptions";


export function notebookFromJson(source: string): NotebookDocument {
  return parseNotebookSource(source, "json").document;
}

export function notebookFromMarkdown(source: string): NotebookDocument {
  return parseNotebookSource(source, "markdown").document;
}

export function notebookFromYaml(source: string): NotebookDocument {
  return parseNotebookSource(source, "yaml").document;
}

export function detectNotebookSourceFormat(source: string): NotebookSourceFormat {
  const normalized = source.trimStart();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return "json";
  }
  // YAML notebooks often start with `#` comments; prefer YAML when the body looks like one.
  if (looksLikeYamlNotebookSource(normalized)) {
    return "yaml";
  }
  if (normalized.startsWith("#")) {
    return "markdown";
  }
  throw new Error("Unable to detect notebook format. Expected JSON, Markdown, or YAML.");
}

export function parseNotebookSource(
  source: string,
  preferredFormat?: NotebookSourceFormat
): { document: NotebookDocument; format: NotebookSourceFormat } {
  return parseNotebookSourceWithPipeline(source, preferredFormat, notebookSourcePipeline);
}

export function analyzeNotebookSource(
  source: string,
  preferredFormat?: NotebookSourceFormat
): NotebookSourceAnalysis<NotebookDocument> {
  return analyzeNotebookSourceWithPipeline(source, preferredFormat, notebookSourcePipeline);
}

export {
  normalizeNotebookCell,
  normalizeNotebookDocument,
  serializeNotebookDocument
} from "./notebookSerialize";
