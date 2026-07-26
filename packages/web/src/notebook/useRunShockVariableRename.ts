import { useCallback, useState } from "react";

import type { ShockVariableDef } from "@sfcr/core";
import { parseLenientJsonValue } from "@sfcr/notebook-core";

import { type ModelRenameScope } from "./renameVariable";
import type { NotebookCell, RunCell } from "./types";
import { useVariableRenameConfirm } from "./useVariableRenameConfirm";

interface PendingShockVariableRename {
  applyLocal(): void;
  newName: string;
  oldName: string;
  shockIndex: number;
  nextValue: ShockVariableDef;
}

export function resolveRunCellRenameScope(
  runCell: Pick<RunCell, "sourceModelCellId" | "sourceModelId">
): ModelRenameScope | null {
  const sourceModelId = runCell.sourceModelId?.trim();
  if (sourceModelId) {
    return { kind: "modelId", modelId: sourceModelId };
  }

  const sourceModelCellId = runCell.sourceModelCellId?.trim();
  if (sourceModelCellId) {
    return { kind: "legacyModelCell", cellId: sourceModelCellId };
  }

  return null;
}

export function applyShockVariableRenameToRunCell<T extends Pick<RunCell, "scenario">>(
  runCell: T,
  shockIndex: number,
  variableName: string,
  nextName: string,
  nextValue: ShockVariableDef
): T {
  const scenario = runCell.scenario ?? { shocks: [] };
  const shock = scenario.shocks[shockIndex];
  if (!shock) {
    return runCell;
  }

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    return runCell;
  }

  const nextVariables = { ...shock.variables };
  delete nextVariables[variableName];
  nextVariables[trimmedName] = nextValue;

  return {
    ...runCell,
    scenario: {
      ...scenario,
      shocks: scenario.shocks.map((entry, index) =>
        index === shockIndex ? { ...entry, variables: nextVariables } : entry
      )
    }
  };
}

export function useRunShockVariableRename({
  cells,
  onReplaceCells,
  runCellId,
  scope,
  value
}: {
  cells: NotebookCell[];
  onReplaceCells?: (nextCells: NotebookCell[]) => void;
  runCellId?: string;
  scope: ModelRenameScope | null;
  value: string;
}) {
  const [pendingRename, setPendingRename] = useState<PendingShockVariableRename | null>(null);
  const renameConfirm = useVariableRenameConfirm({
    cells,
    onReplaceCells: onReplaceCells ?? (() => {}),
    scope
  });

  const cancelRename = useCallback(() => {
    setPendingRename(null);
    renameConfirm.clearRenameDialog();
  }, [renameConfirm]);

  const requestShockVariableRename = useCallback(
    (
      shockIndex: number,
      oldName: string,
      newName: string,
      nextValue: ShockVariableDef,
      applyLocal: () => void
    ) => {
      const trimmedOldName = oldName.trim();
      const trimmedNewName = newName.trim();
      if (!trimmedNewName || trimmedOldName === trimmedNewName) {
        applyLocal();
        return;
      }

      if (!scope || !onReplaceCells) {
        applyLocal();
        return;
      }

      setPendingRename({
        applyLocal,
        newName: trimmedNewName,
        oldName: trimmedOldName,
        nextValue,
        shockIndex
      });
      renameConfirm.openRenameDialog(trimmedOldName, trimmedNewName);
    },
    [onReplaceCells, renameConfirm, scope]
  );

  const confirmRenameNo = useCallback(() => {
    if (!pendingRename) {
      return;
    }

    renameConfirm.confirmRenameNo(() => {
      pendingRename.applyLocal();
      cancelRename();
    });
  }, [cancelRename, pendingRename, renameConfirm]);

  const confirmRenameYes = useCallback(() => {
    if (!pendingRename || !runCellId) {
      return;
    }

    renameConfirm.confirmRenameYes({
      onComplete: cancelRename,
      patch: (nextCells) => {
        let parsedRunCell: RunCell | null = null;
        try {
          const parsed = parseLenientJsonValue(value) as NotebookCell;
          parsedRunCell = parsed.type === "run" ? parsed : null;
        } catch {
          parsedRunCell = null;
        }

        if (!parsedRunCell) {
          return nextCells;
        }

        const mergedRunCell = applyShockVariableRenameToRunCell(
          parsedRunCell,
          pendingRename.shockIndex,
          pendingRename.oldName,
          pendingRename.newName,
          pendingRename.nextValue
        );

        return nextCells.map((entry) =>
          entry.id === runCellId && entry.type === "run"
            ? ({ ...mergedRunCell, id: runCellId } as RunCell)
            : entry
        );
      }
    });
  }, [cancelRename, pendingRename, renameConfirm, runCellId, value]);

  return {
    cancelRename,
    confirmRenameNo,
    confirmRenameYes,
    renameDialog: renameConfirm.renameDialog,
    renameReferenceCount: renameConfirm.renameReferenceCount,
    requestShockVariableRename
  };
}
