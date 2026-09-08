import type { SimulationResult } from "@sfcr/core";
import type {
  HydraulicsAnchor,
  HydraulicsBoxLayout,
  HydraulicsCell,
  HydraulicsLayout,
  HydraulicsPipeLayout,
  HydraulicsPolarity,
  HydraulicsSectorLayout,
  HydraulicsTankLayout,
  MatrixCell,
  NotebookCell
} from "@sfcr/notebook-core";
import { canonicalHydraulicsBoxPort } from "@sfcr/notebook-core";

import { findCompanionBalanceMatrixCell } from "../components/multiportParticipantStocks";
import { computeTransactionFlowStrokeWidth, MULTIPORT_FLOW_STROKE_PRESET } from "../components/transactionFlowStroke";
import { classifyMatrixStockRole } from "./matrixSemantics";
import { buildSequenceDiagramFromMatrix, evaluateMatrixEntryAtPeriod } from "./sequence";

const ASSET_COLORS = ["#2980b9", "#d4a017", "#27ae60", "#8e44ad"] as const;
const LIABILITY_COLOR = "#c0392b";

export const HYDRAULICS_GRID_COLS = 40;
export const HYDRAULICS_GRID_ROWS = 24;
export const HYDRAULICS_SECTOR_GRID_Y = 5;
export const HYDRAULICS_TANK_GRID_Y = 14;
/** Even cell counts so 5 long-side ports land on grid intersections. */
export const HYDRAULICS_SECTOR_GRID_WIDTH = 8;
export const HYDRAULICS_SECTOR_GRID_HEIGHT = 4;
export const HYDRAULICS_TANK_GRID_WIDTH = 4;
export const HYDRAULICS_TANK_GRID_HEIGHT = 8;
export const HYDRAULICS_BOX_GRID_WIDTH = 12;
export const HYDRAULICS_BOX_GRID_HEIGHT = 8;
export const HYDRAULICS_BOX_MIN_GRID = 2;
export const DEFAULT_BOX_FILL = "#7dd3fc";
export const DEFAULT_BOX_FILL_OPACITY = 0.2;
export const DEFAULT_BOX_STROKE = "#64748b";

export const HYDRAULICS_BOX_RESIZE_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type HydraulicsBoxResizeHandle = (typeof HYDRAULICS_BOX_RESIZE_HANDLES)[number];

export const DEFAULT_PIPE_COLOR = "#334155";
export const DEFAULT_PIPE_ARROW_SIZE = 8;
/** Dash overlay speed for the largest peer flow on the diagram. */
export const DEFAULT_PIPE_FLOW_ANIMATION_SPEED = 1;
export const DEFAULT_PIPE_WIDTH_SCALE = 1;
export const DEFAULT_PIPE_TOKEN_COUNT = 3;
export const DEFAULT_PIPE_OPACITY = 1;
/** Floor on flow-scaled dash speed so small non-zero flows still move. */
export const HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR = 0.25;
/** Label offsets snap to this many grid cells (pipe, sector, tank, and box). */
export const HYDRAULICS_LABEL_OFFSET_STEP = 0.5;
export const HYDRAULICS_LABEL_OFFSET_MAX = 12;
export const DEFAULT_SECTOR_FILL = "#f8fafc";
export const DEFAULT_SECTOR_STROKE = "#334155";
export const DEFAULT_SECTOR_OPACITY = 1;

export interface ResolvedHydraulicsSector {
  id: string;
  label: string;
  fill: string;
  stroke: string;
  opacity: number;
  x: number;
  y: number;
  labelOffsetX: number | null;
  labelOffsetY: number | null;
}

export interface ResolvedHydraulicsTank {
  id: string;
  sectorId: string;
  label: string;
  variable?: string;
  expression?: string;
  polarity: HydraulicsPolarity;
  color: string;
  x: number;
  y: number;
  value: number | null;
  /** Authored fill ceiling. `null` uses `runMaxAbs`. */
  maxLevel: number | null;
  /** Peak |value| over the run for the bound series. */
  runMaxAbs: number;
  /** Effective fill denominator (`maxLevel` or `runMaxAbs`). */
  maxAbs: number;
  fill: number;
  labelOffsetX: number | null;
  labelOffsetY: number | null;
}

export interface ResolvedHydraulicsPipe {
  id: string;
  from: HydraulicsAnchor;
  to: HydraulicsAnchor;
  variable?: string;
  expression?: string;
  label: string;
  waypoints: Array<{ x: number; y: number }>;
  magnitude: number | null;
  strokeWidth: number;
  color: string;
  arrowSize: number;
  /** Dash overlay speed from flow magnitude. `0` when unbound or near-zero. */
  flowAnimationSpeed: number;
  widthScale: number;
  dashed: boolean;
  tokenCount: number;
  opacity: number;
  /** Authored 0–1 along-pipe position. `null` keeps auto placement. */
  labelT: number | null;
  /** Authored perpendicular offset in half-cell steps. `null` keeps auto placement. */
  labelOffset: number | null;
}

export interface ResolvedHydraulicsBox {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  dashed: boolean;
  labelOffsetX: number | null;
  labelOffsetY: number | null;
}

export interface ResolvedHydraulicsScene {
  sectors: ResolvedHydraulicsSector[];
  tanks: ResolvedHydraulicsTank[];
  pipes: ResolvedHydraulicsPipe[];
  boxes: ResolvedHydraulicsBox[];
  errors: string[];
}

export function resolveHydraulicsScene(
  cell: HydraulicsCell,
  resolveMatrixCell: (cellId: string) => MatrixCell | null,
  resolveResult: (cellId: string) => SimulationResult | null,
  selectedPeriodIndex: number,
  cells: NotebookCell[] = []
): ResolvedHydraulicsScene {
  const transactionMatrix = resolveMatrixCell(cell.source.transactionMatrixCellId);
  const errors: string[] = [];
  if (!transactionMatrix) {
    errors.push(`Matrix cell '${cell.source.transactionMatrixCellId}' was not found.`);
  }

  let balanceMatrix = cell.source.balanceMatrixCellId
    ? resolveMatrixCell(cell.source.balanceMatrixCellId)
    : null;
  if (cell.source.balanceMatrixCellId && !balanceMatrix) {
    errors.push(`Matrix cell '${cell.source.balanceMatrixCellId}' was not found.`);
  }
  if (!balanceMatrix && transactionMatrix && cells.length > 0) {
    balanceMatrix = findCompanionBalanceMatrixCell(cells, transactionMatrix);
  }

  const runCellId =
    cell.source.sourceRunCellId ?? transactionMatrix?.sourceRunCellId ?? balanceMatrix?.sourceRunCellId;
  const result = runCellId ? resolveResult(runCellId) : null;

  const seeded = seedHydraulicsLayout(transactionMatrix, balanceMatrix);
  const layout = mergeHydraulicsLayout(seeded, cell.layout);
  return evaluateHydraulicsLayout(layout, result, selectedPeriodIndex, errors);
}

export function seedHydraulicsLayout(
  transactionMatrix: MatrixCell | null,
  balanceMatrix: MatrixCell | null
): HydraulicsLayout {
  const sectors = seedSectors(transactionMatrix);
  const tanks = seedTanks(balanceMatrix, sectors);
  const pipes = seedPipes(transactionMatrix, sectors);
  return { sectors, tanks, pipes, boxes: [] };
}

export function mergeHydraulicsLayout(
  seeded: HydraulicsLayout,
  authored: HydraulicsLayout | undefined
): HydraulicsLayout {
  if (!authored) {
    return seeded;
  }

  return {
    sectors: mergeById(seeded.sectors ?? [], authored.sectors ?? []),
    tanks: mergeById(seeded.tanks ?? [], authored.tanks ?? []),
    pipes: mergeById(seeded.pipes ?? [], authored.pipes ?? []),
    boxes: mergeById(seeded.boxes ?? [], authored.boxes ?? [])
  };
}

export function hydraulicsGridToUnit(value: number, axis: "x" | "y"): number {
  const span = axis === "x" ? HYDRAULICS_GRID_COLS : HYDRAULICS_GRID_ROWS;
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value > 0 && value < 1) {
    return value;
  }
  return clampUnit(value / span);
}

export function hydraulicsUnitToGrid(value: number, axis: "x" | "y"): number {
  const span = axis === "x" ? HYDRAULICS_GRID_COLS : HYDRAULICS_GRID_ROWS;
  return Math.round(clampUnit(value) * span);
}

export function snapHydraulicsUnit(value: number, axis: "x" | "y"): number {
  return hydraulicsGridToUnit(hydraulicsUnitToGrid(value, axis), axis);
}

export function snapHydraulicsPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: snapHydraulicsUnit(point.x, "x"),
    y: snapHydraulicsUnit(point.y, "y")
  };
}

function persistAnchor(anchor: HydraulicsAnchor): HydraulicsAnchor {
  if (anchor.kind !== "point") {
    return anchor;
  }
  return {
    kind: "point",
    x: hydraulicsUnitToGrid(anchor.x, "x"),
    y: hydraulicsUnitToGrid(anchor.y, "y")
  };
}

function persistLabelOffsets(node: { labelOffsetX: number | null; labelOffsetY: number | null }): {
  labelOffsetX?: number;
  labelOffsetY?: number;
} {
  return {
    ...(node.labelOffsetX != null ? { labelOffsetX: node.labelOffsetX } : {}),
    ...(node.labelOffsetY != null ? { labelOffsetY: node.labelOffsetY } : {})
  };
}

function readAnchor(anchor: HydraulicsAnchor): HydraulicsAnchor {
  if (anchor.kind !== "point") {
    return anchor;
  }
  return {
    kind: "point",
    x: hydraulicsGridToUnit(anchor.x, "x"),
    y: hydraulicsGridToUnit(anchor.y, "y")
  };
}

function canonicalizeBoxAnchor(anchor: HydraulicsAnchor, boxes: ResolvedHydraulicsBox[]): HydraulicsAnchor {
  if (anchor.kind !== "box" || !anchor.port) {
    return anchor;
  }
  const box = boxes.find((entry) => entry.id === anchor.id);
  if (!box) {
    return anchor;
  }
  const port = canonicalHydraulicsBoxPort(
    anchor.port,
    hydraulicsUnitToGrid(box.width, "x"),
    hydraulicsUnitToGrid(box.height, "y")
  );
  return port ? { kind: "box", id: anchor.id, port } : { kind: "box", id: anchor.id };
}

export function layoutFromResolved(scene: ResolvedHydraulicsScene): HydraulicsLayout {
  return {
    sectors: scene.sectors.map((sector) => ({
      id: sector.id,
      label: sector.label,
      fill: sector.fill,
      stroke: sector.stroke,
      opacity: sector.opacity,
      x: hydraulicsUnitToGrid(sector.x, "x"),
      y: hydraulicsUnitToGrid(sector.y, "y"),
      ...persistLabelOffsets(sector)
    })),
    tanks: scene.tanks.map((tank) => ({
      id: tank.id,
      sectorId: tank.sectorId,
      variable: tank.variable,
      expression: tank.expression,
      polarity: tank.polarity,
      color: tank.color,
      ...(tank.maxLevel != null ? { maxLevel: tank.maxLevel } : {}),
      x: hydraulicsUnitToGrid(tank.x, "x"),
      y: hydraulicsUnitToGrid(tank.y, "y"),
      ...persistLabelOffsets(tank)
    })),
    pipes: scene.pipes.map((pipe) => ({
      id: pipe.id,
      from: persistAnchor(pipe.from),
      to: persistAnchor(pipe.to),
      variable: pipe.variable,
      expression: pipe.expression,
      label: pipe.label,
      waypoints:
        pipe.waypoints.length > 0
          ? pipe.waypoints.map((point) => ({
              x: hydraulicsUnitToGrid(point.x, "x"),
              y: hydraulicsUnitToGrid(point.y, "y")
            }))
          : undefined,
      color: pipe.color,
      arrowSize: pipe.arrowSize,
      widthScale: pipe.widthScale,
      dashed: pipe.dashed,
      tokenCount: pipe.tokenCount,
      opacity: pipe.opacity,
      ...(pipe.labelT != null ? { labelT: pipe.labelT } : {}),
      ...(pipe.labelOffset != null ? { labelOffset: pipe.labelOffset } : {})
    })),
    boxes: scene.boxes.map((box) => ({
      id: box.id,
      ...(box.label.trim() ? { label: box.label } : {}),
      x: hydraulicsUnitToGrid(box.x, "x"),
      y: hydraulicsUnitToGrid(box.y, "y"),
      width: Math.max(1, hydraulicsUnitToGrid(box.width, "x")),
      height: Math.max(1, hydraulicsUnitToGrid(box.height, "y")),
      fill: box.fill,
      fillOpacity: box.fillOpacity,
      stroke: box.stroke,
      ...(box.dashed ? { dashed: true } : {}),
      ...persistLabelOffsets(box)
    }))
  };
}

export function evaluateHydraulicsLayout(
  layout: HydraulicsLayout,
  result: SimulationResult | null,
  selectedPeriodIndex: number,
  errors: string[] = []
): ResolvedHydraulicsScene {
  const sectors = (layout.sectors ?? []).map((sector) => ({
    id: sector.id,
    label: sector.label?.trim() || sector.id,
    fill: sector.fill?.trim() || DEFAULT_SECTOR_FILL,
    stroke: sector.stroke?.trim() || DEFAULT_SECTOR_STROKE,
    opacity: clampRange(sector.opacity, 0, 1, DEFAULT_SECTOR_OPACITY),
    x: hydraulicsGridToUnit(sector.x, "x"),
    y: hydraulicsGridToUnit(sector.y, "y"),
    labelOffsetX: clampLabelOffset(sector.labelOffsetX),
    labelOffsetY: clampLabelOffset(sector.labelOffsetY)
  }));

  const tanks = (layout.tanks ?? []).map((tank, index) => {
    const expression = tank.expression?.trim() || tank.variable?.trim() || "";
    const value = expression ? evaluateMatrixEntryAtPeriod(expression, result, selectedPeriodIndex) : null;
    const runMaxAbs = expression ? maxAbsOverRun(expression, result) : 0;
    const maxLevel = clampTankMaxLevel(tank.maxLevel);
    const maxAbs = maxLevel ?? runMaxAbs;
    const polarity = tank.polarity ?? inferPolarityFromValue(value);
    return {
      id: tank.id,
      sectorId: tank.sectorId,
      label: tank.variable?.trim() || tank.id,
      variable: tank.variable,
      expression: tank.expression,
      polarity,
      color: tank.color?.trim() || defaultTankColor(polarity, index),
      x: hydraulicsGridToUnit(tank.x, "x"),
      y: hydraulicsGridToUnit(tank.y, "y"),
      value,
      maxLevel,
      runMaxAbs,
      maxAbs,
      fill: maxAbs > 0 && value != null ? Math.min(1, Math.abs(value) / maxAbs) : 0,
      labelOffsetX: clampLabelOffset(tank.labelOffsetX),
      labelOffsetY: clampLabelOffset(tank.labelOffsetY)
    } satisfies ResolvedHydraulicsTank;
  });

  const boxes = (layout.boxes ?? []).map((box) => resolveHydraulicsBox(box));

  const rawPipes = (layout.pipes ?? []).map((pipe) => {
    const expression = pipe.expression?.trim() || pipe.variable?.trim() || "";
    const magnitude = expression ? evaluateMatrixEntryAtPeriod(expression, result, selectedPeriodIndex) : null;
    const style = resolvePipeStyle(pipe);
    return {
      id: pipe.id,
      from: canonicalizeBoxAnchor(readAnchor(pipe.from), boxes),
      to: canonicalizeBoxAnchor(readAnchor(pipe.to), boxes),
      variable: pipe.variable,
      expression: pipe.expression,
      label: pipe.label?.trim() || pipe.variable?.trim() || pipe.id,
      waypoints: (pipe.waypoints ?? []).map((point) => ({
        x: hydraulicsGridToUnit(point.x, "x"),
        y: hydraulicsGridToUnit(point.y, "y")
      })),
      magnitude,
      strokeWidth: 0,
      flowAnimationSpeed: 0,
      labelT: clampOptionalUnit(pipe.labelT),
      labelOffset: clampLabelOffset(pipe.labelOffset),
      ...style
    } satisfies ResolvedHydraulicsPipe;
  });
  const maxMagnitude = Math.max(
    0,
    ...rawPipes.map((pipe) => (pipe.magnitude != null ? Math.abs(pipe.magnitude) : 0))
  );
  const pipes = rawPipes.map((pipe) => ({
    ...pipe,
    strokeWidth:
      computeTransactionFlowStrokeWidth(
        pipe.magnitude == null ? undefined : Math.abs(pipe.magnitude),
        maxMagnitude,
        MULTIPORT_FLOW_STROKE_PRESET
      ) * pipe.widthScale,
    flowAnimationSpeed: scaleHydraulicsPipeAnimationSpeed(pipe.magnitude, maxMagnitude)
  }));

  return { sectors, tanks, pipes, boxes, errors };
}

/** Dash speed from peer-relative flow magnitude. Unbound or ~0 magnitude stays still. */
export function scaleHydraulicsPipeAnimationSpeed(
  magnitude: number | null,
  maxMagnitude: number
): number {
  if (magnitude == null || !Number.isFinite(magnitude) || Math.abs(magnitude) < 1e-9) {
    return 0;
  }
  if (!(maxMagnitude > 0) || !Number.isFinite(maxMagnitude)) {
    return 0;
  }
  const normalized = Math.min(1, Math.abs(magnitude) / maxMagnitude);
  return (
    DEFAULT_PIPE_FLOW_ANIMATION_SPEED *
    (HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR +
      (1 - HYDRAULICS_PIPE_ANIMATION_SPEED_MIN_FACTOR) * normalized)
  );
}

export function createResolvedHydraulicsBox(id: string, x: number, y: number): ResolvedHydraulicsBox {
  return {
    id,
    label: "",
    x,
    y,
    width: hydraulicsGridToUnit(HYDRAULICS_BOX_GRID_WIDTH, "x"),
    height: hydraulicsGridToUnit(HYDRAULICS_BOX_GRID_HEIGHT, "y"),
    fill: DEFAULT_BOX_FILL,
    fillOpacity: DEFAULT_BOX_FILL_OPACITY,
    stroke: DEFAULT_BOX_STROKE,
    dashed: false,
    labelOffsetX: null,
    labelOffsetY: null
  };
}

function resolveHydraulicsBox(box: HydraulicsBoxLayout): ResolvedHydraulicsBox {
  const fill = box.fill?.trim() ?? "";
  return {
    id: box.id,
    label: box.label?.trim() ?? "",
    x: hydraulicsGridToUnit(box.x, "x"),
    y: hydraulicsGridToUnit(box.y, "y"),
    width: hydraulicsGridToUnit(Math.max(1, box.width), "x"),
    height: hydraulicsGridToUnit(Math.max(1, box.height), "y"),
    fill: fill || DEFAULT_BOX_FILL,
    fillOpacity: fill ? clampRange(box.fillOpacity, 0, 1, DEFAULT_BOX_FILL_OPACITY) : 0,
    stroke: box.stroke?.trim() || DEFAULT_BOX_STROKE,
    dashed: box.dashed === true,
    labelOffsetX: clampLabelOffset(box.labelOffsetX),
    labelOffsetY: clampLabelOffset(box.labelOffsetY)
  };
}

export function hydraulicsBoxHandlePoint(
  box: Pick<ResolvedHydraulicsBox, "x" | "y" | "width" | "height">,
  handle: HydraulicsBoxResizeHandle
): { x: number; y: number } {
  const flags = boxResizeFlags(handle);
  return {
    x: flags.moveE ? box.x + box.width / 2 : flags.moveW ? box.x - box.width / 2 : box.x,
    y: flags.moveN ? box.y - box.height / 2 : flags.moveS ? box.y + box.height / 2 : box.y
  };
}

export function resizeHydraulicsBox(
  box: ResolvedHydraulicsBox,
  handle: HydraulicsBoxResizeHandle,
  point: { x: number; y: number }
): ResolvedHydraulicsBox {
  const flags = boxResizeFlags(handle);
  let left = box.x - box.width / 2;
  let right = box.x + box.width / 2;
  let top = box.y - box.height / 2;
  let bottom = box.y + box.height / 2;
  const snapped = snapHydraulicsPoint(point);

  if (flags.moveE) {
    right = snapEvenSpanEdge(left, snapped.x, "x", "end");
  }
  if (flags.moveW) {
    left = snapEvenSpanEdge(right, snapped.x, "x", "start");
  }
  if (flags.moveS) {
    bottom = snapEvenSpanEdge(top, snapped.y, "y", "end");
  }
  if (flags.moveN) {
    top = snapEvenSpanEdge(bottom, snapped.y, "y", "start");
  }

  return {
    ...box,
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top
  };
}

function boxResizeFlags(handle: HydraulicsBoxResizeHandle): {
  moveN: boolean;
  moveE: boolean;
  moveS: boolean;
  moveW: boolean;
} {
  return {
    moveN: handle === "n" || handle === "ne" || handle === "nw",
    moveE: handle === "e" || handle === "ne" || handle === "se",
    moveS: handle === "s" || handle === "se" || handle === "sw",
    moveW: handle === "w" || handle === "nw" || handle === "sw"
  };
}

function snapEvenSpanEdge(
  fixed: number,
  proposed: number,
  axis: "x" | "y",
  side: "start" | "end"
): number {
  const minSpan = hydraulicsGridToUnit(HYDRAULICS_BOX_MIN_GRID, axis);
  let edge = snapHydraulicsUnit(proposed, axis);
  if (side === "end") {
    edge = Math.min(1, Math.max(fixed + minSpan, edge));
  } else {
    edge = Math.max(0, Math.min(fixed - minSpan, edge));
  }
  let cells = Math.max(HYDRAULICS_BOX_MIN_GRID, hydraulicsUnitToGrid(Math.abs(edge - fixed), axis));
  if (cells % 2 !== 0) {
    cells += 1;
  }
  const span = hydraulicsGridToUnit(cells, axis);
  if (side === "end") {
    return Math.min(1, fixed + span);
  }
  return Math.max(0, fixed - span);
}

function seedSectors(transactionMatrix: MatrixCell | null): HydraulicsSectorLayout[] {
  if (!transactionMatrix) {
    return [];
  }

  const sumColumnIndex = findSumColumnIndex(transactionMatrix.columns);
  const sectors: HydraulicsSectorLayout[] = [];
  const seenLabels = new Set<string>();

  transactionMatrix.columns.forEach((column, index) => {
    if (index === sumColumnIndex || !column.trim()) {
      return;
    }
    const sectorLabel = (transactionMatrix.sectors?.[index]?.trim() || column).trim();
    if (!sectorLabel || isCentralBankLabel(sectorLabel) || isCentralBankLabel(column)) {
      return;
    }
    const labelKey = sectorLabel.toLowerCase();
    if (seenLabels.has(labelKey)) {
      return;
    }
    seenLabels.add(labelKey);
    sectors.push({
      id: column.trim(),
      label: sectorLabel,
      x: Math.round(HYDRAULICS_GRID_COLS / 2),
      y: HYDRAULICS_SECTOR_GRID_Y
    });
  });

  return sectors.map((sector, order) => ({
    ...sector,
    x: Math.round(((order + 1) / (sectors.length + 1)) * HYDRAULICS_GRID_COLS)
  }));
}

function seedTanks(
  balanceMatrix: MatrixCell | null,
  sectors: HydraulicsSectorLayout[]
): HydraulicsTankLayout[] {
  if (!balanceMatrix) {
    return [];
  }

  const sumColumnIndex = findSumColumnIndex(balanceMatrix.columns);
  const tanks: HydraulicsTankLayout[] = [];
  const seen = new Set<string>();

  balanceMatrix.rows.forEach((row) => {
    if (row.label.trim().toLowerCase() === "sum") {
      return;
    }

    row.values.forEach((source, columnIndex) => {
      if (columnIndex === sumColumnIndex) {
        return;
      }

      const variableName = extractStockVariable(source);
      if (!variableName) {
        return;
      }

      const numericValue = source.trim().startsWith("-") ? -1 : 1;
      const role = classifyMatrixStockRole(row.label, source, numericValue);
      if (role === "equity" || role == null) {
        return;
      }

      const sectorId = resolveSectorId(
        sectors,
        balanceMatrix.columns[columnIndex] ?? "",
        balanceMatrix.sectors?.[columnIndex]
      );
      if (!sectorId) {
        return;
      }

      if (seen.has(variableName)) {
        return;
      }
      seen.add(variableName);
      tanks.push({
        id: variableName,
        sectorId,
        variable: variableName,
        polarity: role === "liability" ? "liability" : "asset",
        x: 0,
        y: HYDRAULICS_TANK_GRID_Y
      });
    });
  });

  placeTanksUnderSectors(tanks, sectors);
  return tanks;
}

function seedPipes(
  transactionMatrix: MatrixCell | null,
  sectors: HydraulicsSectorLayout[]
): HydraulicsPipeLayout[] {
  if (!transactionMatrix) {
    return [];
  }

  const sectorIds = new Set(sectors.map((sector) => sector.id));
  const diagram = buildSequenceDiagramFromMatrix(transactionMatrix, null, 0);
  const pipes: HydraulicsPipeLayout[] = [];
  const usedIds = new Set<string>();

  diagram.steps.forEach((step, index) => {
    if (step.type !== "message") {
      return;
    }
    if (!sectorIds.has(step.senderId) || !sectorIds.has(step.receiverId)) {
      return;
    }

    const expression = stripLeadingSign(step.targetExpression || step.sourceExpression || "");
    if (!expression || isStockChangeExpression(expression)) {
      return;
    }

    const id = uniquePipeId(expression, step.label, usedIds, index);
    pipes.push({
      id,
      from: { kind: "sector", id: step.senderId },
      to: { kind: "sector", id: step.receiverId },
      variable: isPlainVariable(expression) ? expression : undefined,
      expression: isPlainVariable(expression) ? undefined : expression,
      label: step.label.split("(")[0]?.trim() || id
    });
  });

  return pipes;
}

function uniquePipeId(expression: string, label: string, usedIds: Set<string>, index: number): string {
  const preferred = preferredPipeId(expression, label) || `pipe-${index + 1}`;
  let id = preferred;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${preferred}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function preferredPipeId(expression: string, label: string): string {
  if (isPlainVariable(expression)) {
    return expression === "TX" ? "T" : expression;
  }
  if (/lag\(\s*r\s*\)/i.test(expression) && /lag\(\s*Bh\s*\)/i.test(expression)) {
    return "rBh";
  }
  return slugify(label.split("(")[0]?.trim() || expression);
}

function placeTanksUnderSectors(
  tanks: HydraulicsTankLayout[],
  sectors: HydraulicsSectorLayout[]
): void {
  const sectorX = new Map(sectors.map((sector) => [sector.id, sector.x]));
  const grouped = new Map<string, HydraulicsTankLayout[]>();
  tanks.forEach((tank) => {
    const group = grouped.get(tank.sectorId) ?? [];
    group.push(tank);
    grouped.set(tank.sectorId, group);
  });

  for (const [sectorId, group] of grouped) {
    const center = sectorX.get(sectorId) ?? Math.round(HYDRAULICS_GRID_COLS / 2);
    group.forEach((tank, index) => {
      const offset = Math.round((index - (group.length - 1) / 2) * (HYDRAULICS_TANK_GRID_WIDTH + 2));
      tank.x = Math.max(0, Math.min(HYDRAULICS_GRID_COLS, center + offset));
      tank.y = HYDRAULICS_TANK_GRID_Y;
    });
  }
}

function extractStockVariable(source: string): string | null {
  const match = source.trim().match(/^[+-]?\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match || match[1] === "0") {
    return null;
  }
  return match[1] ?? null;
}

function resolveSectorId(
  sectors: HydraulicsSectorLayout[],
  column: string,
  sectorLabel: string | undefined
): string | null {
  const candidates = [column.trim(), sectorLabel?.trim() ?? ""].filter(Boolean);
  for (const candidate of candidates) {
    const exact = sectors.find(
      (sector) =>
        sector.id.toLowerCase() === candidate.toLowerCase() ||
        (sector.label ?? "").toLowerCase() === candidate.toLowerCase()
    );
    if (exact) {
      return exact.id;
    }
  }

  for (const candidate of candidates) {
    const partial = sectors.find((sector) => {
      const haystacks = [sector.id, sector.label ?? ""];
      return haystacks.some(
        (haystack) =>
          haystack.toLowerCase().includes(candidate.toLowerCase()) ||
          candidate.toLowerCase().includes(haystack.toLowerCase())
      );
    });
    if (partial) {
      return partial.id;
    }
  }

  return null;
}

function maxAbsOverRun(expression: string, result: SimulationResult | null): number {
  if (!result) {
    return 0;
  }
  const periodCount = Math.max(
    result.options.periods,
    ...Object.values(result.series).map((values) => values.length)
  );
  let maxAbs = 0;
  for (let period = 0; period < periodCount; period += 1) {
    const value = evaluateMatrixEntryAtPeriod(expression, result, period);
    if (value != null && Number.isFinite(value)) {
      maxAbs = Math.max(maxAbs, Math.abs(value));
    }
  }
  return maxAbs;
}

function inferPolarityFromValue(value: number | null): HydraulicsPolarity {
  return value != null && value < 0 ? "liability" : "asset";
}

function defaultTankColor(polarity: HydraulicsPolarity, index: number): string {
  if (polarity === "liability") {
    return LIABILITY_COLOR;
  }
  return ASSET_COLORS[index % ASSET_COLORS.length] ?? ASSET_COLORS[0];
}

function isStockChangeExpression(expression: string): boolean {
  const compact = expression.replace(/\s+/g, "");
  if (/\bd\s*\(/i.test(expression)) {
    return true;
  }
  return /\(?([A-Za-z_][A-Za-z0-9_]*)-lag\(\1\)\)?/i.test(compact);
}

function isPlainVariable(expression: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression.trim());
}

function stripLeadingSign(source: string): string {
  return source.trim().replace(/^[+-]\s*/, "");
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "pipe";
}

function isCentralBankLabel(value: string): boolean {
  return /central\s*bank|\bcb\b/i.test(value.trim());
}

function findSumColumnIndex(columns: string[]): number {
  return columns.findIndex((column) => column.trim().toLowerCase() === "sum");
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

export function resolvePipeStyle(pipe: Pick<
  HydraulicsPipeLayout,
  "color" | "arrowSize" | "widthScale" | "dashed" | "tokenCount" | "opacity"
>): {
  color: string;
  arrowSize: number;
  widthScale: number;
  dashed: boolean;
  tokenCount: number;
  opacity: number;
} {
  return {
    color: pipe.color?.trim() || DEFAULT_PIPE_COLOR,
    arrowSize: clampRange(pipe.arrowSize, 0, 24, DEFAULT_PIPE_ARROW_SIZE),
    widthScale: clampRange(pipe.widthScale, 0, 4, DEFAULT_PIPE_WIDTH_SCALE),
    dashed: pipe.dashed === true,
    tokenCount: Math.round(clampRange(pipe.tokenCount, 0, 8, DEFAULT_PIPE_TOKEN_COUNT)),
    opacity: clampRange(pipe.opacity, 0, 1, DEFAULT_PIPE_OPACITY)
  };
}

export function formatHydraulicsTankValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(1)}k`;
  }
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  if (abs === 0) {
    return "0";
  }
  return value.toFixed(2);
}

function clampOptionalUnit(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function clampTankMaxLevel(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function snapHydraulicsLabelOffsetCells(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const snapped =
    Math.round(value / HYDRAULICS_LABEL_OFFSET_STEP) * HYDRAULICS_LABEL_OFFSET_STEP;
  const clamped = Math.min(HYDRAULICS_LABEL_OFFSET_MAX, Math.max(-HYDRAULICS_LABEL_OFFSET_MAX, snapped));
  return clamped === 0 ? 0 : clamped;
}

function clampLabelOffset(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return snapHydraulicsLabelOffsetCells(value);
}

function clampRange(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function mergeById<T extends { id: string }>(seeded: T[], authored: T[]): T[] {
  const merged = new Map<string, T>();
  seeded.forEach((item) => merged.set(item.id, item));
  authored.forEach((item) => {
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? { ...existing, ...item } : item);
  });
  return [...merged.values()];
}
