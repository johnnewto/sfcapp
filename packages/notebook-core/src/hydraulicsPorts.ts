export type HydraulicsBoxSide = "n" | "e" | "s" | "w";
export type HydraulicsBoxCorner = "ne" | "se" | "sw" | "nw";

export type ParsedHydraulicsBoxPort =
  | { kind: "center" }
  | { kind: "corner"; corner: HydraulicsBoxCorner }
  | { kind: "edge"; side: HydraulicsBoxSide; offset: number };

const BOX_SIDES = new Set<HydraulicsBoxSide>(["n", "e", "s", "w"]);
const BOX_CORNERS = new Set<HydraulicsBoxCorner>(["ne", "se", "sw", "nw"]);
const BOX_PORT_OFFSET = /^([nesw])([+-])(\d+)$/;

export function parseHydraulicsBoxPort(value: unknown): ParsedHydraulicsBoxPort | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  if (value === "c") {
    return { kind: "center" };
  }
  if (BOX_CORNERS.has(value as HydraulicsBoxCorner)) {
    return { kind: "corner", corner: value as HydraulicsBoxCorner };
  }
  if (BOX_SIDES.has(value as HydraulicsBoxSide)) {
    return { kind: "edge", side: value as HydraulicsBoxSide, offset: 0 };
  }
  const match = BOX_PORT_OFFSET.exec(value);
  if (!match) {
    return null;
  }
  const offset = Number(`${match[2]}${match[3]}`);
  if (!Number.isInteger(offset) || offset === 0 || offset % 2 !== 0) {
    return null;
  }
  return { kind: "edge", side: match[1] as HydraulicsBoxSide, offset };
}

export function isHydraulicsBoxPort(value: unknown): boolean {
  return parseHydraulicsBoxPort(value) != null;
}

export function formatHydraulicsBoxPort(parsed: ParsedHydraulicsBoxPort): string {
  if (parsed.kind === "center") {
    return "c";
  }
  if (parsed.kind === "corner") {
    return parsed.corner;
  }
  if (parsed.offset === 0) {
    return parsed.side;
  }
  return `${parsed.side}${parsed.offset > 0 ? "+" : ""}${parsed.offset}`;
}

/** Rim ports every 2 cells from each side midpoint, plus center and corners. */
export function hydraulicsBoxPorts(widthCells: number, heightCells: number): string[] {
  const halfW = evenHalf(widthCells);
  const halfH = evenHalf(heightCells);
  const ports = ["c", "n", "ne", "e", "se", "s", "sw", "w", "nw"];
  for (let offset = 2; offset < halfW; offset += 2) {
    ports.push(`n+${offset}`, `n-${offset}`, `s+${offset}`, `s-${offset}`);
  }
  for (let offset = 2; offset < halfH; offset += 2) {
    ports.push(`e+${offset}`, `e-${offset}`, `w+${offset}`, `w-${offset}`);
  }
  return ports;
}

export function canonicalHydraulicsBoxPort(
  port: string,
  widthCells: number,
  heightCells: number
): string | null {
  const parsed = parseHydraulicsBoxPort(port);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "center") {
    return "c";
  }
  if (parsed.kind === "corner") {
    return parsed.corner;
  }
  const half = parsed.side === "n" || parsed.side === "s" ? evenHalf(widthCells) : evenHalf(heightCells);
  const offset = Math.max(-half, Math.min(half, parsed.offset));
  if (offset === 0) {
    return parsed.side;
  }
  if (Math.abs(offset) >= half) {
    return cornerForSide(parsed.side, offset);
  }
  return formatHydraulicsBoxPort({ kind: "edge", side: parsed.side, offset });
}

/** Cell delta from the box center. East is +x, south is +y. */
export function hydraulicsBoxPortCellDelta(
  port: string,
  widthCells: number,
  heightCells: number
): { dx: number; dy: number } | null {
  const parsed = parseHydraulicsBoxPort(port);
  if (!parsed) {
    return null;
  }
  const halfW = evenHalf(widthCells);
  const halfH = evenHalf(heightCells);
  if (parsed.kind === "center") {
    return { dx: 0, dy: 0 };
  }
  if (parsed.kind === "corner") {
    return cornerDelta(parsed.corner, halfW, halfH);
  }
  const max = parsed.side === "n" || parsed.side === "s" ? halfW : halfH;
  const offset = Math.max(-max, Math.min(max, parsed.offset));
  switch (parsed.side) {
    case "n":
      return { dx: offset, dy: -halfH };
    case "s":
      return { dx: offset, dy: halfH };
    case "e":
      return { dx: halfW, dy: offset };
    case "w":
      return { dx: -halfW, dy: offset };
  }
}

function cornerForSide(side: HydraulicsBoxSide, offset: number): HydraulicsBoxCorner {
  const positive = offset > 0;
  switch (side) {
    case "n":
      return positive ? "ne" : "nw";
    case "s":
      return positive ? "se" : "sw";
    case "e":
      return positive ? "se" : "ne";
    case "w":
      return positive ? "sw" : "nw";
  }
}

function cornerDelta(corner: HydraulicsBoxCorner, halfW: number, halfH: number): { dx: number; dy: number } {
  switch (corner) {
    case "ne":
      return { dx: halfW, dy: -halfH };
    case "se":
      return { dx: halfW, dy: halfH };
    case "sw":
      return { dx: -halfW, dy: halfH };
    case "nw":
      return { dx: -halfW, dy: -halfH };
  }
}

function evenHalf(cells: number): number {
  if (!Number.isFinite(cells)) {
    return 1;
  }
  const rounded = Math.max(2, Math.round(Math.abs(cells)));
  const even = rounded % 2 === 0 ? rounded : rounded + 1;
  return even / 2;
}
