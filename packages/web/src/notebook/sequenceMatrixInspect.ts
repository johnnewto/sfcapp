import { externalRowsOnly } from "@sfcr/notebook-core";
import type { SimulationResult } from "@sfcr/core";

import type { EditorState } from "../lib/editorModel";
import { buildVariableUnitMetadata } from "../lib/units";
import type { VariableUnitMetadata } from "../lib/unitMeta";
import { buildVariableDescriptions, type VariableDescriptions } from "../lib/variableDescriptions";
import {
  resolveInspectorModelSource,
  type InspectorModelSource
} from "../lib/variableInspect";
import { buildEditorStateForNotebookModel } from "./modelSections";
import type { HydraulicsCell, MatrixCell, NotebookCell, RunCell, SequenceCell } from "./types";
import type { useNotebookRunner } from "./useNotebookRunner";

const EMPTY_PARAMETER_NAMES = new Set<string>();

export interface SequenceMatrixInspectBundle {
  currentValues: Record<string, number | undefined>;
  laggedCurrentValues: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  editor: EditorState | null;
  modelSource: InspectorModelSource | null;
  sourceRunCellId: string | null;
  parameterNames: Set<string>;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
}

export function resolveSequenceMatrixRunCellId(
  cell: SequenceCell,
  cells: NotebookCell[]
): string | null {
  if (cell.source.kind !== "matrix") {
    return null;
  }

  const source = cell.source;
  const matrixCell = cells.find(
    (candidate): candidate is MatrixCell =>
      candidate.type === "matrix" && candidate.id === source.matrixCellId
  );
  return source.sourceRunCellId ?? matrixCell?.sourceRunCellId ?? null;
}

export function resolveHydraulicsRunCellId(
  cell: HydraulicsCell,
  cells: NotebookCell[]
): string | null {
  const matrixCell = cells.find(
    (candidate): candidate is MatrixCell =>
      candidate.type === "matrix" && candidate.id === cell.source.transactionMatrixCellId
  );
  return cell.source.sourceRunCellId ?? matrixCell?.sourceRunCellId ?? null;
}

export function resolveSequenceMatrixInspectBundle(
  cell: SequenceCell,
  cells: NotebookCell[],
  runner: Pick<ReturnType<typeof useNotebookRunner>, "getResult">,
  selectedPeriodIndex: number,
  variableDescriptions: VariableDescriptions
): SequenceMatrixInspectBundle {
  return resolveInspectBundleForRunCell(
    cells,
    runner,
    selectedPeriodIndex,
    variableDescriptions,
    resolveSequenceMatrixRunCellId(cell, cells)
  );
}

export function resolveInspectBundleForRunCell(
  cells: NotebookCell[],
  runner: Pick<ReturnType<typeof useNotebookRunner>, "getResult">,
  selectedPeriodIndex: number,
  variableDescriptions: VariableDescriptions,
  sourceRunCellId: string | null
): SequenceMatrixInspectBundle {
  const sourceRunCell = sourceRunCellId
    ? cells.find(
        (candidate): candidate is RunCell =>
          candidate.type === "run" && candidate.id === sourceRunCellId
      ) ?? null
    : null;
  const editor = sourceRunCellId ? resolveEditorStateForRunCellId(cells, sourceRunCellId) : null;
  const result = sourceRunCellId ? runner.getResult(sourceRunCellId) : null;
  const currentValues = buildCurrentValues(result, selectedPeriodIndex);
  const laggedCurrentValues = buildLaggedCurrentValues(result, selectedPeriodIndex);
  const laggedPeriodLabel = selectedPeriodIndex > 0 ? `period ${selectedPeriodIndex}` : undefined;
  const modelSource = sourceRunCell ? resolveInspectorModelSource(sourceRunCell) : null;
  const parameterNames = editor
    ? new Set(externalRowsOnly(editor.externals).map((external) => external.name.trim()).filter(Boolean))
    : EMPTY_PARAMETER_NAMES;
  const variableUnitMetadata = editor
    ? buildVariableUnitMetadata({
        equations: editor.equations,
        externals: editor.externals
      })
    : new Map();
  const resolvedVariableDescriptions = new Map(variableDescriptions);
  if (editor) {
    for (const [name, description] of buildVariableDescriptions({
      equations: editor.equations,
      externals: editor.externals
    })) {
      if (!resolvedVariableDescriptions.has(name)) {
        resolvedVariableDescriptions.set(name, description);
      }
    }
  }

  return {
    currentValues,
    laggedCurrentValues,
    laggedPeriodLabel,
    editor,
    modelSource,
    sourceRunCellId,
    parameterNames,
    variableDescriptions: resolvedVariableDescriptions,
    variableUnitMetadata
  };
}

function resolveEditorStateForRunCellId(
  cells: NotebookCell[],
  sourceRunCellId: string
): EditorState | null {
  const sourceRunCell = cells.find((entry) => entry.id === sourceRunCellId);
  if (!sourceRunCell || sourceRunCell.type !== "run") {
    return null;
  }

  return buildEditorStateForNotebookModel(
    {
      id: "notebook",
      title: "notebook",
      metadata: { version: 1 },
      cells
    },
    sourceRunCell
  );
}

function buildCurrentValues(
  result: SimulationResult | null,
  selectedPeriodIndex: number
): Record<string, number | undefined> {
  if (!result) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(result.series).map(([name, values]) => [
      name,
      values[Math.min(selectedPeriodIndex, Math.max(values.length - 1, 0))]
    ])
  );
}

function buildLaggedCurrentValues(
  result: SimulationResult | null,
  selectedPeriodIndex: number
): Record<string, number | undefined> {
  if (!result) {
    return {};
  }

  const lagPeriodIndex = selectedPeriodIndex - 1;
  return Object.fromEntries(
    Object.entries(result.series).map(([name, values]) => [
      name,
      lagPeriodIndex >= 0
        ? values[Math.min(lagPeriodIndex, Math.max(values.length - 1, 0))]
        : undefined
    ])
  );
}
