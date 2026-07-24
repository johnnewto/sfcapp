import { normalizeAccountingMatrixKindInput, normalizeMatrixCellAccountingKind } from "../accountingMatrixKind";
import { inferMatrixRowRoleFromLabels, normalizeMatrixRowRole } from "../matrixRowRole";
import { parseMatrixColumnBadges } from "../matrixAccountColumns";
import { parseMatrixColumnTree } from "../matrixColumnTree";
import {
  assertCompactRowPresent,
  buildCompactRowComment,
  isRowComment,
  parseCompactRowComment
} from "../rowComments";
import type {
  ChartAxisRange,
  ChartSeriesSpec,
  EquationListItem,
  EquationRow,
  ExogenizeEntry,
  ExternalListItem,
  ExternalRow,
  InitialValueListItem,
  InitialValueRow,
  NotebookCell,
  NotebookDocument
} from "../types";
import { NOTEBOOK_CELL_TYPES } from "./documentTypes";
import { isRecord, numberValue, slugifyIdentifier, stringArray, stringValue } from "./documentUtils";

export function generatedCompactModelId(document: NotebookDocument): string {
  return document.metadata.template ?? slugifyIdentifier(document.id.replace(/-?notebook$/i, "")) ?? "main";
}

/**
 * Normalize a run cell's exogenize input into the canonical `ExogenizeEntry[]`
 * form. Supports an authoring-only shorthand where `exogenize` is a flat list of
 * variable names paired with a sibling `throughPeriod` array (or single scalar):
 *
 *   exogenize: [Lpc, Lp_en, ..., oph, opf]
 *   throughPeriod: [25, 25, ...]
 *
 * `throughPeriod[i]` windows `exogenize[i]` to periods `1..throughPeriod[i]`. A
 * `null` entry, or a name with no matching `throughPeriod` index (shorter array),
 * stays pinned for the whole run (a bare string). A scalar `throughPeriod`
 * applies to every listed name. The sibling `throughPeriod` field is consumed and
 * dropped so the resulting cell matches the notebook schema.
 */
export function normalizeRunCellExogenize(cell: NotebookCell): NotebookCell {
  if (cell.type !== "run") {
    return cell;
  }
  const raw = cell as unknown as Record<string, unknown>;
  if (!("throughPeriod" in raw)) {
    return cell;
  }
  const { throughPeriod, exogenize, ...rest } = raw;
  const names = Array.isArray(exogenize) ? exogenize : [];
  const windows = resolveThroughPeriodWindows(throughPeriod, names.length);
  const entries: ExogenizeEntry[] = names.map((name, index) => {
    if (name !== null && typeof name === "object") {
      return name as ExogenizeEntry;
    }
    const variable = String(name);
    const window = windows[index];
    return typeof window === "number" ? { name: variable, throughPeriod: window } : variable;
  });
  return (entries.length > 0 ? { ...rest, exogenize: entries } : rest) as unknown as NotebookCell;
}

function resolveThroughPeriodWindows(throughPeriod: unknown, length: number): Array<number | undefined> {
  if (typeof throughPeriod === "number") {
    return Array.from({ length }, () => throughPeriod);
  }
  if (!Array.isArray(throughPeriod)) {
    return Array.from({ length }, () => undefined);
  }
  return Array.from({ length }, (_unused, index) => {
    const value = throughPeriod[index];
    return typeof value === "number" ? value : undefined;
  });
}

export function buildCompactEquationListRow(item: EquationListItem, index: number): unknown {
  if (isRowComment(item)) {
    return buildCompactRowComment(item);
  }
  return buildCompactEquationRow(item, index);
}

function buildCompactEquationRow(equation: EquationRow, index: number): unknown[] {
  const unit = formatCompactUnit(equation.unitMeta);
  const type = equation.unitMeta?.stockFlow;
  const row = [equation.name, equation.expression, equation.desc, unit, type, equation.role];
  while (row.length > 2 && row[row.length - 1] == null) {
    row.pop();
  }
  const normalized = row.map((value) => value ?? "");
  const fallbackId = `eq-${index}-${slugifyIdentifier(equation.name)}`;
  if (equation.id === fallbackId) {
    return normalized;
  }
  while (normalized.length < 6) {
    normalized.push("");
  }
  return [...normalized, equation.id];
}

export function buildCompactExternalListRow(item: ExternalListItem, index: number): unknown {
  if (isRowComment(item)) {
    return buildCompactRowComment(item);
  }
  return buildCompactExternalRow(item, index);
}

function buildCompactExternalRow(external: ExternalRow, index: number): unknown[] | Record<string, unknown> {
  if (external.kind !== "constant") {
    const fallbackId = `ext-${index}-${slugifyIdentifier(external.name)}`;
    return {
      ...(external.id === fallbackId ? {} : { id: external.id }),
      name: external.name,
      kind: external.kind,
      ...(external.observed ? { observed: true } : {}),
      ...(external.desc ? { desc: external.desc } : {}),
      valueText: external.valueText,
      ...compactUnitFields(external.unitMeta)
    };
  }

  const unit = formatCompactUnit(external.unitMeta);
  const type = external.unitMeta?.stockFlow;
  const row = [external.name, scalarFromValueText(external.valueText), external.desc, unit, type];
  while (row.length > 2 && row[row.length - 1] == null) {
    row.pop();
  }
  const normalized = row.map((value) => value ?? "");
  const fallbackId = `ext-${index}-${slugifyIdentifier(external.name)}`;
  if (external.id === fallbackId) {
    return normalized;
  }
  while (normalized.length < 5) {
    normalized.push("");
  }
  return [...normalized, external.id];
}

export function buildCompactInitialValueListRow(item: InitialValueListItem, index: number): unknown {
  if (isRowComment(item)) {
    return buildCompactRowComment(item);
  }
  return buildCompactInitialValueRow(item, index);
}

function buildCompactInitialValueRow(initialValue: InitialValueRow, index: number): unknown {
  const fallbackId = `init-${index}-${slugifyIdentifier(initialValue.name)}`;
  const row: unknown[] = [initialValue.name, scalarFromValueText(initialValue.valueText)];
  if (initialValue.desc?.trim()) {
    row.push(initialValue.desc);
  }
  if (initialValue.id !== fallbackId) {
    row.push(initialValue.id);
  }
  if (initialValue.enabled === false) {
    row.push(false);
  }
  return row;
}

function compactUnitFields(unitMeta: EquationRow["unitMeta"]): Record<string, unknown> {
  if (!unitMeta) {
    return {};
  }
  const unit = formatCompactUnit(unitMeta);
  return {
    ...(unit ? { unit } : { unitMeta }),
    ...(unitMeta.stockFlow ? { type: unitMeta.stockFlow } : {})
  };
}

export function buildCompactSolverDescriptor(options: Extract<NotebookCell, { type: "solver" }>["options"]): Record<string, unknown> {
  return {
    ...(options.periods == null ? {} : { periods: options.periods }),
    method: options.solverMethod.toLowerCase().replace(/_/g, "-"),
    tolerance: options.toleranceText,
    maxIterations: options.maxIterations,
    defaultInitialValue: options.defaultInitialValueText,
    hiddenLeftVariable: options.hiddenLeftVariable,
    hiddenRightVariable: options.hiddenRightVariable,
    hiddenTolerance: options.hiddenToleranceText,
    relativeHiddenTolerance: options.relativeHiddenTolerance
  };
}

export function buildCompactMatrixDescriptor(
  cell: Extract<NotebookCell, { type: "matrix" }>,
  options: { fallbackId: string; preserveIds: boolean }
): Record<string, unknown> {
  return {
    ...(options.preserveIds ? { id: cell.id } : {}),
    title: cell.title,
    ...(cell.description ? { description: cell.description } : {}),
    ...(cell.note ? { note: cell.note } : {}),
    ...(cell.more ? { more: cell.more } : {}),
    columns: cell.columns,
    ...(cell.sectors ? { sectors: cell.sectors } : {}),
    ...(cell.columnBadges ? { columnBadges: cell.columnBadges } : {}),
    ...(cell.variables ? { variables: cell.variables } : {}),
    ...(cell.columnTree ? { columnTree: cell.columnTree } : {}),
    ...(cell.accountingKind ? { accountingKind: cell.accountingKind } : {}),
    rows: cell.rows.map((row) =>
      row.band != null
        ? [row.band, row.label, ...row.values]
        : row.role == null
          ? { label: row.label, values: row.values }
          : { label: row.label, role: row.role, values: row.values }
    )
  };
}

export function buildCompactChartDescriptor(
  cell: Extract<NotebookCell, { type: "chart" }>,
  options: { fallbackId: string; preserveIds: boolean }
): Record<string, unknown> {
  return {
    ...(options.preserveIds ? { id: cell.id } : {}),
    title: cell.title,
    ...(cell.description ? { description: cell.description } : {}),
    ...(cell.note ? { note: cell.note } : {}),
    ...(cell.more ? { more: cell.more } : {}),
    ...(cell.variables && cell.variables.length > 0 ? { variables: cell.variables } : {}),
    ...(cell.series && cell.series.length > 0 ? { series: cell.series } : {}),
    ...(cell.axisMode ? { axisMode: cell.axisMode } : {}),
    ...(cell.axisGroups && cell.axisGroups.length > 0 ? { axisGroups: cell.axisGroups } : {}),
    ...(cell.axisSnapTolarance == null ? {} : { axisSnapTolarance: cell.axisSnapTolarance }),
    ...(cell.niceScale == null ? {} : { niceScale: cell.niceScale }),
    ...(cell.compareMode ? { compareMode: cell.compareMode } : {}),
    ...(cell.referenceTrace ? { referenceTrace: cell.referenceTrace } : {}),
    ...(cell.showScenarioShocks === false || cell.showScenarioShocks === true || cell.showScenarioShocks === "auto"
      ? { showScenarioShocks: cell.showScenarioShocks }
      : {}),
    ...(cell.yAxisTickCount == null ? {} : { yAxisTickCount: cell.yAxisTickCount }),
    ...(cell.axisFontSize == null ? {} : { axisFontSize: cell.axisFontSize }),
    ...(cell.sharedRange ? { sharedRange: cell.sharedRange } : {}),
    ...(cell.showMcBands === true ? { showMcBands: true } : {}),
    ...(cell.seriesRanges ? { seriesRanges: cell.seriesRanges } : {}),
    ...(cell.timeRangeInclusive ? { timeRangeInclusive: cell.timeRangeInclusive } : {})
  };
}

export function buildCompactTableDescriptor(
  cell: Extract<NotebookCell, { type: "table" }>,
  options: { fallbackId: string; preserveIds: boolean }
): Record<string, unknown> {
  return {
    ...(options.preserveIds ? { id: cell.id } : {}),
    title: cell.title,
    ...(cell.note ? { note: cell.note } : {}),
    ...(cell.description ? { description: cell.description } : {}),
    ...(cell.more ? { more: cell.more } : {}),
    variables: cell.variables
  };
}

export function rewriteCompactReferences(value: unknown, idMap: Map<string, string>, modelIdMap: Map<string, string>, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "type") {
      return value;
    }
    if ((key === "modelId" || key === "sourceModelId") && modelIdMap.has(value)) {
      return modelIdMap.get(value);
    }
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteCompactReferences(entry, idMap, modelIdMap));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, rewriteCompactReferences(entry, idMap, modelIdMap, entryKey)]));
}

function scalarFromValueText(valueText: string): string | number | boolean {
  if (valueText === "true") {
    return true;
  }
  if (valueText === "false") {
    return false;
  }
  const number = Number(valueText);
  return Number.isFinite(number) && String(number) === valueText.trim() ? number : valueText;
}

function formatCompactUnit(unitMeta: EquationRow["unitMeta"]): string | undefined {
  const signature = compactUnitSignature(unitMeta);
  if (!signature) {
    return undefined;
  }
  if (Object.keys(signature).length === 0) return "1";
  if (compactUnitMatches(signature, { money: 1, time: -1 })) return "$/year";
  if (compactUnitMatches(signature, { money: 1 })) return "$";
  if (compactUnitMatches(signature, { time: -1 })) return "1/year";
  if (compactUnitMatches(signature, { items: 1, time: -1 })) return "items/year";
  if (compactUnitMatches(signature, { items: 1 })) return "items";
  if (compactUnitMatches(signature, { mass: 1, time: -1 })) return "kg/year";
  if (compactUnitMatches(signature, { mass: 1 })) return "kg";
  if (compactUnitMatches(signature, { energy: 1, time: -1 })) return "J/year";
  if (compactUnitMatches(signature, { energy: 1 })) return "J";
  if (compactUnitMatches(signature, { pp: 1, time: -1 })) return "pp/year";
  if (compactUnitMatches(signature, { pp: 1 })) return "pp";
  if (compactUnitMatches(signature, { carbon: 1, time: -1 })) return "°C/year";
  if (compactUnitMatches(signature, { carbon: 1 })) return "°C";
  if (compactUnitMatches(signature, { money: 1, items: -1 })) return "$/item";
  if (compactUnitMatches(signature, { money: 1, mass: -1 })) return "$/kg";
  if (compactUnitMatches(signature, { money: 1, energy: -1 })) return "$/J";
  if (compactUnitMatches(signature, { money: 1, pp: -1 })) return "$/pp";
  if (compactUnitMatches(signature, { money: 1, carbon: -1 })) return "$/°C";
  if (compactUnitMatches(signature, { time: 1 })) return "year";
  return undefined;
}

function compactUnitMatches(
  signature: Record<string, number>,
  expected: Partial<Record<"money" | "items" | "mass" | "energy" | "pp" | "carbon" | "time", number>>
): boolean {
  const keys = ["money", "items", "mass", "energy", "pp", "carbon", "time"] as const;
  for (const key of keys) {
    const value = signature[key];
    const wanted = expected[key];
    if (wanted === undefined) {
      if (value != null) {
        return false;
      }
    } else if (value !== wanted) {
      return false;
    }
  }
  return true;
}

function compactUnitSignature(unitMeta: unknown): Record<string, number> | undefined {
  if (!isRecord(unitMeta)) {
    return undefined;
  }
  if (isRecord(unitMeta.signature)) {
    return Object.fromEntries(Object.entries(unitMeta.signature).filter(([, value]) => typeof value === "number")) as Record<string, number>;
  }
  const units = isRecord(unitMeta.units) ? unitMeta.units : undefined;
  if (!units) {
    return undefined;
  }
  return {
    ...(typeof units.$ === "number" ? { money: units.$ } : {}),
    ...(typeof units.money === "number" ? { money: units.money } : {}),
    ...(typeof units.yr === "number" ? { time: units.yr } : {}),
    ...(typeof units.time === "number" ? { time: units.time } : {}),
    ...(typeof units.items === "number" ? { items: units.items } : {}),
    ...(typeof units.kg === "number" ? { mass: units.kg } : {}),
    ...(typeof units.mass === "number" ? { mass: units.mass } : {}),
    ...(typeof units.J === "number" ? { energy: units.J } : {}),
    ...(typeof units.energy === "number" ? { energy: units.energy } : {}),
    ...(typeof units.pp === "number" ? { pp: units.pp } : {}),
    ...(typeof units["°C"] === "number" ? { carbon: units["°C"] } : {}),
    ...(typeof units.carbon === "number" ? { carbon: units.carbon } : {})
  };
}

export function isNotebookCellType(value: string): value is NotebookCell["type"] {
  return NOTEBOOK_CELL_TYPES.has(value as NotebookCell["type"]);
}

export function compactCellId(input: unknown, fallback: string): string {
  return isRecord(input) && typeof input.id === "string" ? input.id : fallback;
}

export function compactCellTitle(input: unknown, fallback: string): string {
  return isRecord(input) && typeof input.title === "string" ? input.title : fallback;
}

export function compactCellFlags(input: unknown): Pick<NotebookCell, "collapsed" | "description" | "note" | "more"> {
  if (!isRecord(input)) {
    return {};
  }
  return {
    ...(typeof input.collapsed === "boolean" ? { collapsed: input.collapsed } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
    ...(typeof input.more === "string" ? { more: input.more } : {})
  };
}

export function orderCompactCells(cells: NotebookCell[], cellOrder: unknown): NotebookCell[] {
  if (!Array.isArray(cellOrder)) {
    return cells;
  }
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const orderedIds = new Set<string>();
  const orderedCells = cellOrder.flatMap((entry) => {
    const id = String(entry);
    const cell = cellsById.get(id);
    if (!cell) {
      return [];
    }
    orderedIds.add(id);
    return [cell];
  });
  return [...orderedCells, ...cells.filter((cell) => !orderedIds.has(cell.id))];
}

export function parseCompactEquations(source: string, variables: unknown): Extract<NotebookCell, { type: "equations" }>["equations"] {
  const variableMeta = isRecord(variables) ? variables : {};
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const match = line.match(/^([A-Za-z_][\w^{}.]*)\s*(?:~|=)\s*(.+)$/);
      if (!match) {
        throw new Error(`Invalid compact equation line: ${line}`);
      }

      const name = match[1];
      const meta = isRecord(variableMeta[name]) ? variableMeta[name] : {};
      return {
        id: `eq-${index}-${slugifyIdentifier(name)}`,
        name,
        ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
        expression: match[2].trim(),
        ...(resolveEquationRole(meta) ? { role: resolveEquationRole(meta) } : {}),
        ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
      };
    });
}

export function parseCompactEquationRows(rows: unknown[], variables: unknown): EquationListItem[] {
  const variableMeta = isRecord(variables) ? variables : {};
  return rows.map((row, index) => {
    assertCompactRowPresent(row, index, "Equation");
    const comment = parseCompactRowComment(row, index, "eq-comment");
    if (comment) {
      return comment;
    }

    if (Array.isArray(row)) {
      const [rawName, rawExpression, rawDescription, rawUnit, rawType, rawRole, rawId] = row;
      const name = stringValue(rawName, "");
      const meta = {
        ...(isRecord(variableMeta[name]) ? variableMeta[name] : {}),
        ...(rawDescription == null || rawDescription === "" ? {} : { description: String(rawDescription) }),
        ...(rawUnit == null || rawUnit === "" ? {} : { unit: String(rawUnit) }),
        ...(rawType == null || rawType === "" ? {} : { type: String(rawType) }),
        ...(rawRole == null || rawRole === "" ? {} : { role: String(rawRole) })
      };
      return {
        id: stringValue(rawId, `eq-${index}-${slugifyIdentifier(name)}`),
        name,
        ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
        expression: stringValue(rawExpression, "").trim(),
        ...(resolveEquationRole(meta) ? { role: resolveEquationRole(meta) } : {}),
        ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
      };
    }

    if (isRecord(row)) {
      const name = stringValue(row.name, "");
      const meta = {
        ...(isRecord(variableMeta[name]) ? variableMeta[name] : {}),
        ...(typeof row.desc === "string" ? { description: row.desc } : {}),
        ...(typeof row.description === "string" ? { description: row.description } : {}),
        ...(row.unit == null ? {} : { unit: String(row.unit) }),
        ...(row.type == null ? {} : { type: String(row.type) }),
        ...(row.role == null ? {} : { role: String(row.role) }),
        ...(isRecord(row.unitMeta) ? { unitMeta: row.unitMeta } : {})
      };
      return {
        id: stringValue(row.id, `eq-${index}-${slugifyIdentifier(name)}`),
        name,
        ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
        expression: stringValue(row.expr ?? row.expression, "").trim(),
        ...(resolveEquationRole(meta) ? { role: resolveEquationRole(meta) } : {}),
        ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
      };
    }

    throw new Error("Compact equation rows must be arrays or row objects.");
  });
}

export function buildCompactParameters(parameters: unknown, variables: unknown): Extract<NotebookCell, { type: "externals" }>["externals"] {
  if (!isRecord(parameters)) {
    return [];
  }

  const variableMeta = isRecord(variables) ? variables : {};
  return Object.entries(parameters).map(([name, value], index) => {
    const meta = isRecord(variableMeta[name]) ? variableMeta[name] : {};
    return {
      id: `ext-${index}-${slugifyIdentifier(name)}`,
      name,
      ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
      kind: "constant",
      valueText: String(value),
      ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
    };
  });
}

export function parseCompactExternalRows(rows: unknown[], variables: unknown): ExternalListItem[] {
  const variableMeta = isRecord(variables) ? variables : {};
  return rows.map((row, index) => {
    assertCompactRowPresent(row, index, "External");
    const comment = parseCompactRowComment(row, index, "ext-comment");
    if (comment) {
      return comment;
    }

    if (Array.isArray(row)) {
      const [rawName, rawValue, rawDescription, rawUnit, rawType, rawId] = row;
      const name = stringValue(rawName, "");
      const meta = {
        ...(isRecord(variableMeta[name]) ? variableMeta[name] : {}),
        ...(rawDescription == null || rawDescription === "" ? {} : { description: String(rawDescription) }),
        ...(rawUnit == null || rawUnit === "" ? {} : { unit: String(rawUnit) }),
        ...(rawType == null || rawType === "" ? {} : { type: String(rawType) })
      };
      return {
        id: stringValue(rawId, `ext-${index}-${slugifyIdentifier(name)}`),
        name,
        ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
        kind: "constant",
        valueText: String(rawValue),
        ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
      };
    }

    if (isRecord(row)) {
      const name = stringValue(row.name, "");
      const meta = {
        ...(isRecord(variableMeta[name]) ? variableMeta[name] : {}),
        ...(typeof row.desc === "string" ? { description: row.desc } : {}),
        ...(typeof row.description === "string" ? { description: row.description } : {}),
        ...(row.unit == null ? {} : { unit: String(row.unit) }),
        ...(row.type == null ? {} : { type: String(row.type) }),
        ...(isRecord(row.unitMeta) ? { unitMeta: row.unitMeta } : {})
      };
      return {
        id: stringValue(row.id, `ext-${index}-${slugifyIdentifier(name)}`),
        name,
        ...(typeof meta.description === "string" ? { desc: meta.description } : {}),
        kind: row.kind === "series" ? "series" : row.kind === "coefficient" ? "coefficient" : "constant",
        valueText: stringValue(row.value ?? row.valueText, ""),
        ...(row.observed === true ? { observed: true } : {}),
        ...(buildUnitMeta(meta) ? { unitMeta: buildUnitMeta(meta) } : {})
      };
    }

    throw new Error("Compact external rows must be arrays or row objects.");
  });
}

export function buildCompactInitialValues(initialValues: unknown): Extract<NotebookCell, { type: "initial-values" }>["initialValues"] {
  if (!isRecord(initialValues)) {
    return [];
  }

  return Object.entries(initialValues).map(([name, value], index) => ({
    id: `init-${index}-${slugifyIdentifier(name)}`,
    name,
    valueText: String(value)
  }));
}

const COMPACT_STOCK_FLOW_TOKENS = new Set(["stock", "flow", "aux"]);

function isCompactStockFlowToken(value: unknown): boolean {
  return COMPACT_STOCK_FLOW_TOKENS.has(stringValue(value, "").trim().toLowerCase());
}

function parseCompactInitialValueArrayRow(row: unknown[], index: number): InitialValueRow {
  const [rawName, rawValue, ...rest] = row;
  const name = stringValue(rawName, "");
  let tail = rest;
  let enabled: boolean | undefined;

  if (rest.length > 0 && typeof rest[rest.length - 1] === "boolean") {
    enabled = rest[rest.length - 1] as boolean;
    tail = rest.slice(0, -1);
  }

  let desc: string | undefined;
  let id: string | undefined;
  if (tail.length === 1) {
    const trailing = tail[0];
    const trailingText = stringValue(trailing, "").trim();
    if (trailingText.startsWith("init-")) {
      id = trailingText;
    } else if (!isCompactStockFlowToken(trailingText)) {
      desc = trailingText;
    }
  } else if (tail.length >= 2) {
    const firstText = stringValue(tail[0], "").trim();
    if (!firstText.startsWith("init-")) {
      desc = firstText;
    }
    const lastText = stringValue(tail[tail.length - 1], "").trim();
    if (
      lastText &&
      !isCompactStockFlowToken(lastText) &&
      (lastText.startsWith("init-") || tail.length === 2)
    ) {
      id = lastText;
    }
  }

  return {
    id: id ?? `init-${index}-${slugifyIdentifier(name)}`,
    name,
    ...(desc?.trim() ? { desc: desc.trim() } : {}),
    valueText: String(rawValue),
    ...(enabled === false ? { enabled: false as const } : {})
  };
}

export function parseCompactInitialValueRows(rows: unknown[]): InitialValueListItem[] {
  return rows.map((row, index) => {
    assertCompactRowPresent(row, index, "Initial value");
    const comment = parseCompactRowComment(row, index, "init-comment");
    if (comment) {
      return comment;
    }

    if (Array.isArray(row)) {
      return parseCompactInitialValueArrayRow(row, index);
    }

    if (isRecord(row)) {
      const name = stringValue(row.name, "");
      return {
        id: stringValue(row.id, `init-${index}-${slugifyIdentifier(name)}`),
        name,
        ...(typeof row.desc === "string" && row.desc.trim()
          ? { desc: row.desc.trim() }
          : typeof row.description === "string" && row.description.trim()
            ? { desc: row.description.trim() }
            : {}),
        valueText: stringValue(row.value ?? row.valueText, ""),
        ...(row.enabled === false ? { enabled: false as const } : {})
      };
    }

    throw new Error("Compact initial-value rows must be arrays or row objects.");
  });
}

export function buildCompactMatrixCell(
  input: unknown,
  options: { fallbackColumns: unknown; id: string; sourceRunCellId?: string; title: string }
): Extract<NotebookCell, { type: "matrix" }> | null {
  if (!isRecord(input)) {
    return null;
  }

  const columns = stringArray(input.columns) ?? stringArray(options.fallbackColumns) ?? [];
  const sectors = stringArray(input.sectors);
  const rows = Array.isArray(input.rows)
    ? input.rows.map((row) => {
        if (Array.isArray(row)) {
          const [band, label, ...values] = row;
          const bandText = String(band);
          const labelText = String(label);
          const role = inferMatrixRowRoleFromLabels(bandText, labelText);
          return {
            band: bandText,
            label: labelText,
            ...(role ? { role } : {}),
            values: values.map((value) => String(value))
          };
        }
        if (isRecord(row)) {
          const band = typeof row.band === "string" ? row.band : undefined;
          const label = stringValue(row.label, "");
          const role = normalizeMatrixRowRole(row.role) ?? inferMatrixRowRoleFromLabels(band, label);
          return {
            ...(band ? { band } : {}),
            label,
            ...(role ? { role } : {}),
            values: stringArray(row.values) ?? []
          };
        }
        throw new Error("Compact matrix rows must be arrays or row objects.");
      })
    : [];

  const accountingKind = normalizeAccountingMatrixKindInput(input.accountingKind);
  const columnTree = parseMatrixColumnTree(input.columnTree);
  const columnBadges = parseMatrixColumnBadges(input.columnBadges);
  const variables = stringArray(input.variables);

  return normalizeMatrixCellAccountingKind({
    id: typeof input.id === "string" ? input.id : options.id,
    type: "matrix",
    title: typeof input.title === "string" ? input.title : options.title,
    ...(options.sourceRunCellId ? { sourceRunCellId: options.sourceRunCellId } : {}),
    ...(accountingKind ? { accountingKind } : {}),
    columns,
    ...(columnTree ? { columnTree } : {}),
    ...(columnBadges ? { columnBadges } : {}),
    ...(variables ? { variables } : {}),
    ...(sectors ? { sectors } : {}),
    rows,
    ...compactCellFlags(input)
  });
}

export function buildCompactSolverOptions(input: unknown): Extract<NotebookCell, { type: "solver" }>["options"] {
  const solver = isRecord(input) ? input : {};
  return {
    ...(solver.periods == null ? {} : { periods: numberValue(solver.periods, 50) }),
    solverMethod: normalizeSolverMethod(solver.method ?? solver.solverMethod),
    toleranceText: stringValue(solver.tolerance ?? solver.toleranceText, "1e-6"),
    maxIterations: numberValue(solver.maxIterations, 200),
    defaultInitialValueText: stringValue(solver.defaultInitialValue ?? solver.defaultInitialValueText, "1e-15"),
    hiddenLeftVariable: stringValue(solver.hiddenLeftVariable, ""),
    hiddenRightVariable: stringValue(solver.hiddenRightVariable, ""),
    hiddenToleranceText: stringValue(solver.hiddenTolerance ?? solver.hiddenToleranceText, "0.00001"),
    relativeHiddenTolerance: Boolean(solver.relativeHiddenTolerance)
  } as Extract<NotebookCell, { type: "solver" }>["options"];
}

export function buildCompactChartCells(charts: unknown, sourceRunCellId: string): Array<Extract<NotebookCell, { type: "chart" }>> {
  if (!Array.isArray(charts)) {
    return [];
  }

  return charts.filter(isRecord).map((chart, index) => {
    const variables = stringArray(chart.variables);
    const series = parseChartSeries(chart.series);
    const axisGroups = parseChartAxisGroups(chart.axisGroups);

    return {
      id: typeof chart.id === "string" ? chart.id : `chart-${index + 1}`,
      type: "chart",
      title: typeof chart.title === "string" ? chart.title : `Chart ${index + 1}`,
      ...compactCellFlags(chart),
      sourceRunCellId,
      ...(variables && variables.length > 0 ? { variables } : {}),
      ...(series && series.length > 0 ? { series } : {}),
      ...(isRecord(chart.sharedRange) ? { sharedRange: chart.sharedRange as Extract<NotebookCell, { type: "chart" }>["sharedRange"] } : {}),
      ...(chart.axisMode === "shared" || chart.axisMode === "separate" ? { axisMode: chart.axisMode } : {}),
      ...(axisGroups && axisGroups.length > 0 ? { axisGroups } : {}),
      ...(typeof chart.axisSnapTolarance === "number" ? { axisSnapTolarance: chart.axisSnapTolarance } : {}),
      ...(typeof chart.niceScale === "boolean" ? { niceScale: chart.niceScale } : {}),
      ...(chart.compareMode === "levels" || chart.compareMode === "relative" || chart.compareMode === "percent"
        ? { compareMode: chart.compareMode }
        : {}),
      ...(chart.referenceTrace === "none" || chart.referenceTrace === "baseline" || chart.referenceTrace === "previous-run" || chart.referenceTrace === "observed" ? { referenceTrace: chart.referenceTrace } : {}),
      ...(chart.showScenarioShocks === false || chart.showScenarioShocks === true || chart.showScenarioShocks === "auto"
        ? { showScenarioShocks: chart.showScenarioShocks }
        : {}),
      ...(typeof chart.yAxisTickCount === "number" ? { yAxisTickCount: chart.yAxisTickCount } : {}),
      ...(typeof chart.axisFontSize === "number" ? { axisFontSize: chart.axisFontSize } : {}),
      ...(chart.showMcBands === true ? { showMcBands: true } : {}),
      ...(isRecord(chart.seriesRanges) ? { seriesRanges: chart.seriesRanges as Extract<NotebookCell, { type: "chart" }>["seriesRanges"] } : {}),
      ...(Array.isArray(chart.timeRangeInclusive) ? { timeRangeInclusive: chart.timeRangeInclusive as [number, number] } : {})
    };
  });
}

function parseChartAxisRange(value: unknown): ChartAxisRange | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const range: ChartAxisRange = {};
  if (typeof value.includeZero === "boolean") {
    range.includeZero = value.includeZero;
  }
  if (typeof value.min === "number") {
    range.min = value.min;
  }
  if (typeof value.max === "number") {
    range.max = value.max;
  }

  return Object.keys(range).length > 0 ? range : undefined;
}

function parseChartAxisGroups(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value.flatMap((group) => {
    const names = stringArray(group);
    if (!names) {
      return [];
    }
    const trimmed = names.map((name) => name.trim()).filter((name) => name !== "");
    return trimmed.length > 0 ? [trimmed] : [];
  });

  return groups.length > 0 ? groups : undefined;
}

function parseChartSeries(value: unknown): ChartSeriesSpec[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const series = value.filter(isRecord).flatMap((entry) => {
    const expression = stringValue(entry.expression, "").trim();
    if (!expression) {
      return [];
    }

    const range = parseChartAxisRange(entry.range);
    return [
      {
        expression,
        ...(typeof entry.label === "string" && entry.label.trim() !== "" ? { label: entry.label } : {}),
        ...(range ? { range } : {}),
        ...(typeof entry.sourceRunCellId === "string" && entry.sourceRunCellId.trim() !== ""
          ? { sourceRunCellId: entry.sourceRunCellId }
          : {})
      }
    ];
  });

  return series.length > 0 ? series : undefined;
}

export function buildCompactTableCells(tables: unknown, sourceRunCellId: string): Array<Extract<NotebookCell, { type: "table" }>> {
  if (!Array.isArray(tables)) {
    return [];
  }

  return tables.filter(isRecord).map((table, index) => ({
    id: typeof table.id === "string" ? table.id : `table-${index + 1}`,
    type: "table",
    title: typeof table.title === "string" ? table.title : `Table ${index + 1}`,
    ...(typeof table.note === "string" ? { note: table.note } : {}),
    ...(typeof table.description === "string" ? { description: table.description } : {}),
    ...(typeof table.more === "string" ? { more: table.more } : {}),
    ...(typeof table.collapsed === "boolean" ? { collapsed: table.collapsed } : {}),
    sourceRunCellId,
    variables: stringArray(table.variables) ?? []
  }));
}

function resolveEquationRole(meta: Record<string, unknown>): EquationRow["role"] | undefined {
  if (typeof meta.role === "string") {
    return meta.role as EquationRow["role"];
  }
  if (meta.type === "stock") {
    return "accumulation";
  }
  if (meta.type === "flow") {
    return "identity";
  }
  return undefined;
}

function buildUnitMeta(meta: Record<string, unknown>): EquationRow["unitMeta"] | undefined {
  const unit = typeof meta.unit === "string" ? meta.unit : undefined;
  const unitMeta = isRecord(meta.unitMeta) ? meta.unitMeta : undefined;
  if (unitMeta) {
    return unitMeta;
  }
  const stockFlow = meta.type === "stock" || meta.type === "flow" || meta.type === "aux" ? meta.type : undefined;
  const trimmedUnit = unit?.trim();
  let signature: Record<string, number> | undefined;
  if (trimmedUnit) {
    signature = parseCompactUnit(trimmedUnit);
  }
  if (!stockFlow && signature === undefined) {
    return undefined;
  }
  return {
    ...(stockFlow ? { stockFlow } : {}),
    ...(signature !== undefined ? { signature } : {})
  };
}

function parseCompactUnit(unit: string): Record<string, number> | undefined {
  const normalized = unit.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "1") {
    return {};
  }
  if (normalized === "$") {
    return { money: 1 };
  }
  if (normalized === "$/year" || normalized === "$/yr") {
    return { money: 1, time: -1 };
  }
  if (normalized === "1/year" || normalized === "1/yr") {
    return { time: -1 };
  }
  if (normalized === "items/year" || normalized === "items/yr") {
    return { items: 1, time: -1 };
  }
  if (normalized === "items") {
    return { items: 1 };
  }
  if (normalized === "kg/year" || normalized === "kg/yr") {
    return { mass: 1, time: -1 };
  }
  if (normalized === "kg") {
    return { mass: 1 };
  }
  if (normalized === "$/item" || normalized === "$/items") {
    return { money: 1, items: -1 };
  }
  if (normalized === "$/kg") {
    return { money: 1, mass: -1 };
  }
  if (normalized === "J/year" || normalized === "J/yr") {
    return { energy: 1, time: -1 };
  }
  if (normalized === "J") {
    return { energy: 1 };
  }
  if (normalized === "pp/year" || normalized === "pp/yr") {
    return { pp: 1, time: -1 };
  }
  if (normalized === "pp") {
    return { pp: 1 };
  }
  if (normalized === "$/J") {
    return { money: 1, energy: -1 };
  }
  if (normalized === "$/pp") {
    return { money: 1, pp: -1 };
  }
  if (normalized === "°C/year" || normalized === "°C/yr") {
    return { carbon: 1, time: -1 };
  }
  if (normalized === "°C") {
    return { carbon: 1 };
  }
  if (normalized === "$/°C") {
    return { money: 1, carbon: -1 };
  }
  if (normalized === "year" || normalized === "yr") {
    return { time: 1 };
  }
  return undefined;
}

function normalizeSolverMethod(value: unknown): "GAUSS_SEIDEL" | "BROYDEN" | "NEWTON" {
  const normalized = typeof value === "string" ? value.toUpperCase().replace(/-/g, "_") : "NEWTON";
  if (normalized === "GAUSS_SEIDEL" || normalized === "BROYDEN" || normalized === "NEWTON") {
    return normalized;
  }
  return "NEWTON";
}
