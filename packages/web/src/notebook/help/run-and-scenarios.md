Run cells execute a model and store the result for charts, tables, matrices, and sequence views. A run can be a baseline or a scenario.

## How To Use

1. Make sure the equations, externals, initial values, and solver cells are valid.
2. Press **Run cell** on a run cell, or **Run all** from the notebook toolbar.
3. Use chart, table, matrix, and sequence cells to inspect the output.
4. For scenarios, compare the scenario result against a baseline run.

## Keyboard Shortcut

Press **R** to run all cells without leaving the keyboard. The shortcut is ignored while you are typing in an input, text area, or equation editor, and it does nothing if a run is already in progress.

Press **P** to toggle between the interactive run view and the publication view. From the notebook it opens the publication view; from a publication it returns to the interactive run view. Like **R**, it is ignored while you are typing in an editor.

A run cell does not define equations. It tells the notebook which model to execute, how many periods to simulate, and where to store the result.

## Baseline Runs

A baseline run is the reference path of the model without scenario shocks. It is usually the first run in a notebook.

Typical baseline fields:

```json
{
  "id": "baseline-run",
  "type": "run",
  "title": "Baseline run",
  "mode": "baseline",
  "periods": 60,
  "resultKey": "baseline",
  "sourceModelId": "main"
}
```

Use a baseline to:

- Check that the model solves.
- Build reference charts and tables.
- Provide a comparison path for scenarios.
- Generate values for matrix and dependency views.

## Scenario Runs

A scenario run changes one or more external variables for selected periods and compares the resulting path with a baseline.

Typical scenario fields:

```json
{
  "id": "policy-scenario",
  "type": "run",
  "title": "Policy scenario",
  "mode": "scenario",
  "baselineRunCellId": "baseline-run",
  "baselineStartPeriod": 40,
  "periods": 50,
  "resultKey": "policy_scenario",
  "sourceModelId": "main",
  "scenario": {
    "shocks": [
      {
        "rangeInclusive": [5, 50],
        "variables": {
          "Gd": {
            "kind": "constant",
            "value": 25
          }
        }
      }
    ]
  }
}
```

## Shocks

A shock changes external variables over an inclusive period range. In the example above, `Gd` is set to `25` from period 5 through period 50.

Use shocks for:

- Policy changes.
- Behavioral-parameter changes.
- Interest-rate changes.
- Productivity changes.
- Temporary or permanent external series changes.

Keep scenario shocks focused. It is easier to interpret one or two changes than a bundle of unrelated changes.

## Baseline Start Period

`baselineStartPeriod` chooses the baseline period used as the scenario starting state. This is useful when the baseline needs time to settle before the shock begins.

For example:

- Run the baseline for 60 periods.
- Use `baselineStartPeriod: 40` for the scenario.
- Apply shocks from scenario period 5 onward.

This means the scenario starts from the baseline's period-40 state, then evolves with the scenario's shock path.

If `baselineStartPeriod` is missing, the app uses its default behavior for that run type. Add it explicitly when scenario timing matters.

## Result Keys

`resultKey` names the output so downstream cells can refer to it. Keep result keys short and stable, such as `baseline`, `bmw_s1`, or `policy_scenario`.

Changing a result key can break charts, tables, or exported comparisons that expect the old name.

## Source Model

A run points to a model through `sourceModelId` or `sourceModelCellId`.

Use `sourceModelId` for notebooks built from separate equations, externals, solver, and initial-values cells. Use `sourceModelCellId` when the notebook has a combined model cell.

## ABM Runs

Agent-based notebooks use run cells with `engine: "abm"`. Point `sourceModelId` at an `abm-model` cell's `modelId`, and put Monte Carlo / parameter overrides under `abm`:

```json
{
  "id": "baseline-run",
  "type": "run",
  "mode": "baseline",
  "engine": "abm",
  "sourceModelId": "abm-sim",
  "periods": 100,
  "resultKey": "abm_sim_baseline",
  "abm": {
    "households": 200,
    "monteCarlo": 20
  }
}
```

Macro series are Monte Carlo means. Companion `_p10` / `_p90` series summarize the spread across MC runs. See **ABM Model** and chart `showMcBands`.

ABM runs currently support baseline mode only.

## Periods

`periods` is the number of periods to simulate. Choose enough periods to see the model's adjustment path.

Common patterns:

- 20 to 40 periods for quick checks.
- 50 to 100 periods for textbook SFC models.
- Longer runs for slow convergence, growth paths, or delayed dynamics.

If a run fails at a later period, inspect charts and variable values just before the failure. A model can be valid at period 1 and unstable after a shock or feedback loop develops.

## Reading Scenario Results

After running a scenario:

- Compare scenario charts to the baseline.
- Check whether the shock period is visible at the expected time.
- Inspect stocks as well as flows.
- Check matrix row and column sums if accounting changes.
- Confirm the hidden equation still passes if the solver cell uses one.

A scenario is most useful when the baseline is already understood. If the baseline has unexplained drift, fix or document that before interpreting scenario effects.

## Common Mistakes

- Running a scenario before the baseline exists or solves.
- Shocking a variable that is an equation instead of an external parameter.
- Using the wrong period range.
- Forgetting that `rangeInclusive` includes both endpoints.
- Changing too many variables at once.
- Comparing a scenario to a baseline that starts from a different state than intended.
- Reusing a `resultKey` in a way that makes downstream cells ambiguous.

## Practical Workflow

1. Build and run a baseline.
2. Add charts for the main stocks and flows.
3. Add one scenario shock.
4. Run the scenario.
5. Compare charts, tables, and accounting matrices.
6. Add more shocks only after the first scenario is understood.
