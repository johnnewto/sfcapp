import { normalizeMatrixCellAccountingKind } from "../accountingMatrixKind";
import { normalizeAbmModelCell } from "../abmModelCell";
import type { MatrixCell, NotebookCell } from "../types";
import type { NotebookYamlEnvelope } from "./documentTypes";
import { isRecord, stringValue } from "./documentUtils";
import {
  buildCompactChartCells,
  buildCompactInitialValues,
  buildCompactMatrixCell,
  buildCompactParameters,
  buildCompactSolverOptions,
  buildCompactTableCells,
  compactCellFlags,
  compactCellId,
  compactCellTitle,
  isNotebookCellType,
  normalizeRunCellExogenize,
  parseCompactEquationRows,
  parseCompactEquations,
  parseCompactExternalRows,
  parseCompactInitialValueRows
} from "./yamlCompactHelpers";

export function normalizeYamlNotebookCells(source: NotebookYamlEnvelope): NotebookYamlEnvelope {
  const { cellOrder: _cellOrder, ...rest } = source;
  return {
    ...rest,
    cells: normalizeYamlCellEntries(source.cells)
  };
}

export function normalizeYamlCellEntries(cells: unknown): NotebookCell[] {
  if (!Array.isArray(cells)) {
    return [];
  }
  return cells.map(normalizeYamlCellEntry);
}

function normalizeYamlCellEntry(cell: unknown): NotebookCell {
  return normalizeRunCellExogenize(normalizeYamlCellEntryShape(cell));
}

function normalizeYamlCellEntryShape(cell: unknown): NotebookCell {
  if (!isRecord(cell)) {
    return cell as unknown as NotebookCell;
  }
  if (typeof cell.type === "string") {
    if (cell.type === "matrix") {
      return normalizeMatrixCellAccountingKind(cell as unknown as MatrixCell);
    }
    return cell as unknown as NotebookCell;
  }

  const entries = Object.entries(cell);
  if (entries.length !== 1) {
    return cell as unknown as NotebookCell;
  }

  const [type, body] = entries[0];
  if (!isNotebookCellType(type) || !isRecord(body)) {
    return cell as unknown as NotebookCell;
  }

  return buildYamlWrappedCell(type, body);
}

function buildYamlWrappedCell(type: NotebookCell["type"], body: Record<string, unknown>): NotebookCell {
  if (Array.isArray(body[type === "initial-values" ? "initialValues" : type])) {
    return normalizeRawYamlWrappedCell(type, body);
  }

  switch (type) {
    case "markdown":
      return {
        id: compactCellId(body, "markdown"),
        type,
        title: compactCellTitle(body, "Markdown"),
        source: stringValue(body.source, ""),
        ...compactCellFlags(body)
      };
    case "matrix": {
      const cell = buildCompactMatrixCell(body, {
        fallbackColumns: body.sectors,
        id: "matrix",
        sourceRunCellId: typeof body.sourceRunCellId === "string" ? body.sourceRunCellId : undefined,
        title: "Matrix"
      });
      return (cell ?? normalizeRawYamlWrappedCell(type, body)) as NotebookCell;
    }
    case "equations":
      if (Array.isArray(body.equations)) {
        return normalizeRawYamlWrappedCell(type, body);
      }
      return {
        id: compactCellId(body, "equations"),
        type,
        title: compactCellTitle(body, "Equations"),
        modelId: stringValue(body.modelId, "main"),
        equations: Array.isArray(body.rows)
          ? parseCompactEquationRows(body.rows, body.variables)
          : parseCompactEquations(stringValue(body.source ?? body.equations, ""), body.variables),
        ...compactCellFlags(body)
      };
    case "externals":
      if (Array.isArray(body.externals)) {
        return normalizeRawYamlWrappedCell(type, body);
      }
      return {
        id: compactCellId(body, "externals"),
        type,
        title: compactCellTitle(body, "Externals"),
        modelId: stringValue(body.modelId, "main"),
        externals: Array.isArray(body.rows)
          ? parseCompactExternalRows(body.rows, body.variables)
          : buildCompactParameters(body.values ?? body.parameters ?? body.externals, body.variables),
        ...compactCellFlags(body)
      };
    case "observed":
      if (Array.isArray(body.externals)) {
        return normalizeRawYamlWrappedCell(type, body);
      }
      return {
        id: compactCellId(body, "observed"),
        type,
        title: compactCellTitle(body, "Observed"),
        modelId: stringValue(body.modelId, "main"),
        externals: Array.isArray(body.rows)
          ? parseCompactExternalRows(body.rows, body.variables)
          : buildCompactParameters(body.values ?? body.parameters ?? body.externals, body.variables),
        ...compactCellFlags(body)
      };
    case "initial-values":
      if (Array.isArray(body.initialValues)) {
        return normalizeRawYamlWrappedCell(type, body);
      }
      return {
        id: compactCellId(body, "initial-values"),
        type,
        title: compactCellTitle(body, "Initial values"),
        modelId: stringValue(body.modelId, "main"),
        initialValues: Array.isArray(body.rows)
          ? parseCompactInitialValueRows(body.rows)
          : buildCompactInitialValues(body.values ?? body.initialValues ?? body["initial-values"]),
        ...compactCellFlags(body)
      };
    case "solver":
      return {
        id: compactCellId(body, "solver"),
        type,
        title: compactCellTitle(body, "Solver options"),
        modelId: stringValue(body.modelId, "main"),
        options: isRecord(body.options)
          ? (body.options as unknown as Extract<NotebookCell, { type: "solver" }>["options"])
          : buildCompactSolverOptions(body),
        ...compactCellFlags(body)
      };
    case "chart":
      return buildCompactChartCells([body], stringValue(body.sourceRunCellId, ""))[0] ?? normalizeRawYamlWrappedCell(type, body);
    case "table":
      return buildCompactTableCells([body], stringValue(body.sourceRunCellId, ""))[0] ?? normalizeRawYamlWrappedCell(type, body);
    case "abm-model":
      return normalizeAbmModelCell(normalizeRawYamlWrappedCell(type, body) as Extract<NotebookCell, { type: "abm-model" }>);
    default:
      return normalizeRawYamlWrappedCell(type, body);
  }
}

function normalizeRawYamlWrappedCell(type: NotebookCell["type"], body: Record<string, unknown>): NotebookCell {
  const { id, type: _ignoredType, ...rest } = body;
  const cell = {
    ...(typeof id === "string" ? { id } : {}),
    type,
    ...rest
  } as NotebookCell;
  return type === "matrix" ? normalizeMatrixCellAccountingKind(cell as MatrixCell) : cell;
}
