import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  HYDRAULICS_PORTS,
  isHydraulicsPort,
  type HydraulicsAnchor,
  type HydraulicsLayout,
  type HydraulicsPort
} from "@sfcr/notebook-core";

import {
  DEFAULT_PIPE_ANIMATION_SPEED,
  DEFAULT_PIPE_ARROW_SIZE,
  DEFAULT_PIPE_COLOR,
  DEFAULT_PIPE_OPACITY,
  DEFAULT_PIPE_TOKEN_COUNT,
  DEFAULT_PIPE_WIDTH_SCALE,
  formatHydraulicsTankValue,
  HYDRAULICS_GRID_COLS,
  HYDRAULICS_TANK_GRID_Y,
  hydraulicsGridToUnit,
  layoutFromResolved,
  snapHydraulicsPoint,
  snapHydraulicsUnit,
  type ResolvedHydraulicsPipe,
  type ResolvedHydraulicsScene,
  type ResolvedHydraulicsSector,
  type ResolvedHydraulicsTank
} from "../notebook/hydraulics";

export const HYDRAULICS_VIEW_WIDTH = 1000;
export const HYDRAULICS_VIEW_HEIGHT = 620;
export const HYDRAULICS_SECTOR_WIDTH = 160;
export const HYDRAULICS_SECTOR_HEIGHT = 80;
export const HYDRAULICS_TANK_WIDTH = 70;
export const HYDRAULICS_TANK_HEIGHT = 120;
export const HYDRAULICS_SNAP_DISTANCE = 0.06;

export type HydraulicsTool = "select" | "add-sector" | "add-tank" | "add-pipe";

export type HydraulicsSelection =
  | { kind: "sector"; id: string }
  | { kind: "tank"; id: string }
  | { kind: "pipe"; id: string }
  | { kind: "waypoint"; pipeId: string; index: number };

interface Point {
  x: number;
  y: number;
}

type DragState =
  | { kind: "sector" | "tank"; id: string; grabOffset: Point }
  | { kind: "pipe-end"; pipeId: string; end: "from" | "to" }
  | { kind: "waypoint"; pipeId: string; index: number };

export function HydraulicsCanvas({
  scene,
  interactive = true,
  layoutLocked = true,
  prefersReducedMotion = false,
  selected = null,
  tool = "select",
  onLayoutChange,
  onSelect
}: {
  scene: ResolvedHydraulicsScene;
  interactive?: boolean;
  layoutLocked?: boolean;
  prefersReducedMotion?: boolean;
  selected?: HydraulicsSelection | null;
  tool?: HydraulicsTool;
  onLayoutChange?(layout: HydraulicsLayout): void;
  onSelect?(selection: HydraulicsSelection | null): void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<ResolvedHydraulicsScene | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<ResolvedHydraulicsScene | null>(null);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const [pipeDraftFrom, setPipeDraftFrom] = useState<HydraulicsAnchor | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const rendered = draft ?? scene;
  const canEdit = interactive && !layoutLocked;
  dragRef.current = drag;
  draftRef.current = draft;
  onLayoutChangeRef.current = onLayoutChange;

  const pipePaths = useMemo(
    () =>
      rendered.pipes.map((pipe) => ({
        pipe,
        d: buildPipePath(pipe, rendered.sectors, rendered.tanks)
      })),
    [rendered]
  );

  function persist(nextScene: ResolvedHydraulicsScene): void {
    onLayoutChangeRef.current?.(layoutFromResolved(nextScene));
  }

  function clientToNormalized(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        x: clampUnit(clientX / HYDRAULICS_VIEW_WIDTH),
        y: clampUnit(clientY / HYDRAULICS_VIEW_HEIGHT)
      };
    }
    return {
      x: clampUnit((clientX - rect.left) / rect.width),
      y: clampUnit((clientY - rect.top) / rect.height)
    };
  }

  function applyDragPoint(point: Point): void {
    const activeDrag = dragRef.current;
    const activeDraft = draftRef.current;
    if (!activeDrag || !activeDraft) {
      return;
    }

    if (activeDrag.kind === "sector" || activeDrag.kind === "tank") {
      const x = snapHydraulicsUnit(point.x - activeDrag.grabOffset.x, "x");
      const y = snapHydraulicsUnit(point.y - activeDrag.grabOffset.y, "y");
      const nextDraft =
        activeDrag.kind === "sector"
          ? {
              ...activeDraft,
              sectors: activeDraft.sectors.map((sector) =>
                sector.id === activeDrag.id ? { ...sector, x, y } : sector
              )
            }
          : {
              ...activeDraft,
              tanks: activeDraft.tanks.map((tank) => (tank.id === activeDrag.id ? { ...tank, x, y } : tank))
            };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (activeDrag.kind === "waypoint") {
      const nextDraft = {
        ...activeDraft,
        pipes: activeDraft.pipes.map((pipe) =>
          pipe.id === activeDrag.pipeId
            ? {
                ...pipe,
                waypoints: pipe.waypoints.map((waypoint, index) =>
                  index === activeDrag.index ? snapHydraulicsPoint(point) : waypoint
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

    const snapped = snapAnchor(point, activeDraft.sectors, activeDraft.tanks);
    const nextDraft = {
      ...activeDraft,
      pipes: activeDraft.pipes.map((pipe) =>
        pipe.id === activeDrag.pipeId
          ? { ...pipe, [activeDrag.end]: snapped ?? { kind: "point" as const, ...snapHydraulicsPoint(point) } }
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
      if (draftRef.current) {
        persist(draftRef.current);
      }
      dragRef.current = null;
      draftRef.current = null;
      setDrag(null);
      setDraft(null);
    };

    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag]);

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
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
          animationSpeed: DEFAULT_PIPE_ANIMATION_SPEED,
          widthScale: DEFAULT_PIPE_WIDTH_SCALE,
          dashed: false,
          tokenCount: DEFAULT_PIPE_TOKEN_COUNT,
          opacity: DEFAULT_PIPE_OPACITY
        }
      ]
    });
    onSelect?.({ kind: "pipe", id });
    setPipeDraftFrom(null);
  }

  function startNodeDrag(
    kind: "sector" | "tank",
    id: string,
    event: ReactPointerEvent,
    node: { x: number; y: number }
  ): void {
    if (canEdit && tool === "add-pipe") {
      event.stopPropagation();
      applyPipeDraft(snapPortOnNode(clientToNormalized(event.clientX, event.clientY), kind, id, rendered.sectors, rendered.tanks));
      return;
    }
    if (!canEdit || tool !== "select") {
      onSelect?.({ kind, id });
      return;
    }
    event.stopPropagation();
    capturePointer(event);
    const point = clientToNormalized(event.clientX, event.clientY);
    const nextDrag: DragState = { kind, id, grabOffset: { x: point.x - node.x, y: point.y - node.y } };
    dragRef.current = nextDrag;
    draftRef.current = rendered;
    setDrag(nextDrag);
    setDraft(rendered);
    onSelect?.({ kind, id });
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget && (event.target as Element).closest("[data-hydraulics-node]")) {
      return;
    }
    const point = snapHydraulicsPoint(clientToNormalized(event.clientX, event.clientY));
    if (!canEdit) {
      onSelect?.(null);
      return;
    }

    if (tool === "add-sector") {
      const id = uniqueId(
        "sector",
        rendered.sectors.map((sector) => sector.id)
      );
      persist({
        ...rendered,
        sectors: [...rendered.sectors, { id, label: "Sector", x: point.x, y: point.y }]
      });
      onSelect?.({ kind: "sector", id });
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
            x: snapped ? snapTankX(snapped, rendered.tanks) : point.x,
            y: snapped ? hydraulicsGridToUnit(HYDRAULICS_TANK_GRID_Y, "y") : point.y,
            value: null,
            maxAbs: 0,
            fill: 0
          }
        ]
      });
      onSelect?.({ kind: "tank", id });
      return;
    }

    if (tool === "add-pipe") {
      applyPipeDraft(snapAnchor(point, rendered.sectors, rendered.tanks));
      return;
    }

    onSelect?.(null);
  }

  function handlePipeDoubleClick(pipe: ResolvedHydraulicsPipe, event: ReactPointerEvent): void {
    if (!canEdit) {
      return;
    }
    event.stopPropagation();
    const point = snapHydraulicsPoint(clientToNormalized(event.clientX, event.clientY));
    persist({
      ...rendered,
      pipes: rendered.pipes.map((entry) =>
        entry.id === pipe.id ? { ...entry, waypoints: [...entry.waypoints, point] } : entry
      )
    });
  }

  const previewPath =
    tool === "add-pipe" && pipeDraftFrom && cursor
      ? buildPathFromPoints([anchorPoint(pipeDraftFrom, rendered.sectors, rendered.tanks) ?? cursor, cursor])
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
    <svg
      ref={svgRef}
      className="hydraulics-diagram-canvas"
      role="img"
      aria-label="Hydraulics diagram"
      viewBox={`0 0 ${HYDRAULICS_VIEW_WIDTH} ${HYDRAULICS_VIEW_HEIGHT}`}
      width="100%"
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
    >
      <defs>
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

      {pipePaths.map(({ pipe, d }) => {
        const markerId = `hydraulics-arrow-${svgId(pipe.id)}`;
        const animateFlow = !prefersReducedMotion && pipe.animationSpeed > 0;
        return (
        <g key={pipe.id} data-hydraulics-node="pipe" opacity={pipe.opacity}>
          <path
            data-testid={`hydraulics-pipe-${pipe.id}`}
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(18, pipe.strokeWidth + 12)}
            className={selected?.kind === "pipe" && selected.id === pipe.id ? "is-selected" : undefined}
            onPointerDown={(event) => {
              event.stopPropagation();
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
          {animateFlow ? (
            <path
              data-testid={`hydraulics-pipe-overlay-${pipe.id}`}
              d={d}
              fill="none"
              stroke="#f8fafc"
              strokeWidth={Math.max(1.2, pipe.strokeWidth * 0.4)}
              className="hydraulics-pipe-overlay is-animated"
              style={{ animationDuration: `${0.5 / pipe.animationSpeed}s` }}
              pointerEvents="none"
            />
          ) : null}
          {pipe.label ? (
            <text
              x={pathLabelPoint(d).x * HYDRAULICS_VIEW_WIDTH}
              y={pathLabelPoint(d).y * HYDRAULICS_VIEW_HEIGHT - 8}
              textAnchor="middle"
              className="hydraulics-pipe-label"
              style={{ fill: pipe.color }}
              pointerEvents="none"
            >
              {pipe.label}
            </text>
          ) : null}
          {canEdit && tool === "select"
            ? (["from", "to"] as const).map((end) => {
                const otherAnchor = pipe[end === "from" ? "to" : "from"];
                const other = pipe.waypoints[end === "from" ? 0 : pipe.waypoints.length - 1]
                  ?? anchorPoint(otherAnchor, rendered.sectors, rendered.tanks)
                  ?? { x: 0.5, y: 0.5 };
                const point = resolvePipeEnd(pipe[end], other, rendered.sectors, rendered.tanks);
                return (
                  <circle
                    key={`${pipe.id}-${end}`}
                    data-testid={`hydraulics-pipe-end-${pipe.id}-${end}`}
                    cx={point.x * HYDRAULICS_VIEW_WIDTH}
                    cy={point.y * HYDRAULICS_VIEW_HEIGHT}
                    r={7}
                    className="hydraulics-handle"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      capturePointer(event);
                      const nextDrag: DragState = { kind: "pipe-end", pipeId: pipe.id, end };
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
                  data-testid={`hydraulics-waypoint-${pipe.id}-${index}`}
                  cx={waypoint.x * HYDRAULICS_VIEW_WIDTH}
                  cy={waypoint.y * HYDRAULICS_VIEW_HEIGHT}
                  r={6}
                  className="hydraulics-handle"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    capturePointer(event);
                    const nextDrag: DragState = { kind: "waypoint", pipeId: pipe.id, index };
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
        const x = sector.x * HYDRAULICS_VIEW_WIDTH - HYDRAULICS_SECTOR_WIDTH / 2;
        const y = sector.y * HYDRAULICS_VIEW_HEIGHT - HYDRAULICS_SECTOR_HEIGHT / 2;
        const isSelected = selected?.kind === "sector" && selected.id === sector.id;
        return (
          <g
            key={sector.id}
            data-hydraulics-node="sector"
            data-testid={`hydraulics-sector-${sector.id}`}
            className={`hydraulics-sector${isSelected ? " is-selected" : ""}`}
            onPointerDown={(event) => startNodeDrag("sector", sector.id, event, sector)}
          >
            <rect x={x} y={y} width={HYDRAULICS_SECTOR_WIDTH} height={HYDRAULICS_SECTOR_HEIGHT} rx="10" />
            <text x={sector.x * HYDRAULICS_VIEW_WIDTH} y={sector.y * HYDRAULICS_VIEW_HEIGHT + 5} textAnchor="middle">
              {sector.label}
            </text>
          </g>
        );
      })}

      {rendered.tanks.map((tank) => {
        const x = tank.x * HYDRAULICS_VIEW_WIDTH - HYDRAULICS_TANK_WIDTH / 2;
        const y = tank.y * HYDRAULICS_VIEW_HEIGHT - HYDRAULICS_TANK_HEIGHT / 2;
        const fillHeight = tank.fill * HYDRAULICS_TANK_HEIGHT;
        const fillY = tank.polarity === "liability" ? y : y + HYDRAULICS_TANK_HEIGHT - fillHeight;
        const isSelected = selected?.kind === "tank" && selected.id === tank.id;
        return (
          <g
            key={tank.id}
            data-hydraulics-node="tank"
            data-testid={`hydraulics-tank-${tank.id}`}
            className={`hydraulics-tank${isSelected ? " is-selected" : ""}`}
            onPointerDown={(event) => startNodeDrag("tank", tank.id, event, tank)}
          >
            <rect
              x={x}
              y={fillY}
              width={HYDRAULICS_TANK_WIDTH}
              height={fillHeight}
              fill={tank.color}
              opacity="0.85"
            />
            <rect
              x={x}
              y={y}
              width={HYDRAULICS_TANK_WIDTH}
              height={HYDRAULICS_TANK_HEIGHT}
              rx="8"
              fill="none"
              stroke={tank.color}
              strokeWidth="3"
            />
            <text
              x={tank.x * HYDRAULICS_VIEW_WIDTH}
              y={y + HYDRAULICS_TANK_HEIGHT / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="hydraulics-tank-value"
              pointerEvents="none"
            >
              {formatHydraulicsTankValue(tank.value)}
            </text>
            <text
              x={tank.x * HYDRAULICS_VIEW_WIDTH}
              y={y + HYDRAULICS_TANK_HEIGHT + 18}
              textAnchor="middle"
              className="hydraulics-tank-label"
            >
              {tank.label}
            </text>
          </g>
        );
      })}

      {canEdit && (tool === "add-pipe" || drag?.kind === "pipe-end")
        ? [
            ...rendered.sectors.flatMap((sector) =>
              portsForNode("sector", sector).map(({ port, point }) => ({
                key: `sector-${sector.id}-${port}`,
                kind: "sector" as const,
                id: sector.id,
                port,
                point
              }))
            ),
            ...rendered.tanks.flatMap((tank) =>
              portsForNode("tank", tank).map(({ port, point }) => ({
                key: `tank-${tank.id}-${port}`,
                kind: "tank" as const,
                id: tank.id,
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
                event.stopPropagation();
                if (tool === "add-pipe") {
                  applyPipeDraft({ kind: entry.kind, id: entry.id, port: entry.port });
                }
              }}
            />
          ))
        : null}
    </svg>
  );
}

export function snapAnchor(
  point: Point,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): HydraulicsAnchor | null {
  const candidates: Array<{ distance: number; anchor: HydraulicsAnchor }> = [];

  const consider = (anchor: HydraulicsAnchor, target: Point) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= HYDRAULICS_SNAP_DISTANCE) {
      candidates.push({ distance, anchor });
    }
  };

  for (const sector of sectors) {
    for (const { port, point: target } of portsForNode("sector", sector)) {
      consider({ kind: "sector", id: sector.id, port }, target);
    }
  }
  for (const tank of tanks) {
    for (const { port, point: target } of portsForNode("tank", tank)) {
      consider({ kind: "tank", id: tank.id, port }, target);
    }
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.anchor ?? null;
}

export function snapPortOnNode(
  point: Point,
  kind: "sector" | "tank",
  id: string,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): HydraulicsAnchor | null {
  const node = kind === "sector" ? sectors.find((entry) => entry.id === id) : tanks.find((entry) => entry.id === id);
  if (!node) {
    return null;
  }
  const nearest = nearestPort(point, portsForNode(kind, node));
  return { kind, id, port: nearest.port };
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

function snapTankX(sector: ResolvedHydraulicsSector, tanks: ResolvedHydraulicsTank[]): number {
  const attached = tanks.filter((tank) => tank.sectorId === sector.id);
  return snapHydraulicsUnit(sector.x + attached.length * (2 / HYDRAULICS_GRID_COLS), "x");
}

const AUTO_PORTS: readonly HydraulicsPort[] = ["n", "e", "s", "w"];

function nodeHalfSize(kind: "sector" | "tank"): Point {
  if (kind === "sector") {
    return {
      x: HYDRAULICS_SECTOR_WIDTH / 2 / HYDRAULICS_VIEW_WIDTH,
      y: HYDRAULICS_SECTOR_HEIGHT / 2 / HYDRAULICS_VIEW_HEIGHT
    };
  }
  return {
    x: HYDRAULICS_TANK_WIDTH / 2 / HYDRAULICS_VIEW_WIDTH,
    y: HYDRAULICS_TANK_HEIGHT / 2 / HYDRAULICS_VIEW_HEIGHT
  };
}

function portOffset(port: HydraulicsPort, half: Point): Point {
  const x = port.includes("e") ? 1 : port.includes("w") ? -1 : 0;
  const y = port.includes("s") ? 1 : port.includes("n") ? -1 : 0;
  return { x: x * half.x, y: y * half.y };
}

export function portsForNode(
  kind: "sector" | "tank",
  node: { x: number; y: number }
): Array<{ port: HydraulicsPort; point: Point }> {
  const half = nodeHalfSize(kind);
  return HYDRAULICS_PORTS.map((port) => {
    const offset = portOffset(port, half);
    return { port, point: { x: node.x + offset.x, y: node.y + offset.y } };
  });
}

function nearestPort(
  from: Point,
  ports: Array<{ port: HydraulicsPort; point: Point }>
): { port: HydraulicsPort; point: Point } {
  return ports.reduce((best, entry) =>
    Math.hypot(from.x - entry.point.x, from.y - entry.point.y) <
    Math.hypot(from.x - best.point.x, from.y - best.point.y)
      ? entry
      : best
  );
}

function autoPortsForNode(
  kind: "sector" | "tank",
  node: { x: number; y: number }
): Array<{ port: HydraulicsPort; point: Point }> {
  return portsForNode(kind, node).filter((entry) => AUTO_PORTS.includes(entry.port));
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
  port: HydraulicsPort
): Point {
  return portsForNode(kind, node).find((entry) => entry.port === port)?.point ?? { x: node.x, y: node.y };
}

export function anchorPoint(
  anchor: HydraulicsAnchor,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): Point | null {
  if (anchor.kind === "point") {
    return { x: clampUnit(anchor.x), y: clampUnit(anchor.y) };
  }
  const node = nodeForAnchor(anchor, sectors, tanks);
  if (!node) {
    return null;
  }
  if (isHydraulicsPort(anchor.port)) {
    return pointForPort(anchor.kind, node, anchor.port);
  }
  return { x: node.x, y: node.y };
}

export function resolvePipeEnd(
  anchor: HydraulicsAnchor,
  other: Point,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): Point {
  if (anchor.kind === "point") {
    return { x: clampUnit(anchor.x), y: clampUnit(anchor.y) };
  }
  const node = nodeForAnchor(anchor, sectors, tanks);
  if (!node) {
    return other;
  }
  if (isHydraulicsPort(anchor.port)) {
    return pointForPort(anchor.kind, node, anchor.port);
  }
  return nearestPort(other, autoPortsForNode(anchor.kind, node)).point;
}

function buildPipePath(
  pipe: ResolvedHydraulicsPipe,
  sectors: ResolvedHydraulicsSector[],
  tanks: ResolvedHydraulicsTank[]
): string {
  const fromCenter = anchorPoint(pipe.from, sectors, tanks) ?? { x: 0.5, y: 0.5 };
  const toCenter = anchorPoint(pipe.to, sectors, tanks) ?? { x: 0.5, y: 0.5 };
  const start = resolvePipeEnd(pipe.from, pipe.waypoints[0] ?? toCenter, sectors, tanks);
  const end = resolvePipeEnd(pipe.to, pipe.waypoints.at(-1) ?? fromCenter, sectors, tanks);
  if (pipe.waypoints.length > 0) {
    return buildPathFromPoints([start, ...pipe.waypoints, end]);
  }
  const control = {
    x: (start.x + end.x) / 2,
    y: Math.min(start.y, end.y) - 0.08
  };
  return `M ${start.x * HYDRAULICS_VIEW_WIDTH} ${start.y * HYDRAULICS_VIEW_HEIGHT} Q ${control.x * HYDRAULICS_VIEW_WIDTH} ${control.y * HYDRAULICS_VIEW_HEIGHT} ${end.x * HYDRAULICS_VIEW_WIDTH} ${end.y * HYDRAULICS_VIEW_HEIGHT}`;
}

function buildPathFromPoints(points: Point[]): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${point.x * HYDRAULICS_VIEW_WIDTH} ${point.y * HYDRAULICS_VIEW_HEIGHT}`;
    })
    .join(" ");
}

function pathLabelPoint(d: string): Point {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (numbers.length < 4) {
    return { x: 0.5, y: 0.4 };
  }
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length / HYDRAULICS_VIEW_WIDTH,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length / HYDRAULICS_VIEW_HEIGHT
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

function capturePointer(event: ReactPointerEvent): void {
  const target = event.currentTarget as SVGElement;
  const svg = target.ownerSVGElement ?? (target as SVGSVGElement);
  if (typeof svg.setPointerCapture === "function") {
    svg.setPointerCapture(event.pointerId);
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}
