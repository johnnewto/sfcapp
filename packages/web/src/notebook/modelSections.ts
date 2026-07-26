import type {
  EditorOptions,
  EditorState,
  EquationListItem,
  ExternalListItem,
  InitialValueListItem
} from "../lib/editorModel";
import { isRowComment } from "@sfcr/notebook-core";

import type {
  EquationsCell,
  ExternalsCell,
  InitialValuesCell,
  ModelCell,
  NotebookCell,
  NotebookDocument,
  ObservedCell,
  RunCell,
  SolverCell
} from "./types";
import { buildEditorStateFromAbmModelCell, findAbmModelCell } from "./abmInspect";

export function findLegacyModelCell(cells: NotebookCell[], cellId: string): ModelCell | null {
  return cells.find((cell): cell is ModelCell => cell.type === "model" && cell.id === cellId) ?? null;
}

export function findEquationsCell(cells: NotebookCell[], modelId: string): EquationsCell | null {
  return (
    cells.find(
      (cell): cell is EquationsCell => cell.type === "equations" && cell.modelId === modelId
    ) ?? null
  );
}

export function findExternalsCell(cells: NotebookCell[], modelId: string): ExternalsCell | null {
  return (
    cells.find(
      (cell): cell is ExternalsCell => cell.type === "externals" && cell.modelId === modelId
    ) ?? null
  );
}

export function findObservedCell(cells: NotebookCell[], modelId: string): ObservedCell | null {
  return (
    cells.find(
      (cell): cell is ObservedCell => cell.type === "observed" && cell.modelId === modelId
    ) ?? null
  );
}

/**
 * Externals for a model, combining the externals cell with any observed cell.
 * Observed rows are forced to `observed: true` so they feed both
 * `model.externals` and `model.observed` during compilation.
 */
export function collectModelExternals(
  cells: NotebookCell[],
  modelId: string
): ExternalListItem[] {
  const externals = findExternalsCell(cells, modelId)?.externals ?? [];
  const observed = (findObservedCell(cells, modelId)?.externals ?? []).map((row) =>
    isRowComment(row) ? row : { ...row, observed: true }
  );
  return observed.length > 0 ? [...externals, ...observed] : externals;
}

export function findInitialValuesCell(
  cells: NotebookCell[],
  modelId: string
): InitialValuesCell | null {
  return (
    cells.find(
      (cell): cell is InitialValuesCell =>
        cell.type === "initial-values" && cell.modelId === modelId
    ) ?? null
  );
}

export function findSolverCell(cells: NotebookCell[], modelId: string): SolverCell | null {
  return (
    cells.find((cell): cell is SolverCell => cell.type === "solver" && cell.modelId === modelId) ??
    null
  );
}

export function resolveNotebookModelKey(
  cells: NotebookCell[],
  source: { modelId?: string; sourceModelId?: string; sourceModelCellId?: string }
): string | null {
  const modelId = source.modelId ?? source.sourceModelId;
  if (typeof modelId === "string" && modelId.trim() !== "") {
    return `model:${modelId.trim()}`;
  }

  const legacyCellId = source.sourceModelCellId?.trim();
  if (!legacyCellId) {
    return null;
  }

  const cell = cells.find((entry) => entry.id === legacyCellId);
  if (!cell) {
    return null;
  }

  if (cell.type === "model") {
    return `cell:${cell.id}`;
  }

  if (
    (cell.type === "equations" ||
      cell.type === "solver" ||
      cell.type === "externals" ||
      cell.type === "observed" ||
      cell.type === "initial-values") &&
    cell.modelId
  ) {
    return `model:${cell.modelId}`;
  }

  return null;
}

export function resolveRunCellModelKey(cells: NotebookCell[], cell: RunCell): string | null {
  return resolveNotebookModelKey(cells, cell);
}

export function buildEditorStateForNotebookModel(
  document: NotebookDocument,
  source: { modelId?: string; sourceModelId?: string; sourceModelCellId?: string; periods?: number }
): EditorState | null {
  const modelId = source.modelId ?? source.sourceModelId;
  if (typeof modelId === "string" && modelId.trim() !== "") {
    const equationsCell = findEquationsCell(document.cells, modelId);
    const solverCell = findSolverCell(document.cells, modelId);
    if (equationsCell && solverCell) {
      return {
        equations: equationsCell.equations,
        externals: collectModelExternals(document.cells, modelId),
        initialValues: findInitialValuesCell(document.cells, modelId)?.initialValues ?? [],
        options: {
          ...solverCell.options,
          periods: source.periods ?? solverCell.options.periods
        },
        scenario: { shocks: [] }
      };
    }

    const abmCell = findAbmModelCell(document.cells, modelId);
    if (abmCell) {
      return buildEditorStateFromAbmModelCell(abmCell, source.periods);
    }

    return null;
  }

  const legacyCellId = source.sourceModelCellId?.trim();
  if (!legacyCellId) {
    return null;
  }

  const legacyCell = findLegacyModelCell(document.cells, legacyCellId);
  return legacyCell?.editor ?? null;
}

export function countModelSectionIssues(
  issuePaths: string[],
  prefix: "equations." | "externals." | "initialValues." | "options."
): number {
  return issuePaths.filter((path) => path.startsWith(prefix)).length;
}

export function buildEditorStateFromSections(args: {
  equations: EquationListItem[];
  externals: ExternalListItem[];
  initialValues: InitialValueListItem[];
  options: EditorOptions;
}): EditorState {
  return {
    equations: args.equations,
    externals: args.externals,
    initialValues: args.initialValues,
    options: args.options,
    scenario: { shocks: [] }
  };
}
