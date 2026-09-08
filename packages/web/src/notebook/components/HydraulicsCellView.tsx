import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  HydraulicsAnchor,
  HydraulicsCell,
  HydraulicsLayout,
  HydraulicsPolarity,
  HydraulicsPort,
  NotebookCell
} from "@sfcr/notebook-core";
import { HYDRAULICS_PORTS } from "@sfcr/notebook-core";

import {
  HydraulicsCanvas,
  type HydraulicsSelection,
  type HydraulicsTool
} from "../../components/HydraulicsCanvas";
import { useFloatingPanelPosition } from "../../hooks/useFloatingPanelPosition";
import { formatHydraulicsTankValue, layoutFromResolved, resolveHydraulicsScene } from "../hydraulics";
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
  selectedPeriodIndex
}: {
  cell: HydraulicsCell;
  cells: NotebookCell[];
  interactive?: boolean;
  maxPeriodIndex: number;
  onCellChange?(cellId: string, updater: (cell: NotebookCell) => NotebookCell): void;
  onSelectedPeriodIndexChange?(nextIndex: number): void;
  runner: Pick<ReturnType<typeof useNotebookRunner>, "getResult">;
  selectedPeriodIndex: number;
}) {
  const [tool, setTool] = useState<HydraulicsTool>("select");
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<HydraulicsSelection | null>(null);
  const periodRef = useRef(selectedPeriodIndex);
  periodRef.current = selectedPeriodIndex;

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
    const layout = layoutFromResolved(scene);
    if (selected.kind === "sector") {
      persistLayout({
        ...layout,
        sectors: layout.sectors?.filter((sector) => sector.id !== selected.id)
      });
    } else if (selected.kind === "tank") {
      persistLayout({
        ...layout,
        tanks: layout.tanks?.filter((tank) => tank.id !== selected.id)
      });
    } else if (selected.kind === "pipe" || selected.kind === "waypoint") {
      const pipeId = selected.kind === "pipe" ? selected.id : selected.pipeId;
      persistLayout({
        ...layout,
        pipes: layout.pipes?.filter((pipe) => pipe.id !== pipeId)
      });
    }
    setSelected(null);
  }

  const selectedSector = selected?.kind === "sector" ? scene.sectors.find((sector) => sector.id === selected.id) : null;
  const selectedTank = selected?.kind === "tank" ? scene.tanks.find((tank) => tank.id === selected.id) : null;
  const selectedPipe =
    selected?.kind === "pipe"
      ? scene.pipes.find((pipe) => pipe.id === selected.id)
      : selected?.kind === "waypoint"
        ? scene.pipes.find((pipe) => pipe.id === selected.pipeId)
        : null;

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
              onClick={() => setPlaying((current) => !current)}
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
          layoutLocked={layoutLocked || !interactive}
          onLayoutChange={persistLayout}
          onSelect={setSelected}
          prefersReducedMotion={readPrefersReducedMotion()}
          scene={scene}
          selected={selected}
          tool={tool}
        />
      </div>
      {interactive && (selectedSector || selectedTank || selectedPipe) ? (
        <HydraulicsInspector
          onClose={() => setSelected(null)}
          onPatch={patchSelected}
          pipe={selectedPipe}
          sector={selectedSector}
          tank={selectedTank}
          variableListId={`hydraulics-variable-options-${cell.id}`}
          variableNames={variableNames}
        />
      ) : null}
    </div>
  );
}

function HydraulicsInspector({
  onClose,
  onPatch,
  pipe,
  sector,
  tank,
  variableListId,
  variableNames
}: {
  onClose(): void;
  onPatch(mutate: (layout: HydraulicsLayout) => HydraulicsLayout): void;
  pipe: ReturnType<typeof resolveHydraulicsScene>["pipes"][number] | null | undefined;
  sector: ReturnType<typeof resolveHydraulicsScene>["sectors"][number] | null | undefined;
  tank: ReturnType<typeof resolveHydraulicsScene>["tanks"][number] | null | undefined;
  variableListId: string;
  variableNames: string[];
}) {
  const { position, dragHandleProps } = useFloatingPanelPosition(INSPECTOR_POSITION_STORAGE_KEY);
  const title = selectedInspectorTitle(sector, tank, pipe);

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
      className="stability-raw-floating-panel notebook-inspector-popup hydraulics-inspector-popup"
      role="dialog"
      aria-label="Hydraulics inspector"
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
          <p className="hydraulics-inspector-readout">
            Current value <strong>{formatHydraulicsTankValue(tank.value)}</strong>
          </p>
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
                {HYDRAULICS_PORTS.map((port) => (
                  <option key={port} value={port}>
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
                {HYDRAULICS_PORTS.map((port) => (
                  <option key={port} value={port}>
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
            Animation speed (0 = still)
            <input
              type="number"
              min={0}
              max={8}
              step={0.25}
              value={pipe.animationSpeed}
              onChange={(event) => {
                const animationSpeed = Number(event.target.value);
                onPatch((layout) => ({
                  ...layout,
                  pipes: layout.pipes?.map((entry) =>
                    entry.id === pipe.id
                      ? { ...entry, animationSpeed: Number.isFinite(animationSpeed) ? animationSpeed : 0 }
                      : entry
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
  pipe: ReturnType<typeof resolveHydraulicsScene>["pipes"][number] | null | undefined
): string {
  if (sector) {
    return `Sector · ${sector.label}`;
  }
  if (tank) {
    return `Tank · ${tank.label}`;
  }
  if (pipe) {
    return `Pipe · ${pipe.label}`;
  }
  return "Nothing selected";
}

const PORT_LABELS: Record<HydraulicsPort, string> = {
  c: "Center",
  n: "North",
  ne: "Northeast",
  e: "East",
  se: "Southeast",
  s: "South",
  sw: "Southwest",
  w: "West",
  nw: "Northwest"
};

function portLabel(port: HydraulicsPort): string {
  return `${PORT_LABELS[port]} (${port})`;
}

function withAnchorPort(anchor: HydraulicsAnchor, port: string): HydraulicsAnchor {
  if (anchor.kind === "point") {
    return anchor;
  }
  return port
    ? { kind: anchor.kind, id: anchor.id, port: port as HydraulicsPort }
    : { kind: anchor.kind, id: anchor.id };
}

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
