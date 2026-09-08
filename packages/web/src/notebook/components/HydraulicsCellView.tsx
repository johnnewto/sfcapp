import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type {
  HydraulicsAnchor,
  HydraulicsCell,
  HydraulicsLayout,
  HydraulicsPolarity,
  HydraulicsPort,
  NotebookCell
} from "@sfcr/notebook-core";
import { hydraulicsBoxPorts, hydraulicsPortsForKind, parseHydraulicsBoxPort } from "@sfcr/notebook-core";

import {
  HydraulicsCanvas,
  type HydraulicsContextMenuRequest,
  type HydraulicsSelection,
  type HydraulicsTool
} from "../../components/HydraulicsCanvas";
import { VariableMathLabel } from "../../components/VariableMathLabel";
import { useFloatingPanelPosition } from "../../hooks/useFloatingPanelPosition";
import { applyFixedMenuPosition } from "../../lib/clampFixedMenuPosition";
import {
  createResolvedHydraulicsBox,
  DEFAULT_BOX_FILL,
  DEFAULT_BOX_FILL_OPACITY,
  DEFAULT_BOX_STROKE,
  DEFAULT_PIPE_ARROW_SIZE,
  DEFAULT_PIPE_COLOR,
  DEFAULT_PIPE_OPACITY,
  DEFAULT_PIPE_TOKEN_COUNT,
  DEFAULT_PIPE_WIDTH_SCALE,
  DEFAULT_SECTOR_FILL,
  DEFAULT_SECTOR_OPACITY,
  DEFAULT_SECTOR_STROKE,
  formatHydraulicsTankValue,
  HYDRAULICS_BOX_GRID_HEIGHT,
  HYDRAULICS_BOX_GRID_WIDTH,
  HYDRAULICS_GRID_COLS,
  HYDRAULICS_TANK_GRID_Y,
  hydraulicsGridToUnit,
  hydraulicsUnitToGrid,
  layoutFromResolved,
  resolveHydraulicsScene,
  snapHydraulicsPoint,
  snapHydraulicsUnit
} from "../hydraulics";
import type { MatrixCell } from "../types";
import type { useNotebookRunner } from "../useNotebookRunner";

const INSPECTOR_POSITION_STORAGE_KEY = "sfcr.hydraulics-inspector-position";

const PLAY_INTERVAL_MS = 700;

export function HydraulicsCellView({
  cell,
  cells,
  interactive = true,
  maxPeriodIndex,
  onCellChange,
  onSelectedPeriodIndexChange,
  runner,
  selectedPeriodIndex,
  viewportRoot = null
}: {
  cell: HydraulicsCell;
  cells: NotebookCell[];
  interactive?: boolean;
  maxPeriodIndex: number;
  onCellChange?(cellId: string, updater: (cell: NotebookCell) => NotebookCell): void;
  onSelectedPeriodIndexChange?(nextIndex: number): void;
  runner: Pick<ReturnType<typeof useNotebookRunner>, "getResult">;
  selectedPeriodIndex: number;
  viewportRoot?: Element | null;
}) {
  const [tool, setTool] = useState<HydraulicsTool>("select");
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<HydraulicsSelection | null>(null);
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [contextMenu, setContextMenu] = useState<HydraulicsContextMenuRequest | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const periodRef = useRef(selectedPeriodIndex);
  periodRef.current = selectedPeriodIndex;

  useEffect(() => {
    setAnimationEpoch((epoch) => epoch + 1);
  }, [selectedPeriodIndex]);

  useLayoutEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      applyFixedMenuPosition(contextMenuRef.current, contextMenu.clientX, contextMenu.clientY);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (contextMenu == null) {
      return;
    }

    function handlePointerDown(): void {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const scene = useMemo(
    () =>
      resolveHydraulicsScene(
        cell,
        (cellId) => {
          const target = cells.find((entry) => entry.id === cellId);
          return target?.type === "matrix" ? target : null;
        },
        (cellId) => runner.getResult(cellId),
        selectedPeriodIndex,
        cells
      ),
    [cell, cells, runner, selectedPeriodIndex]
  );

  const sourceMatrix = useMemo((): MatrixCell | null => {
    const target = cells.find((entry) => entry.id === cell.source.transactionMatrixCellId);
    return target?.type === "matrix" ? target : null;
  }, [cell.source.transactionMatrixCellId, cells]);

  const variableNames = useMemo(() => {
    const runCellId =
      cell.source.sourceRunCellId ?? sourceMatrix?.sourceRunCellId ?? cell.source.balanceMatrixCellId;
    const result = runCellId ? runner.getResult(runCellId) : null;
    return result ? Object.keys(result.series).sort() : [];
  }, [cell.source, runner, sourceMatrix]);

  useEffect(() => {
    if (!playing || !onSelectedPeriodIndexChange) {
      return;
    }
    const timer = window.setInterval(() => {
      const next = periodRef.current >= maxPeriodIndex ? 0 : periodRef.current + 1;
      onSelectedPeriodIndexChange(next);
    }, PLAY_INTERVAL_MS / speed);
    return () => window.clearInterval(timer);
  }, [maxPeriodIndex, onSelectedPeriodIndexChange, playing, speed]);

  function persistLayout(layout: HydraulicsLayout): void {
    onCellChange?.(cell.id, (current) => (current.type === "hydraulics" ? { ...current, layout } : current));
  }

  function patchSelected(mutate: (layout: HydraulicsLayout) => HydraulicsLayout): void {
    persistLayout(mutate(layoutFromResolved(scene)));
  }

  function handleDelete(): void {
    if (!selected) {
      return;
    }
    deleteSelection(selected);
  }

  function closeContextMenu(): void {
    setContextMenu(null);
  }

  function persistScene(nextScene: typeof scene): void {
    persistLayout(layoutFromResolved(nextScene));
  }

  function deleteSelection(target: HydraulicsSelection): void {
    if (target.kind === "sector") {
      persistScene({
        ...scene,
        sectors: scene.sectors.filter((sector) => sector.id !== target.id)
      });
    } else if (target.kind === "tank") {
      persistScene({
        ...scene,
        tanks: scene.tanks.filter((tank) => tank.id !== target.id)
      });
    } else if (target.kind === "pipe") {
      persistScene({
        ...scene,
        pipes: scene.pipes.filter((pipe) => pipe.id !== target.id)
      });
    } else if (target.kind === "box") {
      persistScene({
        ...scene,
        boxes: scene.boxes.filter((box) => box.id !== target.id)
      });
    } else {
      persistScene({
        ...scene,
        pipes: scene.pipes.map((pipe) =>
          pipe.id === target.pipeId
            ? { ...pipe, waypoints: pipe.waypoints.filter((_, index) => index !== target.index) }
            : pipe
        )
      });
      setSelected({ kind: "pipe", id: target.pipeId });
      closeContextMenu();
      return;
    }
    setSelected(null);
    closeContextMenu();
  }

  function addSectorAt(point: { x: number; y: number }): void {
    const snapped = snapHydraulicsPoint(point);
    const id = uniqueHydraulicsId(
      "sector",
      scene.sectors.map((sector) => sector.id)
    );
    persistScene({
      ...scene,
      sectors: [
        ...scene.sectors,
        {
          id,
          label: "Sector",
          fill: DEFAULT_SECTOR_FILL,
          stroke: DEFAULT_SECTOR_STROKE,
          opacity: DEFAULT_SECTOR_OPACITY,
          x: snapped.x,
          y: snapped.y,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ]
    });
    setSelected({ kind: "sector", id });
    closeContextMenu();
  }

  function addTankAt(point: { x: number; y: number }, sectorId?: string): void {
    const snapped = snapHydraulicsPoint(point);
    const sector =
      (sectorId ? scene.sectors.find((entry) => entry.id === sectorId) : null) ??
      nearestSector(snapped, scene.sectors);
    const id = uniqueHydraulicsId(
      "tank",
      scene.tanks.map((tank) => tank.id)
    );
    const attached = scene.tanks.filter((tank) => tank.sectorId === (sector?.id ?? "")).length;
    persistScene({
      ...scene,
      tanks: [
        ...scene.tanks,
        {
          id,
          sectorId: sector?.id ?? scene.sectors[0]?.id ?? "",
          label: id,
          polarity: "asset",
          color: "#2980b9",
          x: sector ? snapHydraulicsUnit(sector.x + attached * (2 / HYDRAULICS_GRID_COLS), "x") : snapped.x,
          y: sector ? hydraulicsGridToUnit(HYDRAULICS_TANK_GRID_Y, "y") : snapped.y,
          value: null,
          maxLevel: null,
          runMaxAbs: 0,
          maxAbs: 0,
          fill: 0,
          labelOffsetX: null,
          labelOffsetY: null
        }
      ]
    });
    setSelected({ kind: "tank", id });
    closeContextMenu();
  }

  function addBoxAt(point: { x: number; y: number }): void {
    const snapped = snapHydraulicsPoint(point);
    const id = uniqueHydraulicsId(
      "box",
      scene.boxes.map((box) => box.id)
    );
    persistScene({
      ...scene,
      boxes: [...scene.boxes, createResolvedHydraulicsBox(id, snapped.x, snapped.y)]
    });
    setSelected({ kind: "box", id });
    closeContextMenu();
  }

  function addWaypoint(pipeId: string, point: { x: number; y: number }): void {
    const snapped = snapHydraulicsPoint(point);
    persistScene({
      ...scene,
      pipes: scene.pipes.map((pipe) =>
        pipe.id === pipeId ? { ...pipe, waypoints: [...pipe.waypoints, snapped] } : pipe
      )
    });
    const pipe = scene.pipes.find((entry) => entry.id === pipeId);
    setSelected({ kind: "waypoint", pipeId, index: pipe?.waypoints.length ?? 0 });
    closeContextMenu();
  }

  function reversePipe(pipeId: string): void {
    persistScene({
      ...scene,
      pipes: scene.pipes.map((pipe) =>
        pipe.id === pipeId
          ? {
              ...pipe,
              from: pipe.to,
              to: pipe.from,
              waypoints: [...pipe.waypoints].reverse(),
              labelT: pipe.labelT == null ? null : 1 - pipe.labelT
            }
          : pipe
      )
    });
    closeContextMenu();
  }

  function duplicateSelection(target: HydraulicsSelection): void {
    const offset = 2 / HYDRAULICS_GRID_COLS;
    if (target.kind === "sector") {
      const sector = scene.sectors.find((entry) => entry.id === target.id);
      if (!sector) {
        return;
      }
      const id = uniqueHydraulicsId(sector.id, scene.sectors.map((entry) => entry.id));
      persistScene({
        ...scene,
        sectors: [
          ...scene.sectors,
          { ...sector, id, label: `${sector.label} copy`, x: snapHydraulicsUnit(sector.x + offset, "x") }
        ]
      });
      setSelected({ kind: "sector", id });
    } else if (target.kind === "tank") {
      const tank = scene.tanks.find((entry) => entry.id === target.id);
      if (!tank) {
        return;
      }
      const id = uniqueHydraulicsId(tank.id, scene.tanks.map((entry) => entry.id));
      persistScene({
        ...scene,
        tanks: [...scene.tanks, { ...tank, id, x: snapHydraulicsUnit(tank.x + offset, "x") }]
      });
      setSelected({ kind: "tank", id });
    } else if (target.kind === "pipe") {
      const pipe = scene.pipes.find((entry) => entry.id === target.id);
      if (!pipe) {
        return;
      }
      const id = uniqueHydraulicsId(pipe.id, scene.pipes.map((entry) => entry.id));
      persistScene({
        ...scene,
        pipes: [
          ...scene.pipes,
          {
            ...pipe,
            id,
            label: pipe.label ? `${pipe.label} copy` : id,
            color: pipe.color || DEFAULT_PIPE_COLOR,
            arrowSize: pipe.arrowSize || DEFAULT_PIPE_ARROW_SIZE,
            widthScale: pipe.widthScale || DEFAULT_PIPE_WIDTH_SCALE,
            tokenCount: pipe.tokenCount || DEFAULT_PIPE_TOKEN_COUNT,
            opacity: pipe.opacity || DEFAULT_PIPE_OPACITY,
            waypoints: pipe.waypoints.map((point) => ({
              x: snapHydraulicsUnit(point.x + offset, "x"),
              y: point.y
            }))
          }
        ]
      });
      setSelected({ kind: "pipe", id });
    } else if (target.kind === "box") {
      const box = scene.boxes.find((entry) => entry.id === target.id);
      if (!box) {
        return;
      }
      const id = uniqueHydraulicsId(box.id, scene.boxes.map((entry) => entry.id));
      persistScene({
        ...scene,
        boxes: [
          ...scene.boxes,
          {
            ...box,
            id,
            label: box.label ? `${box.label} copy` : "",
            x: snapHydraulicsUnit(box.x + offset, "x")
          }
        ]
      });
      setSelected({ kind: "box", id });
    }
    closeContextMenu();
  }

  function startAddPipe(): void {
    setLayoutLocked(false);
    setTool("add-pipe");
    closeContextMenu();
  }

  function resetPipeLabel(pipeId: string): void {
    persistScene({
      ...scene,
      pipes: scene.pipes.map((pipe) =>
        pipe.id === pipeId ? { ...pipe, labelT: null, labelOffset: null } : pipe
      )
    });
    closeContextMenu();
  }

  function resetNodeLabel(kind: "sector" | "tank" | "box", id: string): void {
    if (kind === "sector") {
      persistScene({
        ...scene,
        sectors: scene.sectors.map((sector) =>
          sector.id === id ? { ...sector, labelOffsetX: null, labelOffsetY: null } : sector
        )
      });
    } else if (kind === "tank") {
      persistScene({
        ...scene,
        tanks: scene.tanks.map((tank) =>
          tank.id === id ? { ...tank, labelOffsetX: null, labelOffsetY: null } : tank
        )
      });
    } else {
      persistScene({
        ...scene,
        boxes: scene.boxes.map((box) =>
          box.id === id ? { ...box, labelOffsetX: null, labelOffsetY: null } : box
        )
      });
    }
    closeContextMenu();
  }

  const selectedSector = selected?.kind === "sector" ? scene.sectors.find((sector) => sector.id === selected.id) : null;
  const selectedTank = selected?.kind === "tank" ? scene.tanks.find((tank) => tank.id === selected.id) : null;
  const selectedPipe =
    selected?.kind === "pipe"
      ? scene.pipes.find((pipe) => pipe.id === selected.id)
      : selected?.kind === "waypoint"
        ? scene.pipes.find((pipe) => pipe.id === selected.pipeId)
        : null;
  const selectedBox = selected?.kind === "box" ? scene.boxes.find((box) => box.id === selected.id) : null;

  return (
    <div className="hydraulics-cell-view">
      {sourceMatrix ? (
        <p className="hydraulics-cell-caption">
          Bound to matrix <strong>{sourceMatrix.title}</strong> at period {selectedPeriodIndex + 1}.
        </p>
      ) : null}
      {scene.errors.length > 0 ? (
        <div className="hydraulics-diagram-errors" role="alert">
          {scene.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
      {interactive ? (
        <div className="hydraulics-toolbar">
          <div className="hydraulics-toolbar-actions">
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${tool === "select" ? " is-active" : ""}`}
              onClick={() => setTool("select")}
            >
              Select / move
            </button>
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${tool === "add-sector" ? " is-active" : ""}`}
              disabled={layoutLocked}
              onClick={() => setTool("add-sector")}
            >
              Add sector
            </button>
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${tool === "add-tank" ? " is-active" : ""}`}
              disabled={layoutLocked}
              onClick={() => setTool("add-tank")}
            >
              Add tank
            </button>
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${tool === "add-pipe" ? " is-active" : ""}`}
              disabled={layoutLocked}
              onClick={() => setTool("add-pipe")}
            >
              Add pipe
            </button>
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${tool === "add-box" ? " is-active" : ""}`}
              disabled={layoutLocked}
              onClick={() => setTool("add-box")}
            >
              Add box
            </button>
            <button type="button" className="secondary-button" disabled={layoutLocked || !selected} onClick={handleDelete}>
              Delete
            </button>
            <label className="hydraulics-toolbar-checkbox">
              <input
                type="checkbox"
                checked={layoutLocked}
                onChange={(event) => {
                  setLayoutLocked(event.target.checked);
                  if (event.target.checked) {
                    setTool("select");
                  }
                }}
              />
              Lock layout
            </label>
          </div>
          <div className="hydraulics-toolbar-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setPlaying((current) => {
                  const next = !current;
                  if (next) {
                    setAnimationEpoch((epoch) => epoch + 1);
                  }
                  return next;
                })
              }
              disabled={!onSelectedPeriodIndexChange || maxPeriodIndex <= 0}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <label className="hydraulics-speed">
              Speed
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
        </div>
      ) : null}
      <div className="hydraulics-workspace">
        <HydraulicsCanvas
          interactive={interactive}
          interactionEpoch={animationEpoch}
          layoutLocked={layoutLocked || !interactive}
          onContextMenu={setContextMenu}
          onLayoutChange={persistLayout}
          onSelect={setSelected}
          prefersReducedMotion={readPrefersReducedMotion()}
          scene={scene}
          selected={selected}
          tool={tool}
          viewportRoot={viewportRoot}
        />
      </div>
      {interactive && (selectedSector || selectedTank || selectedPipe || selectedBox) ? (
        <HydraulicsInspector
          box={selectedBox}
          boxes={scene.boxes}
          onClose={() => setSelected(null)}
          onPatch={patchSelected}
          pipe={selectedPipe}
          sector={selectedSector}
          tank={selectedTank}
          variableListId={`hydraulics-variable-options-${cell.id}`}
          variableNames={variableNames}
        />
      ) : null}
      {interactive && contextMenu ? (
        <HydraulicsContextMenu
          canEdit={!layoutLocked}
          canResetLabel={selectionHasMovedLabel(contextMenu.selection, scene)}
          menuRef={contextMenuRef}
          request={contextMenu}
          onAddBox={() => addBoxAt(contextMenu.point)}
          onAddPipe={startAddPipe}
          onAddSector={() => addSectorAt(contextMenu.point)}
          onAddTank={() =>
            addTankAt(
              contextMenu.point,
              contextMenu.selection?.kind === "sector" ? contextMenu.selection.id : undefined
            )
          }
          onAddWaypoint={() => {
            const pipeId =
              contextMenu.selection?.kind === "pipe"
                ? contextMenu.selection.id
                : contextMenu.selection?.kind === "waypoint"
                  ? contextMenu.selection.pipeId
                  : null;
            if (pipeId) {
              addWaypoint(pipeId, contextMenu.point);
            }
          }}
          onDelete={() => {
            if (contextMenu.selection) {
              deleteSelection(contextMenu.selection);
            }
          }}
          onDeletePipe={() => {
            const pipeId =
              contextMenu.selection?.kind === "pipe"
                ? contextMenu.selection.id
                : contextMenu.selection?.kind === "waypoint"
                  ? contextMenu.selection.pipeId
                  : null;
            if (pipeId) {
              deleteSelection({ kind: "pipe", id: pipeId });
            }
          }}
          onDuplicate={() => {
            if (contextMenu.selection && contextMenu.selection.kind !== "waypoint") {
              duplicateSelection(contextMenu.selection);
            }
          }}
          onReversePipe={() => {
            const pipeId =
              contextMenu.selection?.kind === "pipe"
                ? contextMenu.selection.id
                : contextMenu.selection?.kind === "waypoint"
                  ? contextMenu.selection.pipeId
                  : null;
            if (pipeId) {
              reversePipe(pipeId);
            }
          }}
          onResetLabel={() => {
            const target = contextMenu.selection;
            if (target?.kind === "pipe") {
              resetPipeLabel(target.id);
            } else if (target?.kind === "sector" || target?.kind === "tank" || target?.kind === "box") {
              resetNodeLabel(target.kind, target.id);
            }
          }}
          onToggleLock={() => {
            setLayoutLocked((current) => {
              const next = !current;
              if (next) {
                setTool("select");
              }
              return next;
            });
            closeContextMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function HydraulicsContextMenu({
  canEdit,
  canResetLabel,
  menuRef,
  request,
  onAddBox,
  onAddPipe,
  onAddSector,
  onAddTank,
  onAddWaypoint,
  onDelete,
  onDeletePipe,
  onDuplicate,
  onResetLabel,
  onReversePipe,
  onToggleLock
}: {
  canEdit: boolean;
  canResetLabel: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  request: HydraulicsContextMenuRequest;
  onAddBox(): void;
  onAddPipe(): void;
  onAddSector(): void;
  onAddTank(): void;
  onAddWaypoint(): void;
  onDelete(): void;
  onDeletePipe(): void;
  onDuplicate(): void;
  onResetLabel(): void;
  onReversePipe(): void;
  onToggleLock(): void;
}) {
  const kind = request.selection?.kind ?? "canvas";
  const label =
    kind === "canvas"
      ? "Hydraulics canvas actions"
      : kind === "waypoint"
        ? "Hydraulics waypoint actions"
        : `Hydraulics ${kind} actions`;

  const panel = (
    <div
      ref={menuRef}
      className="notebook-cell-context-menu"
      role="menu"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {kind === "canvas" ? (
        <>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddSector}>
            Add sector
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddTank}>
            Add tank
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddPipe}>
            Add pipe
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddBox}>
            Add box
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={onToggleLock}>
            {canEdit ? "Lock layout" : "Unlock layout"}
          </button>
        </>
      ) : null}
      {kind === "sector" ? (
        <>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddTank}>
            Add tank here
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" role="menuitem" disabled={!canEdit || !canResetLabel} onClick={onResetLabel}>
            Reset label position
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" disabled={!canEdit} onClick={onDelete}>
            Delete
          </button>
        </>
      ) : null}
      {kind === "tank" || kind === "box" ? (
        <>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" role="menuitem" disabled={!canEdit || !canResetLabel} onClick={onResetLabel}>
            Reset label position
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" disabled={!canEdit} onClick={onDelete}>
            Delete
          </button>
        </>
      ) : null}
      {kind === "pipe" ? (
        <>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onAddWaypoint}>
            Add waypoint
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onReversePipe}>
            Reverse direction
          </button>
          <button type="button" role="menuitem" disabled={!canEdit} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" role="menuitem" disabled={!canEdit || !canResetLabel} onClick={onResetLabel}>
            Reset label position
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" disabled={!canEdit} onClick={onDelete}>
            Delete
          </button>
        </>
      ) : null}
      {kind === "waypoint" ? (
        <>
          <button type="button" role="menuitem" className="is-danger" disabled={!canEdit} onClick={onDelete}>
            Delete waypoint
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" disabled={!canEdit} onClick={onDeletePipe}>
            Delete pipe
          </button>
        </>
      ) : null}
      {!canEdit && kind !== "canvas" ? (
        <>
          <div className="notebook-cell-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={onToggleLock}>
            Unlock layout
          </button>
        </>
      ) : null}
    </div>
  );

  return createPortal(panel, document.body);
}

function HydraulicsInspector({
  box,
  boxes,
  onClose,
  onPatch,
  pipe,
  sector,
  tank,
  variableListId,
  variableNames
}: {
  box: ReturnType<typeof resolveHydraulicsScene>["boxes"][number] | null | undefined;
  boxes: ReturnType<typeof resolveHydraulicsScene>["boxes"];
  onClose(): void;
  onPatch(mutate: (layout: HydraulicsLayout) => HydraulicsLayout): void;
  pipe: ReturnType<typeof resolveHydraulicsScene>["pipes"][number] | null | undefined;
  sector: ReturnType<typeof resolveHydraulicsScene>["sectors"][number] | null | undefined;
  tank: ReturnType<typeof resolveHydraulicsScene>["tanks"][number] | null | undefined;
  variableListId: string;
  variableNames: string[];
}) {
  const { position, dragHandleProps } = useFloatingPanelPosition(INSPECTOR_POSITION_STORAGE_KEY);
  const title = selectedInspectorTitle(sector, tank, pipe, box);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [box?.id, pipe?.id, sector?.id, tank?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const panel = (
    <div
      ref={panelRef}
      className="stability-raw-floating-panel notebook-inspector-popup hydraulics-inspector-popup"
      role="dialog"
      aria-label="Hydraulics inspector"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
    >
      <header className="stability-raw-dialog-header stability-raw-dialog-header-draggable" {...dragHandleProps}>
        <div>
          <div className="eyebrow">Hydraulics inspector</div>
          <p className="stability-raw-dialog-subtitle">{title}</p>
        </div>
        <button
          type="button"
          className="stability-raw-dialog-close"
          aria-label="Close inspector"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="stability-raw-dialog-body notebook-inspector-popup-body hydraulics-inspector">
      {sector ? (
        <>
        <label>
          Label
          <input
            value={sector.label}
            onChange={(event) => {
              const label = event.target.value;
              onPatch((layout) => ({
                ...layout,
                sectors: layout.sectors?.map((entry) => (entry.id === sector.id ? { ...entry, label } : entry))
              }));
            }}
          />
        </label>
        <label>
          Fill
          <input
            type="color"
            aria-label="Sector fill color"
            value={/^#[0-9A-Fa-f]{6}$/.test(sector.fill) ? sector.fill : DEFAULT_SECTOR_FILL}
            onChange={(event) => {
              const fill = event.target.value;
              onPatch((layout) => ({
                ...layout,
                sectors: layout.sectors?.map((entry) => (entry.id === sector.id ? { ...entry, fill } : entry))
              }));
            }}
          />
        </label>
        <label>
          Border
          <input
            type="color"
            aria-label="Sector border color"
            value={/^#[0-9A-Fa-f]{6}$/.test(sector.stroke) ? sector.stroke : DEFAULT_SECTOR_STROKE}
            onChange={(event) => {
              const stroke = event.target.value;
              onPatch((layout) => ({
                ...layout,
                sectors: layout.sectors?.map((entry) => (entry.id === sector.id ? { ...entry, stroke } : entry))
              }));
            }}
          />
        </label>
        <label>
          Opacity
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            aria-label="Sector opacity"
            value={Math.round(sector.opacity * 100)}
            onChange={(event) => {
              const opacity = Number(event.target.value) / 100;
              onPatch((layout) => ({
                ...layout,
                sectors: layout.sectors?.map((entry) => (entry.id === sector.id ? { ...entry, opacity } : entry))
              }));
            }}
          />
        </label>
        <NodeLabelOffsetFields
          offsetX={sector.labelOffsetX}
          offsetY={sector.labelOffsetY}
          onChange={(next) => {
            onPatch((layout) => ({
              ...layout,
              sectors: layout.sectors?.map((entry) => (entry.id === sector.id ? { ...entry, ...next } : entry))
            }));
          }}
          onReset={() => {
            onPatch((layout) => ({
              ...layout,
              sectors: layout.sectors?.map((entry) => {
                if (entry.id !== sector.id) {
                  return entry;
                }
                const { labelOffsetX: _x, labelOffsetY: _y, ...rest } = entry;
                return rest;
              })
            }));
          }}
        />
        </>
      ) : null}
      {box ? (
        <>
          <label>
            Label
            <input
              value={box.label}
              onChange={(event) => {
                const label = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) => (entry.id === box.id ? { ...entry, label } : entry))
                }));
              }}
            />
          </label>
          <NodeLabelOffsetFields
            offsetX={box.labelOffsetX}
            offsetY={box.labelOffsetY}
            onChange={(next) => {
              onPatch((layout) => ({
                ...layout,
                boxes: layout.boxes?.map((entry) => (entry.id === box.id ? { ...entry, ...next } : entry))
              }));
            }}
            onReset={() => {
              onPatch((layout) => ({
                ...layout,
                boxes: layout.boxes?.map((entry) => {
                  if (entry.id !== box.id) {
                    return entry;
                  }
                  const { labelOffsetX: _x, labelOffsetY: _y, ...rest } = entry;
                  return rest;
                })
              }));
            }}
          />
          <label>
            Border
            <input
              type="color"
              aria-label="Box border color"
              value={/^#[0-9A-Fa-f]{6}$/.test(box.stroke) ? box.stroke : DEFAULT_BOX_STROKE}
              onChange={(event) => {
                const stroke = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) => (entry.id === box.id ? { ...entry, stroke } : entry))
                }));
              }}
            />
          </label>
          <label className="hydraulics-inspector-checkbox">
            <input
              type="checkbox"
              checked={box.dashed}
              onChange={(event) => {
                const dashed = event.target.checked;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) => (entry.id === box.id ? { ...entry, dashed } : entry))
                }));
              }}
            />
            Dashed border
          </label>
          <label className="hydraulics-inspector-checkbox">
            <input
              type="checkbox"
              checked={box.fillOpacity <= 0}
              onChange={(event) => {
                const fillOpacity = event.target.checked ? 0 : DEFAULT_BOX_FILL_OPACITY;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) =>
                    entry.id === box.id ? { ...entry, fillOpacity } : entry
                  )
                }));
              }}
            />
            Transparent fill
          </label>
          <label>
            Fill
            <input
              type="color"
              aria-label="Box fill color"
              value={/^#[0-9A-Fa-f]{6}$/.test(box.fill) ? box.fill : DEFAULT_BOX_FILL}
              onChange={(event) => {
                const fill = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) =>
                    entry.id === box.id
                      ? {
                          ...entry,
                          fill,
                          fillOpacity: (entry.fillOpacity ?? 0) <= 0 ? DEFAULT_BOX_FILL_OPACITY : entry.fillOpacity
                        }
                      : entry
                  )
                }));
              }}
            />
          </label>
          <label>
            Fill opacity
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Box fill opacity"
              value={Math.round(box.fillOpacity * 100)}
              onChange={(event) => {
                const fillOpacity = Number(event.target.value) / 100;
                onPatch((layout) => ({
                  ...layout,
                  boxes: layout.boxes?.map((entry) =>
                    entry.id === box.id ? { ...entry, fillOpacity } : entry
                  )
                }));
              }}
            />
          </label>
        </>
      ) : null}
      {tank ? (
        <>
          <label>
            Variable
            <input
              list={variableListId}
              value={tank.variable ?? ""}
              onChange={(event) => {
                const variable = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, variable } : entry))
                }));
              }}
            />
          </label>
          <label>
            Expression
            <input
              value={tank.expression ?? ""}
              onChange={(event) => {
                const expression = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, expression } : entry))
                }));
              }}
            />
          </label>
          <label>
            Sector
            <input
              value={tank.sectorId}
              onChange={(event) => {
                const sectorId = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, sectorId } : entry))
                }));
              }}
            />
          </label>
          <label>
            Polarity
            <select
              value={tank.polarity}
              onChange={(event) => {
                const polarity = event.target.value as HydraulicsPolarity;
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, polarity } : entry))
                }));
              }}
            >
              <option value="asset">Asset (fill up)</option>
              <option value="liability">Liability (fill down)</option>
            </select>
          </label>
          <label>
            Color
            <input
              type="color"
              value={tank.color}
              onChange={(event) => {
                const color = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, color } : entry))
                }));
              }}
            />
          </label>
          <label>
            Max level
            <input
              type="number"
              min={0}
              step="any"
              aria-label="Tank max level"
              placeholder={tank.runMaxAbs > 0 ? `Run max ${formatHydraulicsTankValue(tank.runMaxAbs)}` : "Run max"}
              value={tank.maxLevel ?? ""}
              onChange={(event) => {
                const raw = event.target.value.trim();
                onPatch((layout) => ({
                  ...layout,
                  tanks: layout.tanks?.map((entry) => {
                    if (entry.id !== tank.id) {
                      return entry;
                    }
                    if (raw === "") {
                      const { maxLevel: _maxLevel, ...rest } = entry;
                      return rest;
                    }
                    const maxLevel = Number(raw);
                    return {
                      ...entry,
                      maxLevel: Number.isFinite(maxLevel) && maxLevel > 0 ? maxLevel : undefined
                    };
                  })
                }));
              }}
            />
          </label>
          <p className="hydraulics-inspector-readout">
            Current value <strong>{formatHydraulicsTankValue(tank.value)}</strong>
            {" · "}
            fill scale <strong>{formatHydraulicsTankValue(tank.maxAbs > 0 ? tank.maxAbs : null)}</strong>
            {tank.maxAbs > 0 ? ` (${tank.maxLevel != null ? "authored" : "run"})` : ""}
          </p>
          <NodeLabelOffsetFields
            offsetX={tank.labelOffsetX}
            offsetY={tank.labelOffsetY}
            onChange={(next) => {
              onPatch((layout) => ({
                ...layout,
                tanks: layout.tanks?.map((entry) => (entry.id === tank.id ? { ...entry, ...next } : entry))
              }));
            }}
            onReset={() => {
              onPatch((layout) => ({
                ...layout,
                tanks: layout.tanks?.map((entry) => {
                  if (entry.id !== tank.id) {
                    return entry;
                  }
                  const { labelOffsetX: _x, labelOffsetY: _y, ...rest } = entry;
                  return rest;
                })
              }));
            }}
          />
        </>
      ) : null}
      {pipe ? (
        <>
          <label>
            Label
            <input
              value={pipe.label}
              onChange={(event) => {
                const label = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => (entry.id === pipe.id ? { ...entry, label } : entry))
                }));
              }}
            />
          </label>
          <label>
            Variable
            <input
              list={variableListId}
              aria-label="Pipe variable"
              value={pipe.variable ?? ""}
              onChange={(event) => {
                const variable = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => (entry.id === pipe.id ? { ...entry, variable } : entry))
                }));
              }}
            />
          </label>
          <label>
            Expression
            <input
              aria-label="Pipe expression"
              value={pipe.expression ?? ""}
              onChange={(event) => {
                const expression = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => (entry.id === pipe.id ? { ...entry, expression } : entry))
                }));
              }}
            />
          </label>
          <p className="hydraulics-inspector-readout">
            Current flow <strong>{formatHydraulicsTankValue(pipe.magnitude)}</strong>
          </p>
          <label>
            Along pipe
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="Label position along pipe"
              value={Math.round((pipe.labelT ?? 0.5) * 100)}
              onChange={(event) => {
                const labelT = Number(event.target.value) / 100;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id
                      ? { ...entry, labelT, labelOffset: entry.labelOffset ?? 0 }
                      : entry
                  )
                }));
              }}
            />
          </label>
          <label>
            Offset
            <input
              type="range"
              min={-8}
              max={8}
              step={0.5}
              aria-label="Label offset from pipe"
              value={pipe.labelOffset ?? 0}
              onChange={(event) => {
                const labelOffset = Number(event.target.value);
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id
                      ? { ...entry, labelT: entry.labelT ?? 0.5, labelOffset }
                      : entry
                  )
                }));
              }}
            />
          </label>
          {pipe.labelT != null || pipe.labelOffset != null ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => {
                    if (entry.id !== pipe.id) {
                      return entry;
                    }
                    const { labelT: _labelT, labelOffset: _labelOffset, ...rest } = entry;
                    return rest;
                  })
                }));
              }}
            >
              Reset label position
            </button>
          ) : null}
          {pipe.from.kind !== "point" ? (
            <label>
              From port
              <select
                value={pipe.from.port ?? ""}
                onChange={(event) => {
                  const port = event.target.value;
                  onPatch((layout) => ({
                    ...layout,
                    pipes: layout.pipes?.map((entry) =>
                      entry.id === pipe.id ? { ...entry, from: withAnchorPort(entry.from, port) } : entry
                    )
                  }));
                }}
              >
                <option value="">Auto (nearest)</option>
                {inspectorPortsForAnchor(pipe.from, boxes).map((port) => (
                  <option key={`from-${port}`} value={port}>
                    {portLabel(port)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {pipe.to.kind !== "point" ? (
            <label>
              To port
              <select
                value={pipe.to.port ?? ""}
                onChange={(event) => {
                  const port = event.target.value;
                  onPatch((layout) => ({
                    ...layout,
                    pipes: layout.pipes?.map((entry) =>
                      entry.id === pipe.id ? { ...entry, to: withAnchorPort(entry.to, port) } : entry
                    )
                  }));
                }}
              >
                <option value="">Auto (nearest)</option>
                {inspectorPortsForAnchor(pipe.to, boxes).map((port) => (
                  <option key={`to-${port}`} value={port}>
                    {portLabel(port)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Color
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(pipe.color) ? pipe.color : "#334155"}
              onChange={(event) => {
                const color = event.target.value;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => (entry.id === pipe.id ? { ...entry, color } : entry))
                }));
              }}
            />
          </label>
          <label>
            Arrow head (0 = none)
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={pipe.arrowSize}
              onChange={(event) => {
                const arrowSize = Number(event.target.value);
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id ? { ...entry, arrowSize: Number.isFinite(arrowSize) ? arrowSize : 0 } : entry
                  )
                }));
              }}
            />
          </label>
          <label>
            Width scale
            <input
              type="number"
              min={0}
              max={4}
              step={0.25}
              value={pipe.widthScale}
              onChange={(event) => {
                const widthScale = Number(event.target.value);
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id ? { ...entry, widthScale: Number.isFinite(widthScale) ? widthScale : 1 } : entry
                  )
                }));
              }}
            />
          </label>
          <label>
            Opacity
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={pipe.opacity}
              onChange={(event) => {
                const opacity = Number(event.target.value);
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id ? { ...entry, opacity: Number.isFinite(opacity) ? opacity : 1 } : entry
                  )
                }));
              }}
            />
          </label>
          <label className="hydraulics-inspector-checkbox">
            <input
              type="checkbox"
              checked={pipe.dashed}
              onChange={(event) => {
                const dashed = event.target.checked;
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) => (entry.id === pipe.id ? { ...entry, dashed } : entry))
                }));
              }}
            />
            Dashed
          </label>
        </>
      ) : null}
      <datalist id={variableListId}>
        {variableNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function selectedInspectorTitle(
  sector: ReturnType<typeof resolveHydraulicsScene>["sectors"][number] | null | undefined,
  tank: ReturnType<typeof resolveHydraulicsScene>["tanks"][number] | null | undefined,
  pipe: ReturnType<typeof resolveHydraulicsScene>["pipes"][number] | null | undefined,
  box: ReturnType<typeof resolveHydraulicsScene>["boxes"][number] | null | undefined
): ReactNode {
  if (sector) {
    return (
      <>
        Sector · <VariableMathLabel name={sector.label} />
      </>
    );
  }
  if (tank) {
    return (
      <>
        Tank · <VariableMathLabel name={tank.label} />
      </>
    );
  }
  if (pipe) {
    return (
      <>
        Pipe · <VariableMathLabel name={pipe.label} />
      </>
    );
  }
  if (box) {
    return box.label.trim() ? (
      <>
        Box · <VariableMathLabel name={box.label} />
      </>
    ) : (
      "Box"
    );
  }
  return "Nothing selected";
}

const PORT_LABELS: Record<HydraulicsPort, string> = {
  c: "Center",
  n: "North",
  nne: "North-northeast",
  ne: "Northeast",
  ene: "East-northeast",
  e: "East",
  ese: "East-southeast",
  se: "Southeast",
  sse: "South-southeast",
  s: "South",
  ssw: "South-southwest",
  sw: "Southwest",
  wsw: "West-southwest",
  w: "West",
  wnw: "West-northwest",
  nw: "Northwest",
  nnw: "North-northwest"
};

function selectionHasMovedLabel(
  selection: HydraulicsSelection | null,
  scene: ReturnType<typeof resolveHydraulicsScene>
): boolean {
  if (!selection) {
    return false;
  }
  if (selection.kind === "pipe") {
    const pipe = scene.pipes.find((entry) => entry.id === selection.id);
    return Boolean(pipe && (pipe.labelT != null || pipe.labelOffset != null));
  }
  if (selection.kind === "waypoint") {
    return false;
  }
  const node =
    selection.kind === "sector"
      ? scene.sectors.find((entry) => entry.id === selection.id)
      : selection.kind === "tank"
        ? scene.tanks.find((entry) => entry.id === selection.id)
        : scene.boxes.find((entry) => entry.id === selection.id);
  return Boolean(node && (node.labelOffsetX != null || node.labelOffsetY != null));
}

function NodeLabelOffsetFields({
  offsetX,
  offsetY,
  onChange,
  onReset
}: {
  offsetX: number | null;
  offsetY: number | null;
  onChange(next: { labelOffsetX: number; labelOffsetY: number }): void;
  onReset(): void;
}) {
  return (
    <>
      <label>
        Label offset X
        <input
          type="range"
          min={-8}
          max={8}
          step={0.5}
          aria-label="Label offset X"
          value={offsetX ?? 0}
          onChange={(event) => {
            onChange({ labelOffsetX: Number(event.target.value), labelOffsetY: offsetY ?? 0 });
          }}
        />
      </label>
      <label>
        Label offset Y
        <input
          type="range"
          min={-8}
          max={8}
          step={0.5}
          aria-label="Label offset Y"
          value={offsetY ?? 0}
          onChange={(event) => {
            onChange({ labelOffsetX: offsetX ?? 0, labelOffsetY: Number(event.target.value) });
          }}
        />
      </label>
      {offsetX != null || offsetY != null ? (
        <button type="button" className="secondary-button" onClick={onReset}>
          Reset label position
        </button>
      ) : null}
    </>
  );
}

function portLabel(port: string): string {
  if (port in PORT_LABELS) {
    return `${PORT_LABELS[port as HydraulicsPort]} (${port})`;
  }
  const parsed = parseHydraulicsBoxPort(port);
  if (!parsed) {
    return port;
  }
  if (parsed.kind === "center") {
    return "Center (c)";
  }
  if (parsed.kind === "corner") {
    return `${PORT_LABELS[parsed.corner]} (${parsed.corner})`;
  }
  const side = PORT_LABELS[parsed.side];
  const signed = parsed.offset > 0 ? `+${parsed.offset}` : String(parsed.offset);
  return `${side} ${signed} (${port})`;
}

function inspectorPortsForAnchor(
  anchor: HydraulicsAnchor,
  boxes: ReturnType<typeof resolveHydraulicsScene>["boxes"]
): string[] {
  if (anchor.kind === "point") {
    return [];
  }
  if (anchor.kind === "box") {
    const box = boxes.find((entry) => entry.id === anchor.id);
    if (!box) {
      return hydraulicsBoxPorts(HYDRAULICS_BOX_GRID_WIDTH, HYDRAULICS_BOX_GRID_HEIGHT);
    }
    return hydraulicsBoxPorts(hydraulicsUnitToGrid(box.width, "x"), hydraulicsUnitToGrid(box.height, "y"));
  }
  return [...hydraulicsPortsForKind(anchor.kind)];
}

function withAnchorPort(anchor: HydraulicsAnchor, port: string): HydraulicsAnchor {
  if (anchor.kind === "point") {
    return anchor;
  }
  if (!port) {
    if (anchor.kind === "box") {
      return { kind: "box", id: anchor.id };
    }
    if (anchor.kind === "sector") {
      return { kind: "sector", id: anchor.id };
    }
    return { kind: "tank", id: anchor.id };
  }
  if (anchor.kind === "box") {
    return { kind: "box", id: anchor.id, port };
  }
  if (anchor.kind === "sector") {
    return { kind: "sector", id: anchor.id, port: port as HydraulicsPort };
  }
  return { kind: "tank", id: anchor.id, port: port as HydraulicsPort };
}

function uniqueHydraulicsId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(prefix)) {
    return prefix;
  }
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) {
    suffix += 1;
  }
  return `${prefix}-${suffix}`;
}

function nearestSector(
  point: { x: number; y: number },
  sectors: Array<{ id: string; x: number; y: number }>
): { id: string; x: number; y: number } | null {
  let nearest: { id: string; x: number; y: number } | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sector of sectors) {
    const distance = Math.hypot(point.x - sector.x, point.y - sector.y);
    if (distance <= 0.18 && distance < nearestDistance) {
      nearest = sector;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
