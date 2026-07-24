import type {
  EquationRole,
  ExternalDef,
  ModelDefinition,
  ScenarioDefinition,
  ShockVariableDef,
  SimulationOptions,
  SimulationResult,
  SolverMethod
} from "@sfcr/core";

import type { NotebookScenarioDefinition } from "./document/scenarioFormat";
import type { UnitMeta } from "./unitMetaAliases";
export interface EquationRow {
  id: string;
  name: string;
  desc?: string;
  expression: string;
  role?: EquationRole;
  unitMeta?: UnitMeta;
}

/**
 * `constant` and `series` populate the engine `externals` namespace. `coefficient`
 * rows populate the separate `coefficients` namespace (scalar parameters held
 * across every period), so they cannot collide with equations or externals.
 */
export type ExternalRowKind = ExternalDef["kind"] | "coefficient";

export interface ExternalRow {
  id: string;
  name: string;
  desc?: string;
  kind: ExternalRowKind;
  valueText: string;
  observed?: boolean;
  unitMeta?: UnitMeta;
}

export interface InitialValueRow {
  id: string;
  name: string;
  desc?: string;
  valueText: string;
  enabled?: boolean;
}

export interface RowComment {
  id: string;
  kind: "comment";
  text: string;
}

export type EquationListItem = EquationRow | RowComment;
export type ExternalListItem = ExternalRow | RowComment;
export type InitialValueListItem = InitialValueRow | RowComment;

export interface ShockVariableRow {
  id: string;
  name: string;
  kind: ShockVariableDef["kind"];
  valueText: string;
}

export interface ShockRow {
  id: string;
  startPeriodInclusive: number;
  endPeriodInclusive: number;
  variables: ShockVariableRow[];
}

export interface EditorScenario {
  shocks: ShockRow[];
}

export interface EditorOptions {
  periods: number;
  solverMethod: SolverMethod;
  toleranceText: string;
  maxIterations: number;
  defaultInitialValueText: string;
  hiddenLeftVariable: string;
  hiddenRightVariable: string;
  hiddenToleranceText: string;
  relativeHiddenTolerance: boolean;
}

export interface EditorState {
  equations: EquationListItem[];
  externals: ExternalListItem[];
  initialValues: InitialValueListItem[];
  options: EditorOptions;
  scenario: EditorScenario;
}

export interface RuntimeDocument {
  model: ModelDefinition;
  options: SimulationOptions;
  scenario: ScenarioDefinition | null;
}

export interface ChartAxisRange {
  includeZero?: boolean;
  max?: number;
  min?: number;
}

export interface ChartAxisLabel {
  title?: string;
  unit?: string;
}

export interface NotebookDocument {
  id: string;
  title: string;
  cells: NotebookCell[];
  metadata: {
    version: 1;
    template?: string;
    sourceFileName?: string;
    /**
     * Optional calendar mapping for chart time axes. When `startYear` is set,
     * charts render the first plotted period as `startYear` and subsequent
     * periods as `startYear + 1`, `startYear + 2`, ... instead of period numbers.
     */
    timeAxis?: {
      startYear: number;
    };
  };
}

export type NotebookCell =
  | MarkdownCell
  | ModelCell
  | EquationsCell
  | SolverCell
  | ExternalsCell
  | ObservedCell
  | InitialValuesCell
  | RunCell
  | ChartCell
  | ChartGridCell
  | TableCell
  | MatrixCell
  | SequenceCell
  | SankeyCell;

export interface NotebookCellBase {
  collapsed?: boolean;
  description?: string;
  id: string;
  more?: string;
  note?: string;
  title: string;
}

export interface MarkdownCell extends NotebookCellBase {
  type: "markdown";
  source: string;
}

export interface ModelCell extends NotebookCellBase {
  type: "model";
  editor: EditorState;
}

export interface EquationsCell extends NotebookCellBase {
  type: "equations";
  modelId: string;
  equations: EquationListItem[];
}

export interface SolverCell extends NotebookCellBase {
  type: "solver";
  modelId: string;
  options: EditorOptions;
}

export interface ExternalsCell extends NotebookCellBase {
  type: "externals";
  modelId: string;
  externals: ExternalListItem[];
}

/**
 * Observed/empirical input series for a model. Structurally identical to an
 * {@link ExternalsCell} (same `externals` row shape) but authored as a separate
 * category so large empirical datasets do not crowd the externals section. At
 * compile time these rows are merged into the model externals with `observed`
 * forced on, so they feed both `model.externals` and `model.observed`.
 */
export interface ObservedCell extends NotebookCellBase {
  type: "observed";
  modelId: string;
  externals: ExternalListItem[];
}

export interface InitialValuesCell extends NotebookCellBase {
  type: "initial-values";
  modelId: string;
  initialValues: InitialValueListItem[];
}

export interface RunCell extends NotebookCellBase {
  type: "run";
  sourceModelCellId?: string;
  sourceModelId?: string;
  baselineRunCellId?: string;
  baselineStartPeriod?: number;
  mode: "baseline" | "scenario";
  scenario?: ScenarioDefinition | NotebookScenarioDefinition | null;
  resultKey: string;
  periods: number;
  simType?: "DYNAMIC" | "STATIC";
  /**
   * Simulation engine for this run. Defaults to `"equation"` (Gauss–Seidel / Broyden).
   * `"abm"` uses the agent-based Monte Carlo path (`abmModel` + `abm` config).
   */
  engine?: "equation" | "abm";
  /** Registered ABM model id when `engine` is `"abm"` (e.g. `"abm-sim"`). */
  abmModel?: string;
  /** ABM parameter overrides (households, monteCarlo, s, …). */
  abm?: Record<string, number | boolean>;
  /**
   * Variables held exogenous for this run (R `bimets` Exogenize semantics): each
   * listed variable that also has a data series drops its equation so the run
   * uses the supplied/observed values instead of solving it.
   *
   * A bare string pins the variable for the whole run (`Exogenize = TRUE`). An
   * object with `throughPeriod` pins it only for periods `1..throughPeriod` and
   * releases it afterwards (`Exogenize = c(start, end)`), turning the run into a
   * segmented in-sample/out-of-sample simulation.
   */
  exogenize?: ExogenizeEntry[];
  /**
   * Per-run replacements for external/coefficient rows. Useful for alternative
   * forecast paths that should reuse the same model equations and observed data.
   */
  externalOverrides?: ExternalListItem[];
}

/**
 * A run's exogenize entry: either a whole-run variable name, or a window that
 * pins the variable to data through `throughPeriod` (1-based, inclusive) and
 * releases it for later periods.
 */
export type ExogenizeEntry = string | { name: string; throughPeriod?: number };

export interface ChartSeriesSpec {
  expression: string;
  label?: string;
  range?: ChartAxisRange;
  /** Y-axis unit for this series (separate-axis mode). Overrides model unit inference. */
  unit?: string;
  /**
   * Run cell whose result supplies this series. Defaults to the chart cell's
   * `sourceRunCellId` when omitted, letting one chart overlay traces drawn from
   * several different runs.
   */
  sourceRunCellId?: string;
}

export interface ChartCell extends NotebookCellBase {
  type: "chart";
  sourceRunCellId: string;
  /** Shorthand for plotting raw run series by name. Ignored when `series` is non-empty. */
  variables?: string[];
  /** Derived series evaluated from run results using model/matrix expression syntax. */
  series?: ChartSeriesSpec[];
  axisMode?: "shared" | "separate";
  /**
   * Buckets series onto shared axes. Each inner array lists variable/expression
   * names that should share one y-axis; series omitted from every group get their
   * own axis. Implies multiple axes (overrides `axisMode: "shared"`).
   */
  axisGroups?: string[][];
  axisSnapTolarance?: number;
  niceScale?: boolean;
  /**
   * How scenario chart series relate to the linked baseline path.
   * - `levels` (default): plot scenario values as-is
   * - `relative`: scenario[t] / baseline[t] (time-aligned via baselineStartPeriod)
   * - `percent`: ((scenario − baseline) / baseline) × 100
   * Falls back to levels when the source run is not a scenario with a resolvable baseline.
   */
  compareMode?: "levels" | "relative" | "percent";
  referenceTrace?: "none" | "baseline" | "previous-run" | "observed";
  referenceTraces?: Array<"baseline" | "previous-run" | "observed">;
  /** When `"auto"` (default), show shock bands on charts sourced from scenario runs. */
  showScenarioShocks?: boolean | "auto";
  yAxisTickCount?: number;
  /** Tick label size in SVG units; axis title uses this + 1. Defaults to 11. */
  axisFontSize?: number;
  /** Shared-axis title and unit. Separate-axis mode uses per-series `unit` when set. */
  yAxis?: ChartAxisLabel;
  /** X-axis title. Defaults to `yr` when omitted. */
  xAxis?: ChartAxisLabel;
  sharedRange?: ChartAxisRange;
  seriesRanges?: Record<string, ChartAxisRange | undefined>;
  timeRangeInclusive?: [number, number];
  /**
   * When true, plot Monte Carlo summary bands for bare variable series that have
   * companion `{name}_p10`/`{name}_p90` (or `{name}_min`/`{name}_max`) in the run result.
   */
  showMcBands?: boolean;
}

/**
 * Container cell that arranges several inlined {@link ChartCell} specs into a
 * CSS grid (e.g. 2x2, 3x2). Charts flow row-major into `gridColumns` columns;
 * rows wrap automatically based on how many charts are supplied.
 */
export interface ChartGridCell extends NotebookCellBase {
  type: "chart-grid";
  /** Number of columns in the grid. Charts fill left-to-right, top-to-bottom. */
  gridColumns: number;
  /** Default tick label size for all charts in the grid (SVG units). */
  axisFontSize?: number;
  /** Inlined chart specs rendered into the grid, in order. */
  charts: ChartCell[];
}

export interface TableCell extends NotebookCellBase {
  type: "table";
  sourceRunCellId: string;
  variables: string[];
}

export interface MatrixColumnTreeNode {
  id: string;
  label: string;
  variable?: string;
  children?: MatrixColumnTreeNode[];
}

export interface MatrixCell extends NotebookCellBase {
  type: "matrix";
  accountingKind?: "transaction-flow" | "balance-sheet" | "account-transactions" | "input-output";
  columns: string[];
  columnTree?: MatrixColumnTreeNode[];
  columnBadges?: string[];
  variables?: string[];
  sectors?: string[];
  sourceRunCellId?: string;
  rows: Array<{
    band?: string;
    label: string;
    role?: "flow" | "initial";
    values: string[];
  }>;
}

export interface SequenceCell extends NotebookCellBase {
  type: "sequence";
  source: SequenceCellSource;
  participantColumnOrder?: string[];
}

export interface SankeyCell extends NotebookCellBase {
  type: "sankey";
  source: SankeyCellSource;
}

export type SankeyCellSource = {
  kind: "matrix";
  matrixCellId: string;
  sourceRunCellId?: string;
  includeZeroFlows?: boolean;
};

export type SequenceCellSource =
  | {
      kind: "plantuml";
      source: string;
    }
  | {
      kind: "matrix";
      matrixCellId: string;
      sourceRunCellId?: string;
      includeZeroFlows?: boolean;
      aliases?: Record<string, string>;
    }
  | {
      kind: "dependency";
      modelId?: string;
      sourceModelId?: string;
      sourceModelCellId?: string;
      stripSectorSource?: "columns" | "sectors";
      showAccountingStrips?: boolean;
      ignoreInferredBandsForPlacement?: boolean;
      showExogenous?: boolean;
      showDebugOverlay?: boolean;
      stripMapping?: {
        transactionMatrixCellId?: string;
        balanceMatrixCellId?: string;
      };
    }
  | {
      kind: "cld";
      modelId?: string;
      sourceModelId?: string;
      sourceModelCellId?: string;
    };

export type NotebookCellOutput =
  | {
      type: "model";
      runtime: RuntimeDocument;
    }
  | {
      type: "result";
      previousResult?: SimulationResult;
      result: SimulationResult;
    };

export interface NotebookRuntimeState {
  outputs: Record<string, NotebookCellOutput | undefined>;
  status: Record<string, "idle" | "running" | "success" | "error">;
  errors: Record<string, string | undefined>;
  historyUpdates?: Record<string, number | undefined>;
}
