Chart cells plot variables from a run result. They are the fastest way to see model dynamics, compare scenario paths, and spot unexpected behavior.

## How To Use

1. Make sure the source run cell has been run successfully.
2. Press **Edit** on the chart cell if you need to change its source or variables.
3. Choose the run cell with `sourceRunCellId`.
4. Add variables to the `variables` list.
5. Apply the change and run the source run if needed.

A chart cell reads output from a run cell. It does not run the model by itself.

## Variables

The `variables` list controls which series appear in the chart:

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["Y", "Cd", "Mh"]
}
```

Choose variables that answer one question at a time. For example:

- Income and demand: `Y`, `Cd`, `Id`.
- Stocks: `Mh`, `Ld`, `K`, `Vh`.
- Prices or rates: `W`, `rl`, `rm`.
- Scenario comparison: a small group of variables most affected by the shock.

## Expression Series

Use `series` when you need derived quantities such as portfolio shares or percentage transforms. Each entry evaluates an expression against the source run result using the same syntax as model and matrix cells (`+`, `-`, `*`, `/`, `lag(...)`, `d(...)`, and so on).

When `series` is non-empty, it takes precedence over `variables`.

```json
{
  "type": "chart",
  "sourceRunCellId": "scenario-1-run",
  "timeRangeInclusive": [2, 25],
  "axisMode": "separate",
  "series": [
    {
      "expression": "100 * h_h / v",
      "label": "Share of money balances"
    },
    {
      "expression": "100 * b_h / v",
      "label": "Share of bills"
    }
  ]
}
```

Optional per-series fields:

- `label` for legend text (defaults to the expression).
- `range` for y-axis bounds on that series (merged with top-level `seriesRanges` keyed by the resolved label).

The `variables` list remains valid shorthand for plotting raw run series by name.

## Traces From Different Runs

By default every series reads from the chart's `sourceRunCellId`. To overlay traces from several runs on one chart, give individual series their own source run.

In `series`, set a per-entry `sourceRunCellId`. Entries without one fall back to the chart-level source run:

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "series": [
    { "expression": "Cd", "sourceRunCellId": "scenario-run" },
    { "expression": "YD", "sourceRunCellId": "austerity-run" },
    { "expression": "Id" },
    { "expression": "AF" }
  ]
}
```

The `variables` shorthand supports the same idea: append `, <runId>` to a bare variable name. Names without a run id use the chart's `sourceRunCellId`.

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["Cd, scenario-run", "YD, austerity-run", "Id", "AF"]
}
```

The shorthand only applies to bare variable names; expressions that contain commas (such as `max(a, b)`) are always treated as raw expressions, so use the `series` form for those. When the same variable is drawn from more than one run, the legend disambiguates it with the run id, e.g. `Cd (austerity-run)`.

## Axis Modes

Charts can use shared or separate axes.

Use a shared axis when variables have comparable units and scale. This makes direct visual comparison easier.

Use separate axes when variables have different magnitudes or units. This keeps small series visible when plotted with large stocks or flows.

```json
{
  "axisMode": "separate"
}
```

## Axis Groups

Use `axisGroups` to bucket variables onto shared axes instead of giving each one its own. Each inner array lists the variables (or expression labels) that share one y-axis; any series you leave out of every group keeps its own axis. Providing `axisGroups` implies multiple axes, so you do not also need `axisMode: "separate"`.

This is useful when some variables share a scale and others do not. For example, plot `Y`, `Cd`, and `Mh` together on one axis and `W` on its own:

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["Y", "Cd", "Mh", "W"],
  "axisGroups": [["Y", "Cd", "Mh"], ["W"]]
}
```

The grouped axis scales to the combined range of its members. Group axis labels show the member names; the legend and per-series colors still identify each line.

## Ranges And Scaling

Useful options include:

- `sharedRange` to control the shared axis.
- `seriesRanges` to control individual variable ranges.
- `niceScale` to expand automatic bounds to readable tick values.
- `timeRangeInclusive` to focus on a period window.
  Drag the overview brush under long charts, then use **Store range** to save the
  window on the cell (or **Clear range** to remove it).
- `yAxisTickCount` to guide tick density.
- `xAxis.title` for the horizontal axis label (defaults to `yr`).
- `yAxis.title` and `yAxis.unit` for the shared vertical axis (unit appears below the lowest tick label).
- `series[].unit` for per-series units in separate-axis mode (overrides model unit inference; shown below each axis’s lowest tick).

Example:

```json
{
  "timeRangeInclusive": [5, 30],
  "axisMode": "separate",
  "niceScale": true,
  "xAxis": { "title": "yr" },
  "yAxis": { "title": "Value", "unit": "$" },
  "sharedRange": {
    "includeZero": true
  }
}
```

Expression series with explicit units:

```json
{
  "series": [
    {
      "expression": "100 * h_h / v",
      "label": "Share of money balances",
      "unit": "%"
    }
  ]
}
```

Include zero when the sign or distance from zero matters. Avoid forcing zero when it compresses important movement in a series that varies within a narrow positive range.

## Baseline And Scenario Charts

For scenario analysis, chart the variables directly affected by the shock and the main stocks or flows that transmit the effect.

A good scenario chart often includes:

- The shocked external or a close consequence.
- A flow response such as output, consumption, investment, or income.
- A stock response such as money, loans, capital, debt, or wealth.

Keep charts focused. Several small charts are usually easier to read than one crowded chart.

## Monte Carlo Bands (ABM)

For agent-based Monte Carlo runs, companion series `{name}_p10` and `{name}_p90` summarize the spread of outcomes across MC runs. Set `showMcBands: true` on a chart cell to draw those percentile bands around the mean series:

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["Y", "C"],
  "showMcBands": true
}
```

See **ABM Model** for how `Y`, `Y_p10`, and `Y_p90` relate. Bands only appear when the matching companions exist on the run result.

## Compare Mode (Vs Baseline)

Scenario charts can plot levels or ratios/deviations from the linked baseline path. Set `compareMode` on the chart cell, or use the **Compare** toggle in the cell header.

| Mode | Plotted value |
|------|----------------|
| `levels` (default) | Scenario values as-is |
| `relative` | `scenario[t] / baseline[t]` |
| `percent` | `((scenario − baseline) / baseline) × 100` |

Period alignment matches baseline reference traces: the scenario window is sliced from the baseline using `baselineStartPeriod` on the scenario run.

```json
{
  "type": "chart",
  "sourceRunCellId": "scenario-run",
  "variables": ["Y", "Cd", "Hh"],
  "compareMode": "relative",
  "referenceTrace": "none"
}
```

Notes:

- Relative and percent only apply when the chart’s source run is a **scenario** with a resolvable baseline result. Otherwise the chart falls back to levels.
- In relative/percent mode the dashed **baseline** reference overlay is omitted (it would be a flat 1 or 0). Other reference traces still work.
- Percent mode prefers including zero on the axis and uses `%` as the series unit.
- Divide-by-zero baseline periods become gaps (NaN) in relative and percent modes.

Use relative charts when you want the scenario as a multiple of the counterfactual (`1` = unchanged); use percent for percentage points of change; keep levels when absolute paths matter (for example settling onto a new steady state).

## Chart Grids

When you want several focused charts side by side, use a `chart-grid` cell instead of one crowded chart. A grid arranges inlined chart specs into rows and columns.

Set `gridColumns` to the number of columns and list the charts in `charts`. Charts fill left-to-right, top-to-bottom, and rows wrap automatically: `gridColumns: 2` with 4 charts gives a 2x2, `gridColumns: 3` with 6 charts gives a 3x2.

```json
{
  "type": "chart-grid",
  "title": "Scenario overview",
  "gridColumns": 2,
  "charts": [
    {
      "id": "grid-output",
      "type": "chart",
      "title": "Output",
      "sourceRunCellId": "baseline-run",
      "variables": ["Y"]
    },
    {
      "id": "grid-consumption",
      "type": "chart",
      "title": "Consumption",
      "sourceRunCellId": "baseline-run",
      "variables": ["Cd"]
    }
  ]
}
```

Each entry in `charts` is a normal chart cell, so it supports every field above (`series`, `axisMode`, `axisGroups`, `seriesRanges`, `timeRangeInclusive`, and so on) and needs its own `id` and `sourceRunCellId`. Insert a grid with **Add cell → Chart grid**, then edit its source to tune the layout and the individual charts.

## Reading A Chart

When inspecting a chart, ask:

- Does the first period make sense given the initial values?
- Does the shock begin in the expected period?
- Is the response direction plausible?
- Do stocks move gradually while flows can jump?
- Does the result settle, cycle, explode, or drift?

If the chart looks wrong, inspect the source run, solver status, and the equations feeding the plotted variables.

## Common Problems

- `sourceRunCellId` points to a run that has not been executed.
- A variable name is misspelled or no longer exists.
- Too many variables are plotted at once.
- Shared axis hides smaller series.
- A scenario chart is interpreted before the baseline is understood.
- A time range excludes the shock period or the adjustment period.
