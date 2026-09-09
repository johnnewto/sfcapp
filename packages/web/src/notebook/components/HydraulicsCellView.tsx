import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type {
  HydraulicsAnchor,
  HydraulicsCell,
  HydraulicsLayout,
  HydraulicsPolarity,
  HydraulicsPort,
  NotebookCell
} from "@sfcr/notebook-core";
import { hydraulicsBoxPorts, hydraulicsPortsForKind, HYDRAULICS_SNAP_STEPS, parseHydraulicsBoxPort } from "@sfcr/notebook-core";

import {
  HydraulicsCanvas,
  type HydraulicsContextMenuRequest,
  type HydraulicsSelection,
  type HydraulicsTool
} from "../../components/HydraulicsCanvas";
import type { MultiportVariableInspectContextValue } from "../../components/flow/MultiportVariableInspectContext";
import { VariableMathLabel } from "../../components/VariableMathLabel";
import type { VariableInspectRequest } from "../../lib/variableInspect";
import type { VariableDescriptions } from "../../lib/variableDescriptions";
import { resolveInspectBundleForRunCell, resolveHydraulicsRunCellId } from "../sequenceMatrixInspect";
import { useFloatingPanelPosition } from "../../hooks/useFloatingPanelPosition";
import { applyFixedMenuPosition } from "../../lib/clampFixedMenuPosition";
import {
  clampHydraulicsViewport,
  createResolvedHydraulicsBox,
  DEFAULT_BOX_FILL,
  DEFAULT_BOX_FILL_OPACITY,
  DEFAULT_BOX_STROKE,
  DEFAULT_HYDRAULICS_VIEWPORT,
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
  HYDRAULICS_GRID_COLS_MAX,
  HYDRAULICS_GRID_COLS_MIN,
  HYDRAULICS_GRID_ROWS_MAX,
  HYDRAULICS_GRID_ROWS_MIN,
  HYDRAULICS_TANK_GRID_Y,
  HYDRAULICS_ZOOM_MAX,
  HYDRAULICS_ZOOM_MIN,
  hydraulicsGridToUnit,
  hydraulicsUnitToGrid,
  layoutFromResolved,
  persistHydraulicsCanvas,
  resolveHydraulicsCanvas,
  resolveHydraulicsScene,
  resolveHydraulicsSnapStep,
  snapHydraulicsPoint,
  snapHydraulicsUnit,
  type HydraulicsViewport
} from "../hydraulics";
import type { MatrixCell } from "../types";
import type { useNotebookRunner } from "../useNotebookRunner";

const INSPECTOR_POSITION_STORAGE_KEY = "sfcr.hydraulics-inspector-position";

const PLAY_INTERVAL_MS = 700;

export function HydraulicsCellView({
  cell,
  cells,
  highlightedVariable = null,
  interactive = true,
  maxPeriodIndex,
  onCellChange,
  onSelectedPeriodIndexChange,
  onVariableInspectRequest,
  runner,
  selectedPeriodIndex,
  variableDescriptions,
  viewportRoot = null
}: {
  cell: HydraulicsCell;
  cells: NotebookCell[];
  highlightedVariable?: string | null;
  interactive?: boolean;
  maxPeriodIndex: number;
  onCellChange?(cellId: string, updater: (cell: NotebookCell) => NotebookCell): void;
  onSelectedPeriodIndexChange?(nextIndex: number): void;
  onVariableInspectRequest?(args: VariableInspectRequest): void;
  runner: Pick<ReturnType<typeof useNotebookRunner>, "getResult">;
  selectedPeriodIndex: number;
  variableDescriptions?: VariableDescriptions;
  viewportRoot?: Element | null;
}) {
  const [tool, setTool] = useState<HydraulicsTool>("select");
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<HydraulicsSelection | null>(null);
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [viewport, setViewport] = useState<HydraulicsViewport>(DEFAULT_HYDRAULICS_VIEWPORT);
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
  const canvas = resolveHydraulicsCanvas(scene.canvas);

  const sourceMatrix = useMemo((): MatrixCell | null => {
    const target = cells.find((entry) => entry.id === cell.source.transactionMatrixCellId);
    return target?.type === "matrix" ? target : null;
  }, [cell.source.transactionMatrixCellId, cells]);

  const inspectBundle = useMemo(
    () =>
      variableDescriptions
        ? resolveInspectBundleForRunCell(
            cells,
            runner,
            selectedPeriodIndex,
            variableDescriptions,
            resolveHydraulicsRunCellId(cell, cells)
          )
        : null,
    [cell, cells, runner, selectedPeriodIndex, variableDescriptions]
  );
  const inspectContextRef = useRef(inspectBundle);
  inspectContextRef.current = inspectBundle;

  const handleInspectVariable = useCallback(
    (selectedVariable: string) => {
      const bundle = inspectContextRef.current;
      if (!bundle?.editor || !onVariableInspectRequest) {
        return;
      }
      onVariableInspectRequest({
        currentValues: bundle.currentValues,
        editor: bundle.editor,
        modelSource: bundle.modelSource,
        sourceRunCellId: bundle.sourceRunCellId,
        selectedVariable,
        variableDescriptions: bundle.variableDescriptions,
        variableUnitMetadata: bundle.variableUnitMetadata
      });
    },
    [onVariableInspectRequest]
  );

  const inspectContext = useMemo((): MultiportVariableInspectContextValue | null => {
    if (!inspectBundle) {
      return null;
    }
    return {
      currentValues: inspectBundle.currentValues,
      laggedCurrentValues: inspectBundle.laggedCurrentValues,
      laggedPeriodLabel: inspectBundle.laggedPeriodLabel,
      highlightedVariable,
      onSelectVariable: inspectBundle.editor ? handleInspectVariable : undefined,
      parameterNames: inspectBundle.parameterNames,
      variableDescriptions: inspectBundle.variableDescriptions,
      variableUnitMetadata: inspectBundle.variableUnitMetadata
    };
  }, [handleInspectVariable, highlightedVariable, inspectBundle]);

  const variableNames = useMemo(() => {
    const runCellId = resolveHydraulicsRunCellId(cell, cells);
    const result = runCellId ? runner.getResult(runCellId) : null;
    return result ? Object.keys(result.series).sort() : [];
  }, [cell, cells, runner]);

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
    onCellChange?.(cell.id, (current) => (current.type === "diagram" ? { ...current, layout } : current));
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
    if (target.kind === "canvas" || target.kind === "all") {
      setSelected(null);
      closeContextMenu();
      return;
    }
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
    const snapped = snapHydraulicsPoint(point, canvas.snapStep, canvas);
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
    const snapped = snapHydraulicsPoint(point, canvas.snapStep, canvas);
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
          x: sector ? snapHydraulicsUnit(sector.x + attached * (2 / canvas.cols), "x", canvas.snapStep, canvas) : snapped.x,
          y: sector ? hydraulicsGridToUnit(HYDRAULICS_TANK_GRID_Y, "y", canvas.snapStep, canvas) : snapped.y,
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
    const snapped = snapHydraulicsPoint(point, canvas.snapStep, canvas);
    const id = uniqueHydraulicsId(
      "box",
      scene.boxes.map((box) => box.id)
    );
    persistScene({
      ...scene,
      boxes: [...scene.boxes, createResolvedHydraulicsBox(id, snapped.x, snapped.y, canvas)]
    });
    setSelected({ kind: "box", id });
    closeContextMenu();
  }

  function addWaypoint(pipeId: string, point: { x: number; y: number }): void {
    const snapped = snapHydraulicsPoint(point, canvas.snapStep, canvas);
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
    if (target.kind === "canvas" || target.kind === "all" || target.kind === "waypoint") {
      return;
    }
    const offset = 2 / canvas.cols;
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
          { ...sector, id, label: `${sector.label} copy`, x: snapHydraulicsUnit(sector.x + offset, "x", canvas.snapStep, canvas) }
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
        tanks: [...scene.tanks, { ...tank, id, x: snapHydraulicsUnit(tank.x + offset, "x", canvas.snapStep, canvas) }]
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
              x: snapHydraulicsUnit(point.x + offset, "x", canvas.snapStep, canvas),
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
            x: snapHydraulicsUnit(box.x + offset, "x", canvas.snapStep, canvas)
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
            <button
              type="button"
              className={`notebook-run-button notebook-source-toggle${selected?.kind === "canvas" ? " is-active" : ""}`}
              onClick={() => setSelected({ kind: "canvas" })}
            >
              Canvas
            </button>
            <button type="button" className="secondary-button" disabled={layoutLocked || !selected || selected.kind === "canvas" || selected.kind === "all"} onClick={handleDelete}>
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
          onToolChange={setTool}
          onViewportChange={setViewport}
          inspectContext={inspectContext}
          prefersReducedMotion={readPrefersReducedMotion()}
          scene={scene}
          selected={selected}
          tool={tool}
          viewport={viewport}
          viewportRoot={viewportRoot}
        />
      </div>
      {interactive && (selected?.kind === "canvas" || selectedSector || selectedTank || selectedPipe || selectedBox) ? (
        <HydraulicsInspector
          box={selectedBox}
          boxes={scene.boxes}
          isCanvas={selected?.kind === "canvas"}
          onClose={() => setSelected(null)}
          onPatch={patchSelected}
          onViewportChange={setViewport}
          pipe={selectedPipe}
          sector={selectedSector}
          showGrid={canvas.showGrid}
          snapStep={canvas.snapStep}
          cols={canvas.cols}
          rows={canvas.rows}
          tank={selectedTank}
          variableListId={`hydraulics-variable-options-${cell.id}`}
          variableNames={variableNames}
          viewport={viewport}
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
          onSelectAll={() => {
            setSelected({ kind: "all" });
            setTool("select");
            closeContextMenu();
          }}
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
            if (contextMenu.selection && contextMenu.selection.kind !== "waypoint" && contextMenu.selection.kind !== "all") {
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
  onSelectAll,
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
  onSelectAll(): void;
  onToggleLock(): void;
}) {
  const kind = request.selection?.kind ?? "canvas";
  const label =
    kind === "canvas"
      ? "Stock-flow diagram canvas actions"
      : kind === "waypoint"
        ? "Stock-flow diagram waypoint actions"
        : `Stock-flow diagram ${kind} actions`;

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
          <button type="button" role="menuitem" onClick={onSelectAll}>
            Select all
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
  cols,
  isCanvas = false,
  onClose,
  onPatch,
  onViewportChange,
  pipe,
  rows,
  sector,
  showGrid,
  snapStep,
  tank,
  variableListId,
  variableNames,
  viewport
}: {
  box: ReturnType<typeof resolveHydraulicsScene>["boxes"][number] | null | undefined;
  boxes: ReturnType<typeof resolveHydraulicsScene>["boxes"];
  cols: number;
  isCanvas?: boolean;
  onClose(): void;
  onPatch(mutate: (layout: HydraulicsLayout) => HydraulicsLayout): void;
  onViewportChange(viewport: HydraulicsViewport): void;
  pipe: ReturnType<typeof resolveHydraulicsScene>["pipes"][number] | null | undefined;
  rows: number;
  sector: ReturnType<typeof resolveHydraulicsScene>["sectors"][number] | null | undefined;
  showGrid: boolean;
  snapStep: ReturnType<typeof resolveHydraulicsSnapStep>;
  tank: ReturnType<typeof resolveHydraulicsScene>["tanks"][number] | null | undefined;
  variableListId: string;
  variableNames: string[];
  viewport: HydraulicsViewport;
}) {
  const { position, dragHandleProps } = useFloatingPanelPosition(INSPECTOR_POSITION_STORAGE_KEY);
  const title = selectedInspectorTitle(sector, tank, pipe, box, isCanvas);
  const panelRef = useRef<HTMLDivElement | null>(null);

  function patchCanvas(next: { snapStep?: typeof snapStep; showGrid?: boolean; cols?: number; rows?: number }): void {
    onPatch((layout) => ({
      ...layout,
      canvas: persistHydraulicsCanvas({
        snapStep,
        showGrid,
        cols,
        rows,
        ...next
      })
    }));
  }

  useLayoutEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [box?.id, isCanvas, pipe?.id, sector?.id, tank?.id]);

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
      aria-label="Stock-flow diagram inspector"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
    >
      <header className="stability-raw-dialog-header stability-raw-dialog-header-draggable" {...dragHandleProps}>
        <div>
          <div className="eyebrow">Stock-flow diagram inspector</div>
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
      {isCanvas ? (
        <>
          <label>
            Snap step
            <select
              aria-label="Snap step"
              value={String(snapStep)}
              onChange={(event) => {
                patchCanvas({ snapStep: resolveHydraulicsSnapStep(Number(event.target.value)) });
              }}
            >
              {HYDRAULICS_SNAP_STEPS.map((step) => (
                <option key={step} value={String(step)}>
                  {step === 1 ? "1 cell" : `${step} cell`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Columns
            <input
              type="number"
              min={HYDRAULICS_GRID_COLS_MIN}
              max={HYDRAULICS_GRID_COLS_MAX}
              step={2}
              aria-label="Canvas columns"
              value={cols}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                patchCanvas({ cols: resolveHydraulicsCanvas({ cols: parsed, rows }).cols });
              }}
            />
          </label>
          <label>
            Rows
            <input
              type="number"
              min={HYDRAULICS_GRID_ROWS_MIN}
              max={HYDRAULICS_GRID_ROWS_MAX}
              step={2}
              aria-label="Canvas rows"
              value={rows}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                patchCanvas({ rows: resolveHydraulicsCanvas({ cols, rows: parsed }).rows });
              }}
            />
          </label>
          <p className="hydraulics-inspector-readout">
            Extra columns appear on the right; extra rows at the bottom. Existing cells stay put.
          </p>
          <label className="hydraulics-inspector-checkbox">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(event) => {
                patchCanvas({ showGrid: event.target.checked });
              }}
            />
            Show snap grid
          </label>
          <label>
            Zoom
            <input
              type="range"
              min={HYDRAULICS_ZOOM_MIN * 100}
              max={HYDRAULICS_ZOOM_MAX * 100}
              step={10}
              aria-label="Canvas zoom"
              value={Math.round(viewport.scale * 100)}
              onChange={(event) => {
                const nextScale = Number(event.target.value) / 100;
                const centerX = viewport.x + 1 / viewport.scale / 2;
                const centerY = viewport.y + 1 / viewport.scale / 2;
                onViewportChange(
                  clampHydraulicsViewport({
                    scale: nextScale,
                    x: centerX - 1 / nextScale / 2,
                    y: centerY - 1 / nextScale / 2
                  })
                );
              }}
            />
          </label>
          <p className="hydraulics-inspector-readout">
            {Math.round(viewport.scale * 100)}% · Ctrl+scroll to zoom
            {viewport.scale > 1 ? " · drag empty canvas to pan" : ""}
          </p>
          {viewport.scale !== 1 || viewport.x !== 0 || viewport.y !== 0 ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onViewportChange(DEFAULT_HYDRAULICS_VIEWPORT)}
            >
              Reset view
            </button>
          ) : null}
        </>
      ) : null}
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
  box: ReturnType<typeof resolveHydraulicsScene>["boxes"][number] | null | undefined,
  isCanvas = false
): ReactNode {
  if (isCanvas) {
    return "Canvas";
  }
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
  if (!selection || selection.kind === "canvas" || selection.kind === "all") {
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
