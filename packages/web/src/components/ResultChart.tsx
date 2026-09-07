import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { formatVariableTooltip, type VariableUnitMetadata } from "../lib/unitMeta";
import type { VariableDescriptions } from "../lib/variableDescriptions";
import { getVariableUnitLabel } from "../lib/units";
import { documentHighlightClassName } from "../lib/variableHighlight";
import { InstantTooltip } from "./InstantTooltip";
import { PinToggleIcon } from "./PinToggleIcon";
import type { MatrixGraphSliceHighlight } from "../notebook/graphDocumentHighlight";
import type { ReferenceTraceKind } from "../notebook/chartReferenceTrace";
import {
  DEFAULT_AXIS_TICK_COUNT,
  applyTimeRangeDrag,
  buildAxisMetrics,
  buildIntegerTicks,
  clampInteractiveTimeRange,
  formatAxisValue,
  resolveTimeRange,
  snapAxisMetrics,
  timeRangeInclusiveEquals,
  toBandAreaPath,
  toPolylinePoints,
  toStoredTimeRangeInclusive,
  toX,
  toY,
  type ChartAxisRange
} from "./ResultChartScales";
import { ScenarioShockVariableLine } from "./ScenarioShockVariableLine";
import { VariableMathLabel, renderVariableMathPlainText, renderVariableMathSvgLabel } from "./VariableMathLabel";
import {
  formatScenarioShockAriaLabel,
  type ScenarioShockMarker
} from "../lib/scenarioShockMarkers";
import type { ChartAxisLabel } from "@sfcr/notebook-core";

interface ChartSeries {
  highlightKey?: string;
  legendTooltip?: string;
  name: string;
  referenceTraceKind?: ReferenceTraceKind;
  unit?: string;
  values: number[];
}

/** Monte Carlo (or other) envelope drawn behind a matching mean series. */
export interface ChartBand {
  /** Must match `ChartSeries.name` for axis colour / scale association. */
  seriesName: string;
  lo: number[];
  hi: number[];
}

export type ChartAxisMode = "shared" | "separate";
;

interface ResultChartProps {
  addVariableOptions?: string[];
  axisMode?: ChartAxisMode;
  /**
   * Buckets series onto shared axes. Each inner array lists series names (or
   * highlight keys) that should share one y-axis; series omitted from every group
   * get their own axis. Implies multiple axes (overrides `axisMode: "shared"`).
   */
  axisGroups?: string[][];
  axisSnapTolarance?: number;
  niceScale?: boolean;
  onAddVariable?(variableName: string): void;
  onMoveVariable?(variableName: string, direction: "left" | "right"): void;
  onRemoveVariable?(variableName: string): void;
  /** Persist the slider window as chart `timeRangeInclusive` (or clear when `undefined`). */
  onTimeRangeInclusiveChange?(range: [number, number] | undefined): void;
  overlaySeries?: ChartSeries[];
  /** Optional fill bands keyed by series name (drawn under the matching mean polyline). */
  bands?: ChartBand[];
  periodLabelOffset?: number;
  /**
   * When set, the time axis renders calendar years instead of period numbers:
   * the first plotted period (period 1) maps to `originYear`, period 2 to
   * `originYear + 1`, and so on. Threaded from the notebook's
   * `metadata.timeAxis.startYear`.
   */
  originYear?: number;
  referenceTraceKind?: ReferenceTraceKind;
  referenceTraceLegendLabel?: string;
  referenceTraceLegendLabels?: Array<{ kind: ReferenceTraceKind; label: string }>;
  scenarioShocks?: ScenarioShockMarker[];
  seriesRanges?: Record<string, ChartAxisRange | undefined>;
  selectedIndex?: number;
  series: ChartSeries[];
  sharedRange?: ChartAxisRange;
  timeRangeDefaults?: { endPeriodInclusive: number; startPeriodInclusive: number };
  timeRangeInclusive?: [number, number];
  /**
   * `"auto"` shows a brush when the run is long enough. Drags update local zoom state;
   * pass `onTimeRangeInclusiveChange` to offer Store/Clear for the chart cell.
   */
  timeRangeSlider?: boolean | "auto";
  graphSlice?: MatrixGraphSliceHighlight | null;
  highlightedVariable?: string | null;
  isPinned?: boolean;
  legendMode?: "expression" | "cross";
  legendModeCrossHint?: string;
  onDismiss?(): void;
  onGraphExpressionHighlightChange?(expression: string | null): void;
  onGraphSliceHighlightChange?(slice: MatrixGraphSliceHighlight | null): void;
  onInspectScenarioShockVariable?(variableName: string): void;
  onToggleLegendMode?(): void;
  onTogglePin?(): void;
  title?: string;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
  showAxisSummary?: boolean;
  xAxisTitle?: string;
  yAxis?: ChartAxisLabel;
  yAxisTickCount?: number;
  /** Tick label size in SVG units; axis title uses this + 1. Defaults to 11. */
  axisFontSize?: number;
}

const SERIES_COLORS = ["#111827", "#ec4899", "#ea580c", "#6366f1", "#059669", "#0284c7"];
const OBSERVED_TRACE_COLOR = "#dc2626";
export const LEGEND_MENU_OPEN_DELAY_MS = 450;
export const LEGEND_MENU_CLOSE_DELAY_MS = 150;
const X_TICK_LABEL_OFFSET = 10;
const X_AXIS_TITLE_OFFSET = 12;
const CHART_VIEWBOX_WIDTH = 900;
const CHART_MAIN_HEIGHT = 360;
const CHART_TOP_PADDING = 18;
const AXIS_TITLE_ROW_OFFSET = 13;
const CHART_BOTTOM_PADDING = 28;
const TIME_RANGE_SLIDER_MIN_PERIODS = 10;
const TIME_RANGE_SLIDER_SECTION_HEIGHT = 48;
const TIME_RANGE_SLIDER_HANDLE_WIDTH = 10;
const SCENARIO_SHOCK_LABEL_HEIGHT = 14;
const SCENARIO_SHOCK_LABEL_GAP = 0;
const SCENARIO_SHOCK_BAND_OPACITY = 0.04;
const AXIS_TITLE_FONT_SIZE = 12;
const AXIS_TITLE_AVERAGE_CHAR_WIDTH = AXIS_TITLE_FONT_SIZE * 0.58;
const CHART_AXIS_TITLE_MAX_LENGTH = 3;
const CHART_GROUP_AXIS_TITLE_MAX_LENGTH = 14;
const SCENARIO_SHOCK_LABEL_AXIS_GAP = 4;
const DEFAULT_X_AXIS_TITLE = "yr";
const DEFAULT_Y_AXIS_TITLE = "Value";
const Y_AXIS_UNIT_LABEL_OFFSET = 14;
const Y_AXIS_UNIT_FONT_SIZE = 9;
const DEFAULT_TICK_FONT_SIZE = 11;

function resolveChartLayoutMetrics(tickFontSize: number): {
  primaryAxisWidth: number;
  axisSpacing: number;
  bottomPadding: number;
  xTickLabelOffset: number;
  xAxisTitleOffset: number;
  yAxisLabelGap: number;
  yAxisUnitLabelOffset: number;
} {
  const fontScale = tickFontSize / DEFAULT_TICK_FONT_SIZE;
  const enlarged = fontScale > 1;
  return {
    primaryAxisWidth: Math.round(56 * fontScale + (enlarged ? 8 : 0)),
    axisSpacing: Math.round(42 * fontScale),
    bottomPadding: Math.round(CHART_BOTTOM_PADDING * fontScale + (enlarged ? 12 : 0)),
    xTickLabelOffset: Math.round(X_TICK_LABEL_OFFSET * fontScale + (enlarged ? 6 : 0)),
    xAxisTitleOffset: Math.round(X_AXIS_TITLE_OFFSET * fontScale),
    yAxisLabelGap: Math.round(12 * fontScale),
    yAxisUnitLabelOffset: Math.round(Y_AXIS_UNIT_LABEL_OFFSET * fontScale)
  };
}

function renderSeparateAxisTitle(name: string): ReactNode {
  const plain = renderVariableMathPlainText(name);
  if (plain.length <= CHART_AXIS_TITLE_MAX_LENGTH) {
    return renderVariableMathSvgLabel(name);
  }
  return formatChartAxisTitlePlain(name);
}

function formatGroupAxisTitle(label: string): string {
  return label.length > CHART_GROUP_AXIS_TITLE_MAX_LENGTH
    ? `${label.slice(0, CHART_GROUP_AXIS_TITLE_MAX_LENGTH - 1)}…`
    : label;
}

function resolveYAxisUnit(
  axisMode: ChartAxisMode,
  entry: { unit?: string },
  yAxisConfig?: ChartAxisLabel
): string | undefined {
  const unit = axisMode === "shared" ? yAxisConfig?.unit : entry.unit;
  const trimmed = unit?.trim();
  return trimmed ? trimmed : undefined;
}

function lowestTickLabelY(
  ticks: number[],
  topPadding: number,
  plotHeight: number,
  min: number,
  range: number
): number {
  const bottomTick = ticks.reduce((lowest, tick) => (tick < lowest ? tick : lowest), ticks[0] ?? min);
  return toY(bottomTick, topPadding, plotHeight, min, range) + 3;
}

function formatChartAxisTitlePlain(
  name: string,
  maxLength = CHART_AXIS_TITLE_MAX_LENGTH
): string {
  const plain = renderVariableMathPlainText(name);
  if (plain.length <= maxLength) {
    return plain;
  }
  return plain.slice(0, maxLength);
}

export function ResultChart({
  addVariableOptions,
  axisMode: axisModeProp = "shared",
  axisGroups,
  axisSnapTolarance,
  niceScale = false,
  onAddVariable,
  onMoveVariable,
  onRemoveVariable,
  onTimeRangeInclusiveChange,
  overlaySeries = [],
  bands = [],
  periodLabelOffset = 0,
  originYear,
  referenceTraceKind,
  referenceTraceLegendLabel,
  referenceTraceLegendLabels,
  scenarioShocks = [],
  seriesRanges,
  series,
  sharedRange,
  timeRangeDefaults,
  timeRangeInclusive,
  timeRangeSlider = "auto",
  highlightedVariable = null,
  graphSlice = null,
  isPinned = false,
  legendMode = "expression",
  legendModeCrossHint = "cross labels",
  onDismiss,
  onGraphExpressionHighlightChange,
  onGraphSliceHighlightChange,
  onInspectScenarioShockVariable,
  onToggleLegendMode,
  onTogglePin,
  title = "Chart",
  variableDescriptions,
  variableUnitMetadata,
  showAxisSummary = true,
  xAxisTitle = DEFAULT_X_AXIS_TITLE,
  yAxis,
  yAxisTickCount = DEFAULT_AXIS_TICK_COUNT,
  axisFontSize,
  selectedIndex = 0
}: ResultChartProps) {
  const tickFontSize = axisFontSize ?? DEFAULT_TICK_FONT_SIZE;
  const axisTitleFontSize = axisFontSize != null ? axisFontSize + 1 : AXIS_TITLE_FONT_SIZE;
  const axisUnitFontSize = axisFontSize != null ? Math.max(axisFontSize - 2, 8) : Y_AXIS_UNIT_FONT_SIZE;
  const chartLayout = resolveChartLayoutMetrics(tickFontSize);
  const periodToAxisValue = (periodNumber: number) =>
    originYear != null ? originYear + periodNumber - 1 : periodNumber;
  const [hoveredDatum, setHoveredDatum] = useState<{ index: number; seriesName: string } | null>(null);
  const [hiddenSeriesNames, setHiddenSeriesNames] = useState<Set<string>>(() => new Set());
  const [isAddVariableMenuOpen, setIsAddVariableMenuOpen] = useState(false);
  const [openLegendMenuSeriesName, setOpenLegendMenuSeriesName] = useState<string | null>(null);
  const [legendMenuAnchorRect, setLegendMenuAnchorRect] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [addMenuAnchorRect, setAddMenuAnchorRect] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const addVariableMenuRef = useRef<HTMLDivElement | null>(null);
  const legendItemRefs = useRef(new Map<string, HTMLElement>());
  const legendMenuOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const legendMenuCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const syncedTimeRangeSourceKeyRef = useRef<string | null>(null);
  const addVariableMenuId = useId();
  const normalizedSeries = series
    .map((entry, index) => ({
      ...entry,
      colorIndex: index % SERIES_COLORS.length,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      finiteValues: entry.values.filter(Number.isFinite)
    }))
    .filter((entry) => entry.values.length > 1 && entry.finiteValues.length > 0);
  const normalizedOverlaySeries = overlaySeries
    .map((entry) => {
      const matchingSeries = normalizedSeries.find((candidate) => candidate.name === entry.name);
      if (!matchingSeries) {
        return null;
      }
      // Reference traces (e.g. observed data) may cover fewer periods than the
      // simulation. Pad the trailing periods with NaN so the trace shares the
      // main series' period axis and simply finishes at its last real point
      // instead of stretching across the full width.
      const alignedValues =
        entry.values.length < matchingSeries.values.length
          ? [
              ...entry.values,
              ...Array.from(
                { length: matchingSeries.values.length - entry.values.length },
                () => Number.NaN
              )
            ]
          : entry.values;
      return {
        ...entry,
        values: alignedValues,
        color: matchingSeries.color,
        finiteValues: alignedValues.filter(Number.isFinite)
      };
    })
    .filter(
      (
        entry
      ): entry is ChartSeries & { color: string; finiteValues: number[] } =>
        entry != null && entry.values.length > 1 && entry.finiteValues.length > 0
    );

  const useAxisGroups =
    Array.isArray(axisGroups) && axisGroups.some((group) => group.some((name) => name.trim() !== ""));
  const axisMode: ChartAxisMode = useAxisGroups ? "separate" : axisModeProp;
  const axisGroupIndexByName = new Map<string, number>();
  if (useAxisGroups) {
    axisGroups!.forEach((group, groupIndex) => {
      group.forEach((member) => {
        const trimmed = member.trim();
        if (trimmed === "") {
          return;
        }
        normalizedSeries.forEach((entry) => {
          if (
            !axisGroupIndexByName.has(entry.name) &&
            (entry.name === trimmed || entry.highlightKey === trimmed)
          ) {
            axisGroupIndexByName.set(entry.name, groupIndex);
          }
        });
      });
    });
  }
  const resolveAxisGroupKey = (name: string): string => {
    const groupIndex = axisGroupIndexByName.get(name);
    return groupIndex == null ? `solo:${name}` : `group:${groupIndex}`;
  };

  const hoveredSeriesName = hoveredDatum?.seriesName ?? null;

  useEffect(() => {
    if (!onGraphExpressionHighlightChange) {
      return;
    }

    if (!hoveredSeriesName) {
      onGraphExpressionHighlightChange(null);
      return;
    }

    const activeSeries = normalizedSeries.find((entry) => entry.name === hoveredSeriesName);
    const expression = activeSeries?.highlightKey ?? activeSeries?.name ?? null;
    onGraphExpressionHighlightChange(expression);
  }, [hoveredSeriesName, normalizedSeries, onGraphExpressionHighlightChange]);

  function handleChartHoverZoneEnter(): void {
    if (graphSlice) {
      onGraphSliceHighlightChange?.(graphSlice);
    }
  }

  function handleChartHoverZoneLeave(): void {
    setHoveredDatum(null);
    onGraphSliceHighlightChange?.(null);
    onGraphExpressionHighlightChange?.(null);
  }

  function updateHoveredDatum(nextHover: { index: number; seriesName: string }): void {
    setHoveredDatum((current) =>
      current?.seriesName === nextHover.seriesName && current.index === nextHover.index
        ? current
        : nextHover
    );
  }

  const provisionalSeriesLength =
    normalizedSeries.length > 0
      ? Math.max(...normalizedSeries.map((entry) => entry.values.length))
      : 1;
  const timeRangeSourceKey = [
    timeRangeInclusive?.[0] ?? "",
    timeRangeInclusive?.[1] ?? "",
    timeRangeDefaults?.startPeriodInclusive ?? "",
    timeRangeDefaults?.endPeriodInclusive ?? "",
    provisionalSeriesLength
  ].join("|");
  const [interactiveTimeRange, setInteractiveTimeRange] = useState(() =>
    resolveTimeRange(timeRangeInclusive, timeRangeDefaults, provisionalSeriesLength)
  );

  useEffect(() => {
    if (syncedTimeRangeSourceKeyRef.current === timeRangeSourceKey) {
      return;
    }

    syncedTimeRangeSourceKeyRef.current = timeRangeSourceKey;
    setInteractiveTimeRange(
      resolveTimeRange(timeRangeInclusive, timeRangeDefaults, provisionalSeriesLength)
    );
  }, [timeRangeSourceKey, timeRangeInclusive, timeRangeDefaults, provisionalSeriesLength]);

  const selectableVariableNames = (addVariableOptions ?? []).filter(
    (name) =>
      !normalizedSeries.some((entry) => entry.name === name || entry.highlightKey === name)
  );
  const canAddVariable = onAddVariable != null && selectableVariableNames.length > 0;
  const hasLegendContextMenu = onMoveVariable != null || onRemoveVariable != null;
  const legendDocumentHighlight = onGraphExpressionHighlightChange ? null : highlightedVariable;

  useEffect(() => {
    if (!canAddVariable && isAddVariableMenuOpen) {
      setIsAddVariableMenuOpen(false);
    }
  }, [canAddVariable, isAddVariableMenuOpen]);

  useEffect(() => {
    if (!isAddVariableMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;
      if (
        target instanceof Element &&
        (addVariableMenuRef.current?.contains(target) ||
          target.closest(".chart-legend-add-menu"))
      ) {
        return;
      }

      setIsAddVariableMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsAddVariableMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAddVariableMenuOpen]);

  useLayoutEffect(() => {
    if (!isAddVariableMenuOpen) {
      setAddMenuAnchorRect(null);
      return undefined;
    }

    if (!addVariableMenuRef.current) {
      return undefined;
    }

    function updatePosition(): void {
      const node = addVariableMenuRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      setAddMenuAnchorRect({ left: rect.left, bottom: rect.bottom });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isAddVariableMenuOpen]);

  useLayoutEffect(() => {
    if (!openLegendMenuSeriesName) {
      setLegendMenuAnchorRect(null);
      return undefined;
    }

    const seriesName = openLegendMenuSeriesName;
    if (!legendItemRefs.current.get(seriesName)) {
      return undefined;
    }

    function updatePosition(): void {
      const node = legendItemRefs.current.get(seriesName);
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      setLegendMenuAnchorRect({ left: rect.left, bottom: rect.bottom });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openLegendMenuSeriesName]);

  useEffect(() => {
    return () => {
      if (legendMenuOpenTimeoutRef.current != null) {
        clearTimeout(legendMenuOpenTimeoutRef.current);
      }
      if (legendMenuCloseTimeoutRef.current != null) {
        clearTimeout(legendMenuCloseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openLegendMenuSeriesName) {
      return undefined;
    }

    function handleClick(event: MouseEvent): void {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".chart-legend-context-menu") ||
          target.closest(".legend-item.is-menu-open"))
      ) {
        return;
      }

      clearLegendMenuTimers();
      setOpenLegendMenuSeriesName(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        clearLegendMenuTimers();
        setOpenLegendMenuSeriesName(null);
      }
    }

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openLegendMenuSeriesName]);

  function clearLegendMenuTimers(): void {
    if (legendMenuOpenTimeoutRef.current != null) {
      clearTimeout(legendMenuOpenTimeoutRef.current);
      legendMenuOpenTimeoutRef.current = null;
    }
    if (legendMenuCloseTimeoutRef.current != null) {
      clearTimeout(legendMenuCloseTimeoutRef.current);
      legendMenuCloseTimeoutRef.current = null;
    }
  }

  if (normalizedSeries.length === 0) {
    if (!canAddVariable || onAddVariable == null) {
      return title !== "Chart" || onDismiss || onTogglePin ? (
        <section className="result-panel result-chart-empty">
          <div className="panel-header">
            <div className="result-chart-heading">
              <h2>{title}</h2>
              {onTogglePin || onDismiss ? (
                <div className="result-chart-heading-actions">
                  {onTogglePin ? (
                    <button
                      type="button"
                      className="result-chart-pin-button"
                      aria-label={isPinned ? "Unpin chart" : "Pin chart"}
                      aria-pressed={isPinned ? "true" : "false"}
                      title={isPinned ? "Unpin chart" : "Pin chart"}
                      onClick={onTogglePin}
                    >
                      <PinToggleIcon pinned={isPinned} />
                    </button>
                  ) : null}
                  {onDismiss ? (
                    <button
                      type="button"
                      className="result-chart-dismiss-button"
                      aria-label="Remove chart"
                      title="Remove chart"
                      onClick={onDismiss}
                    >
                      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                        <path
                          d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.5"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <p className="chart-empty-variable-picker-hint">No graphable series available.</p>
        </section>
      ) : null;
    }

    return (
      <section className="result-panel result-chart-empty">
        <div className="panel-header">
          <div className="result-chart-heading">
            <h2>{title}</h2>
            {onTogglePin || onDismiss ? (
              <div className="result-chart-heading-actions">
                {onTogglePin ? (
                  <button
                    type="button"
                    className="result-chart-pin-button"
                    aria-label={isPinned ? "Unpin chart" : "Pin chart"}
                    aria-pressed={isPinned ? "true" : "false"}
                    title={isPinned ? "Unpin chart" : "Pin chart"}
                    onClick={onTogglePin}
                  >
                    <PinToggleIcon pinned={isPinned} />
                  </button>
                ) : null}
                {onDismiss ? (
                  <button
                    type="button"
                    className="result-chart-dismiss-button"
                    aria-label="Remove chart"
                    title="Remove chart"
                    onClick={onDismiss}
                  >
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                      <path
                        d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="chart-empty-variable-picker">
          <p className="chart-empty-variable-picker-hint">Add a variable to graph</p>
          <div
            className="chart-empty-variable-picker-list"
            role="listbox"
            aria-label="Available chart variables"
          >
            {selectableVariableNames.map((name) => (
              <button
                key={name}
                type="button"
                className="chart-legend-add-option"
                role="option"
                onClick={() => onAddVariable(name)}
              >
                <span className="chart-legend-add-option-name">
                  <VariableMathLabel name={name} />
                </span>
                {variableDescriptions?.get(name) ? (
                  <span className="chart-legend-add-option-description">
                    {variableDescriptions.get(name)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const visibleSeries = normalizedSeries.filter((entry) => !hiddenSeriesNames.has(entry.name));
  const visibleSeriesNames = new Set(visibleSeries.map((entry) => entry.name));
  const visibleOverlaySeries = normalizedOverlaySeries.filter((entry) => visibleSeriesNames.has(entry.name));
  const referenceLegendItems = referenceTraceLegendLabels ?? (
    referenceTraceLegendLabel
      ? [{ kind: referenceTraceKind ?? "baseline", label: referenceTraceLegendLabel }]
      : []
  );

  const width = CHART_VIEWBOX_WIDTH;
  const seriesLength = Math.max(...visibleSeries.map((entry) => entry.values.length));
  const showTimeRangeSlider =
    timeRangeSlider !== false &&
    (timeRangeSlider === true || timeRangeSlider === "auto") &&
    seriesLength >= TIME_RANGE_SLIDER_MIN_PERIODS;
  const height = CHART_MAIN_HEIGHT;
  const sliderHeight = TIME_RANGE_SLIDER_SECTION_HEIGHT;
  const bottomPadding = chartLayout.bottomPadding;
  const rightPadding = 20;
  const axisSpacing = chartLayout.axisSpacing;
  const primaryAxisWidth = chartLayout.primaryAxisWidth;
  const xTickLabelOffset = chartLayout.xTickLabelOffset;
  const xAxisTitleOffset = chartLayout.xAxisTitleOffset;
  const yAxisLabelGap = chartLayout.yAxisLabelGap;
  const yAxisUnitLabelOffset = chartLayout.yAxisUnitLabelOffset;
  const axisCount =
    axisMode === "separate"
      ? useAxisGroups
        ? new Set(normalizedSeries.map((entry) => resolveAxisGroupKey(entry.name))).size
        : normalizedSeries.length
      : 1;
  // Stagger neighboring axis titles onto two rows so closely spaced labels do not overlap.
  const staggerAxisTitles = axisMode === "separate" && axisCount >= 2;
  const topPadding = CHART_TOP_PADDING + (staggerAxisTitles ? AXIS_TITLE_ROW_OFFSET : 0);
  const leftPadding = primaryAxisWidth + axisSpacing * Math.max(axisCount - 1, 0);
  const plotWidth = width - leftPadding - rightPadding;
  const plotHeight = CHART_MAIN_HEIGHT - topPadding - bottomPadding;
  const staticTimeRange = resolveTimeRange(timeRangeInclusive, timeRangeDefaults, seriesLength);
  const resolvedTimeRange = showTimeRangeSlider
    ? clampInteractiveTimeRange(interactiveTimeRange, seriesLength)
    : staticTimeRange;
  const visibleStartIndex = resolvedTimeRange.startPeriodInclusive - 1;
  const visibleEndIndex = resolvedTimeRange.endPeriodInclusive - 1;
  const visibleLength = visibleEndIndex - visibleStartIndex + 1;
  const xTickCount = Math.min(6, visibleLength);
  const xTicks = buildIntegerTicks(visibleLength, xTickCount).map((tick) => visibleStartIndex + tick);
  const activeIndex = Math.min(Math.max(selectedIndex, visibleStartIndex), visibleEndIndex);
  const activeVisibleIndex = activeIndex - visibleStartIndex;

  const baseAxisMetrics = visibleSeries.map((entry) => {
    const visibleValues = entry.values.slice(visibleStartIndex, visibleEndIndex + 1);
    const visibleReferenceValues = visibleOverlaySeries
      .filter((overlay) => overlay.name === entry.name)
      .flatMap((overlay) => overlay.values.slice(visibleStartIndex, visibleEndIndex + 1));
    const matchingBand = bands.find((band) => band.seriesName === entry.name);
    const visibleBandValues = matchingBand
      ? [
          ...matchingBand.lo.slice(visibleStartIndex, visibleEndIndex + 1),
          ...matchingBand.hi.slice(visibleStartIndex, visibleEndIndex + 1)
        ]
      : [];
    const scaleValues = [...visibleValues, ...visibleReferenceValues, ...visibleBandValues].filter(
      Number.isFinite
    );
    const fallbackScaleValues = entry.values.filter(Number.isFinite);

    return {
      ...entry,
      visibleValues,
      visibleScaleValues: scaleValues.length > 0 ? scaleValues : fallbackScaleValues,
      axisRangeConfig: seriesRanges?.[entry.name],
      ...buildAxisMetrics(
        scaleValues.length > 0 ? scaleValues : fallbackScaleValues,
        seriesRanges?.[entry.name],
        yAxisTickCount,
        { exactTickCount: axisMode === "separate", niceScale }
      )
    };
  });
  let axisMetrics: typeof baseAxisMetrics;
  if (useAxisGroups) {
    const groupValuesByKey = new Map<string, number[]>();
    baseAxisMetrics.forEach((entry) => {
      const key = resolveAxisGroupKey(entry.name);
      if (key.startsWith("solo:")) {
        return;
      }
      const collected = groupValuesByKey.get(key) ?? [];
      collected.push(...entry.visibleScaleValues.filter(Number.isFinite));
      groupValuesByKey.set(key, collected);
    });
    const groupMetricsByKey = new Map<string, ReturnType<typeof buildAxisMetrics>>();
    groupValuesByKey.forEach((values, key) => {
      groupMetricsByKey.set(
        key,
        buildAxisMetrics(values, undefined, yAxisTickCount, { exactTickCount: true, niceScale })
      );
    });
    axisMetrics = baseAxisMetrics.map((entry) => {
      const groupMetrics = groupMetricsByKey.get(resolveAxisGroupKey(entry.name));
      return groupMetrics ? { ...entry, ...groupMetrics } : entry;
    });
  } else if (axisMode === "separate") {
    axisMetrics = snapAxisMetrics(baseAxisMetrics, axisSnapTolarance, { exactTickCount: true, niceScale });
  } else {
    axisMetrics = baseAxisMetrics;
  }

  // One drawn axis per group; solo series keep their own axis and color.
  const drawnAxisMetrics = useAxisGroups
    ? (() => {
        const seenKeys = new Set<string>();
        return axisMetrics.flatMap((entry) => {
          const key = resolveAxisGroupKey(entry.name);
          if (seenKeys.has(key)) {
            return [];
          }
          seenKeys.add(key);
          const members = axisMetrics.filter((candidate) => resolveAxisGroupKey(candidate.name) === key);
          if (members.length <= 1) {
            return [{ ...entry, memberNames: [entry.name], isGroup: false }];
          }
          const memberNames = members.map((member) => member.name);
          const groupUnit = members[0].unit;
          const allSameUnit = members.every((member) => member.unit === groupUnit);
          return [
            {
              ...entry,
              memberNames,
              isGroup: true,
              name: memberNames.join(", "),
              color: "#0f172a",
              unit: allSameUnit ? groupUnit : undefined
            }
          ];
        });
      })()
    : axisMetrics.map((entry) => ({ ...entry, memberNames: [entry.name], isGroup: false }));
  const sharedFiniteValues = axisMetrics.flatMap((entry) => entry.visibleScaleValues.filter(Number.isFinite));
  const sharedMetrics = buildAxisMetrics(sharedFiniteValues, sharedRange, yAxisTickCount, {
    niceScale
  });
  const primaryMetrics = axisMode === "shared" ? sharedMetrics : axisMetrics[0];
  const hoveredMetric = hoveredDatum
    ? axisMetrics.find((entry) => entry.name === hoveredDatum.seriesName) ?? null
    : null;
  const fallbackHoverVisibleIndex = activeVisibleIndex;
  const resolvedHoverVisibleIndex =
    hoveredDatum != null
      ? Math.min(Math.max(hoveredDatum.index, 0), Math.max(visibleLength - 1, 0))
      : fallbackHoverVisibleIndex;
  const hasScenarioShocks = scenarioShocks.length > 0;
  const ariaLabel =
    axisMode === "shared"
      ? showTimeRangeSlider
        ? hasScenarioShocks
          ? "Simulation result chart with shared left axis, scenario shock markers, and time range slider"
          : "Simulation result chart with shared left axis and time range slider"
        : hasScenarioShocks
          ? "Simulation result chart with shared left axis and scenario shock markers"
          : "Simulation result chart with shared left axis"
      : showTimeRangeSlider
        ? hasScenarioShocks
          ? "Simulation result chart with multiple left axes, scenario shock markers, and time range slider"
          : "Simulation result chart with multiple left axes and time range slider"
        : hasScenarioShocks
          ? "Simulation result chart with multiple left axes and scenario shock markers"
          : "Simulation result chart with multiple left axes";
  const visibleScenarioShocks = scenarioShocks
    .map((marker) =>
      resolveVisibleScenarioShockGeometry(
        marker,
        visibleStartIndex,
        visibleEndIndex,
        leftPadding,
        plotWidth,
        visibleLength
      )
    )
    .filter((entry): entry is VisibleScenarioShockGeometry => entry != null);
  const minScenarioShockLabelX = resolveMinScenarioShockLabelX({
    axisMode,
    leftPadding,
    primarySeriesName: axisMetrics[0]?.name
  });
  const hoverTooltip =
    hoveredDatum && hoveredMetric
      ? buildHoverTooltip(
          hoveredMetric,
          resolvedHoverVisibleIndex,
          visibleStartIndex,
          periodLabelOffset,
          leftPadding,
          topPadding,
          plotWidth,
          plotHeight,
          axisMode === "shared" ? sharedMetrics.min : hoveredMetric.min,
          axisMode === "shared" ? sharedMetrics.range : hoveredMetric.range,
          visibleLength,
          variableDescriptions,
          variableUnitMetadata
        )
      : null;

  function openLegendMenu(seriesName: string): void {
    clearLegendMenuTimers();
    setIsAddVariableMenuOpen(false);
    setOpenLegendMenuSeriesName(seriesName);
  }

  function scheduleLegendMenuOpen(seriesName: string): void {
    if (legendMenuCloseTimeoutRef.current != null) {
      clearTimeout(legendMenuCloseTimeoutRef.current);
      legendMenuCloseTimeoutRef.current = null;
    }
    if (openLegendMenuSeriesName === seriesName) {
      return;
    }
    if (legendMenuOpenTimeoutRef.current != null) {
      clearTimeout(legendMenuOpenTimeoutRef.current);
    }
    legendMenuOpenTimeoutRef.current = setTimeout(() => {
      legendMenuOpenTimeoutRef.current = null;
      setIsAddVariableMenuOpen(false);
      setOpenLegendMenuSeriesName(seriesName);
    }, LEGEND_MENU_OPEN_DELAY_MS);
  }

  function keepLegendMenuOpen(): void {
    if (legendMenuCloseTimeoutRef.current != null) {
      clearTimeout(legendMenuCloseTimeoutRef.current);
      legendMenuCloseTimeoutRef.current = null;
    }
  }

  function scheduleLegendMenuClose(): void {
    if (legendMenuOpenTimeoutRef.current != null) {
      clearTimeout(legendMenuOpenTimeoutRef.current);
      legendMenuOpenTimeoutRef.current = null;
    }
    if (legendMenuCloseTimeoutRef.current != null) {
      clearTimeout(legendMenuCloseTimeoutRef.current);
    }
    legendMenuCloseTimeoutRef.current = setTimeout(() => {
      legendMenuCloseTimeoutRef.current = null;
      setOpenLegendMenuSeriesName(null);
    }, LEGEND_MENU_CLOSE_DELAY_MS);
  }

  function beginTimeRangeDrag(
    mode: "end" | "pan" | "start",
    event: ReactPointerEvent<SVGElement>
  ): void {
    event.preventDefault();
    event.stopPropagation();

    const svgElement = chartSvgRef.current;
    if (!svgElement) {
      return;
    }

    const originX = pointerEventToSvgX(event, svgElement, width);
    const originRange = resolvedTimeRange;

    function handlePointerMove(moveEvent: PointerEvent): void {
      const svg = chartSvgRef.current;
      if (!svg) {
        return;
      }

      const nextX = pointerEventToSvgX(moveEvent, svg, width);
      setInteractiveTimeRange(
        applyTimeRangeDrag({
          leftPadding,
          mode,
          nextX,
          originEnd: originRange.endPeriodInclusive,
          originStart: originRange.startPeriodInclusive,
          originX,
          plotWidth,
          seriesLength
        })
      );
    }

    function handlePointerUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId === event.pointerId) {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const overviewFiniteValues = visibleSeries.flatMap((entry) => entry.values.filter(Number.isFinite));
  const overviewMetrics = showTimeRangeSlider
    ? buildAxisMetrics(
        overviewFiniteValues.length > 0 ? overviewFiniteValues : [0, 1],
        sharedRange,
        3,
        { niceScale: false }
      )
    : { min: 0, max: 1, range: 1, ticks: [0, 1] };
  const rangeSliderWindowLeft = toX(
    resolvedTimeRange.startPeriodInclusive - 1,
    leftPadding,
    plotWidth,
    seriesLength
  );
  const rangeSliderWindowRight = toX(
    resolvedTimeRange.endPeriodInclusive - 1,
    leftPadding,
    plotWidth,
    seriesLength
  );
  const rangeSliderPanLeft = rangeSliderWindowLeft + TIME_RANGE_SLIDER_HANDLE_WIDTH / 2;
  const rangeSliderPanWidth = Math.max(
    rangeSliderWindowRight - rangeSliderWindowLeft - TIME_RANGE_SLIDER_HANDLE_WIDTH,
    0
  );
  const storedTimeRangeCandidate = toStoredTimeRangeInclusive(
    resolvedTimeRange,
    seriesLength,
    timeRangeDefaults
  );
  const canStoreTimeRange =
    onTimeRangeInclusiveChange != null &&
    showTimeRangeSlider &&
    storedTimeRangeCandidate != null &&
    !timeRangeInclusiveEquals(timeRangeInclusive, storedTimeRangeCandidate);
  const canClearTimeRange = onTimeRangeInclusiveChange != null && timeRangeInclusive != null;

  function toggleSeriesVisibility(seriesName: string): void {
    setHiddenSeriesNames((current) => {
      const next = new Set(current);
      if (next.has(seriesName)) {
        next.delete(seriesName);
        return next;
      }

      if (normalizedSeries.length - next.size <= 1) {
        return current;
      }

      next.add(seriesName);
      return next;
    });

    setHoveredDatum((current) => (current?.seriesName === seriesName ? null : current));
  }

  return (
    <section className="result-panel">
      <div
        className="result-chart-hover-zone"
        onMouseEnter={handleChartHoverZoneEnter}
        onMouseLeave={handleChartHoverZoneLeave}
      >
        <div className="panel-header">
          <div className="result-chart-heading">
            <h2>{title}</h2>
            {onTogglePin || onDismiss || onToggleLegendMode ? (
              <div className="result-chart-heading-actions">
                {onTogglePin ? (
                  <button
                    type="button"
                    className="result-chart-pin-button"
                    aria-label={isPinned ? "Unpin chart" : "Pin chart"}
                    aria-pressed={isPinned ? "true" : "false"}
                    title={isPinned ? "Unpin chart" : "Pin chart"}
                    onClick={onTogglePin}
                  >
                    <PinToggleIcon pinned={isPinned} />
                  </button>
                ) : null}
                {onDismiss ? (
                  <button
                    type="button"
                    className="result-chart-dismiss-button"
                    aria-label="Remove chart"
                    title="Remove chart"
                    onClick={onDismiss}
                  >
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                      <path
                        d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                ) : null}
                {onToggleLegendMode ? (
                  <button
                    type="button"
                    className="result-chart-legend-mode-button"
                    aria-label={
                      legendMode === "cross"
                        ? "Show matrix cell expressions in legend"
                        : `Show ${legendModeCrossHint} in legend`
                    }
                    aria-pressed={legendMode === "cross" ? "true" : "false"}
                    title={
                      legendMode === "cross"
                        ? "Show expressions"
                        : `Show ${legendModeCrossHint}`
                    }
                    onClick={onToggleLegendMode}
                  >
                    {legendMode === "cross" ? "Exprs" : "Labels"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="chart-legend">
          {onAddVariable ? (
            <div className="legend-item legend-item-add chart-legend-add" ref={addVariableMenuRef}>
              <button
                type="button"
                className="chart-legend-add-button"
                aria-controls={addVariableMenuId}
                aria-expanded={isAddVariableMenuOpen ? "true" : "false"}
                aria-label={
                  canAddVariable ? "Add chart variable" : "No more variables available to add"
                }
                disabled={!canAddVariable}
                onClick={() => {
                  if (!canAddVariable) {
                    return;
                  }

                  setIsAddVariableMenuOpen((current) => !current);
                }}
              >
                <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.25" />
                  <path d="M8 3.25v9.5M3.25 8h9.5" />
                </svg>
              </button>
              {isAddVariableMenuOpen && addMenuAnchorRect
                ? createPortal(
                    <div
                      id={addVariableMenuId}
                      className="chart-legend-add-menu chart-legend-menu-portal"
                      role="listbox"
                      aria-label="Available chart variables"
                      style={
                        {
                          left: `${addMenuAnchorRect.left}px`,
                          top: `${addMenuAnchorRect.bottom + 6}px`
                        } as CSSProperties
                      }
                    >
                      {selectableVariableNames.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="chart-legend-add-option"
                          role="option"
                          onClick={() => {
                            onAddVariable(name);
                            setIsAddVariableMenuOpen(false);
                          }}
                        >
                          <span className="chart-legend-add-option-name">
                            <VariableMathLabel name={name} />
                          </span>
                          {variableDescriptions?.get(name) ? (
                            <span className="chart-legend-add-option-description">
                              {variableDescriptions.get(name)}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )
                : null}
            </div>
          ) : null}
          {normalizedSeries.map((entry, entryIndex) => {
            const isHidden = hiddenSeriesNames.has(entry.name);
            const isHovered = hoveredDatum?.seriesName === entry.name;
            const isLegendMenuOpen = openLegendMenuSeriesName === entry.name;
            const legendHighlightKey = entry.highlightKey ?? entry.name;
            const className = documentHighlightClassName(
              legendHighlightKey,
              legendDocumentHighlight,
              `legend-item${
                isHidden
                  ? " is-hidden"
                  : hoveredDatum
                    ? isHovered
                      ? " is-active"
                      : " is-dimmed"
                    : ""
              }`
            );

            return (
              <span
                key={entry.name}
                ref={(node) => {
                  if (node) {
                    legendItemRefs.current.set(entry.name, node);
                  } else {
                    legendItemRefs.current.delete(entry.name);
                  }
                }}
                className={`${className}${isLegendMenuOpen ? " is-menu-open" : ""}`}
                onMouseEnter={() => {
                  if (!isHidden) {
                    updateHoveredDatum({ index: fallbackHoverVisibleIndex, seriesName: entry.name });
                  }
                  if (hasLegendContextMenu) {
                    scheduleLegendMenuOpen(entry.name);
                  }
                }}
                onMouseLeave={() => {
                  if (hasLegendContextMenu) {
                    scheduleLegendMenuClose();
                  }
                }}
                onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
                  if (!hasLegendContextMenu) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  openLegendMenu(entry.name);
                }}
              >
                <InstantTooltip
                  className="legend-item-tooltip-anchor"
                  keepVisible={isLegendMenuOpen}
                  tooltip={
                    entry.legendTooltip ??
                    formatVariableTooltip(
                      variableDescriptions?.get(entry.name),
                      variableUnitMetadata?.get(entry.name)
                    )
                  }
                >
                {isHidden ? (
                  <button
                    type="button"
                    className="legend-toggle"
                    aria-label={`Show ${entry.name} trace`}
                    aria-pressed="false"
                    onClick={() => toggleSeriesVisibility(entry.name)}
                  >
                    <span className={`legend-swatch legend-swatch-${entry.colorIndex}`} aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <circle cx="8" cy="8" r="6.25" />
                        <path d="M5 5l6 6M11 5l-6 6" />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="legend-toggle"
                    aria-label={`Hide ${entry.name} trace`}
                    aria-pressed="true"
                    onClick={() => toggleSeriesVisibility(entry.name)}
                    onFocus={() => updateHoveredDatum({ index: fallbackHoverVisibleIndex, seriesName: entry.name })}
                  >
                    <span className={`legend-swatch legend-swatch-${entry.colorIndex}`} aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <circle cx="8" cy="8" r="6.25" />
                        <path d="M4.75 8.4l2.1 2.15 4.35-4.65" />
                      </svg>
                    </span>
                  </button>
                )}
                {hasLegendContextMenu ? (
                  <button
                    type="button"
                    className="legend-label legend-label-menu"
                    aria-expanded={isLegendMenuOpen ? "true" : "false"}
                    aria-haspopup="menu"
                    aria-label={`${entry.name} chart variable actions`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openLegendMenu(entry.name);
                    }}
                  >
                    <VariableMathLabel name={entry.name} />
                  </button>
                ) : (
                  <span className="legend-label">
                    <VariableMathLabel name={entry.name} />
                  </span>
                )}
                {getVariableUnitLabel(variableUnitMetadata ?? new Map(), entry.name) ? (
                  <span className="unit-badge">
                    {getVariableUnitLabel(variableUnitMetadata ?? new Map(), entry.name)}
                  </span>
                ) : null}
                {isLegendMenuOpen && legendMenuAnchorRect
                  ? createPortal(
                      <div
                        className="chart-legend-context-menu chart-legend-menu-portal"
                        role="menu"
                        aria-label={`${entry.name} chart variable actions`}
                        style={
                          {
                            left: `${legendMenuAnchorRect.left}px`,
                            top: `${legendMenuAnchorRect.bottom + 6}px`
                          } as CSSProperties
                        }
                        onMouseEnter={keepLegendMenuOpen}
                        onMouseLeave={scheduleLegendMenuClose}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {onRemoveVariable ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              clearLegendMenuTimers();
                              onRemoveVariable(entry.name);
                              setOpenLegendMenuSeriesName(null);
                            }}
                          >
                            Remove from chart
                          </button>
                        ) : null}
                        {onMoveVariable ? (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={entryIndex === 0}
                              onClick={() => {
                                clearLegendMenuTimers();
                                onMoveVariable(entry.name, "left");
                                setOpenLegendMenuSeriesName(null);
                              }}
                            >
                              Move left
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={entryIndex === normalizedSeries.length - 1}
                              onClick={() => {
                                clearLegendMenuTimers();
                                onMoveVariable(entry.name, "right");
                                setOpenLegendMenuSeriesName(null);
                              }}
                            >
                              Move right
                            </button>
                          </>
                        ) : null}
                      </div>,
                      document.body
                    )
                  : null}
                </InstantTooltip>
              </span>
            );
          })}
          {referenceLegendItems.map((item) => (
            <span className="legend-item legend-item-reference-trace" key={`reference-trace-${item.kind}`}>
              <span
                className="legend-label"
                style={item.kind === "observed" ? { color: OBSERVED_TRACE_COLOR } : undefined}
              >
                {item.label}
              </span>
            </span>
          ))}
          </div>
        </div>

        <svg
        className="result-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => {
          const nextHover = resolveHoveredDatum(
            event,
            axisMetrics,
            visibleStartIndex,
            leftPadding,
            topPadding,
            plotWidth,
            plotHeight,
            axisMode,
            sharedMetrics,
            visibleLength,
            width,
            height
          );
          if (nextHover) {
            updateHoveredDatum(nextHover);
          }
        }}
      >
        <rect
          x={leftPadding}
          y={topPadding}
          width={plotWidth}
          height={plotHeight}
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth="1"
        />

        {visibleScenarioShocks.map((shock) => {
          const bandWidth = Math.max(shock.bandX2 - shock.bandX1, 0);
          const labelX = Math.max(shock.bandX1, minScenarioShockLabelX);
          const labelWidth = Math.max(leftPadding + plotWidth - labelX, bandWidth, 1);
          const labelY = Math.max(2, topPadding - SCENARIO_SHOCK_LABEL_HEIGHT - SCENARIO_SHOCK_LABEL_GAP);

          return (
          <g
            key={`scenario-shock-band-${shock.marker.shockIndex}`}
            className="chart-scenario-shock"
            aria-label={formatScenarioShockAriaLabel(shock.marker, periodLabelOffset)}
          >
            <foreignObject
              overflow="visible"
              x={labelX}
              y={labelY}
              width={labelWidth}
              height={SCENARIO_SHOCK_LABEL_HEIGHT}
            >
              <ScenarioShockBandLabel
                highlightedVariable={highlightedVariable}
                marker={shock.marker}
                color={shock.marker.color}
                onInspect={onInspectScenarioShockVariable}
              />
            </foreignObject>
            <rect
              x={shock.bandX1}
              y={topPadding}
              width={bandWidth}
              fill={shock.marker.color}
              opacity={SCENARIO_SHOCK_BAND_OPACITY}
              height={plotHeight}
            />
            <line
              x1={shock.startLineX}
              x2={shock.startLineX}
              y1={topPadding}
              y2={topPadding + plotHeight}
              stroke={shock.marker.color}
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
            <line
              x1={shock.endLineX}
              x2={shock.endLineX}
              y1={topPadding}
              y2={topPadding + plotHeight}
              stroke={shock.marker.color}
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
          </g>
          );
        })}

        {/* Horizontal grid lines and Y-axis tick labels share the same tick list. */}
        {primaryMetrics?.ticks.map((tick) => {
          const y = toY(tick, topPadding, plotHeight, primaryMetrics.min, primaryMetrics.range);
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={leftPadding}
                x2={width - rightPadding}
                y1={y}
                y2={y}
                stroke="#cbd5e1"
                strokeWidth="1"
              />
            </g>
          );
        })}

        {xTicks.map((tickIndex) => {
          const x = toX(tickIndex - visibleStartIndex, leftPadding, plotWidth, visibleLength);
          return (
            <g key={`xtick-${tickIndex}`}>
              <line
                x1={x}
                x2={x}
                y1={topPadding}
                y2={topPadding + plotHeight}
                stroke="#d1d5db"
                strokeWidth="1"
              />
              <text
                x={x}
                y={topPadding + plotHeight + xTickLabelOffset}
                fill="#111827"
                fontSize={tickFontSize}
                textAnchor="middle"
              >
                {periodToAxisValue(tickIndex + 1 + periodLabelOffset)}
              </text>
            </g>
          );
        })}

        <line
          x1={toX(activeVisibleIndex, leftPadding, plotWidth, visibleLength)}
          x2={toX(activeVisibleIndex, leftPadding, plotWidth, visibleLength)}
          y1={topPadding}
          y2={topPadding + plotHeight}
          stroke="#0f172a"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />

        {(axisMode === "shared" ? drawnAxisMetrics.slice(0, 1) : drawnAxisMetrics).map((entry, index) => {
          const axisX = leftPadding - axisSpacing * index;
          const labelX = axisX - yAxisLabelGap;
          const axisHitLeft = labelX - 34;
          const axisHitWidth = 52;
          const axisPlainLabel = renderVariableMathPlainText(entry.name);
          const hasHoverTarget = hoveredDatum != null;
          const hoveredInAxis =
            hoveredDatum != null && entry.memberNames.includes(hoveredDatum.seriesName);
          const isAxisActive = axisMode === "shared" || !hasHoverTarget || hoveredInAxis;
          const isAxisDimmed = axisMode === "separate" && hasHoverTarget && !hoveredInAxis;
          const axisStroke = axisMode === "shared" ? "#0f172a" : entry.color;
          const axisOpacity = isAxisDimmed ? 0.28 : 1;
          const axisTicks = axisMode === "shared" ? sharedMetrics.ticks : entry.ticks;
          const axisMin = axisMode === "shared" ? sharedMetrics.min : entry.min;
          const axisRange = axisMode === "shared" ? sharedMetrics.range : entry.range;
          const axisUnit = resolveYAxisUnit(axisMode, entry, yAxis);

          return (
            <g
              key={`axis-${entry.name}`}
              className={
                axisMode === "shared"
                  ? undefined
                  : `chart-axis${isAxisActive ? " is-active" : ""}${isAxisDimmed ? " is-dimmed" : ""}`
              }
              onMouseEnter={() =>
                updateHoveredDatum({ index: fallbackHoverVisibleIndex, seriesName: entry.name })
              }
            >
              {axisMode === "shared" ? null : (
                <title>
                  {axisPlainLabel.length > CHART_AXIS_TITLE_MAX_LENGTH
                    ? axisPlainLabel
                    : formatVariableTooltip(
                        variableDescriptions?.get(entry.name),
                        variableUnitMetadata?.get(entry.name)
                      )}
                </title>
              )}
              <rect
                x={axisHitLeft}
                y={topPadding - 18 - (staggerAxisTitles ? AXIS_TITLE_ROW_OFFSET : 0)}
                width={axisHitWidth}
                height={plotHeight + 28 + (staggerAxisTitles ? AXIS_TITLE_ROW_OFFSET : 0)}
                fill="transparent"
              />
              <line
                x1={axisX}
                x2={axisX}
                y1={topPadding}
                y2={topPadding + plotHeight}
                stroke={axisStroke}
                opacity={axisOpacity}
                strokeWidth="1.5"
              />

              <text
                x={axisX}
                y={topPadding - 5 - (staggerAxisTitles && index % 2 === 1 ? AXIS_TITLE_ROW_OFFSET : 0)}
                fill={axisMode === "shared" ? "#111827" : entry.color}
                opacity={axisOpacity}
                fontSize={axisTitleFontSize}
                fontWeight="700"
                textAnchor="middle"
              >
                {axisMode === "shared"
                  ? (yAxis?.title?.trim() || DEFAULT_Y_AXIS_TITLE)
                  : entry.isGroup
                    ? formatGroupAxisTitle(entry.name)
                    : renderSeparateAxisTitle(entry.name)}
              </text>

              {axisTicks.map((tick) => {
                const y = toY(
                  tick,
                  topPadding,
                  plotHeight,
                  axisMin,
                  axisRange
                );
                return (
                  <g key={`${entry.name}-${tick}`}>
                    <line
                      x1={axisX - 6}
                      x2={axisX}
                      y1={y}
                      y2={y}
                      stroke={axisMode === "shared" ? "#0f172a" : entry.color}
                      opacity={axisOpacity}
                      strokeWidth="1.5"
                    />
                    <text
                      x={labelX}
                      y={y + 3}
                      fill={axisMode === "shared" ? "#111827" : entry.color}
                      opacity={axisOpacity}
                      fontSize={tickFontSize}
                      textAnchor="end"
                    >
                      {formatAxisValue(tick)}
                    </text>
                  </g>
                );
              })}

              {axisUnit ? (
                <text
                  className="chart-axis-unit-label"
                  x={labelX}
                  y={lowestTickLabelY(axisTicks, topPadding, plotHeight, axisMin, axisRange) + yAxisUnitLabelOffset}
                  fill={axisMode === "shared" ? "#111827" : entry.color}
                  opacity={axisOpacity}
                  fontSize={axisUnitFontSize}
                  fontWeight="500"
                  textAnchor="end"
                >
                  {axisUnit}
                </text>
              ) : null}
            </g>
          );
        })}

        {axisMetrics.map((entry, index) => (
          <g
            key={`series-${entry.name}`}
            className={`chart-series${
              hoveredDatum ? (hoveredDatum.seriesName === entry.name ? " is-active" : " is-dimmed") : ""
            }`}
          >
            {(() => {
              const matchingBand = bands.find((band) => band.seriesName === entry.name);
              if (!matchingBand) {
                return null;
              }
              const bandPath = toBandAreaPath(
                matchingBand.lo.slice(visibleStartIndex, visibleEndIndex + 1),
                matchingBand.hi.slice(visibleStartIndex, visibleEndIndex + 1),
                leftPadding,
                topPadding,
                plotWidth,
                plotHeight,
                axisMode === "shared" ? sharedMetrics.min : entry.min,
                axisMode === "shared" ? sharedMetrics.range : entry.range
              );
              if (!bandPath) {
                return null;
              }
              return (
                <path
                  d={bandPath}
                  fill={entry.color}
                  fillOpacity={hoveredDatum ? (hoveredDatum.seriesName === entry.name ? 0.22 : 0.08) : 0.16}
                  pointerEvents="none"
                  stroke="none"
                />
              );
            })()}
            {visibleOverlaySeries
              .filter((overlay) => overlay.name === entry.name)
              .filter((overlay) => overlay.referenceTraceKind !== "observed")
              .map((overlay) => (
                <polyline
                  key={`overlay-${overlay.referenceTraceKind ?? "reference"}-${entry.name}`}
                  fill="none"
                  points={toPolylinePoints(
                    overlay.values.slice(visibleStartIndex, visibleEndIndex + 1),
                    leftPadding,
                    topPadding,
                    plotWidth,
                    plotHeight,
                    axisMode === "shared" ? sharedMetrics.min : entry.min,
                    axisMode === "shared" ? sharedMetrics.range : entry.range,
                    { skipNonFinite: true }
                  )}
                  pointerEvents="none"
                  stroke={entry.color}
                  strokeDasharray="5 5"
                  strokeOpacity={hoveredDatum ? (hoveredDatum.seriesName === entry.name ? 0.28 : 0.12) : 0.18}
                  strokeWidth={
                    hoveredDatum
                      ? hoveredDatum.seriesName === entry.name
                        ? 3
                        : 1.5
                      : 2
                  }
                />
              ))}
            <polyline
              fill="none"
              points={toPolylinePoints(
                entry.visibleValues,
                leftPadding,
                topPadding,
                plotWidth,
                plotHeight,
                axisMode === "shared" ? sharedMetrics.min : entry.min,
                axisMode === "shared" ? sharedMetrics.range : entry.range
              )}
              stroke={entry.color}
              strokeOpacity={hoveredDatum ? (hoveredDatum.seriesName === entry.name ? 1 : 0.22) : 1}
              strokeWidth={
                hoveredDatum
                  ? hoveredDatum.seriesName === entry.name
                    ? 3.5
                    : 1.75
                  : index === 0
                    ? 2.75
                    : 2.25
              }
            />
            <circle
              cx={toX(activeVisibleIndex, leftPadding, plotWidth, visibleLength)}
              cy={toY(
                Number.isFinite(entry.visibleValues[activeVisibleIndex])
                  ? entry.visibleValues[activeVisibleIndex]
                  : entry.min,
                topPadding,
                plotHeight,
                axisMode === "shared" ? sharedMetrics.min : entry.min,
                axisMode === "shared" ? sharedMetrics.range : entry.range
              )}
              fill="#ffffff"
              r="4.5"
              opacity={hoveredDatum ? (hoveredDatum.seriesName === entry.name ? 0.5 : 0.18) : 1}
              stroke={entry.color}
              strokeWidth="2"
            />
          </g>
        ))}

        {axisMetrics.map((entry) => {
          const min = axisMode === "shared" ? sharedMetrics.min : entry.min;
          const range = axisMode === "shared" ? sharedMetrics.range : entry.range;
          const isActive = hoveredDatum?.seriesName === entry.name;
          return visibleOverlaySeries
            .filter((overlay) => overlay.name === entry.name)
            .filter((overlay) => overlay.referenceTraceKind === "observed")
            .flatMap((overlay) =>
              overlay.values
                .slice(visibleStartIndex, visibleEndIndex + 1)
                .map((value, localIndex) =>
                  Number.isFinite(value) ? (
                    <circle
                      key={`observed-point-${entry.name}-${localIndex}`}
                      className="chart-observed-point"
                      cx={toX(localIndex, leftPadding, plotWidth, visibleLength)}
                      cy={toY(value, topPadding, plotHeight, min, range)}
                      r={isActive ? 4.5 : 3.5}
                      fill={OBSERVED_TRACE_COLOR}
                      fillOpacity={hoveredDatum ? (isActive ? 1 : 0.5) : 0.95}
                      pointerEvents="none"
                    />
                  ) : null
                )
            );
        })}

        {hoverTooltip ? (
          <g className="chart-hover" pointerEvents="none">
            <line
              x1={hoverTooltip.x}
              x2={hoverTooltip.x}
              y1={topPadding}
              y2={topPadding + plotHeight}
              stroke={hoverTooltip.color}
              strokeDasharray="3 4"
              strokeWidth="1.5"
            />
            <circle
              cx={hoverTooltip.x}
              cy={hoverTooltip.y}
              fill="#ffffff"
              r="6"
              stroke={hoverTooltip.color}
              strokeWidth="3"
            />
            <g transform={`translate(${hoverTooltip.tooltipX}, ${hoverTooltip.tooltipY})`}>
              <rect
                width={hoverTooltip.tooltipWidth}
                height={hoverTooltip.unitLabel ? "56" : "42"}
                rx="10"
                fill="rgba(15, 23, 42, 0.92)"
                stroke={hoverTooltip.color}
              />
              <text x="10" y="16" fill="#f8fafc" fontSize="11" fontWeight="700">
                {renderVariableMathSvgLabel(hoverTooltip.seriesName)} •{" "}
                {hoverTooltip.description
                  ? hoverTooltip.description
                  : originYear != null
                    ? periodToAxisValue(hoverTooltip.period)
                    : `Period ${hoverTooltip.period}`}
              </text>
              <text x="10" y="31" fill="#e2e8f0" fontSize="11">
                <tspan>Value: </tspan>
                <tspan fill={hoverTooltip.value < 0 ? "#b42318" : "#e2e8f0"}>
                  {formatAxisValue(hoverTooltip.value)}
                </tspan>
              </text>
              {hoverTooltip.unitLabel ? (
                <text x="10" y="46" fill="#cbd5e1" fontSize="11">
                  Units: {hoverTooltip.unitLabel}
                </text>
              ) : null}
              {hoverTooltip.description ? (
                <title>{`${hoverTooltip.seriesName}: ${hoverTooltip.description}`}</title>
              ) : null}
            </g>
          </g>
        ) : null}

        <text
          x={leftPadding + plotWidth / 2}
          y={topPadding + plotHeight + xTickLabelOffset + xAxisTitleOffset}
          fill="#111827"
          fontSize={axisTitleFontSize}
          textAnchor="middle"
        >
          {xAxisTitle}
        </text>

      </svg>

      {showTimeRangeSlider ? (
        <div className="chart-time-range-row">
          <svg
            ref={chartSvgRef}
            className="chart-time-range-slider-chart"
            viewBox={`0 0 ${width} ${sliderHeight}`}
            role="img"
            aria-label="Time range slider"
          >
            <g className="chart-time-range-slider">
              <rect
                x={leftPadding}
                y={0}
                width={plotWidth}
                height={sliderHeight}
                fill="#f8fafc"
                rx="4"
                stroke="#cbd5e1"
                strokeWidth="1"
              />

              {visibleSeries.map((entry, index) => (
                <polyline
                  key={`range-slider-${entry.name}`}
                  fill="none"
                  points={toPolylinePoints(
                    entry.values,
                    leftPadding,
                    4,
                    plotWidth,
                    sliderHeight - 8,
                    overviewMetrics.min,
                    overviewMetrics.range
                  )}
                  pointerEvents="none"
                  stroke={entry.color}
                  strokeOpacity={0.45}
                  strokeWidth={index === 0 ? 1.75 : 1.25}
                />
              ))}

              <rect
                x={leftPadding}
                y={0}
                width={Math.max(rangeSliderWindowLeft - leftPadding, 0)}
                height={sliderHeight}
                fill="rgba(255, 255, 255, 0.72)"
                pointerEvents="none"
              />
              <rect
                x={rangeSliderWindowRight}
                y={0}
                width={Math.max(leftPadding + plotWidth - rangeSliderWindowRight, 0)}
                height={sliderHeight}
                fill="rgba(255, 255, 255, 0.72)"
                pointerEvents="none"
              />

              <rect
                x={rangeSliderWindowLeft}
                y={0}
                width={Math.max(rangeSliderWindowRight - rangeSliderWindowLeft, 0)}
                height={sliderHeight}
                fill="rgba(148, 163, 184, 0.12)"
                pointerEvents="none"
                stroke="#64748b"
                strokeWidth="1"
              />

              {rangeSliderPanWidth > 0 ? (
                <rect
                  className="chart-time-range-slider-pan"
                  x={rangeSliderPanLeft}
                  y={0}
                  width={rangeSliderPanWidth}
                  height={sliderHeight}
                  fill="transparent"
                  onPointerDown={(event) => beginTimeRangeDrag("pan", event)}
                />
              ) : null}

              <rect
                className="chart-time-range-slider-handle chart-time-range-slider-handle-start"
                x={rangeSliderWindowLeft - TIME_RANGE_SLIDER_HANDLE_WIDTH / 2}
                y={0}
                width={TIME_RANGE_SLIDER_HANDLE_WIDTH}
                height={sliderHeight}
                fill="transparent"
                onPointerDown={(event) => beginTimeRangeDrag("start", event)}
              />
              <line
                x1={rangeSliderWindowLeft}
                x2={rangeSliderWindowLeft}
                y1={6}
                y2={sliderHeight - 6}
                pointerEvents="none"
                stroke="#475569"
                strokeWidth="2"
              />

              <rect
                className="chart-time-range-slider-handle chart-time-range-slider-handle-end"
                x={rangeSliderWindowRight - TIME_RANGE_SLIDER_HANDLE_WIDTH / 2}
                y={0}
                width={TIME_RANGE_SLIDER_HANDLE_WIDTH}
                height={sliderHeight}
                fill="transparent"
                onPointerDown={(event) => beginTimeRangeDrag("end", event)}
              />
              <line
                x1={rangeSliderWindowRight}
                x2={rangeSliderWindowRight}
                y1={6}
                y2={sliderHeight - 6}
                pointerEvents="none"
                stroke="#475569"
                strokeWidth="2"
              />
            </g>
          </svg>

          {onTimeRangeInclusiveChange ? (
            <div className="chart-time-range-actions">
              <button
                type="button"
                className="chart-time-range-store-button"
                disabled={!canStoreTimeRange}
                aria-label={
                  storedTimeRangeCandidate == null
                    ? "Store time range"
                    : `Store time range ${periodToAxisValue(storedTimeRangeCandidate[0])} to ${periodToAxisValue(storedTimeRangeCandidate[1])}`
                }
                title={
                  storedTimeRangeCandidate == null
                    ? "Adjust the slider, then store the window on this chart"
                    : `Store periods ${periodToAxisValue(storedTimeRangeCandidate[0])}–${periodToAxisValue(storedTimeRangeCandidate[1])} on this chart`
                }
                onClick={() => {
                  if (storedTimeRangeCandidate == null) {
                    return;
                  }
                  onTimeRangeInclusiveChange(storedTimeRangeCandidate);
                }}
              >
                Store range
              </button>
              {canClearTimeRange ? (
                <button
                  type="button"
                  className="chart-time-range-clear-button"
                  aria-label="Clear stored time range"
                  title="Remove the stored time range from this chart"
                  onClick={() => onTimeRangeInclusiveChange(undefined)}
                >
                  Clear range
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>

      {showAxisSummary ? (
        <div className={`chart-scale ${axisMode === "shared" ? "chart-scale-shared" : "chart-scale-multi"}`}>
          <span>
            Time axis: {periodToAxisValue(resolvedTimeRange.startPeriodInclusive + periodLabelOffset)} to {periodToAxisValue(resolvedTimeRange.endPeriodInclusive + periodLabelOffset)}
          </span>
          {axisMode === "shared" ? (
            <span>
              Shared axis: <span className={sharedMetrics.min < 0 ? "numeric-value-negative" : undefined}>{formatAxisValue(sharedMetrics.min)}</span> to <span className={sharedMetrics.max < 0 ? "numeric-value-negative" : undefined}>{formatAxisValue(sharedMetrics.max)}</span>
            </span>
          ) : (
            axisMetrics.map((entry) => (
              <InstantTooltip
                as="span"
                key={`scale-${entry.name}`}
                style={{ color: entry.color }}
                tooltip={formatVariableTooltip(
                  variableDescriptions?.get(entry.name),
                  variableUnitMetadata?.get(entry.name)
                )}
              >
                <VariableMathLabel name={entry.name} />: <span className={entry.min < 0 ? "numeric-value-negative" : undefined}>{formatAxisValue(entry.min)}</span> to <span className={entry.max < 0 ? "numeric-value-negative" : undefined}>{formatAxisValue(entry.max)}</span>
              </InstantTooltip>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function ScenarioShockBandLabel({
  color,
  highlightedVariable = null,
  marker,
  onInspect
}: {
  color: string;
  highlightedVariable?: string | null;
  marker: ScenarioShockMarker;
  onInspect?(variableName: string): void;
}) {
  return (
    <div className="chart-scenario-shock-band-label" style={{ color }}>
      {marker.variables.map((entry, entryIndex) => (
        <span key={`${marker.shockIndex}-${entry.name}`} className="chart-scenario-shock-variable">
          {entryIndex > 0 ? ", " : null}
          <ScenarioShockVariableLine
            entry={entry}
            highlightedVariable={highlightedVariable}
            inspectButtonClassName="chart-scenario-shock-variable-button"
            onInspect={onInspect}
          />
        </span>
      ))}
    </div>
  );
}

interface VisibleScenarioShockGeometry {
  bandX1: number;
  bandX2: number;
  endLineX: number;
  marker: ScenarioShockMarker;
  startLineX: number;
}

function resolveVisibleScenarioShockGeometry(
  marker: ScenarioShockMarker,
  visibleStartIndex: number,
  visibleEndIndex: number,
  leftPadding: number,
  plotWidth: number,
  visibleLength: number
): VisibleScenarioShockGeometry | null {
  const startIndex = marker.startPeriodInclusive - 1;
  const endIndex = marker.endPeriodInclusive - 1;
  if (endIndex < visibleStartIndex || startIndex > visibleEndIndex) {
    return null;
  }

  const clippedStartIndex = Math.max(startIndex, visibleStartIndex);
  const clippedEndIndex = Math.min(endIndex, visibleEndIndex);
  const startLineX = toX(clippedStartIndex - visibleStartIndex, leftPadding, plotWidth, visibleLength);
  const endLineX =
    visibleLength <= 1
      ? leftPadding + plotWidth
      : toX(clippedEndIndex - visibleStartIndex + 1, leftPadding, plotWidth, visibleLength);

  return {
    bandX1: startLineX,
    bandX2: Math.min(endLineX, leftPadding + plotWidth),
    endLineX: Math.min(endLineX, leftPadding + plotWidth),
    marker,
    startLineX
  };
}

function estimateSvgAxisTitleWidth(label: string): number {
  return label.length * AXIS_TITLE_AVERAGE_CHAR_WIDTH;
}

export function resolveMinScenarioShockLabelX({
  axisMode,
  leftPadding,
  primarySeriesName
}: {
  axisMode: ChartAxisMode;
  leftPadding: number;
  primarySeriesName?: string;
}): number {
  const axisTitle = axisMode === "shared" ? "Value" : formatChartAxisTitlePlain(primarySeriesName ?? "");
  const axisX = leftPadding;

  return axisX + estimateSvgAxisTitleWidth(axisTitle) / 2 + SCENARIO_SHOCK_LABEL_AXIS_GAP;
}

function buildHoverTooltip(
  metric: {
    color: string;
    name: string;
    visibleValues: number[];
    min: number;
    range: number;
  },
  visibleIndex: number,
  visibleStartIndex: number,
  periodLabelOffset: number,
  leftPadding: number,
  topPadding: number,
  plotWidth: number,
  plotHeight: number,
  min: number,
  range: number,
  visibleLength: number,
  variableDescriptions?: VariableDescriptions,
  variableUnitMetadata?: VariableUnitMetadata
): {
  color: string;
  description?: string;
  period: number;
  seriesName: string;
  unitLabel?: string | null;
  tooltipWidth: number;
  tooltipX: number;
  tooltipY: number;
  value: number;
  x: number;
  y: number;
} {
  const value = metric.visibleValues[visibleIndex] ?? NaN;
  const x = toX(visibleIndex, leftPadding, plotWidth, visibleLength);
  const y = toY(Number.isFinite(value) ? value : min, topPadding, plotHeight, min, range);
  const tooltipWidth = 140;
  const prefersLeft = x > leftPadding + plotWidth * 0.72;

  return {
    color: metric.color,
    description: variableDescriptions?.get(metric.name),
    unitLabel: getVariableUnitLabel(variableUnitMetadata ?? new Map(), metric.name),
    period: visibleStartIndex + visibleIndex + 1 + periodLabelOffset,
    seriesName: metric.name,
    tooltipWidth,
    tooltipX: prefersLeft ? x - tooltipWidth - 12 : x + 12,
    tooltipY: Math.max(topPadding + 8, Math.min(y - 50, topPadding + plotHeight - 50)),
    value,
    x,
    y
  };
}

function resolveHoveredDatum(
  event: ReactMouseEvent<SVGSVGElement>,
  axisMetrics: Array<{
    name: string;
    visibleValues: number[];
    min: number;
    range: number;
  }>,
  visibleStartIndex: number,
  leftPadding: number,
  topPadding: number,
  plotWidth: number,
  plotHeight: number,
  axisMode: ChartAxisMode,
  sharedMetrics: { min: number; range: number },
  visibleLength: number,
  svgWidth: number,
  svgHeight: number
): { index: number; seriesName: string } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const scaleX = svgWidth / rect.width;
  const scaleY = svgHeight / rect.height;
  const svgX = (event.clientX - rect.left) * scaleX;
  const svgY = (event.clientY - rect.top) * scaleY;

  if (
    svgX < leftPadding ||
    svgX > leftPadding + plotWidth ||
    svgY < topPadding ||
    svgY > topPadding + plotHeight
  ) {
    return null;
  }

  const relativeX = svgX - leftPadding;
  const hoveredIndex = Math.min(
    Math.max(Math.round((relativeX / Math.max(plotWidth, 1)) * Math.max(visibleLength - 1, 0)), 0),
    Math.max(visibleLength - 1, 0)
  );
  let closest: { distance: number; seriesName: string } | undefined;

  axisMetrics.forEach((entry) => {
    const value = entry.visibleValues[hoveredIndex];
    if (!Number.isFinite(value)) {
      return;
    }

    const y = toY(
      value,
      topPadding,
      plotHeight,
      axisMode === "shared" ? sharedMetrics.min : entry.min,
      axisMode === "shared" ? sharedMetrics.range : entry.range
    );
    const distance = Math.abs(svgY - y);

    if (!closest || distance < closest.distance) {
      closest = { distance, seriesName: entry.name };
    }
  });

  return closest ? { index: hoveredIndex, seriesName: closest.seriesName } : null;
}

function pointerEventToSvgX(
  event: { clientX: number },
  svg: SVGSVGElement,
  svgWidth: number
): number {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || !Number.isFinite(event.clientX)) {
    return 0;
  }

  return ((event.clientX - rect.left) / rect.width) * svgWidth;
}
