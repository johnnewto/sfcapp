import { parseDocument as parseYamlDocument } from "yaml";
import type { NotebookDocument } from "../types";
import {
  NOTEBOOK_YAML_FORMAT,
  NOTEBOOK_YAML_FORMAT_VERSION,
  type NotebookYamlEnvelope
} from "./documentTypes";
import { createNotebookSourceDiagnostic, type NotebookSourceDiagnostic } from "./sourcePipeline";
import { applyAbmInlineCommentDescriptions } from "./yamlAbmCommentDescriptions";
import { compileYamlNotebookSource } from "./yamlCompile";
import { buildYamlParseDiagnostic, validateYamlDialectSource } from "./yamlDialect";

export function parseYamlNotebookSource(
  source: string
):
  | { ok: true; value: Partial<NotebookDocument> }
  | { diagnostics: NotebookSourceDiagnostic[]; ok: false } {
  const dialectDiagnostic = validateYamlDialectSource(source);
  if (dialectDiagnostic) {
    return { diagnostics: [dialectDiagnostic], ok: false };
  }

  const document = parseYamlDocument(source, {
    prettyErrors: false,
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    return {
      diagnostics: document.errors.map((error) => buildYamlParseDiagnostic(source, error)),
      ok: false
    };
  }

  const parsed = document.toJSON() as NotebookYamlEnvelope;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      diagnostics: [
        createNotebookSourceDiagnostic({
          message: "Notebook YAML must be an object.",
          phase: "parse"
        })
      ],
      ok: false
    };
  }
  if (parsed.format !== NOTEBOOK_YAML_FORMAT || parsed.formatVersion !== NOTEBOOK_YAML_FORMAT_VERSION) {
    return {
      diagnostics: [
        createNotebookSourceDiagnostic({
          message: `Notebook YAML must start with format: ${NOTEBOOK_YAML_FORMAT} and formatVersion: ${NOTEBOOK_YAML_FORMAT_VERSION}.`,
          phase: "parse"
        })
      ],
      ok: false
    };
  }

  const { format: _format, formatVersion: _formatVersion, ...notebook } = parsed;
  const compiled = compileYamlNotebookSource(notebook);
  applyAbmInlineCommentDescriptions(document, compiled);
  return { ok: true, value: compiled };
}
