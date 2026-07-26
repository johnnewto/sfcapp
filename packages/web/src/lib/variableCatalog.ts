import { equationDefinesVariable, type EquationRole } from "@sfcr/core";
import { isInitialValueEnabled, isRowComment } from "@sfcr/notebook-core";

import { buildDependencyGraph, type VariableType } from "../notebook/dependencyGraph";
import {
  buildEditorStateForNotebookModel,
  buildEditorStateFromSections,
  findEquationsCell,
  findExternalsCell,
  findInitialValuesCell,
  findSolverCell,
  resolveNotebookModelKey,
  resolveRunCellModelKey
} from "../notebook/modelSections";
import { resolveModelTitle } from "../notebook/assistantTools/shared";
import type { NotebookDocument, RunCell } from "../notebook/types";
import type { EditorState, ExternalRow } from "./editorModel";
import { buildVariableDescriptions } from "./variableDescriptions";
import { buildVariableUnitMetadata, getVariableUnitText } from "./units";
import type { SimulationResult } from "@sfcr/core";

import type { StockFlowKind, UnitMeta } from "./unitMeta";
import type { InspectorModelSource } from "./variableInspect";
import { resolveInspectorModelSource } from "./variableInspect";
import type { NotebookAssistantSnapshot } from "../notebook/assistantTools/types";
import {
  collectMatrixColumnSumRefsFromMatrices,
  evaluateMatrixColumnSumAtPeriod,
  resolveMatrixColumnSumBindingsForRef
} from "../notebook/matrixColumnSumRuntime";

type VariableCatalogEndogenousExogenous =
  | "endogenous"
  | "exogenous"
  | "initial-only"
  | "matrix-column-sum"
  | "unknown";

type VariableCatalogValueSource = "run" | "external" | "initial" | "default" | "none";

export type VariableCatalogGroupBy =
  | "none"
  | "endogenousExogenous"
  | "variableType"
  | "stockFlow"
  | "unit"
  | "equationRole"
  | "model";

export interface VariableCatalogRow {
  name: string;
  description: string | null;
  value: number | null;
  valueSource: VariableCatalogValueSource;
  endogenousExogenous: VariableCatalogEndogenousExogenous;
  variableType: VariableType | null;
  stockFlow: StockFlowKind | null;
  unitText: string | null;
  equationRole: EquationRole | null;
  modelId: string;
  modelTitle: string;
  externalKind: ExternalRow["kind"] | null;
  externalValueText: string | null;
  initialValue: number | null;
  currentDependencies: string[];
  lagDependencies: string[];
  modelSource: InspectorModelSource | null;
}

export interface CatalogModelContext {
  editor: EditorState;
  modelId: string;
  modelKey: string;
  modelTitle: string;
  modelSource: InspectorModelSource | null;
}

export function listCatalogModelContexts(document: NotebookDocument): CatalogModelContext[] {
  const contexts: CatalogModelContext[] = [];
  const seen = new Set<string>();

  for (const run of document.cells.filter((cell): cell is RunCell => cell.type === "run")) {
    const modelKey = resolveRunCellModelKey(document.cells, run);
    if (!modelKey || seen.has(modelKey)) {
      continue;
    }

    const editor = buildEditorStateForNotebookModel(document, run);
    if (!editor) {
      continue;
    }

    seen.add(modelKey);
    contexts.push({
      editor,
      modelId: modelKey.replace(/^model:/, "").replace(/^cell:/, ""),
      modelKey,
      modelTitle: resolveModelTitle(document, run) ?? run.title,
      modelSource: resolveInspectorModelSource(run)
    });
  }

  return contexts;
}

export function buildVariableCatalogRows(args: {
  document: NotebookDocument;
  currentValuesByModel?: Map<string, Record<string, number | undefined>>;
}): VariableCatalogRow[] {
  const rows: VariableCatalogRow[] = [];
  const seen = new Set<string>();

  for (const context of listCatalogModelContexts(args.document)) {
    const descriptions = buildVariableDescriptions({
      equations: context.editor.equations,
      externals: context.editor.externals
    });
    const unitMetadata = buildVariableUnitMetadata({
      equations: context.editor.equations,
      externals: context.editor.externals
    });
    const graph = buildDependencyGraph(context.editor);
    const currentValues = args.currentValuesByModel?.get(context.modelId);

    function pushCatalogRow(name: string) {
      if (seen.has(name)) {
        return;
      }
      seen.add(name);

      const node = graph.nodes.find((entry) => entry.name === name);
      const external =
        context.editor.externals.find(
          (row) => !isRowComment(row) && row.name.trim() === name
        ) ?? null;
      const initialValue = parseInitialValue(context.editor, name);
      const endogenousExogenous = node
        ? deriveEndogenousExogenous({
            editor: context.editor,
            name,
            initialValue
          })
        : deriveMatrixColumnSumEndogenousExogenous(context.editor, name);
      const unitMeta = unitMetadata.get(name);
      const { value, valueSource } = resolveCatalogValue({
        currentValues,
        editor: context.editor,
        external: external && !isRowComment(external) ? external : null,
        name,
        selectedPeriodIndex: 0
      });

      rows.push({
        name,
        description:
          descriptions.get(name) ?? node?.description ?? describeMatrixColumnSumCatalogRow(name) ?? null,
        value,
        valueSource,
        endogenousExogenous,
        variableType: node?.variableType ?? (external ? "exogenous" : null),
        stockFlow: unitMeta?.stockFlow ?? (endogenousExogenous === "matrix-column-sum" ? "flow" : null),
        unitText: getVariableUnitText(unitMetadata, name) || null,
        equationRole: node?.equationRole ?? null,
        modelId: context.modelId,
        modelTitle: context.modelTitle,
        externalKind: external && !isRowComment(external) ? external.kind : null,
        externalValueText: external && !isRowComment(external) ? external.valueText : null,
        initialValue,
        currentDependencies: node ? [...node.currentDependencyNames] : [],
        lagDependencies: node ? [...node.lagDependencyNames] : [],
        modelSource: context.modelSource
      });
    }

    for (const node of graph.nodes) {
      pushCatalogRow(node.name);
    }

    // Include equation/external names even when expressions fail to parse (ABM ticks).
    for (const equation of context.editor.equations) {
      if (!isRowComment(equation) && equation.name.trim()) {
        pushCatalogRow(equation.name.trim());
      }
    }
    for (const external of context.editor.externals) {
      if (!isRowComment(external) && external.name.trim()) {
        pushCatalogRow(external.name.trim());
      }
    }

    const preferredRun = findPreferredRunForModelKey(args.document, context.modelKey);
    if (preferredRun?.sourceModelId) {
      for (const columnRef of collectMatrixColumnSumRefsFromMatrices({
        cells: args.document.cells,
        modelId: preferredRun.sourceModelId,
        runCellId: preferredRun.id
      })) {
        pushCatalogRow(columnRef);
      }
    }
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function catalogRowGroupKey(
  row: VariableCatalogRow,
  groupBy: VariableCatalogGroupBy
): string {
  switch (groupBy) {
    case "none":
      return "";
    case "endogenousExogenous":
      return formatEndogenousExogenousLabel(row.endogenousExogenous);
    case "variableType":
      return row.variableType ?? "Unknown";
    case "stockFlow":
      return row.stockFlow ?? "Unspecified";
    case "unit":
      return row.unitText?.trim() || "No unit";
    case "equationRole":
      return row.equationRole ?? "None";
    case "model":
      return row.modelTitle;
    default:
      return "";
  }
}

export function buildCurrentValuesByModel(args: {
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  selectedPeriodIndex: number;
}): Map<string, Record<string, number | undefined>> {
  const valuesByModel = new Map<string, Record<string, number | undefined>>();

  for (const context of listCatalogModelContexts(args.document)) {
    const runCell = findPreferredRunForModelKey(args.document, context.modelKey);
    if (!runCell) {
      continue;
    }

    const result = args.getResult(runCell.id);
    if (!result) {
      continue;
    }

    valuesByModel.set(
      context.modelId,
      Object.fromEntries(
        Object.entries(result.series).map(([name, values]) => [
          name,
          values[Math.min(args.selectedPeriodIndex, Math.max(values.length - 1, 0))]
        ])
      )
    );
  }

  return valuesByModel;
}

export function buildCurrentValuesByModelFromSnapshot(
  snapshot: NotebookAssistantSnapshot,
  selectedPeriodIndex = snapshot.selectedPeriodIndex
): Map<string, Record<string, number | undefined>> {
  return buildCurrentValuesByModel({
    document: snapshot.document,
    getResult: (runCellId) => {
      const output = snapshot.runtime.outputs[runCellId];
      return output?.type === "result" ? output.result : null;
    },
    selectedPeriodIndex
  });
}

export function buildModelDisplayCurrentValues(args: {
  editor: EditorState;
  runCurrentValues?: Record<string, number | undefined>;
  selectedPeriodIndex?: number;
}): Record<string, number | undefined> {
  const selectedPeriodIndex = args.selectedPeriodIndex ?? 0;
  const runCurrentValues = args.runCurrentValues ?? {};
  const values: Record<string, number | undefined> = { ...runCurrentValues };

  for (const name of collectModelDisplayVariableNames(args.editor)) {
    if (values[name] !== undefined && Number.isFinite(values[name])) {
      continue;
    }

    const external =
      args.editor.externals.find(
        (row) => !isRowComment(row) && row.name.trim() === name
      ) ?? null;
    const { value } = resolveCatalogValue({
      currentValues: runCurrentValues,
      editor: args.editor,
      external: external && !isRowComment(external) ? external : null,
      name,
      selectedPeriodIndex
    });

    if (value != null) {
      values[name] = value;
    }
  }

  return values;
}

export function buildModelCurrentValues(args: {
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  modelRef: { modelId?: string; sourceModelId?: string; sourceModelCellId?: string };
  selectedPeriodIndex: number;
}): Record<string, number | undefined> {
  const modelKey = resolveNotebookModelKey(args.document.cells, args.modelRef);
  if (!modelKey) {
    return {};
  }

  let runCurrentValues: Record<string, number | undefined> = {};
  const sourceRunCell = findPreferredRunForModelKey(args.document, modelKey);
  if (sourceRunCell) {
    const result = args.getResult(sourceRunCell.id);
    if (result) {
      runCurrentValues = Object.fromEntries(
        Object.entries(result.series).map(([name, values]) => [
          name,
          values[Math.min(args.selectedPeriodIndex, Math.max(values.length - 1, 0))]
        ])
      );
    }
  }

  const modelId = args.modelRef.modelId ?? args.modelRef.sourceModelId;
  const editor =
    buildEditorStateForNotebookModel(args.document, args.modelRef) ??
    (typeof modelId === "string" && modelId.trim() !== ""
      ? buildEditorStateFromSections({
          equations: findEquationsCell(args.document.cells, modelId)?.equations ?? [],
          externals: findExternalsCell(args.document.cells, modelId)?.externals ?? [],
          initialValues: findInitialValuesCell(args.document.cells, modelId)?.initialValues ?? [],
          options:
            findSolverCell(args.document.cells, modelId)?.options ?? defaultModelSectionOptions()
        })
      : null);
  if (!editor) {
    return runCurrentValues;
  }

  return buildModelDisplayCurrentValues({
    editor,
    runCurrentValues: mergeMatrixColumnSumCurrentValues({
      document: args.document,
      modelKey,
      runCell: sourceRunCell,
      runCurrentValues,
      selectedPeriodIndex: args.selectedPeriodIndex,
      getResult: args.getResult
    }),
    selectedPeriodIndex: args.selectedPeriodIndex
  });
}

export function buildModelLaggedCurrentValues(args: {
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  modelRef: { modelId?: string; sourceModelId?: string; sourceModelCellId?: string };
  selectedPeriodIndex: number;
}): Record<string, number | undefined> {
  if (args.selectedPeriodIndex <= 0) {
    const modelKey = resolveNotebookModelKey(args.document.cells, args.modelRef);
    if (!modelKey) {
      return {};
    }

    const modelId = args.modelRef.modelId ?? args.modelRef.sourceModelId;
    const editor =
      buildEditorStateForNotebookModel(args.document, args.modelRef) ??
      (typeof modelId === "string" && modelId.trim() !== ""
        ? buildEditorStateFromSections({
            equations: findEquationsCell(args.document.cells, modelId)?.equations ?? [],
            externals: findExternalsCell(args.document.cells, modelId)?.externals ?? [],
            initialValues: findInitialValuesCell(args.document.cells, modelId)?.initialValues ?? [],
            options:
              findSolverCell(args.document.cells, modelId)?.options ?? defaultModelSectionOptions()
          })
        : null);
    if (!editor) {
      return {};
    }

    return buildModelDisplayCurrentValues({
      editor,
      runCurrentValues: {},
      selectedPeriodIndex: 0
    });
  }

  return buildModelCurrentValues({
    ...args,
    selectedPeriodIndex: args.selectedPeriodIndex - 1
  });
}

export function catalogRowToAssistantEntry(row: VariableCatalogRow, unitMeta: UnitMeta | undefined) {
  return {
    variable: row.name,
    modelId: row.modelId,
    modelTitle: row.modelTitle,
    description: row.description,
    unitText: row.unitText,
    unitMeta,
    variableType: row.variableType,
    equationRole: row.equationRole,
    currentDependencies: row.currentDependencies,
    lagDependencies: row.lagDependencies,
    initialValue: row.initialValue,
    externalKind: row.externalKind,
    externalValueText: row.externalValueText
  };
}

function findLatestRunForModelKey(document: NotebookDocument, modelKey: string): RunCell | null {
  let latest: RunCell | null = null;

  for (const cell of document.cells) {
    if (cell.type !== "run") {
      continue;
    }

    const cellModelKey = resolveRunCellModelKey(document.cells, cell);
    if (cellModelKey === modelKey) {
      latest = cell;
    }
  }

  return latest;
}

/** First baseline run for a model (document order). Used as the default path for stability and catalog inspect. */
function findBaselineRunForModelKey(document: NotebookDocument, modelKey: string): RunCell | null {
  for (const cell of document.cells) {
    if (cell.type !== "run" || cell.mode !== "baseline") {
      continue;
    }

    if (resolveRunCellModelKey(document.cells, cell) === modelKey) {
      return cell;
    }
  }

  return null;
}

/** Baseline run when present; otherwise the latest run for the model. */
export function findPreferredRunForModelKey(document: NotebookDocument, modelKey: string): RunCell | null {
  return findBaselineRunForModelKey(document, modelKey) ?? findLatestRunForModelKey(document, modelKey);
}

function deriveEndogenousExogenous(args: {
  editor: EditorState;
  name: string;
  initialValue: number | null;
}): VariableCatalogEndogenousExogenous {
  const hasDefiningEquation = args.editor.equations.some(
    (equation) => !isRowComment(equation) && equationDefinesVariable(equation.name, args.name)
  );
  if (hasDefiningEquation) {
    return "endogenous";
  }

  const external = args.editor.externals.find(
    (row) => !isRowComment(row) && row.name.trim() === args.name
  );
  if (external) {
    return "exogenous";
  }

  if (args.initialValue != null) {
    return "initial-only";
  }

  return "unknown";
}

function parseInitialValue(editor: EditorState, name: string): number | null {
  const row = editor.initialValues.find(
    (entry) => !isRowComment(entry) && entry.name.trim() === name
  );
  if (!row || isRowComment(row) || !isInitialValueEnabled(row)) {
    return null;
  }

  const parsed = Number(row.valueText.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDefaultInitialValue(editor: EditorState): number | null {
  const parsed = Number(editor.options.defaultInitialValueText.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveInitialDisplayValue(
  editor: EditorState,
  name: string
): { value: number | null; valueSource: "initial" | "default" | null } {
  const row = editor.initialValues.find(
    (entry) => !isRowComment(entry) && entry.name.trim() === name
  );
  if (row && !isRowComment(row)) {
    if (isInitialValueEnabled(row)) {
      const parsed = Number(row.valueText.trim());
      if (Number.isFinite(parsed)) {
        return { value: parsed, valueSource: "initial" };
      }
      return { value: null, valueSource: null };
    }

    const defaultValue = parseDefaultInitialValue(editor);
    if (defaultValue != null) {
      return { value: defaultValue, valueSource: "default" };
    }
    return { value: null, valueSource: null };
  }

  const hasDefiningEquation = editor.equations.some(
    (equation) => !isRowComment(equation) && equationDefinesVariable(equation.name, name)
  );
  if (hasDefiningEquation) {
    const defaultValue = parseDefaultInitialValue(editor);
    if (defaultValue != null) {
      return { value: defaultValue, valueSource: "default" };
    }
  }

  return { value: null, valueSource: null };
}

function resolveExternalDisplayValue(
  external: ExternalRow,
  selectedPeriodIndex: number
): number | null {
  if (external.kind === "constant") {
    const parsed = Number(external.valueText.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  const values = external.valueText
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  const value = values[Math.min(selectedPeriodIndex, Math.max(values.length - 1, 0))];
  return Number.isFinite(value) ? value : null;
}

function resolveCatalogValue(args: {
  name: string;
  editor: EditorState;
  currentValues?: Record<string, number | undefined>;
  external: EditorState["externals"][number] | null;
  selectedPeriodIndex?: number;
}): { value: number | null; valueSource: VariableCatalogValueSource } {
  const runValue = args.currentValues?.[args.name];
  if (runValue !== undefined && Number.isFinite(runValue)) {
    return { value: runValue, valueSource: "run" };
  }

  if (args.external && !isRowComment(args.external)) {
    const externalValue = resolveExternalDisplayValue(
      args.external,
      args.selectedPeriodIndex ?? 0
    );
    if (externalValue != null) {
      return { value: externalValue, valueSource: "external" };
    }
  }

  const initialDisplay = resolveInitialDisplayValue(args.editor, args.name);
  if (initialDisplay.value != null && initialDisplay.valueSource != null) {
    return { value: initialDisplay.value, valueSource: initialDisplay.valueSource };
  }

  return { value: null, valueSource: "none" };
}

function collectModelDisplayVariableNames(editor: EditorState): string[] {
  const names = new Set<string>();

  for (const row of editor.equations) {
    if (!isRowComment(row)) {
      const name = row.name.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  for (const row of editor.externals) {
    if (!isRowComment(row)) {
      const name = row.name.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  for (const row of editor.initialValues) {
    if (!isRowComment(row)) {
      const name = row.name.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  return [...names];
}

function formatEndogenousExogenousLabel(value: VariableCatalogEndogenousExogenous): string {
  switch (value) {
    case "endogenous":
      return "Endogenous";
    case "exogenous":
      return "Exogenous";
    case "initial-only":
      return "Initial condition";
    case "matrix-column-sum":
      return "Matrix column sum";
    default:
      return "Unknown";
  }
}

function deriveMatrixColumnSumEndogenousExogenous(
  editor: EditorState,
  name: string
): VariableCatalogEndogenousExogenous {
  const appearsInEquation = editor.equations.some((equation) => {
    if (isRowComment(equation)) {
      return false;
    }
    return equationReferencesMatrixColumnRef(equation.expression, name);
  });
  return appearsInEquation ? "matrix-column-sum" : "unknown";
}

function equationReferencesMatrixColumnRef(expression: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  return expression.includes(trimmed) || expression.includes(`sum(${trimmed})`);
}

function describeMatrixColumnSumCatalogRow(name: string): string {
  return `Matrix column sum ${name}`;
}

function mergeMatrixColumnSumCurrentValues(args: {
  document: NotebookDocument;
  modelKey: string;
  runCell: RunCell | null;
  runCurrentValues: Record<string, number | undefined>;
  selectedPeriodIndex: number;
  getResult: (runCellId: string) => SimulationResult | null;
}): Record<string, number | undefined> {
  if (!args.runCell?.sourceModelId) {
    return args.runCurrentValues;
  }

  const result = args.getResult(args.runCell.id);
  if (!result) {
    return args.runCurrentValues;
  }

  const values = { ...args.runCurrentValues };
  for (const columnRef of collectMatrixColumnSumRefsFromMatrices({
    cells: args.document.cells,
    modelId: args.runCell.sourceModelId,
    runCellId: args.runCell.id
  })) {
    const bindings = resolveMatrixColumnSumBindingsForRef({
      cells: args.document.cells,
      modelId: args.runCell.sourceModelId,
      runCellId: args.runCell.id,
      columnRef
    });
    const value = evaluateMatrixColumnSumAtPeriod(
      columnRef,
      bindings,
      result,
      args.selectedPeriodIndex
    );
    if (value != null) {
      values[columnRef] = value;
    }
  }

  return values;
}

function defaultModelSectionOptions(): EditorState["options"] {
  return {
    periods: 100,
    solverMethod: "GAUSS_SEIDEL",
    toleranceText: "1e-15",
    maxIterations: 200,
    defaultInitialValueText: "1e-15",
    hiddenLeftVariable: "",
    hiddenRightVariable: "",
    hiddenToleranceText: "0.00001",
    relativeHiddenTolerance: false
  };
}
