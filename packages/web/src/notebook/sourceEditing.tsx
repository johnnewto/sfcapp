import type { ReactNode } from "react";

import { normalizeAbmSpec, validateAbmSpec } from "@sfcr/core";
import { abmSpecFromCell, isRowComment, parseLenientJsonValue } from "@sfcr/notebook-core";

import { stringifyJsonWithCompactLeaves } from "../lib/jsonFormat";
import { normalizeUnitMetaAliases } from "../lib/unitMeta";
import abmModelHelp from "./help/abm-model.md?raw";
import accountTransactionsMatrixHelp from "./help/account-transactions-matrix.md?raw";
import balanceSheetMatrixHelp from "./help/balance-sheet-matrix.md?raw";
import chartHelp from "./help/chart.md?raw";
import equationsHelp from "./help/equations.md?raw";
import externalsHelp from "./help/externals.md?raw";
import initialValuesHelp from "./help/initial-values.md?raw";
import introductionHelp from "./help/introduction.md?raw";
import markdownHelp from "./help/markdown.md?raw";
import matrixHelp from "./help/matrix.md?raw";
import modelHelp from "./help/model.md?raw";
import runAndScenariosHelp from "./help/run-and-scenarios.md?raw";
import sequenceHelp from "./help/sequence.md?raw";
import solverHelp from "./help/solver.md?raw";
import tableHelp from "./help/table.md?raw";
import transactionFlowMatrixHelp from "./help/transaction-flow-matrix.md?raw";
import { normalizeScenarioFromNotebook, serializeNotebookCell } from "./document";
import { resolveAccountingMatrixKind } from "./validation";
import type {
  AbmModelCell,
  ChartCell,
  EquationsCell,
  ExternalsCell,
  InitialValuesCell,
  MatrixCell,
  ModelCell,
  NotebookCell,
  RunCell,
  HydraulicsCell,
  SankeyCell,
  SequenceCell,
  SolverCell,
  TableCell
} from "./types";

export type NotebookHelpTopicId =
  | "introduction"
  | "markdown"
  | "model"
  | "abm-model"
  | "equations"
  | "solver"
  | "externals"
  | "initial-values"
  | "run"
  | "chart"
  | "table"
  | "matrix"
  | "balance-sheet-matrix"
  | "transaction-flow-matrix"
  | "account-transactions-matrix"
  | "sequence";

export interface NotebookHelpTopic {
  description: string;
  id: NotebookHelpTopicId;
  text: string;
  title: string;
}

export const NOTEBOOK_HELP_TOPICS: NotebookHelpTopic[] = [
  {
    id: "introduction",
    title: "Introduction",
    description: "Notebook concepts, workflow, and how the help system is organized.",
    text: introductionHelp
  },
  {
    id: "markdown",
    title: "Markdown",
    description: "Narrative text, notes, assumptions, and interpretation.",
    text: markdownHelp
  },
  {
    id: "matrix",
    title: "Matrix",
    description: "General matrix editing, formulas, and accounting checks.",
    text: matrixHelp
  },
  {
    id: "balance-sheet-matrix",
    title: "Balance Sheet Matrix",
    description: "SFC stock accounting at a point in time.",
    text: balanceSheetMatrixHelp
  },
  {
    id: "transaction-flow-matrix",
    title: "Transaction Flow Matrix",
    description: "SFC flow accounting across sectors over a period.",
    text: transactionFlowMatrixHelp
  },
  {
    id: "account-transactions-matrix",
    title: "Account Transactions Matrix",
    description: "Account-level flows with sector grouping and asset/liability/equity columns.",
    text: accountTransactionsMatrixHelp
  },
  {
    id: "sequence",
    title: "Sequence",
    description: "Step-by-step transaction flows and dependency views.",
    text: sequenceHelp
  },
  {
    id: "model",
    title: "Model",
    description: "Combined model cells with equations, externals, initial values, and solver settings.",
    text: modelHelp
  },
  {
    id: "abm-model",
    title: "ABM Model",
    description: "Agent-based models, Monte Carlo means, and p10–p90 summary bands.",
    text: abmModelHelp
  },
  {
    id: "equations",
    title: "Equations",
    description: "Model equations, roles, lag syntax, and stock-flow units.",
    text: equationsHelp
  },
  {
    id: "externals",
    title: "Externals",
    description: "Parameters, exogenous series, and scenario shock targets.",
    text: externalsHelp
  },
  {
    id: "initial-values",
    title: "Initial Values",
    description: "Starting values for lagged variables and stocks.",
    text: initialValuesHelp
  },
  {
    id: "solver",
    title: "Solver",
    description: "Numerical methods, tolerances, iterations, and hidden-equation checks.",
    text: solverHelp
  },
  {
    id: "run",
    title: "Run And Scenarios",
    description: "Baseline runs, scenario shocks, periods, and result keys.",
    text: runAndScenariosHelp
  },
  {
    id: "chart",
    title: "Chart",
    description: "Plot variables from run results and inspect time paths.",
    text: chartHelp
  },
  {
    id: "table",
    title: "Table",
    description: "Inspect exact variable values from run results.",
    text: tableHelp
  }
];

export function findNotebookHelpTopic(topicId: NotebookHelpTopicId): NotebookHelpTopic {
  return NOTEBOOK_HELP_TOPICS.find((topic) => topic.id === topicId) ?? NOTEBOOK_HELP_TOPICS[0];
}

export function isSourceEditable(cell: NotebookCell): boolean {
  return !["model", "equations", "solver", "externals", "observed", "initial-values"].includes(cell.type);
}

export function validateAbmModelCellSemantics(cell: AbmModelCell): string | null {
  try {
    validateAbmSpec(normalizeAbmSpec(abmSpecFromCell(cell)));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid ABM model";
  }
}

export function serializeCellBody(cell: NotebookCell): string {
  if (cell.type === "markdown") {
    return cell.source;
  }
  const serialized = serializeNotebookCell(cell);
  const { more: _more, ...withoutMore } = serialized;
  return formatCellBody(withoutMore, "compact");
}

export function formatCellBody(
  cellBody: object,
  mode: "pretty" | "compact"
): string {
  return mode === "pretty"
    ? JSON.stringify(cellBody, null, 2)
    : stringifyJsonWithCompactLeaves(cellBody, 0);
}

/** Read `"title"` from a non-markdown cell source draft when JSON is valid. */
export function readCellSourceTitle(source: string): string | null {
  try {
    const parsed = parseLenientJsonValue(source) as { title?: unknown };
    return typeof parsed?.title === "string" ? parsed.title : null;
  } catch {
    return null;
  }
}

/**
 * Write `"title"` into a non-markdown cell source draft.
 * Returns null when the draft is not valid JSON (leave the draft untouched).
 */
export function writeCellSourceTitle(
  source: string,
  title: string,
  mode: "pretty" | "compact" = "compact"
): string | null {
  try {
    const parsed = parseLenientJsonValue(source) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return formatCellBody({ ...parsed, title }, mode);
  } catch {
    return null;
  }
}

export function highlightSourceDraft(
  source: string,
  cellType: NotebookCell["type"]
): ReactNode[] {
  if (cellType === "markdown") {
    return highlightMarkdownSource(source);
  }

  return highlightJsonSource(source);
}

export function parseCellSource(
  cell: NotebookCell,
  source: string,
  title?: string,
  more?: string
): NotebookCell {
  const nextTitle = title?.trim();
  if (title !== undefined && !nextTitle) {
    throw new Error("Cell title is required.");
  }

  if (cell.type === "markdown") {
    return applyCellMore(
      {
        ...cell,
        title: nextTitle ?? cell.title,
        source
      },
      more
    );
  }

  const parsed = parseLenientJsonValue(source) as NotebookCell;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Cell source must parse to an object.");
  }
  if (parsed.type !== cell.type) {
    throw new Error(`Cell source must remain type '${cell.type}'.`);
  }
  if (title === undefined) {
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      throw new Error("Cell source must include title.");
    }
  }
  if (typeof parsed.id !== "string") {
    throw new Error("Cell source must include id.");
  }
  validateCellSourceShape(cell.type, parsed);
  const normalized = normalizeCellSource(parsed);
  return applyCellMore(
    nextTitle !== undefined ? { ...normalized, title: nextTitle } : normalized,
    more
  );
}

function applyCellMore(cell: NotebookCell, more?: string): NotebookCell {
  if (more === undefined) {
    return cell;
  }

  const { more: _previousMore, ...rest } = cell;
  return {
    ...rest,
    ...(more.trim() ? { more } : {})
  } as NotebookCell;
}

function formatAxisGroupsInsert(suggestion?: string[][]): string {
  const groups = (suggestion ?? []).filter((group) => group.length > 0);
  const usable = groups.length > 0 ? groups : [["Y", "Cd", "Mh"], ["W"]];
  const body = usable
    .map((group) => `[${group.map((name) => JSON.stringify(name)).join(", ")}]`)
    .join(", ");
  return `"axisGroups": [${body}]`;
}

export function buildSourceHelperActions(
  cell: NotebookCell,
  options: { chartAxisGroupSuggestion?: string[][] } = {}
): Array<{ label: string; insert: string }> {
  switch (cell.type) {
    case "chart":
      return [
        { label: "Add axisMode", insert: '"axisMode": "shared"' },
        { label: "Axis groups", insert: formatAxisGroupsInsert(options.chartAxisGroupSuggestion) },
        { label: "Collapsed true", insert: '"collapsed": true' },
        { label: "Shared range", insert: '"sharedRange": {\n  "min": 0,\n  "max": 200\n}' },
        { label: "Nice scale", insert: '"niceScale": true' },
        { label: "Y-axis ticks", insert: '"yAxisTickCount": 7' },
        { label: "Time range", insert: '"timeRangeInclusive": [5, 20]' },
        {
          label: "Series ranges",
          insert: '"seriesRanges": {\n  "y": {\n    "includeZero": true\n  }\n}'
        },
        { label: "Axis snap", insert: '"axisSnapTolarance": 0.1' },
        { label: "Include zero", insert: '"sharedRange": {\n  "includeZero": true\n}' },
        { label: "Use shared", insert: '"axisMode": "shared"' },
        { label: "Use separate", insert: '"axisMode": "separate"' },
        { label: "Variables array", insert: '"variables": ["y", "c"]' },
        {
          label: "Series array",
          insert:
            '"series": [\n  {\n    "expression": "100 * y / v",\n    "label": "Income share"\n  }\n]'
        },
        {
          label: "Series from runs",
          insert:
            '"series": [\n  {\n    "expression": "Cd",\n    "sourceRunCellId": "scenario-run"\n  },\n  {\n    "expression": "Cd",\n    "sourceRunCellId": "baseline-run"\n  }\n]'
        },
        { label: "Variables from runs", insert: '"variables": ["Cd, scenario-run", "Cd, baseline-run"]' }
      ];
    case "chart-grid":
      return [
        { label: "Collapsed true", insert: '"collapsed": true' },
        { label: "Grid columns", insert: '"gridColumns": 2' },
        {
          label: "Charts array",
          insert:
            '"charts": [\n  {\n    "id": "grid-chart-1",\n    "type": "chart",\n    "title": "Chart 1",\n    "sourceRunCellId": "run",\n    "variables": ["y"]\n  }\n]'
        }
      ];
    case "run":
      return [
        { label: "Collapsed true", insert: '"collapsed": true' },
        {
          label: "Scenario skeleton",
          insert:
            '"scenario": {\n  "shocks": [\n    {\n      "rangeInclusive": [1, 4],\n      "variables": {\n        "Gd": {\n          "kind": "constant",\n          "value": 25\n        }\n      }\n    }\n  ]\n}'
        },
        { label: "Baseline run id", insert: '"baselineRunCellId": "baseline-run"' },
        { label: "Baseline start", insert: '"baselineStartPeriod": 55' },
        { label: "Periods", insert: '"periods": 60' },
        { label: "Add shock", insert: '"shocks": []' },
        { label: "Result key", insert: '"resultKey": "scenario_result"' }
      ];
    case "table":
      return [
        { label: "Variables array", insert: '"variables": ["y", "c"]' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "matrix":
      return [
        {
          label: "Balance sheet kind",
          insert: '"accountingKind": "balance-sheet"'
        },
        {
          label: "Transaction flow kind",
          insert: '"accountingKind": "transaction-flow"'
        },
        {
          label: "Account transactions kind",
          insert: '"accountingKind": "account-transactions"'
        },
        { label: "Columns array", insert: '"columns": ["Households", "Firms", "Sum"]' },
        { label: "Sectors array", insert: '"sectors": ["Households", "Firms", ""]' },
        {
          label: "Column badges",
          insert: '"columnBadges": ["asset", "liability", ""]'
        },
        { label: "Rows array", insert: '"rows": []' },
        { label: "Source run id", insert: '"sourceRunCellId": "baseline-run"' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "sequence":
      return [
        {
          label: "Matrix source",
          insert: '"source": {\n  "kind": "matrix",\n  "matrixCellId": "matrix-1"\n}'
        },
        {
          label: "Dependency source",
          insert: '"source": {\n  "kind": "dependency",\n  "modelId": "main"\n}'
        },
        {
          label: "CLD source",
          insert: '"source": {\n  "kind": "cld",\n  "modelId": "main"\n}'
        },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "sankey":
      return [
        {
          label: "Matrix source",
          insert: '"source": {\n  "kind": "matrix",\n  "matrixCellId": "matrix-1"\n}'
        },
        { label: "Include zero flows", insert: '"includeZeroFlows": true' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "hydraulics":
      return [
        {
          label: "Matrix source",
          insert:
            '"source": {\n  "transactionMatrixCellId": "transaction-flow",\n  "balanceMatrixCellId": "balance-sheet"\n}'
        },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "equations":
      return [
        { label: "Model id", insert: '"modelId": "main"' },
        { label: "Equations array", insert: '"equations": []' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "solver":
      return [
        { label: "Model id", insert: '"modelId": "main"' },
        {
          label: "Options object",
          insert:
            '"options": {\n  "periods": 100,\n  "solverMethod": "GAUSS_SEIDEL",\n  "toleranceText": "1e-15",\n  "maxIterations": 200,\n  "defaultInitialValueText": "1e-15",\n  "hiddenLeftVariable": "",\n  "hiddenRightVariable": "",\n  "hiddenToleranceText": "0.00001",\n  "relativeHiddenTolerance": false\n}'
        },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "externals":
    case "observed":
      return [
        { label: "Model id", insert: '"modelId": "main"' },
        { label: "Externals array", insert: '"externals": []' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "initial-values":
      return [
        { label: "Model id", insert: '"modelId": "main"' },
        { label: "Initial values array", insert: '"initialValues": []' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "markdown":
      return [
        { label: "Code span", insert: "`variable`" },
        { label: "Bullet list", insert: "- item one\n- item two" },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    case "model":
      return [{ label: "Collapsed true", insert: '"collapsed": true' }];
    case "abm-model":
      return [
        { label: "Model id", insert: '"modelId": "abm-sim"' },
        {
          label: "Populations",
          insert: '"populations": [{ "name": "households", "size": 200, "state": ["h"] }]'
        },
        { label: "Ticks", insert: '"ticks": []' },
        { label: "Record", insert: '"record": { "series": ["Y"] }' },
        { label: "Collapsed true", insert: '"collapsed": true' }
      ];
    default:
      return [];
  }
}

export function buildSourceHelpText(cell: NotebookCell): string {
  switch (cell.type) {
    case "markdown":
      return "Markdown cell source is plain text.\n\nExample:\nUpdated notebook overview with `inline code` and a short bullet list.\n\nOptional More field: longer textbook-style detail for the collapsible panel.";
    case "run":
      return `Required fields:
- title
- id
- type: "run"
- sourceModelId or sourceModelCellId
- mode: "baseline" | "scenario"
- resultKey
- periods

Optional:
- baselineRunCellId
- baselineStartPeriod

Scenario example:
${formatCellBody(
  {
    title: cell.title,
    id: cell.id,
    type: "run",
    sourceModelId: "main",
    baselineRunCellId: "baseline-run",
    baselineStartPeriod: 55,
    mode: "scenario",
    periods: 60,
    resultKey: "example_result",
    scenario: {
      shocks: [
        {
          rangeInclusive: [5, 12],
          variables: {
            phi: { kind: "constant", value: 0.35 }
          }
        }
      ]
    }
  },
  "compact"
)}`;
    case "equations":
      return `Required fields:
- id
- type: "equations"
- modelId
- equations: []

Optional:
- collapsed: boolean

Behavior:
This cell owns the model equation list for one notebook model.`;
    case "chart":
      return `Required fields:
- title
- id
- type: "chart"
- sourceRunCellId
- variables: string[]

Optional:
- axisMode: "shared" | "separate"
- axisGroups: string[][] (buckets variables onto shared axes, e.g. [["Y","Cd","Mh"],["W"]]; implies multiple axes)
- axisSnapTolarance: number
- niceScale: boolean
- yAxisTickCount: integer >= 2 (preferred density, actual count may vary slightly to keep nice spacing)
- timeRangeInclusive: [startPeriodInclusive, endPeriodInclusive]
- sharedRange: { "includeZero"?: boolean, "min"?: number, "max"?: number }
- seriesRanges: { [variableName]: range }
- series[].sourceRunCellId: string (source run for that series; defaults to the chart sourceRunCellId, so one chart can overlay traces from different runs)
- variables shorthand: "<name>, <runId>" sources a bare variable from another run (e.g. "Cd, scenario-run")

Example:
${formatCellBody(
  {
    title: cell.title,
    id: cell.id,
    type: "chart",
    sourceRunCellId: "baseline-run",
    variables: ["ydhs", "c", "p"],
    axisMode: "separate",
    axisSnapTolarance: 0.1,
    niceScale: true,
    yAxisTickCount: 7,
    timeRangeInclusive: [5, 20],
    sharedRange: {
      includeZero: true
    },
    seriesRanges: {
      p: {
        min: 0,
        max: 2
      }
    }
  },
  "compact"
) }

Notes:
- Horizontal grid lines and Y-axis labels are generated from the same tick list.
- niceScale expands auto-scaled bounds outward to nicer 0/5-style values.
- In shared-axis mode, yAxisTickCount is treated as a target density, so the final tick count may shift slightly when the chart snaps to nicer 0/5 spacing.
- In separate-axis mode, the chart keeps the same tick count on each axis so the grid rows and axis tick rows stay aligned.`;
    case "chart-grid":
      return `Required fields:
- title
- id
- type: "chart-grid"
- gridColumns: integer >= 1 (number of columns; charts flow row-major and rows wrap automatically)
- charts: chart cell[] (inlined chart specs, each a normal chart cell with its own id, title, and sourceRunCellId)

Optional:
- collapsed: boolean

Example:
${formatCellBody(
  {
    title: cell.title,
    id: cell.id,
    type: "chart-grid",
    gridColumns: 2,
    charts: [
      {
        id: `${cell.id}-chart-1`,
        type: "chart",
        title: "Output",
        sourceRunCellId: "baseline-run",
        variables: ["y"]
      },
      {
        id: `${cell.id}-chart-2`,
        type: "chart",
        title: "Consumption",
        sourceRunCellId: "baseline-run",
        variables: ["c"]
      }
    ]
  },
  "compact"
) }

Notes:
- Lay out N charts in a grid by setting gridColumns and providing N charts (e.g. gridColumns 2 + 4 charts = 2x2; gridColumns 3 + 6 charts = 3x2).
- Each chart supports the same fields as a standalone chart cell.`;
    case "externals":
      return `Required fields:
- id
- type: "externals"
- modelId
- externals: []

Optional:
- collapsed: boolean

Behavior:
This cell owns the external parameter list for one notebook model. Hide/show only affects visibility in the notebook UI.`;
    case "observed":
      return `Required fields:
- id
- type: "observed"
- modelId
- externals: []

Optional:
- collapsed: boolean

Behavior:
This cell owns the observed/empirical input series for one notebook model. Rows use the same shape as externals and are merged into the model externals with observed forced on. Hide/show only affects visibility in the notebook UI.`;
    case "solver":
      return `Required fields:
- id
- type: "solver"
- modelId
- options

Optional:
- collapsed: boolean

Behavior:
This cell owns the solver/options section for one notebook model. Hide/show only affects visibility in the notebook UI.`;
    case "initial-values":
      return `Required fields:
- id
- type: "initial-values"
- modelId
- initialValues: []

Optional:
- collapsed: boolean

Behavior:
This cell owns the initial-values section for one notebook model. Hide/show only affects visibility in the notebook UI.`;
    case "table":
      return `Required fields:
- title
- id
- type: "table"
- sourceRunCellId
- variables: string[]`;
    case "matrix":
      return `Required fields:
- title
- id
- type: "matrix"
- columns: string[]
- rows: [{ "label": string, "values": string[] }]

Optional:
- accountingKind: "balance-sheet" | "transaction-flow" | "account-transactions"
- sourceRunCellId: string
- sectors: string[] (same length as columns)
- columnBadges: string[] (asset | liability | equity per column; set in Grid via the A / L / E row)
- band on each row
- collapsed: boolean

accountingKind (recommended) drives stock badges, unit validation, and Sum-row checks.
Aliases normalized at load: Balance → balance-sheet, transactionFlow → transaction-flow, accountTransactions → account-transactions.

Example:
${formatCellBody(
  {
    title: cell.title,
    id: cell.id,
    type: "matrix",
    accountingKind: "transaction-flow",
    sourceRunCellId: "baseline-run",
    columns: ["Households", "Firms", "Sum"],
    sectors: ["Households", "Firms", ""],
    rows: [
      {
        band: "Consumption",
        label: "Consumption",
        values: ["-Cd", "+Cs", "0"]
      },
      {
        band: "Sum",
        label: "Sum",
        values: ["0", "0", "0"]
      }
    ]
  },
  "compact"
)}

Behavior:
Use Grid mode in the source editor to edit columns, row labels, and values directly.
Switch to JSON only for bulk copy, paste, or advanced edits.`;
    case "sequence":
      return `Required fields:
- title
- id
- type: "sequence"
- source

Source can be:
- { "kind": "plantuml", "source": "..." }
- { "kind": "matrix", "matrixCellId": "matrix-1" }
- { "kind": "dependency", "modelId": "main" }

Optional:
- participantColumnOrder: string[] for the default multiport participant order`;
    case "sankey":
      return `Required fields:
- title
- id
- type: "sankey"
- source: { "kind": "matrix", "matrixCellId": "matrix-1" }

Behavior:
- Transaction-flow matrices use the sfcr_sankey sector outflow → flow → sector inflow layout.
- Input-output matrices (accountingKind: input-output) use output → market → inputs / final demand.`;
    case "hydraulics":
      return `Required fields:
- title
- id
- type: "hydraulics"
- source: { "transactionMatrixCellId": "transaction-flow" }

Optional:
- source.balanceMatrixCellId
- source.sourceRunCellId
- layout.sectors / tanks / pipes / boxes with integer grid coordinates (x: 0–40, y: 0–24); (0, 1) fractions still read as legacy normalized
- boxes sit behind other items; width/height are grid cells; fill + fillOpacity (0 = transparent), stroke, dashed
- sectors accept fill, stroke, and opacity (0–1); defaults match the light slate sector look
- tank maxLevel sets the fill denominator; omit or blank to use the run max of the bound series
- pipe color, arrowSize (0 = none), widthScale, dashed, opacity
- pipe from.port / to.port: c plus 12 rim ports (omit for nearest mid-side). Sectors add nne/nnw/sse/ssw on the long north/south sides; tanks add ene/ese/wnw/wsw on the long east/west sides. Compass names n, ne, e, se, s, sw, w, nw still work.
- box pipe ports use n / e / s / w, corners ne/se/sw/nw, and n+2 / e-2 / … every 2 grid cells from the side midpoint (east and south are positive)
- pipe waypoints are spline guide points the curve passes through (cubic Catmull-Rom)
- pipe variable / expression set flow magnitude (width + dash speed); label stays independent; no binding or ~0 magnitude is still
- negative flow magnitude marches the dash overlay backwards (arrow still follows from → to)
- pipe labelT (0–1) and labelOffset (half-cell steps) persist after the label is dragged; omit them for auto placement
- sector / tank / box labelOffsetX and labelOffsetY (half-cell steps) persist after the label is dragged; omit them for auto placement

Empty layout seeds sectors from the transactions-flow matrix, tanks from the balance sheet, and pipes from inferred flows.`;
    case "model":
      return "";
    case "abm-model":
      return `Required fields:
- title
- id
- type: "abm-model"
- modelId
- populations
- ticks

Optional: params, state.aggregates, record, check

Use Visual for normal editing. Use JSON for bulk edits or unsupported legacy shapes.
When record is omitted, all macros plus first/last-agent state are recorded by default.

Ticks use YAML one-key wrappers (do / for / hire-lottery / shuffle / ration-fcfs).
Run cells with engine: "abm" reference this cell via sourceModelId.`;
    default:
      return "";
  }
}

export function buildNotebookCellHelpText(cell: NotebookCell): string {
  return findNotebookHelpTopic(getNotebookHelpTopicIdForCell(cell)).text;
}

export function getNotebookHelpTopicIdForCell(cell: NotebookCell): NotebookHelpTopicId {
  if (cell.type === "matrix") {
    return getMatrixHelpTopicId(cell);
  }

  if (cell.type === "observed") {
    return "externals";
  }

  if (cell.type === "chart-grid") {
    return "chart";
  }

  if (cell.type === "sankey" || cell.type === "hydraulics") {
    return "sequence";
  }

  if (cell.type === "abm-model") {
    return "abm-model";
  }

  return cell.type;
}

function getMatrixHelpTopicId(cell: MatrixCell): NotebookHelpTopicId {
  const kind = resolveAccountingMatrixKind(cell);
  if (kind === "balance-sheet") {
    return "balance-sheet-matrix";
  }
  if (kind === "transaction-flow") {
    return "transaction-flow-matrix";
  }
  if (kind === "account-transactions") {
    return "account-transactions-matrix";
  }

  return "matrix";
}

export function applySourceHelper(currentSource: string, insert: string): string {
  const trimmed = currentSource.trimEnd();
  if (!trimmed) {
    return insert;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return insertIntoJsonObject(trimmed, insert);
  }

  return `${trimmed}\n${insert}`;
}

function highlightJsonSource(source: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  source.replace(
    /"(?:\\.|[^"\\])*"(?=\s*:)?|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g,
    (match, offset) => {
      if (offset > cursor) {
        parts.push(source.slice(cursor, offset));
      }

      parts.push(
        <span key={`${offset}-${match}`} className={tokenClassForJson(source, match, offset)}>
          {match}
        </span>
      );
      cursor = offset + match.length;
      return match;
    }
  );

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }

  return parts;
}

function tokenClassForJson(source: string, token: string, offset: number): string {
  if (token === "true" || token === "false") {
    return "token-boolean";
  }
  if (token === "null") {
    return "token-null";
  }
  if (/^-?\d/.test(token)) {
    return "token-number";
  }
  if (/^"/.test(token)) {
    const trailing = source.slice(offset + token.length);
    return /^\s*:/.test(trailing) ? "token-key" : "token-string";
  }
  return "token-punctuation";
}

function highlightMarkdownSource(source: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    if (index > 0) {
      parts.push("\n");
    }

    const headingMatch = line.match(/^(#+\s.*)$/);
    if (headingMatch) {
      parts.push(
        <span key={`md-heading-${index}`} className="token-heading">
          {line}
        </span>
      );
      return;
    }

    let cursor = 0;
    line.replace(/`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*/g, (match, offset) => {
      if (offset > cursor) {
        parts.push(line.slice(cursor, offset));
      }
      parts.push(
        <span key={`md-${index}-${offset}`} className="token-markdown">
          {match}
        </span>
      );
      cursor = offset + match.length;
      return match;
    });

    if (cursor < line.length) {
      parts.push(line.slice(cursor));
    }
  });

  return parts;
}

function normalizeCellSource(cell: NotebookCell): NotebookCell {
  switch (cell.type) {
    case "model":
      return {
        ...cell,
        editor: {
          ...cell.editor,
          equations: cell.editor.equations.map((equation) =>
            isRowComment(equation)
              ? equation
              : {
                  ...equation,
                  unitMeta: normalizeUnitMetaAliases(equation.unitMeta)
                }
          ),
          externals: cell.editor.externals.map((external) =>
            isRowComment(external)
              ? external
              : {
                  ...external,
                  unitMeta: normalizeUnitMetaAliases(external.unitMeta)
                }
          )
        }
      };
    case "equations":
      return {
        ...cell,
        equations: cell.equations.map((equation) =>
          isRowComment(equation)
            ? equation
            : {
                ...equation,
                unitMeta: normalizeUnitMetaAliases(equation.unitMeta)
              }
        )
      };
    case "externals":
    case "observed":
      return {
        ...cell,
        externals: cell.externals.map((external) =>
          isRowComment(external)
            ? external
            : {
                ...external,
                unitMeta: normalizeUnitMetaAliases(external.unitMeta)
              }
        )
      };
    case "run":
      if (!cell.scenario) {
        return cell;
      }

      return {
        ...cell,
        scenario: normalizeScenarioFromNotebook(cell.scenario)
      };
    default:
      return cell;
  }
}

function validateCellSourceShape(
  cellType: NotebookCell["type"],
  parsed: Omit<NotebookCell, "title">
): void {
  if (
    (parsed as NotebookCell).collapsed != null &&
    typeof (parsed as NotebookCell).collapsed !== "boolean"
  ) {
    throw new Error(`${cellType} cells require collapsed to be a boolean when provided.`);
  }
  switch (cellType) {
    case "run":
      if ((parsed as RunCell).engine === "abm") {
        if (typeof (parsed as RunCell).sourceModelId !== "string") {
          throw new Error("ABM run cells require sourceModelId pointing at an abm-model cell.");
        }
      } else if (
        typeof (parsed as RunCell).sourceModelId !== "string" &&
        typeof (parsed as RunCell).sourceModelCellId !== "string"
      ) {
        throw new Error("Run cells require sourceModelId or sourceModelCellId.");
      }
      if (
        (parsed as RunCell).baselineRunCellId != null &&
        typeof (parsed as RunCell).baselineRunCellId !== "string"
      ) {
        throw new Error("Run cells require baselineRunCellId to be a string when provided.");
      }
      if (
        (parsed as RunCell).baselineStartPeriod != null &&
        typeof (parsed as RunCell).baselineStartPeriod !== "number"
      ) {
        throw new Error("Run cells require baselineStartPeriod to be a number when provided.");
      }
      if (!["baseline", "scenario"].includes(String((parsed as RunCell).mode))) {
        throw new Error("Run cells require mode to be 'baseline' or 'scenario'.");
      }
      if (typeof (parsed as RunCell).resultKey !== "string") {
        throw new Error("Run cells require resultKey.");
      }
      if (
        (parsed as RunCell).periods != null &&
        typeof (parsed as RunCell).periods !== "number"
      ) {
        throw new Error("Run cells require periods to be a number when provided.");
      }
      if (
        (parsed as RunCell).externalOverrides != null &&
        !Array.isArray((parsed as RunCell).externalOverrides)
      ) {
        throw new Error("Run cells require externalOverrides to be an array when provided.");
      }
      ((parsed as RunCell).scenario?.shocks ?? []).forEach((shock, index) => {
        const candidate = shock as typeof shock & { rangeInclusive?: [number, number] };
        if (
          candidate.rangeInclusive != null &&
          (!Array.isArray(candidate.rangeInclusive) ||
            candidate.rangeInclusive.length !== 2 ||
            candidate.rangeInclusive.some((value) => typeof value !== "number"))
        ) {
          throw new Error(
            `scenario.shocks.${index}.rangeInclusive must be a [start, end] number pair.`
          );
        }
      });
      return;
    case "chart":
      if (typeof (parsed as ChartCell).sourceRunCellId !== "string") {
        throw new Error("Chart cells require sourceRunCellId.");
      }
      validateChartSeriesOrVariables(parsed as ChartCell);
      if (
        (parsed as ChartCell).axisMode != null &&
        !["shared", "separate"].includes(String((parsed as ChartCell).axisMode))
      ) {
        throw new Error("Chart axisMode must be 'shared' or 'separate'.");
      }
      if ((parsed as ChartCell).axisGroups != null) {
        const groups = (parsed as ChartCell).axisGroups;
        if (
          !Array.isArray(groups) ||
          groups.some(
            (group) =>
              !Array.isArray(group) || group.some((name) => typeof name !== "string")
          )
        ) {
          throw new Error("Chart axisGroups must be an array of string arrays.");
        }
      }
      if (
        (parsed as ChartCell).axisSnapTolarance != null &&
        typeof (parsed as ChartCell).axisSnapTolarance !== "number"
      ) {
        throw new Error("Chart axisSnapTolarance must be a number.");
      }
      if (
        (parsed as ChartCell).niceScale != null &&
        typeof (parsed as ChartCell).niceScale !== "boolean"
      ) {
        throw new Error("Chart niceScale must be a boolean.");
      }
      if (
        (parsed as ChartCell).compareMode != null &&
        !["levels", "relative", "percent"].includes(String((parsed as ChartCell).compareMode))
      ) {
        throw new Error("Chart compareMode must be 'levels', 'relative', or 'percent'.");
      }
      if (
        (parsed as ChartCell).referenceTrace != null &&
        !["none", "baseline", "previous-run", "observed"].includes(String((parsed as ChartCell).referenceTrace))
      ) {
        throw new Error("Chart referenceTrace must be 'none', 'baseline', 'previous-run', or 'observed'.");
      }
      if (
        (parsed as ChartCell).referenceTraces != null &&
        (!Array.isArray((parsed as ChartCell).referenceTraces) ||
          !(parsed as ChartCell).referenceTraces?.every((trace) =>
            ["baseline", "previous-run", "observed"].includes(String(trace))
          ))
      ) {
        throw new Error("Chart referenceTraces must be an array of 'baseline', 'previous-run', or 'observed'.");
      }
      if (
        (parsed as ChartCell).showScenarioShocks != null &&
        (parsed as ChartCell).showScenarioShocks !== "auto" &&
        typeof (parsed as ChartCell).showScenarioShocks !== "boolean"
      ) {
        throw new Error("Chart showScenarioShocks must be true, false, or 'auto'.");
      }
      if (
        (parsed as ChartCell).yAxisTickCount != null &&
        (!Number.isInteger((parsed as ChartCell).yAxisTickCount) ||
          Number((parsed as ChartCell).yAxisTickCount) < 2)
      ) {
        throw new Error("Chart yAxisTickCount must be an integer greater than or equal to 2.");
      }
      validateChartAxisRange((parsed as ChartCell).sharedRange, "sharedRange");
      validateChartTimeRangeInclusive(
        (parsed as ChartCell).timeRangeInclusive,
        "timeRangeInclusive"
      );
      if (
        (parsed as ChartCell).seriesRanges != null &&
        (typeof (parsed as ChartCell).seriesRanges !== "object" ||
          Array.isArray((parsed as ChartCell).seriesRanges))
      ) {
        throw new Error("Chart seriesRanges must be an object keyed by variable name.");
      }
      Object.entries((parsed as ChartCell).seriesRanges ?? {}).forEach(([name, range]) => {
        validateChartAxisRange(range, `seriesRanges.${name}`);
      });
      validateChartAxisLabel((parsed as ChartCell).xAxis, "xAxis");
      validateChartAxisLabel((parsed as ChartCell).yAxis, "yAxis");
      return;
    case "chart-grid": {
      const grid = parsed as Extract<NotebookCell, { type: "chart-grid" }>;
      if (!Number.isInteger(grid.gridColumns) || Number(grid.gridColumns) < 1) {
        throw new Error("Chart grid cells require gridColumns to be an integer >= 1.");
      }
      if (!Array.isArray(grid.charts)) {
        throw new Error("Chart grid cells require charts to be an array.");
      }
      grid.charts.forEach((chart, index) => {
        if (!chart || typeof chart !== "object" || chart.type !== "chart") {
          throw new Error(`Chart grid charts.${index} must be a chart cell.`);
        }
        if (typeof chart.sourceRunCellId !== "string") {
          throw new Error(`Chart grid charts.${index} requires sourceRunCellId.`);
        }
        validateChartSeriesOrVariables(chart);
      });
      return;
    }
    case "table":
      if (typeof (parsed as TableCell).sourceRunCellId !== "string") {
        throw new Error("Table cells require sourceRunCellId.");
      }
      if (!Array.isArray((parsed as TableCell).variables)) {
        throw new Error("Table cells require variables to be an array.");
      }
      return;
    case "solver":
      if (typeof (parsed as SolverCell).modelId !== "string") {
        throw new Error("solver cells require modelId.");
      }
      if (!(parsed as SolverCell).options || typeof (parsed as SolverCell).options !== "object") {
        throw new Error("solver cells require options.");
      }
      return;
    case "externals":
    case "initial-values":
      if (typeof (parsed as ExternalsCell | InitialValuesCell).modelId !== "string") {
        throw new Error(`${cellType} cells require modelId.`);
      }
      if (cellType === "externals" && !Array.isArray((parsed as ExternalsCell).externals)) {
        throw new Error("externals cells require externals.");
      }
      if (
        cellType === "initial-values" &&
        !Array.isArray((parsed as InitialValuesCell).initialValues)
      ) {
        throw new Error("initial-values cells require initialValues.");
      }
      return;
    case "equations":
      if (typeof (parsed as EquationsCell).modelId !== "string") {
        throw new Error("equations cells require modelId.");
      }
      if (!Array.isArray((parsed as EquationsCell).equations)) {
        throw new Error("equations cells require equations.");
      }
      return;
    case "abm-model":
      if (typeof (parsed as AbmModelCell).modelId !== "string") {
        throw new Error("abm-model cells require modelId.");
      }
      if (!Array.isArray((parsed as AbmModelCell).populations)) {
        throw new Error("abm-model cells require populations.");
      }
      if (!Array.isArray((parsed as AbmModelCell).ticks)) {
        throw new Error("abm-model cells require ticks.");
      }
      if (
        (parsed as AbmModelCell).record != null &&
        typeof (parsed as AbmModelCell).record !== "object"
      ) {
        throw new Error("abm-model record must be an object or directive array.");
      }
      return;
    case "matrix":
      if (!Array.isArray((parsed as MatrixCell).columns)) {
        throw new Error("Matrix cells require columns to be an array.");
      }
      if (
        (parsed as MatrixCell).sectors != null &&
        !Array.isArray((parsed as MatrixCell).sectors)
      ) {
        throw new Error("Matrix cells require sectors to be an array when provided.");
      }
      if (!Array.isArray((parsed as MatrixCell).rows)) {
        throw new Error("Matrix cells require rows to be an array.");
      }
      return;
    case "sequence":
      if (!(parsed as SequenceCell).source || typeof (parsed as SequenceCell).source !== "object") {
        throw new Error("Sequence cells require a source object.");
      }
      if (
        (parsed as SequenceCell).participantColumnOrder != null &&
        !Array.isArray((parsed as SequenceCell).participantColumnOrder)
      ) {
        throw new Error("Sequence participantColumnOrder must be an array.");
      }
      const source = (parsed as SequenceCell).source;
      if (
        (source.kind === "dependency" || source.kind === "cld") &&
        typeof source.modelId !== "string" &&
        typeof source.sourceModelId !== "string" &&
        typeof source.sourceModelCellId !== "string"
      ) {
        throw new Error(
          `${source.kind === "cld" ? "CLD" : "Dependency"} sequence sources require modelId, sourceModelId, or sourceModelCellId.`
        );
      }
      return;
    case "sankey":
      if (!(parsed as SankeyCell).source || typeof (parsed as SankeyCell).source !== "object") {
        throw new Error("Sankey cells require a source object.");
      }
      if ((parsed as SankeyCell).source.kind !== "matrix") {
        throw new Error("Sankey cells currently require a matrix source.");
      }
      if (typeof (parsed as SankeyCell).source.matrixCellId !== "string") {
        throw new Error("Sankey matrix sources require matrixCellId.");
      }
      return;
    case "hydraulics":
      if (!(parsed as HydraulicsCell).source || typeof (parsed as HydraulicsCell).source !== "object") {
        throw new Error("Hydraulics cells require a source object.");
      }
      if (typeof (parsed as HydraulicsCell).source.transactionMatrixCellId !== "string") {
        throw new Error("Hydraulics cells require source.transactionMatrixCellId.");
      }
      return;
    case "markdown":
    case "model":
      return;
  }
}

function insertIntoJsonObject(source: string, insert: string): string {
  const closingIndex = source.lastIndexOf("}");
  if (closingIndex <= 0) {
    return `${source}\n${insert}`;
  }

  const beforeClosing = source.slice(0, closingIndex).trimEnd();
  const needsComma = !beforeClosing.endsWith("{");
  const indentation = "  ";
  const formattedInsert = insert
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");

  return `${beforeClosing}${needsComma ? "," : ""}\n${formattedInsert}\n}`;
}

function validateChartSeriesOrVariables(cell: ChartCell): void {
  const hasVariables = Array.isArray(cell.variables) && cell.variables.length > 0;
  const hasSeries = Array.isArray(cell.series) && cell.series.length > 0;

  if (cell.variables != null && !Array.isArray(cell.variables)) {
    throw new Error("Chart variables must be an array when provided.");
  }

  if (cell.series != null && !Array.isArray(cell.series)) {
    throw new Error("Chart series must be an array when provided.");
  }

  if (!hasVariables && !hasSeries) {
    throw new Error("Chart cells require a non-empty variables or series array.");
  }

  (cell.series ?? []).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Chart series[${index}] must be an object.`);
    }
    if (typeof entry.expression !== "string" || entry.expression.trim() === "") {
      throw new Error(`Chart series[${index}].expression must be a non-empty string.`);
    }
    if (entry.label != null && typeof entry.label !== "string") {
      throw new Error(`Chart series[${index}].label must be a string when provided.`);
    }
    if (entry.range != null) {
      validateChartAxisRange(entry.range, `series[${index}].range`);
    }
    if (entry.unit != null && typeof entry.unit !== "string") {
      throw new Error(`Chart series[${index}].unit must be a string when provided.`);
    }
  });
}

function validateChartAxisLabel(label: unknown, fieldName: string): void {
  if (label == null) {
    return;
  }
  if (typeof label !== "object" || Array.isArray(label)) {
    throw new Error(`Chart ${fieldName} must be an object when provided.`);
  }
  const record = label as Record<string, unknown>;
  if (record.title != null && typeof record.title !== "string") {
    throw new Error(`Chart ${fieldName}.title must be a string when provided.`);
  }
  if (record.unit != null && typeof record.unit !== "string") {
    throw new Error(`Chart ${fieldName}.unit must be a string when provided.`);
  }
}

function validateChartAxisRange(range: unknown, label: string): void {
  if (range == null) {
    return;
  }
  if (typeof range !== "object" || Array.isArray(range)) {
    throw new Error(`${label} must be an object.`);
  }

  const candidate = range as Record<string, unknown>;
  if (candidate.includeZero != null && typeof candidate.includeZero !== "boolean") {
    throw new Error(`${label}.includeZero must be a boolean.`);
  }
  if (candidate.min != null && typeof candidate.min !== "number") {
    throw new Error(`${label}.min must be a number.`);
  }
  if (candidate.max != null && typeof candidate.max !== "number") {
    throw new Error(`${label}.max must be a number.`);
  }
  if (
    typeof candidate.min === "number" &&
    typeof candidate.max === "number" &&
    !(candidate.min < candidate.max)
  ) {
    throw new Error(`${label}.min must be less than ${label}.max.`);
  }
}

function validateChartTimeRangeInclusive(range: unknown, label: string): void {
  if (range == null) {
    return;
  }
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    range.some((value) => !Number.isInteger(value) || Number(value) < 1)
  ) {
    throw new Error(`${label} must be a [start, end] pair of integers >= 1.`);
  }
  if (range[0] > range[1]) {
    throw new Error(`${label}[0] must be <= ${label}[1].`);
  }
}
