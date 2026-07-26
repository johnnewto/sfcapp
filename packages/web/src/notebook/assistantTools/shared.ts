import { isRowComment } from "@sfcr/notebook-core";
import { parseExpression } from "@sfcr/core";

import type { EquationRow, ExternalRow } from "../../lib/editorModel";
import type { UnitMeta } from "../../lib/unitMeta";
import { buildDependencyGraph } from "../dependencyGraph";
import { isBareVariableName } from "../chartSeries";
import { buildEditorStateForNotebookModel, resolveRunCellModelKey } from "../modelSections";
import { previewNotebookPatch as previewPatch, type NotebookPatch, type NotebookPatchOperation, type NotebookPatchResult } from "../notebookPatch";
import type { ChartCell, EquationsCell, ExternalsCell, InitialValuesCell, MarkdownCell, MatrixCell, NotebookCell, NotebookDocument, RunCell, SolverCell, TableCell } from "../types";
import type { NotebookAssistantSnapshot } from "./types";

type VariableUnitMetaTarget =
  | { cell: EquationsCell; property: "equations"; row: EquationRow; rowIndex: number }
  | { cell: ExternalsCell; property: "externals"; row: ExternalRow; rowIndex: number };

type VariableDescriptionTarget =
  | { cell: EquationsCell; property: "equations"; row: EquationRow; rowIndex: number }
  | { cell: ExternalsCell; property: "externals"; row: ExternalRow; rowIndex: number };

export function resolveVariableUnitMetaTarget(
  snapshot: NotebookAssistantSnapshot,
  variable: string,
  modelId?: string
) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  const targets: VariableUnitMetaTarget[] = [];

  for (const cell of snapshot.document.cells) {
    if (cell.type === "equations" && (!modelId || cell.modelId === modelId)) {
      const rowIndex = cell.equations.findIndex(
        (equation) => !isRowComment(equation) && equation.name.trim() === normalizedVariable
      );
      if (rowIndex >= 0) {
        const row = cell.equations[rowIndex];
        if (row && !isRowComment(row)) {
          targets.push({ cell, property: "equations", row, rowIndex });
        }
      }
    }
    if (cell.type === "externals" && (!modelId || cell.modelId === modelId)) {
      const rowIndex = cell.externals.findIndex(
        (external) => !isRowComment(external) && external.name.trim() === normalizedVariable
      );
      if (rowIndex >= 0) {
        const row = cell.externals[rowIndex];
        if (row && !isRowComment(row)) {
          targets.push({ cell, property: "externals", row, rowIndex });
        }
      }
    }
  }

  if (targets.length === 0) {
    throw new Error(modelId ? `Unknown variable '${normalizedVariable}' for model '${modelId}'.` : `Unknown variable: ${normalizedVariable}`);
  }
  if (!modelId && new Set(targets.map((target) => target.cell.modelId)).size > 1) {
    throw new Error(`Variable '${normalizedVariable}' appears in multiple models; provide modelId.`);
  }

  return {
    ...(targets[0] as VariableUnitMetaTarget),
    variable: normalizedVariable
  };
}

export function resolveVariableDescriptionTarget(
  snapshot: NotebookAssistantSnapshot,
  modelId: string,
  variable: string
) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  const targets: VariableDescriptionTarget[] = [];
  const equationsCell = resolveOptionalModelCell(snapshot, modelId, "equations");
  const externalsCell = resolveOptionalModelCell(snapshot, modelId, "externals");

  if (equationsCell) {
    const rowIndex = equationsCell.equations.findIndex(
      (equation) => !isRowComment(equation) && equation.name.trim() === normalizedVariable
    );
    if (rowIndex >= 0) {
      const row = equationsCell.equations[rowIndex];
      if (row && !isRowComment(row)) {
        targets.push({ cell: equationsCell, property: "equations", row, rowIndex });
      }
    }
  }
  if (externalsCell) {
    const rowIndex = externalsCell.externals.findIndex(
      (external) => !isRowComment(external) && external.name.trim() === normalizedVariable
    );
    if (rowIndex >= 0) {
      const row = externalsCell.externals[rowIndex];
      if (row && !isRowComment(row)) {
        targets.push({ cell: externalsCell, property: "externals", row, rowIndex });
      }
    }
  }

  if (targets.length === 0) {
    throw new Error(`Unknown variable '${normalizedVariable}' for model '${modelId}'.`);
  }
  if (targets.length > 1) {
    throw new Error(`Variable '${normalizedVariable}' is ambiguous in model '${modelId}'.`);
  }

  return targets[0] as VariableDescriptionTarget;
}

export function normalizeVariableUnitMetaPatchValue(args: {
  displayUnit?: string;
  existingUnitMeta?: UnitMeta;
  stockFlow?: UnitMeta["stockFlow"];
  unitMeta?: UnitMeta;
}): UnitMeta {
  const base = args.unitMeta ?? args.existingUnitMeta ?? {};
  const displayUnit = args.displayUnit ?? base.displayUnit;
  return {
    ...base,
    ...(displayUnit ? { displayUnit } : {}),
    signature: base.signature ?? {},
    stockFlow: args.stockFlow ?? base.stockFlow ?? "aux"
  };
}

export function listModelContexts(snapshot: NotebookAssistantSnapshot) {
  const contexts: Array<{
    editor: NonNullable<ReturnType<typeof buildEditorStateForNotebookModel>>;
    modelId: string;
    title: string;
  }> = [];
  const seen = new Set<string>();

  for (const run of snapshot.document.cells.filter((cell): cell is RunCell => cell.type === "run")) {
    const modelKey = resolveRunCellModelKey(snapshot.document.cells, run);
    if (!modelKey || seen.has(modelKey)) {
      continue;
    }
    const editor = buildEditorStateForNotebookModel(snapshot.document, run);
    if (!editor) {
      continue;
    }
    seen.add(modelKey);
    contexts.push({
      editor,
      modelId: modelKey.replace(/^model:/, "").replace(/^cell:/, ""),
      title: resolveModelTitle(snapshot.document, run) ?? run.title
    });
  }

  return contexts;
}

function resolveOptionalModelCell<T extends NotebookCell["type"]>(
  snapshot: NotebookAssistantSnapshot,
  modelId: string,
  type: T
): Extract<NotebookCell, { type: T; modelId: string }> | null {
  const normalizedModelId = normalizeRequiredName(modelId, "modelId");
  const matches = snapshot.document.cells.filter(
    (cell): cell is Extract<NotebookCell, { type: T; modelId: string }> =>
      cell.type === type && "modelId" in cell && cell.modelId === normalizedModelId
  );
  if (matches.length > 1) {
    throw new Error(`Model '${normalizedModelId}' has multiple '${type}' cells; use a more specific helper.`);
  }
  return matches[0] ?? null;
}

export function resolveEquationsCell(snapshot: NotebookAssistantSnapshot, modelId: string): EquationsCell {
  const cell = resolveOptionalModelCell(snapshot, modelId, "equations");
  if (!cell) {
    throw new Error(`Unknown equations model id: ${modelId}`);
  }
  return cell;
}

export function resolveExternalsCell(snapshot: NotebookAssistantSnapshot, modelId: string): ExternalsCell {
  const cell = resolveOptionalModelCell(snapshot, modelId, "externals");
  if (!cell) {
    throw new Error(`Unknown externals model id: ${modelId}`);
  }
  return cell;
}

export function resolveInitialValuesCell(snapshot: NotebookAssistantSnapshot, modelId: string): InitialValuesCell {
  const cell = resolveOptionalModelCell(snapshot, modelId, "initial-values");
  if (!cell) {
    throw new Error(`Unknown initial-values model id: ${modelId}`);
  }
  return cell;
}

function resolveSolverCell(snapshot: NotebookAssistantSnapshot, modelId: string): SolverCell {
  const cell = resolveOptionalModelCell(snapshot, modelId, "solver");
  if (!cell) {
    throw new Error(`Unknown solver model id: ${modelId}`);
  }
  return cell;
}

export function resolveSolverCellForRun(snapshot: NotebookAssistantSnapshot, run: RunCell): SolverCell {
  if (run.sourceModelId) {
    return resolveSolverCell(snapshot, run.sourceModelId);
  }
  if (run.sourceModelCellId) {
    const matchingRun = snapshot.document.cells.find(
      (cell): cell is RunCell =>
        cell.type === "run" && cell.sourceModelCellId === run.sourceModelCellId && Boolean(cell.sourceModelId)
    );
    if (matchingRun?.sourceModelId) {
      return resolveSolverCell(snapshot, matchingRun.sourceModelId);
    }
  }
  throw new Error(`Run '${run.id}' does not resolve to a solver cell.`);
}

export function resolveRunModelSource(
  snapshot: NotebookAssistantSnapshot,
  args: { sourceModelCellId?: string; sourceModelId?: string }
) {
  const sourceModelId = args.sourceModelId?.trim();
  const sourceModelCellId = args.sourceModelCellId?.trim();
  if (!sourceModelId && !sourceModelCellId) {
    throw new Error("Provide sourceModelId or sourceModelCellId.");
  }
  if (sourceModelId) {
    const hasModel = snapshot.document.cells.some(
      (cell) => "modelId" in cell && typeof cell.modelId === "string" && cell.modelId === sourceModelId
    );
    if (!hasModel) {
      throw new Error(`Unknown model id: ${sourceModelId}`);
    }
  }
  if (sourceModelCellId) {
    const modelCell = snapshot.document.cells.find((cell) => cell.type === "model" && cell.id === sourceModelCellId);
    if (!modelCell) {
      throw new Error(`Unknown model cell: ${sourceModelCellId}`);
    }
  }

  return {
    ...(sourceModelId ? { sourceModelId } : {}),
    ...(sourceModelCellId ? { sourceModelCellId } : {})
  };
}

export function resolveBaselineRunForScenario(
  snapshot: NotebookAssistantSnapshot,
  args: { baselineRunCellId?: string; sourceModelCellId?: string; sourceModelId?: string }
) {
  if (args.baselineRunCellId) {
    const run = resolveRunCell(snapshot, args.baselineRunCellId, "baselineRunCellId");
    if (run.mode !== "baseline") {
      throw new Error(`Run '${run.id}' is not a baseline run.`);
    }
    return run;
  }

  const candidates = snapshot.document.cells.filter((cell): cell is RunCell => {
    if (cell.type !== "run" || cell.mode !== "baseline") {
      return false;
    }
    if (args.sourceModelId && cell.sourceModelId === args.sourceModelId) {
      return true;
    }
    if (args.sourceModelCellId && cell.sourceModelCellId === args.sourceModelCellId) {
      return true;
    }
    return false;
  });
  if (candidates.length === 0) {
    throw new Error("No baseline run found for the requested model.");
  }
  if (candidates.length > 1) {
    throw new Error("Multiple baseline runs match the requested model; provide baselineRunCellId.");
  }
  return candidates[0] as RunCell;
}

export function resolveEquationRow(cell: EquationsCell, variable: string) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  const rowIndex = cell.equations.findIndex(
    (equation) => !isRowComment(equation) && equation.name.trim() === normalizedVariable
  );
  if (rowIndex < 0) {
    throw new Error(`Unknown equation '${normalizedVariable}' for model '${cell.modelId}'.`);
  }
  const row = cell.equations[rowIndex];
  if (!row || isRowComment(row)) {
    throw new Error(`Unknown equation '${normalizedVariable}' for model '${cell.modelId}'.`);
  }
  return { row, rowIndex };
}

export function resolveExternalRow(cell: ExternalsCell, variable: string) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  const rowIndex = cell.externals.findIndex(
    (external) => !isRowComment(external) && external.name.trim() === normalizedVariable
  );
  if (rowIndex < 0) {
    throw new Error(`Unknown parameter '${normalizedVariable}' for model '${cell.modelId}'.`);
  }
  const row = cell.externals[rowIndex];
  if (!row || isRowComment(row)) {
    throw new Error(`Unknown parameter '${normalizedVariable}' for model '${cell.modelId}'.`);
  }
  return { row, rowIndex };
}

export function resolveInitialValueRow(cell: InitialValuesCell, variable: string) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  const rowIndex = cell.initialValues.findIndex(
    (initialValue) => !isRowComment(initialValue) && initialValue.name.trim() === normalizedVariable
  );
  if (rowIndex < 0) {
    throw new Error(`Unknown initial value '${normalizedVariable}' for model '${cell.modelId}'.`);
  }
  return { row: cell.initialValues[rowIndex] as InitialValuesCell["initialValues"][number], rowIndex };
}

export function resolveRunCell(snapshot: NotebookAssistantSnapshot, reference: string, label: string): RunCell {
  return resolveCellByIdOrTitle(snapshot, reference, label, "run", (cell): cell is RunCell => cell.type === "run");
}

export function resolveChartCell(snapshot: NotebookAssistantSnapshot, reference: string, label: string): ChartCell {
  return resolveCellByIdOrTitle(snapshot, reference, label, "chart", (cell): cell is ChartCell => cell.type === "chart");
}

export function resolveTableCell(snapshot: NotebookAssistantSnapshot, reference: string, label: string): TableCell {
  return resolveCellByIdOrTitle(snapshot, reference, label, "table", (cell): cell is TableCell => cell.type === "table");
}

export function resolveMatrixCell(snapshot: NotebookAssistantSnapshot, reference: string, label: string): MatrixCell {
  return resolveCellByIdOrTitle(snapshot, reference, label, "matrix", (cell): cell is MatrixCell => cell.type === "matrix");
}

function resolveMarkdownCell(snapshot: NotebookAssistantSnapshot, reference: string, label: string): MarkdownCell {
  return resolveCellByIdOrTitle(snapshot, reference, label, "markdown cell", (cell): cell is MarkdownCell => cell.type === "markdown");
}

export function resolveMarkdownCellFromArgs(
  snapshot: NotebookAssistantSnapshot,
  args: { cellId?: string; cellTitle?: string }
) {
  if (args.cellId) {
    return resolveMarkdownCell(snapshot, args.cellId, "cellId");
  }
  if (args.cellTitle) {
    return resolveMarkdownCell(snapshot, args.cellTitle, "cellTitle");
  }
  throw new Error("Provide cellId or cellTitle.");
}

function resolveCellByIdOrTitle<T extends NotebookCell>(
  snapshot: NotebookAssistantSnapshot,
  reference: string,
  label: string,
  typeLabel: string,
  predicate: (cell: NotebookCell) => cell is T
): T {
  const normalizedReference = normalizeRequiredName(reference, label);
  const byId = snapshot.document.cells.find((cell): cell is T => predicate(cell) && cell.id === normalizedReference);
  if (byId) {
    return byId;
  }

  const byTitle = snapshot.document.cells.filter(
    (cell): cell is T => predicate(cell) && cell.title.trim() === normalizedReference
  );
  if (byTitle.length === 1) {
    return byTitle[0] as T;
  }
  if (byTitle.length > 1) {
    throw new Error(`Ambiguous ${typeLabel} '${normalizedReference}'; provide the cell id.`);
  }
  throw new Error(`Unknown ${typeLabel}: ${normalizedReference}`);
}

export function resolveMatrixRow(matrix: MatrixCell, label: string) {
  const normalizedLabel = normalizeRequiredName(label, "label");
  const matches = matrix.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.label.trim() === normalizedLabel);
  if (matches.length === 0) {
    throw new Error(`Unknown matrix row '${normalizedLabel}' for matrix '${matrix.id}'.`);
  }
  if (matches.length > 1) {
    throw new Error(`Matrix '${matrix.id}' has multiple rows labeled '${normalizedLabel}'.`);
  }
  return matches[0] as { row: MatrixCell["rows"][number]; rowIndex: number };
}

export function resolveCellInsertIndex(
  snapshot: NotebookAssistantSnapshot,
  args: { insertAfterCellId?: string; insertAfterCellTitle?: string }
) {
  if (args.insertAfterCellId && args.insertAfterCellTitle) {
    throw new Error("Provide only one of insertAfterCellId or insertAfterCellTitle.");
  }
  if (args.insertAfterCellId) {
    const cell = snapshot.document.cells.find((candidate) => candidate.id === args.insertAfterCellId);
    if (!cell) {
      throw new Error(`Unknown cell id: ${args.insertAfterCellId}`);
    }
    return snapshot.document.cells.findIndex((candidate) => candidate.id === cell.id) + 1;
  }
  if (args.insertAfterCellTitle) {
    const matches = snapshot.document.cells.filter((candidate) => candidate.title.trim() === args.insertAfterCellTitle?.trim());
    if (matches.length === 0) {
      throw new Error(`Unknown cell title: ${args.insertAfterCellTitle}`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous cell title '${args.insertAfterCellTitle}'; provide insertAfterCellId.`);
    }
    return snapshot.document.cells.findIndex((candidate) => candidate.id === matches[0]?.id) + 1;
  }
  return null;
}

export function createSetCellPropertyOperation(
  cell: NotebookCell,
  property: string,
  value: unknown
): NotebookPatchOperation {
  return {
    op: Object.prototype.hasOwnProperty.call(cell, property) ? "replace" : "add",
    path: `/cells/by-id/${escapeJsonPointerSegment(cell.id)}/${property}`,
    value
  };
}

export function createSetNestedCellPropertyOperation(
  cellId: string,
  property: string,
  nestedProperty: string,
  currentValue: unknown,
  value: unknown
): NotebookPatchOperation {
  return {
    op: currentValue === undefined ? "add" : "replace",
    path: `/cells/by-id/${escapeJsonPointerSegment(cellId)}/${property}/${nestedProperty}`,
    value
  };
}

export function resolveInsertAfterVariableIndex(
  rows: Array<{ name: string } | { kind: "comment" }>,
  insertAfterVariable?: string
) {
  if (!insertAfterVariable) {
    return rows.length;
  }
  const normalizedVariable = normalizeRequiredName(insertAfterVariable, "insertAfterVariable");
  const rowIndex = rows.findIndex(
    (row) => "name" in row && row.name.trim() === normalizedVariable
  );
  if (rowIndex < 0) {
    return rows.length;
  }
  return rowIndex + 1;
}

export function resolveInsertAfterLabelIndex(
  rows: Array<{ label: string }>,
  insertAfterLabel?: string
) {
  if (!insertAfterLabel) {
    return rows.length;
  }
  const normalizedLabel = normalizeRequiredName(insertAfterLabel, "insertAfterLabel");
  const rowIndex = rows.findIndex((row) => row.label.trim() === normalizedLabel);
  if (rowIndex < 0) {
    return rows.length;
  }
  return rowIndex + 1;
}

export function ensureModelVariableNameAvailable(snapshot: NotebookAssistantSnapshot, modelId: string, variable: string) {
  const normalizedVariable = normalizeRequiredName(variable, "name");
  const equationsCell = resolveOptionalModelCell(snapshot, modelId, "equations");
  const externalsCell = resolveOptionalModelCell(snapshot, modelId, "externals");
  if (
    equationsCell?.equations.some(
      (equation) => !isRowComment(equation) && equation.name.trim() === normalizedVariable
    )
  ) {
    throw new Error(`Model '${modelId}' already defines equation '${normalizedVariable}'.`);
  }
  if (
    externalsCell?.externals.some(
      (external) => !isRowComment(external) && external.name.trim() === normalizedVariable
    )
  ) {
    throw new Error(`Model '${modelId}' already defines external '${normalizedVariable}'.`);
  }
}

export function ensureInitialValueNameAvailable(cell: InitialValuesCell, variable: string) {
  const normalizedVariable = normalizeRequiredName(variable, "variable");
  if (
    cell.initialValues.some(
      (row) => !isRowComment(row) && row.name.trim() === normalizedVariable
    )
  ) {
    throw new Error(`Model '${cell.modelId}' already has an initial value for '${normalizedVariable}'.`);
  }
}

export function validateEquationCandidate(
  snapshot: NotebookAssistantSnapshot,
  modelId: string,
  equations: EquationsCell["equations"],
  variable: string
) {
  const graph = buildDependencyGraph({
    equations,
    externals: resolveOptionalModelCell(snapshot, modelId, "externals")?.externals ?? [],
    initialValues: resolveOptionalModelCell(snapshot, modelId, "initial-values")?.initialValues ?? []
  });
  if (graph.errors.length > 0) {
    const relevantError = graph.errors.find((error) => error.includes(`(${variable})`)) ?? graph.errors[0];
    throw new Error(relevantError ?? "Unable to validate equation.");
  }
}

export function listEquationDependents(
  snapshot: NotebookAssistantSnapshot,
  modelId: string,
  variable: string
) {
  const graph = buildDependencyGraph({
    equations: resolveEquationsCell(snapshot, modelId).equations,
    externals: resolveOptionalModelCell(snapshot, modelId, "externals")?.externals ?? [],
    initialValues: resolveOptionalModelCell(snapshot, modelId, "initial-values")?.initialValues ?? []
  });
  return Array.from(
    new Set(
      graph.edges
        .filter((edge) => edge.sourceId === variable)
        .map((edge) => edge.targetId)
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function validateMatrixRowValues(matrix: MatrixCell, values: string[]) {
  if (values.length !== matrix.columns.length) {
    throw new Error(`Matrix '${matrix.id}' expects ${matrix.columns.length} values, received ${values.length}.`);
  }
}

export function createUniqueRowId(existingIds: string[], prefix: string, variable: string): string {
  return createUniqueId(new Set(existingIds), `${prefix}-${slugifyCellId(variable, prefix)}`);
}

export function resolveModelTitle(document: NotebookDocument, source: RunCell): string | null {
  const modelKey = resolveRunCellModelKey(document.cells, source);
  if (!modelKey) {
    return null;
  }

  if (modelKey.startsWith("cell:")) {
    const cellId = modelKey.slice("cell:".length);
    return document.cells.find((cell) => cell.id === cellId)?.title ?? null;
  }

  const modelId = modelKey.slice("model:".length);
  return (
    document.cells.find(
      (cell) =>
        (cell.type === "equations" ||
          cell.type === "solver" ||
          cell.type === "externals" ||
          cell.type === "initial-values" ||
          cell.type === "abm-model") &&
        cell.modelId === modelId
    )?.title ?? null
  );
}

export function requireRunResult(snapshot: NotebookAssistantSnapshot, runId: string) {
  const normalizedRunId = normalizeRequiredName(runId, "runId");
  const run = snapshot.document.cells.find(
    (cell): cell is RunCell => cell.type === "run" && cell.id === normalizedRunId
  );
  if (!run) {
    throw new Error(`Unknown run: ${normalizedRunId}`);
  }

  const output = snapshot.runtime.outputs[run.id];
  if (output?.type !== "result") {
    throw new Error(`Run '${run.id}' does not have result data.`);
  }

  return { result: output.result, run };
}

export function summarizeCellTypes(document: NotebookDocument): Record<string, number> {
  return document.cells.reduce<Record<string, number>>((counts, cell) => {
    counts[cell.type] = (counts[cell.type] ?? 0) + 1;
    return counts;
  }, {});
}

export function summarizeNotebookPatchResult(result: NotebookPatchResult) {
  return {
    ok: result.ok,
    issues: result.issues,
    summary: result.summary
  };
}

export function summarizeNotebookPatchProposal(snapshot: NotebookAssistantSnapshot, patch: NotebookPatch) {
  return {
    patch,
    preview: summarizeNotebookPatchResult(previewPatch(snapshot.document, patch))
  };
}

export function slugifyCellId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function createUniqueCellId(document: NotebookDocument, baseId: string): string {
  return createUniqueId(new Set(document.cells.map((cell) => cell.id)), baseId);
}

function createUniqueId(existingIds: Set<string>, baseId: string): string {
  let candidate = baseId;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function validateVariablesInRunResult(
  snapshot: NotebookAssistantSnapshot,
  runId: string,
  variables: string[]
): void {
  const output = snapshot.runtime.outputs[runId];
  if (output?.type !== "result") {
    return;
  }

  const seriesNames = new Set(Object.keys(output.result.series));
  const missingVariables = variables.filter((variable) => {
    const trimmed = variable.trim();
    if (!trimmed) {
      return true;
    }
    if (!isBareVariableName(trimmed)) {
      try {
        parseExpression(trimmed);
        return false;
      } catch {
        return true;
      }
    }
    return !seriesNames.has(trimmed);
  });
  if (missingVariables.length > 0) {
    throw new Error(`Run '${runId}' does not include series: ${missingVariables.join(", ")}`);
  }
}

export function normalizeRequiredName(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

export function clampPeriodIndex(periodIndex: number, periodCount: number): number {
  if (!Number.isInteger(periodIndex)) {
    throw new Error("Period index must be an integer.");
  }
  if (periodCount <= 0) {
    throw new Error("Result has no periods.");
  }
  if (periodIndex < 0 || periodIndex >= periodCount) {
    throw new Error(`Period index ${periodIndex} is outside result range 0-${periodCount - 1}.`);
  }
  return periodIndex;
}

export function finiteValue(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function serializeUnitMeta(unitMeta: UnitMeta | undefined): UnitMeta | null {
  return unitMeta ?? null;
}

