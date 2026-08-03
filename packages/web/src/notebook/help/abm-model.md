An `abm-model` cell defines an agent-based model: populations of agents, ordered period ticks, and which series to record. Unlike a Gauss–Seidel `model` / `equations` cell, the browser does not solve a simultaneous equation system. It simulates agents period by period, then aggregates results across Monte Carlo runs.

## How To Use

1. Press **Edit** on the ABM model cell to change populations, params, ticks, or recording.
2. Add a run cell with `engine: "abm"` and `sourceModelId` pointing at this cell's `modelId`.
3. Set `abm.monteCarlo` (and other overrides) on the run cell.
4. Run the baseline, then inspect charts and tables.

## Macro Vs Micro

By Leeds ABM convention:

- **Macro** (upper-case names such as `Y`, `C`, `UR`): aggregate totals, stored as Monte Carlo means (and optional percentile bands).
- **Micro** (lower-case / `*_h*` names such as `c_h1`, `h_hLast`): household histories from **Monte Carlo run 1 only**, not averaged.

The Monte Carlo count is set on the run cell as `abm.monteCarlo`, not on the model cell (unless the model supplies a default in `record.monteCarlo`).

## Monte Carlo Band Series

In an ABM notebook, companions such as `Y_p10` and `Y_p90` are Monte Carlo band series generated from the repeated simulation runs.

For a macro variable such as `Y`:

- `Y` = the Monte Carlo mean of output across all MC runs at each period.
- `Y_p10` = the 10th percentile of output across MC runs at each period.
- `Y_p90` = the 90th percentile of output across MC runs at each period.

So if the baseline run uses `monteCarlo: 12`, then for each period the browser has 12 simulated values of `Y`. It summarizes them as:

- lower band: `Y_p10`
- mean line: `Y`
- upper band: `Y_p90`

Together, `Y_p10` to `Y_p90` gives an 80% Monte Carlo spread: roughly the middle 80% of simulated outcomes for that variable in that period.

They are not separate model equations. They are result-summary series produced by the ABM run.

### Example

If `Y = 180`, `Y_p10 = 165`, and `Y_p90 = 195` in period 50, that means:

- average output across MC runs was about 180
- 10% of MC runs had output below about 165
- 90% had output below about 195
- most simulated outcomes were between 165 and 195

### Same Naming For Other Macros

The same `{name}_p10` / `{name}_p90` pattern applies to other macro variables, for example:

- `C_p10`, `C_p90` for consumption `C`
- `I_p10`, `I_p90` for investment `I`
- `K_p10`, `K_p90` for capital `K`
- `M_h_p10`, `M_h_p90` for household deposits `M_h`
- `UR_p10`, `UR_p90` for unemployment rate `UR`

Which macros get bands is controlled by `record.bands` on the ABM model (defaults often cover all aggregate macros).

## Charts And `showMcBands`

In chart cells, `showMcBands: true` tells the browser to display these percentile bands around the mean series where companion `_p10` / `_p90` series are available:

```json
{
  "type": "chart",
  "sourceRunCellId": "baseline-run",
  "variables": ["Y"],
  "showMcBands": true
}
```

You can also plot `Y_p10` or `Y_p90` explicitly in `variables` if you want those series as separate lines.

## Cell Structure

Typical fields:

| Field | Purpose |
| --- | --- |
| `modelId` | Id referenced by run cells via `sourceModelId` |
| `populations` | Agent groups (size expression, state, params) |
| `params` | Model-level parameters |
| `state.aggregates` | Optional opening values for aggregate macros (stocks). Seeded into both current and previous-period buffers at each Monte Carlo start |
| `ticks` | Ordered period steps (`do`, `for`, `hire-lottery`, `shuffle`, `ration-fcfs`) |
| `record` | Macro `series`, optional `bands`, optional micro histories |
| `check` | Optional stock-flow equality check each period |

## Opening Aggregates And Timing

Population agent state (`populations[].state`) is zero-initialized and persists across periods: a bare agent variable read before that agent equation writes it is last period’s value.

Declared `state.aggregates` do the same for macros. Example:

```yaml
state:
  aggregates:
    K: 0
    H_s: 0
ticks:
  - do:
      - [DA, "delta * K"]          # opening / carried K
      - [K, "K + I - DA"]          # then overwrite K
```

- Bare `K` before assignment → carried opening stock (R-style mutable loop variable).
- `lag(K)` → immutable period-opening snapshot (unchanged even after `K` is written later in the same period).
- Undeclared bare aggregates still throw `ABM unknown variable` until a tick assigns them.

Use `lag(name)` when you need the previous-period value after overwriting the same name in the current period (for example `H_s + B_cb - lag(B_cb)`). Explicit aliases such as `r_lag` are optional documentation; prefer `lag(r)`.

Run cells with `engine: "abm"` execute this specification under Monte Carlo aggregation. See **Run And Scenarios** for baseline run fields, and **Chart** for plotting options.
