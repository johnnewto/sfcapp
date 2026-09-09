import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

import {
  hydraulicsBoxPorts,
  hydraulicsBoxPortCellDelta,
  hydraulicsPortsForKind,
  isHydraulicsPort,
  type HydraulicsAnchor,
  type HydraulicsLayout,
  type HydraulicsPort
} from "@sfcr/notebook-core";

import { useMultiportEdgeAnimation } from "../hooks/useMultiportEdgeAnimation";
import { highlightFormula } from "./EquationGridEditor";
import { FORMULA_TOOLTIP_ATTR } from "./InstantTooltip";
import type { MultiportVariableInspectContextValue } from "./flow/MultiportVariableInspectContext";
import { renderVariableMathSvgLabel } from "./VariableMathLabel";
import { resolveVariableTooltip } from "../lib/unitMeta";

import {
  clampHydraulicsViewport,
  createResolvedHydraulicsBox,
  DEFAULT_HYDRAULICS_GRID_EXTENT,
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
  HYDRAULICS_BOX_RESIZE_HANDLES,
  HYDRAULICS_GRID_COLS,
  HYDRAULICS_GRID_ROWS,
  HYDRAULICS_SECTOR_GRID_HEIGHT,
  HYDRAULICS_SECTOR_GRID_WIDTH,
  HYDRAULICS_TANK_GRID_HEIGHT,
  HYDRAULICS_TANK_GRID_WIDTH,
  HYDRAULICS_TANK_GRID_Y,
  HYDRAULICS_ZOOM_MAX,
  HYDRAULICS_ZOOM_MIN,
  hydraulicsBoxHandlePoint,
  hydraulicsGridToUnit,
  hydraulicsUnitToGrid,
  layoutFromResolved,
  resizeHydraulicsBox,
  resolveHydraulicsGridExtent,
  resolveHydraulicsSnapStep,
  snapHydraulicsLabelOffsetCells,
  snapHydraulicsPoint,
  snapHydraulicsUnit,
  translateHydraulicsScene,
  type HydraulicsBoxResizeHandle,
  type HydraulicsGridExtent,
  type HydraulicsViewport,
  type ResolvedHydraulicsBox,
  type ResolvedHydraulicsPipe,
  type ResolvedHydraulicsScene,
  type ResolvedHydraulicsSector,
  type ResolvedHydraulicsTank
} from "../notebook/hydraulics";

export const HYDRAULICS_VIEW_WIDTH = 1000;
export const HYDRAULICS_VIEW_HEIGHT = 620;
export const HYDRAULICS_SECTOR_WIDTH =
  (HYDRAULICS_SECTOR_GRID_WIDTH / HYDRAULICS_GRID_COLS) * HYDRAULICS_VIEW_WIDTH;
export const HYDRAULICS_SECTOR_HEIGHT =
  (HYDRAULICS_SECTOR_GRID_HEIGHT / HYDRAULICS_GRID_ROWS) * HYDRAULICS_VIEW_HEIGHT;
export const HYDRAULICS_TANK_WIDTH = (HYDRAULICS_TANK_GRID_WIDTH / HYDRAULICS_GRID_COLS) * HYDRAULICS_VIEW_WIDTH;
export const HYDRAULICS_TANK_HEIGHT = (HYDRAULICS_TANK_GRID_HEIGHT / HYDRAULICS_GRID_ROWS) * HYDRAULICS_VIEW_HEIGHT;
export const HYDRAULICS_SNAP_DISTANCE = 0.06;
export const HYDRAULICS_LABEL_AUTO_T = 0.5;
export const HYDRAULICS_LABEL_CLEARANCE_PX = 8;
/** Vertical gap from the pipe name baseline to the numeric flow value. */
export const HYDRAULICS_PIPE_VALUE_GAP_PX = 12;
const HYDRAULICS_FORMULA_LABEL_WIDTH = 240;
const HYDRAULICS_FORMULA_LABEL_HEIGHT = 28;

export type HydraulicsTool = "select" | "add-sector" | "add-tank" | "add-pipe" | "add-box";

export type HydraulicsSelection =
  | { kind: "canvas" }
  | { kind: "all" }
  | { kind: "sector"; id: string }
  | { kind: "tank"; id: string }
  | { kind: "pipe"; id: string }
  | { kind: "box"; id: string }
  | { kind: "waypoint"; pipeId: string; index: number };

export type HydraulicsContextMenuRequest = {
  selection: HydraulicsSelection | null;
  clientX: number;
  clientY: number;
  point: { x: number; y: number };
};

interface Point {
  x: number;
  y: number;
}

type DragState =
  | { kind: "pan"; startClient: Point; startViewport: HydraulicsViewport }
  | { kind: "all"; origin: Point; grabOffset: Point }
  | { kind: "sector" | "tank" | "box"; id: string; grabOffset: Point }
  | { kind: "box-resize"; id: string; handle: HydraulicsBoxResizeHandle }
  | { kind: "pipe-end"; pipeId: string; end: "from" | "to" }
  | { kind: "waypoint"; pipeId: string; index: number }
  | { kind: "pipe-label"; pipeId: string }
  | { kind: "node-label"; nodeKind: "sector" | "tank" | "box"; id: string };

export function HydraulicsCanvas({
  scene,
  interactive = true,
  interactionEpoch = 0,
  layoutLocked = true,
  prefersReducedMotion = false,
  selected = null,
  tool = "select",
  viewport = DEFAULT_HYDRAULICS_VIEWPORT,
  viewportRoot = null,
  inspectContext = null,
  onContextMenu,
  onLayoutChange,
  onSelect,
  onToolChange,
  onViewportChange
}: {
  scene: ResolvedHydraulicsScene;
  interactive?: boolean;
  interactionEpoch?: number;
  layoutLocked?: boolean;
  prefersReducedMotion?: boolean;
  selected?: HydraulicsSelection | null;
  tool?: HydraulicsTool;
  viewport?: HydraulicsViewport;
  viewportRoot?: Element | null;
  inspectContext?: MultiportVariableInspectContextValue | null;
  onContextMenu?(request: HydraulicsContextMenuRequest): void;
  onLayoutChange?(layout: HydraulicsLayout): void;
  onSelect?(selection: HydraulicsSelection | null): void;
  onToolChange?(tool: HydraulicsTool): void;
  onViewportChange?(viewport: HydraulicsViewport): void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gridPatternId = `hydraulics-grid-${useId().replace(/:/g, "")}`;
  const { bumpAnimation, shellRef, shouldAnimateEdges } = useMultiportEdgeAnimation({
    interactionEpoch,
    root: viewportRoot
  });
  const handleShellPointerDown = useCallback(() => {
    bumpAnimation();
  }, [bumpAnimation]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<ResolvedHydraulicsScene | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<ResolvedHydraulicsScene | null>(null);
  const originSceneRef = useRef<ResolvedHydraulicsScene | null>(null);
  const dragMovedRef = useRef(false);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const onToolChangeRef = useRef(onToolChange);
  const onViewportChangeRef = useRef(onViewportChange);
  const viewportRef = useRef(viewport);
  const [pipeDraftFrom, setPipeDraftFrom] = useState<HydraulicsAnchor | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const rendered = draft ?? scene;
  const canEdit = interactive && !layoutLocked;
  const formulaInspect = inspectContext && !canEdit ? inspectContext : null;
  const snapStep = resolveHydraulicsSnapStep(rendered.canvas?.snapStep);
  const extent = resolveHydraulicsGridExtent(rendered.canvas);
  const sectorWidth = (HYDRAULICS_SECTOR_GRID_WIDTH / extent.cols) * HYDRAULICS_VIEW_WIDTH;
  const sectorHeight = (HYDRAULICS_SECTOR_GRID_HEIGHT / extent.rows) * HYDRAULICS_VIEW_HEIGHT;
  const tankWidth = (HYDRAULICS_TANK_GRID_WIDTH / extent.cols) * HYDRAULICS_VIEW_WIDTH;
  const tankHeight = (HYDRAULICS_TANK_GRID_HEIGHT / extent.rows) * HYDRAULICS_VIEW_HEIGHT;
  const showSnapGrid = canEdit && rendered.canvas?.showGrid !== false;
  dragRef.current = drag;
  draftRef.current = draft;
  onLayoutChangeRef.current = onLayoutChange;
  onToolChangeRef.current = onToolChange;
  onViewportChangeRef.current = onViewportChange;
  viewportRef.current = viewport;

  const pipePaths = useMemo(
    () =>
      rendered.pipes.map((pipe) => ({
        pipe,
        d: buildPipePath(pipe, rendered.sectors, rendered.tanks, rendered.boxes, extent)
      })),
    [rendered]
  );

  function persist(nextScene: ResolvedHydraulicsScene): void {
    onLayoutChangeRef.current?.(layoutFromResolved(nextScene));
  }

  function finishAddTool(): void {
    onToolChangeRef.current?.("select");
  }

  function commitViewport(next: HydraulicsViewport): void {
    onViewportChangeRef.current?.(clampHydraulicsViewport(next));
  }

  function clientToNormalized(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const view = viewportRef.current;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        x: clampUnit(view.x + clientX / HYDRAULICS_VIEW_WIDTH / view.scale),
        y: clampUnit(view.y + clientY / HYDRAULICS_VIEW_HEIGHT / view.scale)
      };
    }
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    return {
      x: clampUnit(view.x + nx / view.scale),
      y: clampUnit(view.y + ny / view.scale)
    };
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number): void {
    const view = viewportRef.current;
    const world = clientToNormalized(clientX, clientY);
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const nx = rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const ny = rect && rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    const scale = Math.min(HYDRAULICS_ZOOM_MAX, Math.max(HYDRAULICS_ZOOM_MIN, nextScale));
    commitViewport({
      scale,
      x: world.x - nx / scale,
      y: world.y - ny / scale
    });
  }

  function applyDragPoint(point: Point): void {
    const activeDrag = dragRef.current;
    const activeDraft = draftRef.current;
    if (!activeDrag || !activeDraft) {
      return;
    }
    if (activeDrag.kind === "pan") {
      return;
    }
    const step = resolveHydraulicsSnapStep(activeDraft.canvas?.snapStep);
    const draftExtent = resolveHydraulicsGridExtent(activeDraft.canvas);

    if (activeDrag.kind === "all") {
      const originScene = originSceneRef.current ?? activeDraft;
      const x = snapHydraulicsUnit(point.x - activeDrag.grabOffset.x, "x", step, draftExtent);
      const y = snapHydraulicsUnit(point.y - activeDrag.grabOffset.y, "y", step, draftExtent);
      const nextDraft = translateHydraulicsScene(
        originScene,
        x - activeDrag.origin.x,
        y - activeDrag.origin.y,
        step,
        draftExtent
      );
      if (nextDraft === activeDraft) {
        return;
      }
      dragMovedRef.current = true;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "sector" || activeDrag.kind === "tank" || activeDrag.kind === "box") {
      const x = snapHydraulicsUnit(point.x - activeDrag.grabOffset.x, "x", step, draftExtent);
      const y = snapHydraulicsUnit(point.y - activeDrag.grabOffset.y, "y", step, draftExtent);
      const current =
        activeDrag.kind === "sector"
          ? activeDraft.sectors.find((sector) => sector.id === activeDrag.id)
          : activeDrag.kind === "tank"
            ? activeDraft.tanks.find((tank) => tank.id === activeDrag.id)
            : activeDraft.boxes.find((box) => box.id === activeDrag.id);
      if (current?.x === x && current?.y === y) {
        return;
      }
      dragMovedRef.current = true;
      const nextDraft =
        activeDrag.kind === "sector"
          ? {
              ...activeDraft,
              sectors: activeDraft.sectors.map((sector) =>
                sector.id === activeDrag.id ? { ...sector, x, y } : sector
              )
            }
          : activeDrag.kind === "tank"
            ? {
                ...activeDraft,
                tanks: activeDraft.tanks.map((tank) => (tank.id === activeDrag.id ? { ...tank, x, y } : tank))
              }
            : {
                ...activeDraft,
                boxes: activeDraft.boxes.map((box) => (box.id === activeDrag.id ? { ...box, x, y } : box))
              };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "box-resize") {
      const current = activeDraft.boxes.find((box) => box.id === activeDrag.id);
      if (!current) {
        return;
      }
      const nextBox = resizeHydraulicsBox(current, activeDrag.handle, point, step, draftExtent);
      if (
        nextBox.x === current.x &&
        nextBox.y === current.y &&
        nextBox.width === current.width &&
        nextBox.height === current.height
      ) {
        return;
      }
      dragMovedRef.current = true;
      const nextDraft = {
        ...activeDraft,
        boxes: activeDraft.boxes.map((box) => (box.id === activeDrag.id ? nextBox : box))
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "node-label") {
      const current =
        activeDrag.nodeKind === "sector"
          ? activeDraft.sectors.find((sector) => sector.id === activeDrag.id)
          : activeDrag.nodeKind === "tank"
            ? activeDraft.tanks.find((tank) => tank.id === activeDrag.id)
            : activeDraft.boxes.find((box) => box.id === activeDrag.id);
      if (!current) {
        return;
      }
      const auto = nodeLabelAutoViewBox(activeDrag.nodeKind, current, draftExtent);
      const labelOffsetX = snapHydraulicsNodeLabelOffset(point.x * HYDRAULICS_VIEW_WIDTH - auto.x, "x", draftExtent);
      const labelOffsetY = snapHydraulicsNodeLabelOffset(point.y * HYDRAULICS_VIEW_HEIGHT - auto.y, "y", draftExtent);
      if (current.labelOffsetX === labelOffsetX && current.labelOffsetY === labelOffsetY) {
        return;
      }
      dragMovedRef.current = true;
      const nextDraft =
        activeDrag.nodeKind === "sector"
          ? {
              ...activeDraft,
              sectors: activeDraft.sectors.map((sector) =>
                sector.id === activeDrag.id ? { ...sector, labelOffsetX, labelOffsetY } : sector
              )
            }
          : activeDrag.nodeKind === "tank"
            ? {
                ...activeDraft,
                tanks: activeDraft.tanks.map((tank) =>
                  tank.id === activeDrag.id ? { ...tank, labelOffsetX, labelOffsetY } : tank
                )
              }
            : {
                ...activeDraft,
                boxes: activeDraft.boxes.map((box) =>
                  box.id === activeDrag.id ? { ...box, labelOffsetX, labelOffsetY } : box
                )
              };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "pipe-label") {
      dragMovedRef.current = true;
      const nextDraft = {
        ...activeDraft,
        pipes: activeDraft.pipes.map((pipe) => {
          if (pipe.id !== activeDrag.pipeId) {
            return pipe;
          }
          const geometry = pipeGeometry(pipe, activeDraft.sectors, activeDraft.tanks, activeDraft.boxes, draftExtent);
          const labelT = closestHydraulicsPipeLabelT(geometry, point);
          const sample = samplePipeGeometry(geometry, labelT);
          const normal = upNormalViewBox(sample.tangent);
          const signedPx =
            (point.x * HYDRAULICS_VIEW_WIDTH - sample.point.x * HYDRAULICS_VIEW_WIDTH) * normal.x +
            (point.y * HYDRAULICS_VIEW_HEIGHT - sample.point.y * HYDRAULICS_VIEW_HEIGHT) * normal.y;
          return {
            ...pipe,
            labelT,
            labelOffset: snapHydraulicsLabelOffset(signedPx - HYDRAULICS_LABEL_CLEARANCE_PX, draftExtent)
          };
        })
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "waypoint") {
      dragMovedRef.current = true;
      const nextDraft = {
        ...activeDraft,
        pipes: activeDraft.pipes.map((pipe) =>
          pipe.id === activeDrag.pipeId
            ? {
                ...pipe,
                waypoints: pipe.waypoints.map((waypoint, index) =>
                  index === activeDrag.index ? snapHydraulicsPoint(point, step, draftExtent) : waypoint
                )
              }
            : pipe
        )
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind !== "pipe-end") {
      return;
    }

    const snapped = snapAnchor(point, activeDraft.sectors, activeDraft.tanks, activeDraft.boxes, draftExtent);
    dragMovedRef.current = true;
    const nextDraft = {
      ...activeDraft,
      pipes: activeDraft.pipes.map((pipe) =>
        pipe.id === activeDrag.pipeId
          ? { ...pipe, [activeDrag.end]: snapped ?? { kind: "point" as const, ...snapHydraulicsPoint(point, step, draftExtent) } }
          : pipe
      )
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  useEffect(() => {
    if (!drag) {
      return;
    }

    const handleUp = () => {
      if (draftRef.current && dragMovedRef.current) {
        persist(draftRef.current);
      }
      dragRef.current = null;
      draftRef.current = null;
      originSceneRef.current = null;
      dragMovedRef.current = false;
      setDrag(null);
      setDraft(null);
    };

    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag]);

  useEffect(() => {
    if (!interactive) {
      return;
    }
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const view = viewportRef.current;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(event.clientX, event.clientY, view.scale * factor);
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
    };
  }, [interactive]);

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const activeDrag = dragRef.current;
    if (activeDrag?.kind === "pan") {
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const view = activeDrag.startViewport;
      const dx = (event.clientX - activeDrag.startClient.x) / rect.width / view.scale;
      const dy = (event.clientY - activeDrag.startClient.y) / rect.height / view.scale;
      dragMovedRef.current = true;
      commitViewport({
        scale: view.scale,
        x: view.x - dx,
        y: view.y - dy
      });
      return;
    }
    const point = clientToNormalized(event.clientX, event.clientY);
    setCursor(point);
    applyDragPoint(point);
  }

  function applyPipeDraft(snapped: HydraulicsAnchor | null): void {
    if (!snapped) {
      return;
    }
    if (!pipeDraftFrom) {
      setPipeDraftFrom(snapped);
      return;
    }
    const id = uniqueId(
      "pipe",
      rendered.pipes.map((pipe) => pipe.id)
    );
    persist({
      ...rendered,
      pipes: [
        ...rendered.pipes,
        {
          id,
          from: pipeDraftFrom,
          to: snapped,
          label: id,
          waypoints: [],
          magnitude: null,
          strokeWidth: 2.5,
          color: DEFAULT_PIPE_COLOR,
          arrowSize: DEFAULT_PIPE_ARROW_SIZE,
          flowAnimationSpeed: 0,
          widthScale: DEFAULT_PIPE_WIDTH_SCALE,
          dashed: false,
          tokenCount: DEFAULT_PIPE_TOKEN_COUNT,
          opacity: DEFAULT_PIPE_OPACITY,
          labelT: null,
          labelOffset: null
        }
      ]
    });
    onSelect?.({ kind: "pipe", id });
    setPipeDraftFrom(null);
    finishAddTool();
  }

  function startNodeDrag(
    kind: "sector" | "tank" | "box",
    id: string,
    event: ReactPointerEvent,
    node: { x: number; y: number }
  ): void {
    if (!isPrimaryPointer(event)) {
      return;
    }
    if (kind === "box" && canEdit && tool !== "select" && tool !== "add-pipe") {
      return;
    }
    if (canEdit && tool === "add-pipe") {
      event.stopPropagation();
      applyPipeDraft(
        snapPortOnNode(
          clientToNormalized(event.clientX, event.clientY),
          kind,
          id,
          rendered.sectors,
          rendered.tanks,
          rendered.boxes,
          extent
        )
      );
      return;
    }
    if (!canEdit || tool !== "select") {
      onSelect?.({ kind, id });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    const point = clientToNormalized(event.clientX, event.clientY);
    if (selected?.kind === "all") {
      startAllDrag(event, node, point);
      return;
    }
    const nextDrag: DragState = { kind, id, grabOffset: { x: point.x - node.x, y: point.y - node.y } };
    dragMovedRef.current = false;
    dragRef.current = nextDrag;
    draftRef.current = rendered;
    setDrag(nextDrag);
    setDraft(rendered);
    onSelect?.({ kind, id });
  }

  function startAllDrag(event: ReactPointerEvent, origin: Point, point = clientToNormalized(event.clientX, event.clientY)): void {
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    const nextDrag: DragState = {
      kind: "all",
      origin,
      grabOffset: { x: point.x - origin.x, y: point.y - origin.y }
    };
    dragMovedRef.current = false;
    dragRef.current = nextDrag;
    originSceneRef.current = rendered;
    draftRef.current = rendered;
    setDrag(nextDrag);
    setDraft(rendered);
  }

  function startBoxResize(id: string, handle: HydraulicsBoxResizeHandle, event: ReactPointerEvent): void {
    if (!isPrimaryPointer(event) || !canEdit || tool !== "select") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    const nextDrag: DragState = { kind: "box-resize", id, handle };
    dragMovedRef.current = false;
    dragRef.current = nextDrag;
    draftRef.current = rendered;
    setDrag(nextDrag);
    setDraft(rendered);
    onSelect?.({ kind: "box", id });
  }

  function startNodeLabelDrag(
    nodeKind: "sector" | "tank" | "box",
    id: string,
    event: ReactPointerEvent
  ): void {
    if (!isPrimaryPointer(event) || !canEdit || tool !== "select") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    const nextDrag: DragState = { kind: "node-label", nodeKind, id };
    dragMovedRef.current = false;
    dragRef.current = nextDrag;
    draftRef.current = rendered;
    setDrag(nextDrag);
    setDraft(rendered);
    onSelect?.({ kind: nodeKind, id });
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!isPrimaryPointer(event)) {
      return;
    }
    const nodeKind = (event.target as Element).closest("[data-hydraulics-node]")?.getAttribute("data-hydraulics-node");
    if (event.target !== event.currentTarget && nodeKind && nodeKind !== "box") {
      return;
    }
    if (event.target !== event.currentTarget && nodeKind === "box" && tool === "select") {
      return;
    }
    const point = snapHydraulicsPoint(clientToNormalized(event.clientX, event.clientY), snapStep, extent);
    if (!canEdit) {
      onSelect?.({ kind: "canvas" });
      startPanIfNeeded(event);
      return;
    }

    if (tool === "add-sector") {
      const id = uniqueId(
        "sector",
        rendered.sectors.map((sector) => sector.id)
      );
      persist({
        ...rendered,
        sectors: [
          ...rendered.sectors,
          {
            id,
            label: "Sector",
            fill: DEFAULT_SECTOR_FILL,
            stroke: DEFAULT_SECTOR_STROKE,
            opacity: DEFAULT_SECTOR_OPACITY,
            x: point.x,
            y: point.y,
            labelOffsetX: null,
            labelOffsetY: null
          }
        ]
      });
      onSelect?.({ kind: "sector", id });
      finishAddTool();
      return;
    }

    if (tool === "add-tank") {
      const snapped = snapToSector(point, rendered.sectors);
      const id = uniqueId(
        "tank",
        rendered.tanks.map((tank) => tank.id)
      );
      persist({
        ...rendered,
        tanks: [
          ...rendered.tanks,
          {
            id,
            sectorId: snapped?.id ?? rendered.sectors[0]?.id ?? "",
            label: id,
            polarity: "asset",
            color: "#2980b9",
            x: snapped ? snapTankX(snapped, rendered.tanks, extent) : point.x,
            y: snapped ? hydraulicsGridToUnit(HYDRAULICS_TANK_GRID_Y, "y", snapStep, extent) : point.y,
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
      onSelect?.({ kind: "tank", id });
      finishAddTool();
      return;
    }

    if (tool === "add-pipe") {
      applyPipeDraft(snapAnchor(point, rendered.sectors, rendered.tanks, rendered.boxes, extent));
      return;
    }

    if (tool === "add-box") {
      const id = uniqueId(
        "box",
        rendered.boxes.map((box) => box.id)
      );
      persist({
        ...rendered,
        boxes: [...rendered.boxes, createResolvedHydraulicsBox(id, point.x, point.y, extent)]
      });
      onSelect?.({ kind: "box", id });
      finishAddTool();
      return;
    }

    onSelect?.({ kind: "canvas" });
    startPanIfNeeded(event);
  }

  function startPanIfNeeded(event: ReactPointerEvent<SVGSVGElement>): void {
    if (tool !== "select" || viewportRef.current.scale <= 1) {
      return;
    }
    event.preventDefault();
    capturePointer(event);
    const nextDrag: DragState = {
      kind: "pan",
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewportRef.current
    };
    dragMovedRef.current = false;
    dragRef.current = nextDrag;
    draftRef.current = null;
    setDrag(nextDrag);
    setDraft(null);
  }

  function handleContextMenu(event: ReactMouseEvent<SVGSVGElement>): void {
    if (!interactive) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = (event.target as Element).closest("[data-hydraulics-node]");
    const kind = target?.getAttribute("data-hydraulics-node");
    let nextSelection: HydraulicsSelection | null = null;
    if (kind === "waypoint") {
      const pipeId = target?.getAttribute("data-hydraulics-pipe-id");
      const index = Number(target?.getAttribute("data-hydraulics-waypoint-index"));
      if (pipeId && Number.isInteger(index)) {
        nextSelection = { kind: "waypoint", pipeId, index };
      }
    } else if ((kind === "sector" || kind === "tank" || kind === "pipe" || kind === "box") && target) {
      const id = target.getAttribute("data-hydraulics-id");
      if (id) {
        nextSelection = { kind, id };
      }
    }
    onSelect?.(nextSelection ?? { kind: "canvas" });
    onContextMenu?.({
      selection: nextSelection,
      clientX: event.clientX,
      clientY: event.clientY,
      point: clientToNormalized(event.clientX, event.clientY)
    });
  }

  function handlePipeDoubleClick(pipe: ResolvedHydraulicsPipe, event: ReactPointerEvent): void {
    if (!canEdit) {
      return;
    }
    event.stopPropagation();
    const point = snapHydraulicsPoint(clientToNormalized(event.clientX, event.clientY), snapStep, extent);
    persist({
      ...rendered,
      pipes: rendered.pipes.map((entry) =>
        entry.id === pipe.id ? { ...entry, waypoints: [...entry.waypoints, point] } : entry
      )
    });
  }

  const previewPath =
    tool === "add-pipe" && pipeDraftFrom && cursor
      ? buildPathFromPoints([anchorPoint(pipeDraftFrom, rendered.sectors, rendered.tanks, rendered.boxes, extent) ?? cursor, cursor])
      : null;

  if (scene.errors.length > 0 && scene.sectors.length === 0) {
    return (
      <div className="hydraulics-diagram-errors" role="alert">
        {scene.errors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="hydraulics-flow-animation-shell"
      onPointerDownCapture={handleShellPointerDown}
    >
      <svg
        ref={svgRef}
        className="hydraulics-diagram-canvas"
        role="img"
        aria-label="Stock-flow diagram"
        viewBox={`${viewport.x * HYDRAULICS_VIEW_WIDTH} ${viewport.y * HYDRAULICS_VIEW_HEIGHT} ${HYDRAULICS_VIEW_WIDTH / viewport.scale} ${HYDRAULICS_VIEW_HEIGHT / viewport.scale}`}
        width="100%"
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onContextMenu={handleContextMenu}
      >
      <defs>
        {showSnapGrid ? (
          <pattern
            id={gridPatternId}
            width={(HYDRAULICS_VIEW_WIDTH / extent.cols) * snapStep}
            height={(HYDRAULICS_VIEW_HEIGHT / extent.rows) * snapStep}
            patternUnits="userSpaceOnUse"
          >
            <circle className="hydraulics-snap-grid-dot" cx="0.75" cy="0.75" r="1.15" />
          </pattern>
        ) : null}
        {rendered.pipes
          .filter((pipe) => pipe.arrowSize > 0)
          .map((pipe) => (
            <marker
              key={`hydraulics-arrow-${svgId(pipe.id)}`}
              id={`hydraulics-arrow-${svgId(pipe.id)}`}
              markerWidth={pipe.arrowSize}
              markerHeight={pipe.arrowSize}
              refX={Math.max(0, pipe.arrowSize - 1)}
              refY={pipe.arrowSize / 2}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d={`M0,0 L${pipe.arrowSize},${pipe.arrowSize / 2} L0,${pipe.arrowSize} z`}
                fill={pipe.color}
              />
            </marker>
          ))}
      </defs>

      {showSnapGrid ? (
        <rect
          className="hydraulics-snap-grid"
          data-testid="hydraulics-snap-grid"
          x={0}
          y={0}
          width={HYDRAULICS_VIEW_WIDTH}
          height={HYDRAULICS_VIEW_HEIGHT}
          fill={`url(#${gridPatternId})`}
          pointerEvents="none"
        />
      ) : null}

      {rendered.boxes.map((box) => {
        const width = box.width * HYDRAULICS_VIEW_WIDTH;
        const height = box.height * HYDRAULICS_VIEW_HEIGHT;
        const x = box.x * HYDRAULICS_VIEW_WIDTH - width / 2;
        const y = box.y * HYDRAULICS_VIEW_HEIGHT - height / 2;
        const isSelected = isHydraulicsItemSelected(selected, "box", box.id);
        const labelPosition = placeHydraulicsNodeLabel("box", box, extent);
        return (
          <g
            key={box.id}
            data-hydraulics-node="box"
            data-hydraulics-id={box.id}
            data-testid={`hydraulics-box-${box.id}`}
            className={`hydraulics-box${isSelected ? " is-selected" : ""}`}
            onPointerDown={(event) => startNodeDrag("box", box.id, event, box)}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx="8"
              fill={box.fill}
              fillOpacity={box.fillOpacity}
              stroke={box.stroke}
              strokeWidth={isSelected ? 3 : 2}
              strokeDasharray={box.dashed ? "10 7" : undefined}
              pointerEvents="all"
            />
            {box.label ? (
              <text
                data-hydraulics-label=""
                data-testid={`hydraulics-box-label-${box.id}`}
                x={labelPosition.x}
                y={labelPosition.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className={`hydraulics-box-label${canEdit && tool === "select" ? " is-editable" : ""}`}
                pointerEvents={canEdit && tool === "select" ? "auto" : "none"}
                onPointerDown={(event) => startNodeLabelDrag("box", box.id, event)}
              >
                {renderVariableMathSvgLabel(box.label)}
              </text>
            ) : null}
          </g>
        );
      })}

      {pipePaths.map(({ pipe, d }) => {
        const markerId = `hydraulics-arrow-${svgId(pipe.id)}`;
        const showFlowOverlay = !prefersReducedMotion && pipe.flowAnimationSpeed > 0;
        const animateFlow = showFlowOverlay && shouldAnimateEdges;
        const labelPosition = pipe.label
          ? placeHydraulicsPipeLabel(pipe, rendered.sectors, rendered.tanks, rendered.boxes, extent)
          : null;
        return (
        <g
          key={pipe.id}
          data-hydraulics-node="pipe"
          data-hydraulics-id={pipe.id}
          opacity={pipe.opacity}
        >
          <path
            data-testid={`hydraulics-pipe-${pipe.id}`}
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(18, pipe.strokeWidth + 12)}
            className={isHydraulicsItemSelected(selected, "pipe", pipe.id) ? "is-selected" : undefined}
            onPointerDown={(event) => {
              if (!isPrimaryPointer(event)) {
                return;
              }
              event.stopPropagation();
              if (selected?.kind === "all" && canEdit && tool === "select") {
                startAllDrag(event, clientToNormalized(event.clientX, event.clientY));
                return;
              }
              onSelect?.({ kind: "pipe", id: pipe.id });
            }}
            onDoubleClick={(event) =>
              handlePipeDoubleClick(pipe, event as unknown as ReactPointerEvent<SVGSVGElement>)
            }
          />
          <path
            data-testid={`hydraulics-pipe-flow-${pipe.id}`}
            d={d}
            fill="none"
            stroke={pipe.color}
            strokeWidth={Math.max(0.5, pipe.strokeWidth)}
            className="hydraulics-pipe-flow"
            strokeDasharray={
              pipe.dashed
                ? `${Math.max(4, pipe.strokeWidth * 2.2)} ${Math.max(3, pipe.strokeWidth * 1.4)}`
                : undefined
            }
            markerEnd={pipe.arrowSize > 0 ? `url(#${markerId})` : undefined}
            pointerEvents="none"
          />
          {showFlowOverlay ? (
            <path
              data-testid={`hydraulics-pipe-overlay-${pipe.id}`}
              d={d}
              fill="none"
              stroke="#f8fafc"
              strokeWidth={Math.max(1.2, pipe.strokeWidth * 0.4)}
              className={[
                "hydraulics-pipe-overlay",
                animateFlow ? "is-animated" : "",
                pipe.magnitude != null && pipe.magnitude < 0 ? "is-reversed" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                animateFlow ? { animationDuration: `${0.5 / pipe.flowAnimationSpeed}s` } : undefined
              }
              pointerEvents="none"
            />
          ) : null}
          {pipe.label && labelPosition ? (
            <g data-testid={`hydraulics-pipe-label-group-${pipe.id}`}>
              {formulaInspect ? (
                <HydraulicsFormulaLabel
                  canEdit={false}
                  color={pipe.color}
                  inspect={formulaInspect}
                  label={pipe.label}
                  testId={`hydraulics-pipe-label-${pipe.id}`}
                  variable={pipe.variable}
                  expression={pipe.expression}
                  x={labelPosition.x}
                  y={labelPosition.y}
                  onLabelPointerDown={(event) => {
                    if (!isPrimaryPointer(event) || !canEdit || tool !== "select") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    capturePointer(event);
                    const nextDrag: DragState = { kind: "pipe-label", pipeId: pipe.id };
                    dragMovedRef.current = false;
                    dragRef.current = nextDrag;
                    draftRef.current = rendered;
                    setDrag(nextDrag);
                    setDraft(rendered);
                    onSelect?.({ kind: "pipe", id: pipe.id });
                  }}
                />
              ) : (
                <text
                  data-testid={`hydraulics-pipe-label-${pipe.id}`}
                  x={labelPosition.x}
                  y={labelPosition.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`hydraulics-pipe-label${canEdit && tool === "select" ? " is-editable" : ""}`}
                  style={{ fill: pipe.color }}
                  pointerEvents={canEdit && tool === "select" ? "auto" : "none"}
                  onPointerDown={(event) => {
                    if (!isPrimaryPointer(event) || !canEdit || tool !== "select") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    capturePointer(event);
                    const nextDrag: DragState = { kind: "pipe-label", pipeId: pipe.id };
                    dragMovedRef.current = false;
                    dragRef.current = nextDrag;
                    draftRef.current = rendered;
                    setDrag(nextDrag);
                    setDraft(rendered);
                    onSelect?.({ kind: "pipe", id: pipe.id });
                  }}
                >
                  {renderVariableMathSvgLabel(pipe.label)}
                </text>
              )}
              {pipe.variable?.trim() || pipe.expression?.trim() ? (
                <text
                  data-testid={`hydraulics-pipe-value-${pipe.id}`}
                  x={labelPosition.x}
                  y={labelPosition.y + HYDRAULICS_PIPE_VALUE_GAP_PX}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  className="hydraulics-pipe-value"
                  style={{ fill: pipe.color }}
                  pointerEvents="none"
                >
                  {formatHydraulicsTankValue(pipe.magnitude)}
                </text>
              ) : null}
            </g>
          ) : null}
          {canEdit && tool === "select"
            ? (["from", "to"] as const).map((end) => {
                const otherAnchor = pipe[end === "from" ? "to" : "from"];
                const other = pipe.waypoints[end === "from" ? 0 : pipe.waypoints.length - 1]
                  ?? anchorPoint(otherAnchor, rendered.sectors, rendered.tanks, rendered.boxes, extent)
                  ?? { x: 0.5, y: 0.5 };
                const point = resolvePipeEnd(pipe[end], other, rendered.sectors, rendered.tanks, rendered.boxes, extent);
                return (
                  <circle
                    key={`${pipe.id}-${end}`}
                    data-testid={`hydraulics-pipe-end-${pipe.id}-${end}`}
                    cx={point.x * HYDRAULICS_VIEW_WIDTH}
                    cy={point.y * HYDRAULICS_VIEW_HEIGHT}
                    r={7}
                    className="hydraulics-handle"
                    onPointerDown={(event) => {
                      if (!isPrimaryPointer(event)) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      capturePointer(event);
                      const nextDrag: DragState = { kind: "pipe-end", pipeId: pipe.id, end };
                      dragMovedRef.current = false;
                      dragRef.current = nextDrag;
                      draftRef.current = rendered;
                      setDrag(nextDrag);
                      setDraft(rendered);
                      onSelect?.({ kind: "pipe", id: pipe.id });
                    }}
                  />
                );
              })
            : null}
          {canEdit
            ? pipe.waypoints.map((waypoint, index) => (
                <circle
                  key={`${pipe.id}-wp-${index}`}
                  data-hydraulics-node="waypoint"
                  data-hydraulics-pipe-id={pipe.id}
                  data-hydraulics-waypoint-index={index}
                  data-testid={`hydraulics-waypoint-${pipe.id}-${index}`}
                  cx={waypoint.x * HYDRAULICS_VIEW_WIDTH}
                  cy={waypoint.y * HYDRAULICS_VIEW_HEIGHT}
                  r={6}
                  className="hydraulics-handle"
                  onPointerDown={(event) => {
                    if (!isPrimaryPointer(event)) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    capturePointer(event);
                    const nextDrag: DragState = { kind: "waypoint", pipeId: pipe.id, index };
                    dragMovedRef.current = false;
                    dragRef.current = nextDrag;
                    draftRef.current = rendered;
                    setDrag(nextDrag);
                    setDraft(rendered);
                    onSelect?.({ kind: "waypoint", pipeId: pipe.id, index });
                  }}
                />
              ))
            : null}
        </g>
        );
      })}

      {previewPath ? (
        <path d={previewPath} fill="none" stroke="#64748b" strokeDasharray="6 4" strokeWidth="2" pointerEvents="none" />
      ) : null}

      {rendered.sectors.map((sector) => {
        const x = sector.x * HYDRAULICS_VIEW_WIDTH - sectorWidth / 2;
        const y = sector.y * HYDRAULICS_VIEW_HEIGHT - sectorHeight / 2;
        const isSelected = isHydraulicsItemSelected(selected, "sector", sector.id);
        const labelPosition = placeHydraulicsNodeLabel("sector", sector, extent);
        return (
          <g
            key={sector.id}
            data-hydraulics-node="sector"
            data-hydraulics-id={sector.id}
            data-testid={`hydraulics-sector-${sector.id}`}
            className={`hydraulics-sector${isSelected ? " is-selected" : ""}`}
            onPointerDown={(event) => startNodeDrag("sector", sector.id, event, sector)}
          >
            <rect
              x={x}
              y={y}
              width={sectorWidth}
              height={sectorHeight}
              rx="10"
              fill={sector.fill}
              stroke={isSelected ? "#2563eb" : sector.stroke}
              strokeWidth={isSelected ? 3 : 2}
              opacity={sector.opacity}
            />
            <text
              data-hydraulics-label=""
              data-testid={`hydraulics-sector-label-${sector.id}`}
              x={labelPosition.x}
              y={labelPosition.y}
              textAnchor="middle"
              className={canEdit && tool === "select" ? "is-editable" : undefined}
              pointerEvents={canEdit && tool === "select" ? "auto" : undefined}
              onPointerDown={(event) => startNodeLabelDrag("sector", sector.id, event)}
            >
              {renderVariableMathSvgLabel(sector.label)}
            </text>
          </g>
        );
      })}

      {rendered.tanks.map((tank) => {
        const x = tank.x * HYDRAULICS_VIEW_WIDTH - tankWidth / 2;
        const y = tank.y * HYDRAULICS_VIEW_HEIGHT - tankHeight / 2;
        const fillHeight = tank.fill * tankHeight;
        const fillY = tank.polarity === "liability" ? y : y + tankHeight - fillHeight;
        const isSelected = isHydraulicsItemSelected(selected, "tank", tank.id);
        return (
          <g
            key={tank.id}
            data-hydraulics-node="tank"
            data-hydraulics-id={tank.id}
            data-testid={`hydraulics-tank-${tank.id}`}
            className={`hydraulics-tank${isSelected ? " is-selected" : ""}`}
            onPointerDown={(event) => startNodeDrag("tank", tank.id, event, tank)}
          >
            <rect
              x={x}
              y={fillY}
              width={tankWidth}
              height={fillHeight}
              fill={tank.color}
              opacity="0.85"
            />
            <rect
              x={x}
              y={y}
              width={tankWidth}
              height={tankHeight}
              rx="8"
              fill="none"
              stroke={tank.color}
              strokeWidth="3"
            />
            <text
              x={tank.x * HYDRAULICS_VIEW_WIDTH}
              y={y + tankHeight / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="hydraulics-tank-value"
              pointerEvents="none"
            >
              {formatHydraulicsTankValue(tank.value)}
            </text>
            {formulaInspect ? (
              <HydraulicsFormulaLabel
                canEdit={false}
                inspect={formulaInspect}
                label={tank.label}
                testId={`hydraulics-tank-label-${tank.id}`}
                variable={tank.variable}
                expression={tank.expression}
                x={placeHydraulicsNodeLabel("tank", tank, extent).x}
                y={placeHydraulicsNodeLabel("tank", tank, extent).y}
                onLabelPointerDown={(event) => startNodeLabelDrag("tank", tank.id, event)}
              />
            ) : (
              <text
                data-hydraulics-label=""
                data-testid={`hydraulics-tank-label-${tank.id}`}
                x={placeHydraulicsNodeLabel("tank", tank, extent).x}
                y={placeHydraulicsNodeLabel("tank", tank, extent).y}
                textAnchor="middle"
                className={`hydraulics-tank-label${canEdit && tool === "select" ? " is-editable" : ""}`}
                pointerEvents={canEdit && tool === "select" ? "auto" : "none"}
                onPointerDown={(event) => startNodeLabelDrag("tank", tank.id, event)}
              >
                {renderVariableMathSvgLabel(tank.label)}
              </text>
            )}
          </g>
        );
      })}

      {canEdit && tool === "select"
        ? rendered.boxes
            .filter((box) => selected?.kind === "box" && selected.id === box.id)
            .flatMap((box) =>
              HYDRAULICS_BOX_RESIZE_HANDLES.map((handle) => {
                const point = hydraulicsBoxHandlePoint(box, handle);
                return (
                  <circle
                    key={`${box.id}-resize-${handle}`}
                    data-testid={`hydraulics-box-handle-${box.id}-${handle}`}
                    cx={point.x * HYDRAULICS_VIEW_WIDTH}
                    cy={point.y * HYDRAULICS_VIEW_HEIGHT}
                    r={6}
                    className={`hydraulics-handle hydraulics-box-handle hydraulics-box-handle-${handle}`}
                    onPointerDown={(event) => startBoxResize(box.id, handle, event)}
                  />
                );
              })
            )
        : null}

      {canEdit && (tool === "add-pipe" || drag?.kind === "pipe-end")
        ? [
            ...rendered.sectors.flatMap((sector) =>
              portsForNode("sector", sector, extent).map(({ port, point }) => ({
                key: `sector-${sector.id}-${port}`,
                kind: "sector" as const,
                id: sector.id,
                port,
                point
              }))
            ),
            ...rendered.tanks.flatMap((tank) =>
              portsForNode("tank", tank, extent).map(({ port, point }) => ({
                key: `tank-${tank.id}-${port}`,
                kind: "tank" as const,
                id: tank.id,
                port,
                point
              }))
            ),
            ...rendered.boxes.flatMap((box) =>
              portsForBox(box, extent).map(({ port, point }) => ({
                key: `box-${box.id}-${port}`,
                kind: "box" as const,
                id: box.id,
                port,
                point
              }))
            )
          ].map((entry) => (
            <circle
              key={entry.key}
              data-testid={`hydraulics-port-${entry.kind}-${entry.id}-${entry.port}`}
              className="hydraulics-port"
              cx={entry.point.x * HYDRAULICS_VIEW_WIDTH}
              cy={entry.point.y * HYDRAULICS_VIEW_HEIGHT}
              r={4.5}
              onPointerDown={(event) => {
                if (!isPrimaryPointer(event)) {
                  return;
                }
                event.stopPropagation();
                if (tool === "add-pipe") {
                  if (entry.kind === "box") {
                    applyPipeDraft({ kind: "box", id: entry.id, port: entry.port });
                  } else if (entry.kind === "sector") {
                    applyPipeDraft({ kind: "sector", id: entry.id, port: entry.port });
                  } else {
                    applyPipeDraft({ kind: "tank", id: entry.id, port: entry.port });
                  }
                }
              }}
            />
          ))
        : null}
      </svg>
    </div>
  );
}

export function snapAnchor(
  point: Point,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): HydraulicsAnchor | null {
  const candidates: Array<{ distance: number; anchor: HydraulicsAnchor }> = [];

  const consider = (anchor: HydraulicsAnchor, target: Point) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= HYDRAULICS_SNAP_DISTANCE) {
      candidates.push({ distance, anchor });
    }
  };

  for (const sector of sectors) {
    for (const { port, point: target } of portsForNode("sector", sector, extent)) {
      consider({ kind: "sector", id: sector.id, port }, target);
    }
  }
  for (const tank of tanks) {
    for (const { port, point: target } of portsForNode("tank", tank, extent)) {
      consider({ kind: "tank", id: tank.id, port }, target);
    }
  }
  for (const box of boxes) {
    for (const { port, point: target } of portsForBox(box, extent)) {
      consider({ kind: "box", id: box.id, port }, target);
    }
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.anchor ?? null;
}

export function snapPortOnNode(
  point: Point,
  kind: "sector" | "tank" | "box",
  id: string,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): HydraulicsAnchor | null {
  if (kind === "box") {
    const box = boxes.find((entry) => entry.id === id);
    if (!box) {
      return null;
    }
    const nearest = nearestPort(point, portsForBox(box, extent));
    return { kind: "box", id, port: nearest.port };
  }
  const node = kind === "sector" ? sectors.find((entry) => entry.id === id) : tanks.find((entry) => entry.id === id);
  if (!node) {
    return null;
  }
  const nearest = nearestPort(point, portsForNode(kind, node, extent));
  if (kind === "sector") {
    return { kind: "sector", id, port: nearest.port };
  }
  return { kind: "tank", id, port: nearest.port };
}

function snapToSector(point: Point, sectors: ResolvedHydraulicsSector[]): ResolvedHydraulicsSector | null {
  let nearest: ResolvedHydraulicsSector | null = null;
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

function snapTankX(
  sector: ResolvedHydraulicsSector,
  tanks: ResolvedHydraulicsTank[],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): number {
  const attached = tanks.filter((tank) => tank.sectorId === sector.id);
  return snapHydraulicsUnit(sector.x + attached.length * (2 / extent.cols), "x", undefined, extent);
}

const AUTO_PORTS: readonly HydraulicsPort[] = ["n", "e", "s", "w"];

/** Unit offsets in [-1, 1] of the node half-size. Side extras sit at ±½. */
const PORT_UNIT_OFFSET: Record<HydraulicsPort, Point> = {
  c: { x: 0, y: 0 },
  n: { x: 0, y: -1 },
  nne: { x: 0.5, y: -1 },
  ne: { x: 1, y: -1 },
  ene: { x: 1, y: -0.5 },
  e: { x: 1, y: 0 },
  ese: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  sse: { x: 0.5, y: 1 },
  s: { x: 0, y: 1 },
  ssw: { x: -0.5, y: 1 },
  sw: { x: -1, y: 1 },
  wsw: { x: -1, y: 0.5 },
  w: { x: -1, y: 0 },
  wnw: { x: -1, y: -0.5 },
  nw: { x: -1, y: -1 },
  nnw: { x: -0.5, y: -1 }
};

function nodeHalfSize(
  kind: "sector" | "tank",
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  if (kind === "sector") {
    return {
      x: HYDRAULICS_SECTOR_GRID_WIDTH / 2 / extent.cols,
      y: HYDRAULICS_SECTOR_GRID_HEIGHT / 2 / extent.rows
    };
  }
  return {
    x: HYDRAULICS_TANK_GRID_WIDTH / 2 / extent.cols,
    y: HYDRAULICS_TANK_GRID_HEIGHT / 2 / extent.rows
  };
}

function portOffset(port: HydraulicsPort, half: Point): Point {
  const unit = PORT_UNIT_OFFSET[port];
  return { x: unit.x * half.x, y: unit.y * half.y };
}

export function portsForNode(
  kind: "sector" | "tank",
  node: { x: number; y: number },
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Array<{ port: HydraulicsPort; point: Point }> {
  const half = nodeHalfSize(kind, extent);
  return hydraulicsPortsForKind(kind).map((port) => {
    const offset = portOffset(port, half);
    return { port, point: { x: node.x + offset.x, y: node.y + offset.y } };
  });
}

export function portsForBox(
  box: ResolvedHydraulicsBox,
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Array<{ port: string; point: Point }> {
  const widthCells = hydraulicsUnitToGrid(box.width, "x", undefined, extent);
  const heightCells = hydraulicsUnitToGrid(box.height, "y", undefined, extent);
  return hydraulicsBoxPorts(widthCells, heightCells).map((port) => ({
    port,
    point: boxPortPoint(box, port, extent)
  }));
}

function boxPortPoint(
  box: ResolvedHydraulicsBox,
  port: string,
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  const delta = hydraulicsBoxPortCellDelta(
    port,
    hydraulicsUnitToGrid(box.width, "x", undefined, extent),
    hydraulicsUnitToGrid(box.height, "y", undefined, extent)
  );
  if (!delta) {
    return { x: box.x, y: box.y };
  }
  return {
    x: box.x + delta.dx / extent.cols,
    y: box.y + delta.dy / extent.rows
  };
}

function nearestPort<T extends string>(
  from: Point,
  ports: Array<{ port: T; point: Point }>
): { port: T; point: Point } {
  return ports.reduce((best, entry) =>
    Math.hypot(from.x - entry.point.x, from.y - entry.point.y) <
    Math.hypot(from.x - best.point.x, from.y - best.point.y)
      ? entry
      : best
  );
}

function autoPortsForNode(
  kind: "sector" | "tank",
  node: { x: number; y: number },
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Array<{ port: HydraulicsPort; point: Point }> {
  return portsForNode(kind, node, extent).filter((entry) => AUTO_PORTS.includes(entry.port));
}

function autoPortsForBox(
  box: ResolvedHydraulicsBox,
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Array<{ port: string; point: Point }> {
  return portsForBox(box, extent).filter((entry) => AUTO_PORTS.includes(entry.port as HydraulicsPort));
}

function nodeForAnchor(
  anchor: Extract<HydraulicsAnchor, { kind: "sector" | "tank" }>,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): { x: number; y: number } | null {
  return anchor.kind === "sector"
    ? (sectors.find((entry) => entry.id === anchor.id) ?? null)
    : (tanks.find((entry) => entry.id === anchor.id) ?? null);
}

function pointForPort(
  kind: "sector" | "tank",
  node: { x: number; y: number },
  port: HydraulicsPort,
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  const offset = portOffset(port, nodeHalfSize(kind, extent));
  return { x: node.x + offset.x, y: node.y + offset.y };
}

export function anchorPoint(
  anchor: HydraulicsAnchor,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point | null {
  if (anchor.kind === "point") {
    return { x: clampUnit(anchor.x), y: clampUnit(anchor.y) };
  }
  if (anchor.kind === "box") {
    const box = boxes.find((entry) => entry.id === anchor.id);
    if (!box) {
      return null;
    }
    return anchor.port ? boxPortPoint(box, anchor.port, extent) : { x: box.x, y: box.y };
  }
  const node = nodeForAnchor(anchor, sectors, tanks);
  if (!node) {
    return null;
  }
  if (isHydraulicsPort(anchor.port)) {
    return pointForPort(anchor.kind, node, anchor.port, extent);
  }
  return { x: node.x, y: node.y };
}

export function resolvePipeEnd(
  anchor: HydraulicsAnchor,
  other: Point,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  if (anchor.kind === "point") {
    return { x: clampUnit(anchor.x), y: clampUnit(anchor.y) };
  }
  if (anchor.kind === "box") {
    const box = boxes.find((entry) => entry.id === anchor.id);
    if (!box) {
      return other;
    }
    if (anchor.port) {
      return boxPortPoint(box, anchor.port, extent);
    }
    return nearestPort(other, autoPortsForBox(box, extent)).point;
  }
  const node = nodeForAnchor(anchor, sectors, tanks);
  if (!node) {
    return other;
  }
  if (isHydraulicsPort(anchor.port)) {
    return pointForPort(anchor.kind, node, anchor.port, extent);
  }
  return nearestPort(other, autoPortsForNode(anchor.kind, node, extent)).point;
}

function buildPipePath(
  pipe: ResolvedHydraulicsPipe,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): string {
  const fromCenter = anchorPoint(pipe.from, sectors, tanks, boxes, extent) ?? { x: 0.5, y: 0.5 };
  const toCenter = anchorPoint(pipe.to, sectors, tanks, boxes, extent) ?? { x: 0.5, y: 0.5 };
  const start = resolvePipeEnd(pipe.from, pipe.waypoints[0] ?? toCenter, sectors, tanks, boxes, extent);
  const end = resolvePipeEnd(pipe.to, pipe.waypoints.at(-1) ?? fromCenter, sectors, tanks, boxes, extent);
  if (pipe.waypoints.length > 0) {
    return buildHydraulicsSplinePath([start, ...pipe.waypoints, end]);
  }
  const control = {
    x: (start.x + end.x) / 2,
    y: Math.min(start.y, end.y) - 0.08
  };
  return `M ${start.x * HYDRAULICS_VIEW_WIDTH} ${start.y * HYDRAULICS_VIEW_HEIGHT} Q ${control.x * HYDRAULICS_VIEW_WIDTH} ${control.y * HYDRAULICS_VIEW_HEIGHT} ${end.x * HYDRAULICS_VIEW_WIDTH} ${end.y * HYDRAULICS_VIEW_HEIGHT}`;
}

export function buildHydraulicsSplinePath(points: Point[]): string {
  const scaled = points.map(toViewBoxPoint);
  if (scaled.length === 0) {
    return "";
  }
  if (scaled.length === 1) {
    return `M ${scaled[0].x} ${scaled[0].y}`;
  }
  if (scaled.length === 2) {
    return `M ${scaled[0].x} ${scaled[0].y} L ${scaled[1].x} ${scaled[1].y}`;
  }

  const commands = [`M ${scaled[0].x} ${scaled[0].y}`];
  for (let index = 0; index < scaled.length - 1; index += 1) {
    const p0 = scaled[index - 1] ?? scaled[index];
    const p1 = scaled[index];
    const p2 = scaled[index + 1];
    const p3 = scaled[index + 2] ?? scaled[index + 1];
    const c1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6
    };
    const c2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6
    };
    commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`);
  }
  return commands.join(" ");
}

function toViewBoxPoint(point: Point): Point {
  return {
    x: point.x * HYDRAULICS_VIEW_WIDTH,
    y: point.y * HYDRAULICS_VIEW_HEIGHT
  };
}

function buildPathFromPoints(points: Point[]): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${point.x * HYDRAULICS_VIEW_WIDTH} ${point.y * HYDRAULICS_VIEW_HEIGHT}`;
    })
    .join(" ");
}

type PipeGeometry =
  | { kind: "quadratic"; start: Point; control: Point; end: Point }
  | { kind: "spline"; points: Point[] };

function pipeGeometry(
  pipe: ResolvedHydraulicsPipe,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): PipeGeometry {
  const fromCenter = anchorPoint(pipe.from, sectors, tanks, boxes, extent) ?? { x: 0.5, y: 0.5 };
  const toCenter = anchorPoint(pipe.to, sectors, tanks, boxes, extent) ?? { x: 0.5, y: 0.5 };
  const start = resolvePipeEnd(pipe.from, pipe.waypoints[0] ?? toCenter, sectors, tanks, boxes, extent);
  const end = resolvePipeEnd(pipe.to, pipe.waypoints.at(-1) ?? fromCenter, sectors, tanks, boxes, extent);
  if (pipe.waypoints.length > 0) {
    return { kind: "spline", points: [start, ...pipe.waypoints, end] };
  }
  return {
    kind: "quadratic",
    start,
    control: {
      x: (start.x + end.x) / 2,
      y: Math.min(start.y, end.y) - 0.08
    },
    end
  };
}

function samplePipeGeometry(geometry: PipeGeometry, t: number): { point: Point; tangent: Point } {
  const clamped = Math.min(1, Math.max(0, t));
  if (geometry.kind === "quadratic") {
    return sampleQuadratic(geometry.start, geometry.control, geometry.end, clamped);
  }
  return sampleSpline(geometry.points, clamped);
}

function sampleQuadratic(start: Point, control: Point, end: Point, t: number): { point: Point; tangent: Point } {
  const u = 1 - t;
  return {
    point: {
      x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * control.y + t * t * end.y
    },
    tangent: {
      x: 2 * u * (control.x - start.x) + 2 * t * (end.x - control.x),
      y: 2 * u * (control.y - start.y) + 2 * t * (end.y - control.y)
    }
  };
}

function sampleSpline(points: Point[], t: number): { point: Point; tangent: Point } {
  if (points.length === 0) {
    return { point: { x: 0.5, y: 0.4 }, tangent: { x: 1, y: 0 } };
  }
  const first = points[0] ?? { x: 0.5, y: 0.4 };
  if (points.length === 1) {
    return { point: first, tangent: { x: 1, y: 0 } };
  }
  const last = points[points.length - 1] ?? first;
  if (points.length === 2) {
    return {
      point: { x: first.x + (last.x - first.x) * t, y: first.y + (last.y - first.y) * t },
      tangent: { x: last.x - first.x, y: last.y - first.y }
    };
  }
  const segments = points.length - 1;
  const scaled = t * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;
  const p1 = points[index] ?? first;
  const p2 = points[index + 1] ?? last;
  const p0 = points[index - 1] ?? p1;
  const p3 = points[index + 2] ?? p2;
  const c1 = {
    x: p1.x + (p2.x - p0.x) / 6,
    y: p1.y + (p2.y - p0.y) / 6
  };
  const c2 = {
    x: p2.x - (p3.x - p1.x) / 6,
    y: p2.y - (p3.y - p1.y) / 6
  };
  return sampleCubic(p1, c1, c2, p2, local);
}

function sampleCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): { point: Point; tangent: Point } {
  const u = 1 - t;
  return {
    point: {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    },
    tangent: {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    }
  };
}

function upNormalViewBox(tangent: Point): Point {
  const tx = tangent.x * HYDRAULICS_VIEW_WIDTH;
  const ty = tangent.y * HYDRAULICS_VIEW_HEIGHT;
  const length = Math.hypot(tx, ty) || 1;
  let nx = -ty / length;
  let ny = tx / length;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

export function snapHydraulicsLabelOffset(
  offsetPx: number,
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): number {
  const cellPx = HYDRAULICS_VIEW_HEIGHT / extent.rows;
  if (!Number.isFinite(offsetPx)) {
    return 0;
  }
  return snapHydraulicsLabelOffsetCells(offsetPx / cellPx);
}

export function snapHydraulicsNodeLabelOffset(
  offsetPx: number,
  axis: "x" | "y",
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): number {
  const cellPx = axis === "x" ? HYDRAULICS_VIEW_WIDTH / extent.cols : HYDRAULICS_VIEW_HEIGHT / extent.rows;
  if (!Number.isFinite(offsetPx)) {
    return 0;
  }
  return snapHydraulicsLabelOffsetCells(offsetPx / cellPx);
}

const SECTOR_LABEL_BASELINE_PX = 5;
const TANK_LABEL_GAP_PX = 18;

function nodeLabelAutoViewBox(
  kind: "sector" | "tank" | "box",
  node: { x: number; y: number },
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  if (kind === "tank") {
    const tankHeight = (HYDRAULICS_TANK_GRID_HEIGHT / extent.rows) * HYDRAULICS_VIEW_HEIGHT;
    const top = node.y * HYDRAULICS_VIEW_HEIGHT - tankHeight / 2;
    return {
      x: node.x * HYDRAULICS_VIEW_WIDTH,
      y: top + tankHeight + TANK_LABEL_GAP_PX
    };
  }
  return {
    x: node.x * HYDRAULICS_VIEW_WIDTH,
    y: node.y * HYDRAULICS_VIEW_HEIGHT + (kind === "sector" ? SECTOR_LABEL_BASELINE_PX : 0)
  };
}

export function placeHydraulicsNodeLabel(
  kind: "sector" | "tank" | "box",
  node: { x: number; y: number; labelOffsetX: number | null; labelOffsetY: number | null },
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  const auto = nodeLabelAutoViewBox(kind, node, extent);
  return {
    x: auto.x + (node.labelOffsetX ?? 0) * (HYDRAULICS_VIEW_WIDTH / extent.cols),
    y: auto.y + (node.labelOffsetY ?? 0) * (HYDRAULICS_VIEW_HEIGHT / extent.rows)
  };
}

function closestHydraulicsPipeLabelT(geometry: PipeGeometry, point: Point): number {
  const steps = 48;
  let bestT = HYDRAULICS_LABEL_AUTO_T;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const sample = samplePipeGeometry(geometry, t);
    const dx = (sample.point.x - point.x) * HYDRAULICS_VIEW_WIDTH;
    const dy = (sample.point.y - point.y) * HYDRAULICS_VIEW_HEIGHT;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return bestT;
}

export function placeHydraulicsPipeLabel(
  pipe: ResolvedHydraulicsPipe,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[],
  boxes: ResolvedHydraulicsBox[] = [],
  extent: HydraulicsGridExtent = DEFAULT_HYDRAULICS_GRID_EXTENT
): Point {
  const geometry = pipeGeometry(pipe, sectors, tanks, boxes, extent);
  const sample = samplePipeGeometry(geometry, pipe.labelT ?? HYDRAULICS_LABEL_AUTO_T);
  const normal = upNormalViewBox(sample.tangent);
  const offsetPx =
    HYDRAULICS_LABEL_CLEARANCE_PX + (pipe.labelOffset ?? 0) * (HYDRAULICS_VIEW_HEIGHT / extent.rows);
  return {
    x: sample.point.x * HYDRAULICS_VIEW_WIDTH + normal.x * offsetPx,
    y: sample.point.y * HYDRAULICS_VIEW_HEIGHT + normal.y * offsetPx
  };
}

function svgId(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9_-]+/g, "-");
  return slug || "pipe";
}

function uniqueId(prefix: string, existing: string[]): string {
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

function isHydraulicsItemSelected(
  selected: HydraulicsSelection | null | undefined,
  kind: "sector" | "tank" | "box" | "pipe",
  id: string
): boolean {
  if (selected?.kind === "all") {
    return true;
  }
  return selected?.kind === kind && selected.id === id;
}

function HydraulicsFormulaLabel({
  canEdit,
  color,
  inspect,
  label,
  testId,
  variable,
  expression,
  x,
  y,
  onLabelPointerDown
}: {
  canEdit: boolean;
  color?: string;
  inspect: MultiportVariableInspectContextValue;
  label: string;
  testId: string;
  variable?: string;
  expression?: string;
  x: number;
  y: number;
  onLabelPointerDown?(event: ReactPointerEvent): void;
}) {
  const displaySource = label.trim() || expression?.trim() || variable?.trim() || "";
  if (!displaySource) {
    return null;
  }
  const boundName = variable?.trim() || "";
  const wrapperTooltip = boundName
    ? resolveVariableTooltip({
        name: boundName,
        variableDescriptions: inspect.variableDescriptions,
        variableUnitMetadata: inspect.variableUnitMetadata,
        currentValues: inspect.currentValues,
        laggedCurrentValues: inspect.laggedCurrentValues,
        laggedPeriodLabel: inspect.laggedPeriodLabel
      })
    : undefined;

  return (
    <foreignObject
      className="hydraulics-formula-label-host"
      data-testid={testId}
      height={HYDRAULICS_FORMULA_LABEL_HEIGHT}
      overflow="visible"
      width={HYDRAULICS_FORMULA_LABEL_WIDTH}
      x={x - HYDRAULICS_FORMULA_LABEL_WIDTH / 2}
      y={y - HYDRAULICS_FORMULA_LABEL_HEIGHT / 2}
    >
      <div
        className={`hydraulics-formula-label${canEdit ? " is-editable" : ""}`}
        style={color ? { color } : undefined}
        {...(wrapperTooltip ? { [FORMULA_TOOLTIP_ATTR]: wrapperTooltip } : {})}
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest(".formula-token.is-clickable")) {
            event.stopPropagation();
          }
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".formula-token.is-clickable")) {
            event.stopPropagation();
            return;
          }
          onLabelPointerDown?.(event as unknown as ReactPointerEvent);
        }}
      >
        {highlightFormula(
          displaySource,
          inspect.parameterNames,
          undefined,
          inspect.variableDescriptions,
          inspect.variableUnitMetadata,
          inspect.onSelectVariable,
          undefined,
          inspect.currentValues,
          inspect.highlightedVariable,
          true,
          inspect.laggedCurrentValues,
          inspect.laggedPeriodLabel
        )}
      </div>
    </foreignObject>
  );
}

function capturePointer(event: ReactPointerEvent): void {
  const target = event.currentTarget as Element;
  const svg =
    (target instanceof SVGElement ? target.ownerSVGElement ?? (target instanceof SVGSVGElement ? target : null) : null) ??
    target.closest("svg");
  if (svg && typeof svg.setPointerCapture === "function") {
    svg.setPointerCapture(event.pointerId);
  }
}

function isPrimaryPointer(event: ReactPointerEvent): boolean {
  return event.button === 0;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}
