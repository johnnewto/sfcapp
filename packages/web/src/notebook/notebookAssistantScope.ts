import { isRowComment } from "@sfcr/notebook-core";

import { getNotebookAssistantToolSyntax, type NotebookAssistantToolRequest } from "./notebookAssistantTools";
import { findEquationsCell, findExternalsCell, findInitialValuesCell } from "./modelSections";
import type { NotebookPatch, NotebookPatchOperation } from "./notebookPatch";
import type { ChartCell, EquationsCell, NotebookDocument } from "./types";

export type NotebookAssistantProposalScopeKind =
  | "global-ask"
  | "chart-update"
  | "equation-update"
  | "equations-cell-ask";

export type NotebookAssistantProposalScope =
  | { kind: "global-ask" }
  | { kind: "chart-update"; cellId: string }
  | {
      kind: "equation-update";
      cellId: string;
      modelId: string;
      variable: string;
    }
  | {
      kind: "equations-cell-ask";
      cellId: string;
      modelId: string;
    };

const GLOBAL_ASK_TOOL_NAMES = [
  "getNotebookSummary",
  "getEquation",
  "getCurrentValues",
  "getSeries",
  "getSeriesWindow",
  "getMatrix",
  "getVariableMetadata",
  "getDependencyGraph",
  "getCausalLoopDiagram",
  "listRuns",
  "listVariables",
  "listCharts"
] as const;

const CHART_UPDATE_TOOL_NAMES = [
  "createUpdateChartVariablesPatch",
  "createUpdateChartOptionsPatch"
] as const;

const CHART_READ_TOOL_NAMES = [
  "listVariables",
  "listRuns",
  "getSeriesWindow",
  "getVariableMetadata",
  "getCurrentValues"
] as const;

const EQUATION_UPDATE_TOOL_NAMES = ["createUpdateEquationPatch"] as const;

const EQUATION_READ_TOOL_NAMES = [
  "getEquation",
  "getDependencyGraph",
  "getVariableMetadata",
  "listVariables"
] as const;

const EQUATIONS_CELL_ASK_TOOL_NAMES = [
  "getEquation",
  "getDependencyGraph",
  "getVariableMetadata",
  "listVariables",
  "getCausalLoopDiagram",
  "getCurrentValues",
  "listRuns"
] as const;

export function getNotebookAssistantScopeKind(scope: NotebookAssistantProposalScope): NotebookAssistantProposalScopeKind {
  return scope.kind;
}

export function getNotebookAssistantScopeToolNames(scope: NotebookAssistantProposalScope): ReadonlySet<string> {
  switch (scope.kind) {
    case "global-ask":
      return new Set(GLOBAL_ASK_TOOL_NAMES);
    case "chart-update":
      return new Set([...CHART_READ_TOOL_NAMES, ...CHART_UPDATE_TOOL_NAMES]);
    case "equation-update":
      return new Set([...EQUATION_READ_TOOL_NAMES, ...EQUATION_UPDATE_TOOL_NAMES]);
    case "equations-cell-ask":
      return new Set(EQUATIONS_CELL_ASK_TOOL_NAMES);
  }
}

export function getNotebookAssistantScopeContract(scope: NotebookAssistantProposalScope): string {
  switch (scope.kind) {
    case "global-ask":
      return "Answer questions and inspect notebook state with read tools only. Do not create or return notebook patch proposals.";
    case "chart-update":
      return `Prepare a validated update for chart cell '${scope.cellId}' only. Use createUpdateChartVariablesPatch or createUpdateChartOptionsPatch with chartId '${scope.cellId}'. Never add, remove, retarget, or edit another chart.`;
    case "equation-update":
      return `Explain or prepare a validated update for equation '${scope.variable}' in model '${scope.modelId}' (equations cell '${scope.cellId}') only. Use createUpdateEquationPatch with that modelId and variable. Never rename, add, remove, or edit another equation or cell. The full equations cell and related model rows are supplied for context only.`;
    case "equations-cell-ask":
      return `Answer questions about equations cell '${scope.cellId}' in model '${scope.modelId}' using read tools only. Explain structure, dependencies, and behavior. Do not create or return notebook patch proposals from this cell-level ask.`;
  }
}

export function summarizeNotebookAssistantScopeToolSyntax(scope: NotebookAssistantProposalScope): string {
  return [...getNotebookAssistantScopeToolNames(scope)]
    .map((name) => getNotebookAssistantToolSyntax(name) ?? `- ${name}`)
    .join("\n");
}

export function filterNotebookAssistantToolRequestsForScope(
  scope: NotebookAssistantProposalScope,
  requests: NotebookAssistantToolRequest[]
): { allowed: NotebookAssistantToolRequest[]; blocked: NotebookAssistantToolRequest[] } {
  const allowedNames = getNotebookAssistantScopeToolNames(scope);
  return requests.reduce<{ allowed: NotebookAssistantToolRequest[]; blocked: NotebookAssistantToolRequest[] }>(
    (result, request) => {
      if (!allowedNames.has(request.name)) {
        result.blocked.push(request);
        return result;
      }

      const targetViolation = validateNotebookAssistantToolRequestTargets(scope, request);
      if (targetViolation) {
        result.blocked.push(request);
        return result;
      }

      result.allowed.push(request);
      return result;
    },
    { allowed: [], blocked: [] }
  );
}

export function validateNotebookAssistantToolRequestTargets(
  scope: NotebookAssistantProposalScope,
  request: NotebookAssistantToolRequest
): string | null {
  const args = request.args ?? {};

  if (scope.kind === "chart-update") {
    if (request.name === "createUpdateChartVariablesPatch" || request.name === "createUpdateChartOptionsPatch") {
      const chartId = readStringArg(args, "chartId") ?? readStringArg(args, "chartCellId");
      if (!chartId) {
        return `Tool '${request.name}' requires chartId '${scope.cellId}'.`;
      }
      if (chartId !== scope.cellId) {
        return `Tool '${request.name}' targeted chart '${chartId}', but this proposal is scoped to '${scope.cellId}'.`;
      }
    }
    return null;
  }

  if (scope.kind === "equation-update") {
    if (request.name === "createUpdateEquationPatch") {
      const modelId = readStringArg(args, "modelId");
      const variable = readStringArg(args, "variable");
      if (!modelId || !variable) {
        return `Tool '${request.name}' requires modelId '${scope.modelId}' and variable '${scope.variable}'.`;
      }
      if (modelId !== scope.modelId || variable !== scope.variable) {
        return `Tool '${request.name}' targeted '${modelId}/${variable}', but this proposal is scoped to '${scope.modelId}/${scope.variable}'.`;
      }
    }
    if (request.name === "getEquation") {
      const variable = readStringArg(args, "variable");
      if (variable && variable !== scope.variable) {
        return `Tool 'getEquation' targeted '${variable}', but this proposal is scoped to '${scope.variable}'.`;
      }
    }
  }

  return null;
}

export function validateNotebookPatchAgainstScope(
  document: NotebookDocument,
  scope: NotebookAssistantProposalScope,
  patch: NotebookPatch
): string[] {
  if (scope.kind === "global-ask" || scope.kind === "equations-cell-ask") {
    return [`${scope.kind} scope does not allow notebook patch proposals.`];
  }

  const issues: string[] = [];
  for (const operation of patch.operations) {
    const issue = validatePatchOperationAgainstScope(document, scope, operation);
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}

export function resolveNotebookAssistantScopeTarget(
  document: NotebookDocument,
  scope: NotebookAssistantProposalScope
):
  | { ok: true; chart: ChartCell }
  | { ok: true; equationsCell: EquationsCell; equationName: string; expression: string }
  | { ok: true; equationsCell: EquationsCell }
  | { ok: true }
  | { ok: false; message: string } {
  if (scope.kind === "global-ask") {
    return { ok: true };
  }

  if (scope.kind === "chart-update") {
    const chart = document.cells.find(
      (cell): cell is ChartCell => cell.type === "chart" && cell.id === scope.cellId
    );
    if (!chart) {
      return { ok: false, message: `Unknown chart cell '${scope.cellId}'.` };
    }
    return { ok: true, chart };
  }

  const equationsCell =
    document.cells.find(
      (cell): cell is EquationsCell => cell.type === "equations" && cell.id === scope.cellId
    ) ?? findEquationsCell(document.cells, scope.modelId);

  if (!equationsCell) {
    return { ok: false, message: `Unknown equations cell for model '${scope.modelId}'.` };
  }
  if (equationsCell.id !== scope.cellId) {
    return {
      ok: false,
      message: `Equations cell '${scope.cellId}' does not match model '${scope.modelId}'.`
    };
  }
  if (equationsCell.modelId !== scope.modelId) {
    return {
      ok: false,
      message: `Equations cell '${scope.cellId}' belongs to model '${equationsCell.modelId}', not '${scope.modelId}'.`
    };
  }

  if (scope.kind === "equations-cell-ask") {
    return { ok: true, equationsCell };
  }

  const equation = equationsCell.equations.find(
    (row) => !isRowComment(row) && row.name.trim() === scope.variable
  );
  if (!equation || isRowComment(equation)) {
    return {
      ok: false,
      message: `Unknown equation '${scope.variable}' in equations cell '${scope.cellId}'.`
    };
  }

  return {
    ok: true,
    equationsCell,
    equationName: equation.name,
    expression: equation.expression
  };
}

export function buildScopedNotebookProposalSemanticSummary(args: {
  document: NotebookDocument;
  patch: NotebookPatch;
  scope: NotebookAssistantProposalScope;
}): string[] {
  const target = resolveNotebookAssistantScopeTarget(args.document, args.scope);
  if (!target.ok) {
    return [args.patch.description?.trim() || "Proposed notebook change."];
  }

  if (args.scope.kind === "chart-update" && "chart" in target) {
    return summarizeChartPatch(target.chart, args.patch);
  }

  if (args.scope.kind === "equation-update" && "expression" in target) {
    return summarizeEquationPatch(target.expression, args.patch, args.scope.variable);
  }

  return [args.patch.description?.trim() || "Proposed notebook change."];
}

function validatePatchOperationAgainstScope(
  document: NotebookDocument,
  scope: Exclude<NotebookAssistantProposalScope, { kind: "global-ask" } | { kind: "equations-cell-ask" }>,
  operation: NotebookPatchOperation
): string | null {
  const path = operation.path;
  if (scope.kind === "chart-update") {
    const prefix = `/cells/by-id/${escapeJsonPointerSegment(scope.cellId)}/`;
    if (!path.startsWith(prefix)) {
      return `Patch path '${path}' is outside chart cell '${scope.cellId}'.`;
    }
    const property = path.slice(prefix.length).split("/")[0] ?? "";
    if (!isAllowedChartProperty(property)) {
      return `Patch path '${path}' changes unsupported chart property '${property}'.`;
    }
    return null;
  }

  const equationsCell =
    document.cells.find(
      (cell): cell is EquationsCell => cell.type === "equations" && cell.id === scope.cellId
    ) ?? null;
  if (!equationsCell) {
    return `Equations cell '${scope.cellId}' was not found for patch validation.`;
  }

  const equationIndex = equationsCell.equations.findIndex(
    (row) => !isRowComment(row) && row.name.trim() === scope.variable
  );
  if (equationIndex < 0) {
    return `Equation '${scope.variable}' was not found in cell '${scope.cellId}'.`;
  }

  const expectedPath = `/cells/by-id/${escapeJsonPointerSegment(scope.cellId)}/equations/${equationIndex}`;
  if (path !== expectedPath) {
    return `Patch path '${path}' is outside equation '${scope.variable}' in cell '${scope.cellId}'.`;
  }

  if (operation.op === "remove") {
    return `Equation-update scope does not allow removing '${scope.variable}'.`;
  }

  if (operation.op === "add" || operation.op === "replace") {
    const value = operation.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `Equation patch value must be an equation row object.`;
    }
    const name = "name" in value && typeof value.name === "string" ? value.name.trim() : "";
    if (name !== scope.variable) {
      return `Equation-update scope does not allow renaming '${scope.variable}'.`;
    }
  }

  return null;
}

export function buildEquationsModelContextPayload(
  document: NotebookDocument,
  equationsCell: EquationsCell,
  focus?: { variable: string; expression: string; description?: string }
): Record<string, unknown> {
  const externalsCell = findExternalsCell(document.cells, equationsCell.modelId);
  const initialValuesCell = findInitialValuesCell(document.cells, equationsCell.modelId);

  return compactObject({
    cellId: equationsCell.id,
    modelId: equationsCell.modelId,
    title: equationsCell.title,
    focus: focus
      ? compactObject({
          variable: focus.variable,
          expression: focus.expression,
          description: focus.description
        })
      : undefined,
    equations: equationsCell.equations.flatMap((row) =>
      isRowComment(row)
        ? [compactArray(["#", row.text])]
        : [compactArray([row.name, row.expression, row.role, row.desc])]
    ),
    externals:
      externalsCell?.externals.flatMap((row) =>
        isRowComment(row)
          ? []
          : [compactArray([row.name, row.kind, row.valueText, row.desc])]
      ) ?? [],
    initialValues:
      initialValuesCell?.initialValues.flatMap((row) =>
        isRowComment(row) ? [] : [compactArray([row.name, row.valueText])]
      ) ?? []
  });
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      if (typeof entry === "object") {
        return Object.keys(entry).length > 0;
      }
      return true;
    })
  ) as T;
}

function compactArray(values: unknown[]): unknown[] {
  const compacted = [...values];
  while (compacted.length > 0 && (compacted[compacted.length - 1] === undefined || compacted[compacted.length - 1] === null)) {
    compacted.pop();
  }
  return compacted.map((value) => (value === undefined ? null : value));
}

function isAllowedChartProperty(property: string): boolean {
  return (
    property === "variables" ||
    property === "axisMode" ||
    property === "compareMode" ||
    property === "niceScale" ||
    property === "referenceTrace" ||
    property === "showScenarioShocks" ||
    property === "seriesRanges" ||
    property === "sharedRange" ||
    property === "timeRangeInclusive" ||
    property === "yAxisTickCount" ||
    property === "title" ||
    property === "axisFontSize"
  );
}

function summarizeChartPatch(chart: ChartCell, patch: NotebookPatch): string[] {
  const lines: string[] = [];
  const currentVariables = chart.variables ?? [];
  for (const operation of patch.operations) {
    if (operation.op !== "replace" && operation.op !== "add") {
      continue;
    }
    if (operation.path.endsWith("/variables") && Array.isArray(operation.value)) {
      const nextVariables = operation.value.filter((entry): entry is string => typeof entry === "string");
      lines.push(`variables: ${formatList(currentVariables)} → ${formatList(nextVariables)}`);
      continue;
    }
    const property = operation.path.split("/").at(-1);
    if (!property || property === chart.id) {
      continue;
    }
    const currentValue = readChartProperty(chart, property);
    lines.push(`${property}: ${formatValue(currentValue)} → ${formatValue(operation.value)}`);
  }
  if (lines.length === 0 && patch.description?.trim()) {
    lines.push(patch.description.trim());
  }
  return lines;
}

function readChartProperty(chart: ChartCell, property: string): unknown {
  switch (property) {
    case "axisMode":
      return chart.axisMode;
    case "compareMode":
      return chart.compareMode;
    case "niceScale":
      return chart.niceScale;
    case "referenceTrace":
      return chart.referenceTrace;
    case "showScenarioShocks":
      return chart.showScenarioShocks;
    case "seriesRanges":
      return chart.seriesRanges;
    case "sharedRange":
      return chart.sharedRange;
    case "timeRangeInclusive":
      return chart.timeRangeInclusive;
    case "yAxisTickCount":
      return chart.yAxisTickCount;
    case "title":
      return chart.title;
    case "axisFontSize":
      return chart.axisFontSize;
    default:
      return undefined;
  }
}

function summarizeEquationPatch(currentExpression: string, patch: NotebookPatch, variable: string): string[] {
  for (const operation of patch.operations) {
    if ((operation.op === "replace" || operation.op === "add") && operation.value && typeof operation.value === "object") {
      const nextExpression =
        "expression" in operation.value && typeof operation.value.expression === "string"
          ? operation.value.expression
          : null;
      if (nextExpression != null) {
        return [`${variable}: ${currentExpression} → ${nextExpression}`];
      }
    }
  }
  return [patch.description?.trim() || `Update equation '${variable}'.`];
}

function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function formatValue(value: unknown): string {
  if (value == null) {
    return "(unset)";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
