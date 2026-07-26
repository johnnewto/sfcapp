import type { SimulationResult } from "@sfcr/core";

import type { EditorState } from "./editorModel";
import type { NotebookCell, NotebookDocument, RunCell } from "../notebook/types";
import { buildEditorStateFromAbmModelCell, findAbmModelCell } from "../notebook/abmInspect";
import { collectModelExternals, findEquationsCell, findInitialValuesCell, findLegacyModelCell, findSolverCell } from "../notebook/modelSections";
import { buildVariableDescriptions } from "./variableDescriptions";
import { buildVariableUnitMetadata } from "./units";
import type { VariableCatalogRow } from "./variableCatalog";
import { findPreferredRunForModelKey, listCatalogModelContexts, buildModelCurrentValues } from "./variableCatalog";
import { resolveRunCellModelKey } from "../notebook/modelSections";
import {
  buildMatrixColumnSumSeries,
  resolveMatrixColumnSumBindingsForRef
} from "../notebook/matrixColumnSumRuntime";

export type InspectorModelSource = { sourceModelId: string } | { sourceModelCellId: string };

export interface VariableInspectContext {
  currentValues: Record<string, number | undefined>;
  editor: EditorState;
  modelSource: InspectorModelSource | null;
  sourceRunCellId?: string | null;
  variableDescriptions: import("./variableDescriptions").VariableDescriptions;
  variableUnitMetadata: import("./unitMeta").VariableUnitMetadata;
}

export interface VariableInspectRequest extends VariableInspectContext {
  selectedVariable: string;
}

export function findRunCellForInspectorModelSource(
  cells: NotebookCell[],
  modelSource: InspectorModelSource | null
): RunCell | null {
  return resolveInspectorRunCell(cells, modelSource, null);
}

export function resolveInspectorRunCell(
  cells: NotebookCell[],
  modelSource: InspectorModelSource | null,
  sourceRunCellId?: string | null
): RunCell | null {
  if (sourceRunCellId) {
    const explicit = cells.find(
      (cell): cell is RunCell => cell.type === "run" && cell.id === sourceRunCellId
    );
    if (explicit) {
      return explicit;
    }
  }

  if (!modelSource) {
    return null;
  }

  for (const cell of cells) {
    if (cell.type !== "run") {
      continue;
    }

    if (isSameInspectorModelSource(resolveInspectorModelSource(cell), modelSource)) {
      return cell;
    }
  }

  return null;
}

/** Baseline run for a model when present; used for notebook right-rail defaults. */
export function resolvePreferredInspectorRunCell(
  document: NotebookDocument,
  modelSource: InspectorModelSource | null
): RunCell | null {
  const probe = resolveInspectorRunCell(document.cells, modelSource, null);
  if (!probe) {
    return null;
  }

  const modelKey = resolveRunCellModelKey(document.cells, probe);
  if (!modelKey) {
    return null;
  }

  return findPreferredRunForModelKey(document, modelKey);
}

export function buildInspectorCurrentValues(args: {
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  modelSource: InspectorModelSource | null;
  selectedPeriodIndex: number;
  sourceRunCellId?: string | null;
}): Record<string, number | undefined> {
  if (!args.modelSource) {
    return {};
  }

  return buildModelCurrentValues({
    document: args.document,
    getResult: args.getResult,
    modelRef: args.modelSource,
    selectedPeriodIndex: args.selectedPeriodIndex
  });
}

export function buildInspectorSeriesValues(args: {
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  modelSource: InspectorModelSource | null;
  sourceRunCellId?: string | null;
  variableName: string;
}): number[] | undefined {
  const runCell = resolvePreferredInspectorRunCell(args.document, args.modelSource);
  if (!runCell) {
    return undefined;
  }

  const result = args.getResult(runCell.id);
  const values = result?.series[args.variableName.trim()];
  if (values) {
    return Array.from(values);
  }

  if (!result || !args.modelSource || !("sourceModelId" in args.modelSource)) {
    return undefined;
  }

  const bindings = resolveMatrixColumnSumBindingsForRef({
    cells: args.document.cells,
    modelId: args.modelSource.sourceModelId,
    runCellId: args.sourceRunCellId?.trim() || runCell.id,
    columnRef: args.variableName.trim()
  });
  if (!bindings[args.variableName.trim()]?.length) {
    return undefined;
  }

  return buildMatrixColumnSumSeries(args.variableName.trim(), bindings, result) ?? undefined;
}

function isSameInspectorModelSource(
  left: InspectorModelSource | null,
  right: InspectorModelSource | null
): boolean {
  if (left == null || right == null) {
    return left === right;
  }

  if ("sourceModelId" in left) {
    return "sourceModelId" in right && left.sourceModelId === right.sourceModelId;
  }

  return "sourceModelCellId" in right && left.sourceModelCellId === right.sourceModelCellId;
}

export function isSameInspectorContext(
  left: VariableInspectContext | null,
  right: VariableInspectContext | null
): boolean {
  if (left == null || right == null) {
    return left === right;
  }

  return isSameInspectorModelSource(left.modelSource, right.modelSource);
}

export function resolveInspectorModelSource(
  source: { modelId?: string; sourceModelId?: string; sourceModelCellId?: string } | null | undefined
): InspectorModelSource | null {
  const modelId = source?.modelId?.trim() || source?.sourceModelId?.trim();
  if (modelId) {
    return { sourceModelId: modelId };
  }

  const legacyCellId = source?.sourceModelCellId?.trim();
  if (legacyCellId) {
    return { sourceModelCellId: legacyCellId };
  }

  return null;
}

export function isInspectorModelEditable(
  cells: NotebookCell[],
  modelSource: InspectorModelSource | null
): boolean {
  if (!modelSource) {
    return false;
  }

  if ("sourceModelCellId" in modelSource) {
    return findLegacyModelCell(cells, modelSource.sourceModelCellId) != null;
  }

  return findEquationsCell(cells, modelSource.sourceModelId) != null;
}

export function updateEditorDefiningEquationExpression(
  editor: EditorState,
  equationId: string,
  expression: string
): EditorState {
  return {
    ...editor,
    equations: editor.equations.map((equation) =>
      equation.id === equationId ? { ...equation, expression } : equation
    )
  };
}

export function applyInspectorDefiningEquationExpression(
  document: NotebookDocument,
  modelSource: InspectorModelSource,
  equationId: string,
  expression: string
): NotebookDocument {
  if ("sourceModelCellId" in modelSource) {
    return {
      ...document,
      cells: document.cells.map((cell) => {
        if (cell.type !== "model" || cell.id !== modelSource.sourceModelCellId) {
          return cell;
        }

        return {
          ...cell,
          editor: updateEditorDefiningEquationExpression(cell.editor, equationId, expression)
        };
      })
    };
  }

  return {
    ...document,
    cells: document.cells.map((cell) => {
      if (cell.type !== "equations" || cell.modelId !== modelSource.sourceModelId) {
        return cell;
      }

      return {
        ...cell,
        equations: cell.equations.map((equation) =>
          equation.id === equationId ? { ...equation, expression } : equation
        )
      };
    })
  };
}

export function buildVariableInspectRequestFromCatalogRow(args: {
  currentValues: Record<string, number | undefined>;
  document: NotebookDocument;
  row: VariableCatalogRow;
}): VariableInspectRequest | null {
  const editor =
    (args.row.modelSource
      ? buildEditorStateForInspectorModelSource(args.document, args.row.modelSource)
      : null) ??
  listCatalogModelContexts(args.document).find((context) => context.modelId === args.row.modelId)?.editor ??
    null;

  if (!editor) {
    return null;
  }

  const catalogContext = listCatalogModelContexts(args.document).find(
    (context) => context.modelId === args.row.modelId
  );
  const sourceRunCellId = catalogContext
    ? findPreferredRunForModelKey(args.document, catalogContext.modelKey)?.id ?? null
    : null;

  return {
    currentValues: args.currentValues,
    editor,
    modelSource: args.row.modelSource,
    sourceRunCellId,
    selectedVariable: args.row.name,
    variableDescriptions: buildVariableDescriptions({
      equations: editor.equations,
      externals: editor.externals
    }),
    variableUnitMetadata: buildVariableUnitMetadata({
      equations: editor.equations,
      externals: editor.externals
    })
  };
}

export function buildEditorStateForInspectorModelSource(
  document: NotebookDocument,
  modelSource: InspectorModelSource
): EditorState | null {
  if ("sourceModelCellId" in modelSource) {
    return findLegacyModelCell(document.cells, modelSource.sourceModelCellId)?.editor ?? null;
  }

  const equationsCell = findEquationsCell(document.cells, modelSource.sourceModelId);
  const solverCell = findSolverCell(document.cells, modelSource.sourceModelId);
  if (equationsCell && solverCell) {
    return {
      equations: equationsCell.equations,
      externals: collectModelExternals(document.cells, modelSource.sourceModelId),
      initialValues: findInitialValuesCell(document.cells, modelSource.sourceModelId)?.initialValues ?? [],
      options: solverCell.options,
      scenario: { shocks: [] }
    };
  }

  const abmCell = findAbmModelCell(document.cells, modelSource.sourceModelId);
  if (abmCell) {
    return buildEditorStateFromAbmModelCell(abmCell);
  }

  return null;
}
