import { useMemo } from "react";

import type { SimulationResult } from "@sfcr/core";

import { HydraulicsCanvas } from "../../components/HydraulicsCanvas";
import { resolveHydraulicsScene } from "../../notebook/hydraulics";
import type { HydraulicsCell, MatrixCell, NotebookCell } from "../../notebook/types";

export function PublicationHydraulics({
  cell,
  cells,
  getResult,
  selectedPeriodIndex
}: {
  cell: HydraulicsCell;
  cells: NotebookCell[];
  getResult(runCellId: string): SimulationResult | null;
  selectedPeriodIndex: number;
}) {
  const scene = useMemo(
    () =>
      resolveHydraulicsScene(
        cell,
        (cellId) => {
          const target = cells.find((entry) => entry.id === cellId);
          return target?.type === "matrix" ? target : null;
        },
        (cellId) => getResult(cellId),
        selectedPeriodIndex,
        cells
      ),
    [cell, cells, getResult, selectedPeriodIndex]
  );

  const sourceMatrix = useMemo((): MatrixCell | null => {
    const target = cells.find((entry) => entry.id === cell.source.transactionMatrixCellId);
    return target?.type === "matrix" ? target : null;
  }, [cell.source.transactionMatrixCellId, cells]);

  return (
    <div className="publication-hydraulics">
      {sourceMatrix ? (
        <p className="hydraulics-cell-caption">
          Bound to matrix <strong>{sourceMatrix.title}</strong> at period {selectedPeriodIndex + 1}.
        </p>
      ) : null}
      <HydraulicsCanvas interactive={false} layoutLocked prefersReducedMotion scene={scene} />
    </div>
  );
}
