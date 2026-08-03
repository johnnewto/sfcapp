import type { SimulationResult } from "@sfcr/core";
import { externalRowsOnly } from "@sfcr/notebook-core";

import { buildVariableDescriptions, type VariableDescriptions } from "../lib/variableDescriptions";
import { buildVariableUnitMetadata } from "../lib/units";
import type { VariableUnitMetadata } from "../lib/unitMeta";
import {
  buildInspectorCurrentValues,
  findRunCellForInspectorModelSource,
  resolveInspectorModelSource,
  resolvePreferredInspectorRunCell,
  type VariableInspectContext,
  type VariableInspectRequest
} from "../lib/variableInspect";
import { buildEditorStateForStandaloneModelSections } from "../notebook/components/ModelEquationViews";
import {
  buildEditorStateForNotebookModel,
  findEquationsCell,
  findExternalsCell
} from "../notebook/modelSections";
import { buildAbmVariableDescriptions, buildEditorStateFromAbmModelCell } from "../notebook/abmInspect";
import { resolveNearestNotebookContextCell } from "../notebook/notebookContext";
import { resolveSequenceMatrixRunCellId } from "../notebook/sequenceMatrixInspect";
import type { NotebookCell, NotebookDocument, RunCell } from "../notebook/types";

export interface PublicationVariableInteraction {
  currentValues: Record<string, number | undefined>;
  highlightedVariable: string | null;
  parameterNames: Set<string>;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
  onSelectVariable?(variableName: string): void;
}

function resolvePublicationParameterNames(
  editor: VariableInspectContext["editor"] | null | undefined
): Set<string> {
  if (!editor) {
    return new Set();
  }

  return new Set(
    externalRowsOnly(editor.externals)
      .map((external) => external.name.trim())
      .filter(Boolean)
  );
}

export function resolvePublicationInspectContext(args: {
  cell: NotebookCell;
  document: NotebookDocument;
  getResult: (runCellId: string) => SimulationResult | null;
  selectedPeriodIndex: number;
}): VariableInspectContext | null {
  const { cell, document, getResult, selectedPeriodIndex } = args;

  if (cell.type === "markdown") {
    const contextCell = resolveNearestNotebookContextCell(document.cells, cell);
    return contextCell
      ? resolvePublicationInspectContext({ cell: contextCell, document, getResult, selectedPeriodIndex })
      : null;
  }

  if (cell.type === "abm-model") {
    const modelSource = { sourceModelId: cell.modelId };
    const sourceRunCellId = findRunCellForInspectorModelSource(document.cells, modelSource)?.id ?? null;
    const editor = buildEditorStateFromAbmModelCell(cell);
    return {
      currentValues: buildInspectorCurrentValues({
        document,
        getResult,
        modelSource,
        selectedPeriodIndex,
        sourceRunCellId
      }),
      editor,
      modelSource,
      sourceRunCellId,
      variableDescriptions: buildAbmVariableDescriptions(cell),
      variableUnitMetadata: buildVariableUnitMetadata({
        equations: editor.equations,
        externals: editor.externals
      })
    };
  }

  if (cell.type === "model") {
    const modelSource = { sourceModelCellId: cell.id };
    const sourceRunCellId = findRunCellForInspectorModelSource(document.cells, modelSource)?.id ?? null;
    return {
      currentValues: buildInspectorCurrentValues({
        document,
        getResult,
        modelSource,
        selectedPeriodIndex,
        sourceRunCellId
      }),
      editor: cell.editor,
      modelSource,
      sourceRunCellId,
      variableDescriptions: buildVariableDescriptions({
        equations: cell.editor.equations,
        externals: cell.editor.externals
      }),
      variableUnitMetadata: buildVariableUnitMetadata({
        equations: cell.editor.equations,
        externals: cell.editor.externals
      })
    };
  }

  if (
    cell.type === "equations" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values" ||
    cell.type === "solver"
  ) {
    const modelSource = { sourceModelId: cell.modelId };
    const sourceRunCellId = findRunCellForInspectorModelSource(document.cells, modelSource)?.id ?? null;
    return {
      currentValues: buildInspectorCurrentValues({
        document,
        getResult,
        modelSource,
        selectedPeriodIndex,
        sourceRunCellId
      }),
      editor: buildEditorStateForStandaloneModelSections(document.cells, cell.modelId),
      modelSource,
      sourceRunCellId,
      variableDescriptions: buildVariableDescriptions({
        equations: findEquationsCell(document.cells, cell.modelId)?.equations,
        externals: findExternalsCell(document.cells, cell.modelId)?.externals
      }),
      variableUnitMetadata: buildVariableUnitMetadata({
        equations: findEquationsCell(document.cells, cell.modelId)?.equations,
        externals: findExternalsCell(document.cells, cell.modelId)?.externals
      })
    };
  }

  if (cell.type === "run") {
    const modelSource = resolveInspectorModelSource(cell);
    const editor = buildEditorStateForNotebookModel(document, cell);
    if (!editor || !modelSource) {
      return null;
    }

    const result = getResult(cell.id);
    const currentValues = result
      ? Object.fromEntries(
          Object.entries(result.series).map(([name, values]) => [
            name,
            values[Math.min(selectedPeriodIndex, Math.max(values.length - 1, 0))]
          ])
        )
      : buildInspectorCurrentValues({
          document,
          getResult,
          modelSource,
          selectedPeriodIndex,
          sourceRunCellId: cell.id
        });

    return {
      currentValues,
      editor,
      modelSource,
      sourceRunCellId: cell.id,
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

  if (cell.type === "chart" || cell.type === "table" || cell.type === "matrix") {
    const sourceRunCell = document.cells.find(
      (candidate): candidate is RunCell =>
        candidate.type === "run" && candidate.id === cell.sourceRunCellId
    );
    return sourceRunCell
      ? resolvePublicationInspectContext({
          cell: sourceRunCell,
          document,
          getResult,
          selectedPeriodIndex
        })
      : null;
  }

  if (cell.type === "sequence") {
    const sourceRunCellId = resolveSequenceMatrixRunCellId(cell, document.cells);
    const sourceRunCell = sourceRunCellId
      ? document.cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCellId
        )
      : null;
    return sourceRunCell
      ? resolvePublicationInspectContext({
          cell: sourceRunCell,
          document,
          getResult,
          selectedPeriodIndex
        })
      : null;
  }

  return null;
}

export function buildPublicationInspectRequest(args: {
  context: VariableInspectContext;
  document: NotebookDocument;
  selectedVariable: string;
}): VariableInspectRequest {
  const sourceRunCellId =
    resolvePreferredInspectorRunCell(args.document, args.context.modelSource)?.id ??
    args.context.sourceRunCellId ??
    findRunCellForInspectorModelSource(args.document.cells, args.context.modelSource)?.id ??
    null;

  return {
    ...args.context,
    sourceRunCellId,
    selectedVariable: args.selectedVariable.trim()
  };
}

export function mergePublicationVariableInteraction(args: {
  descriptions: VariableDescriptions;
  unitMetadata: VariableUnitMetadata;
  inspectContext: VariableInspectContext | null;
  highlightedVariable: string | null;
  onInspectVariable?(variableName: string): void;
}): PublicationVariableInteraction {
  const parameterNames = resolvePublicationParameterNames(args.inspectContext?.editor);
  return {
    currentValues: args.inspectContext?.currentValues ?? {},
    highlightedVariable: args.highlightedVariable,
    parameterNames,
    variableDescriptions: args.descriptions,
    variableUnitMetadata: args.unitMetadata,
    onSelectVariable: args.inspectContext && args.onInspectVariable ? args.onInspectVariable : undefined
  };
}
