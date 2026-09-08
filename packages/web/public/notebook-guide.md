# AI Guide: Creating SFC Model Notebooks

## Overview

This guide explains how to create Stock-Flow Consistent (SFC) model notebooks for the SFCR browser application. Compact `sfcr-notebook-yaml` is the recommended authoring format for humans and AI assistants. Expanded JSON remains the runtime interchange and schema-validation format.

The current compact YAML style uses one ordered `cells:` list. Each cell is wrapped by its JSON cell type, for example `- matrix:`, `- equations:`, `- externals:`, or `- run:`. This keeps every cell in the same place while allowing compact matrix, equation, external, and initial-value rows.

For public AI clients, the recommended bootstrap order is:

1. Fetch `.well-known/sfcr.json`.
2. Fetch `.well-known/sfcr-notebook-guide.json` or this guide.
3. Start from `notebook-examples/starter.example.notebook.yaml`.
4. Use richer YAML examples only for targeted patterns such as sector matrices or scenarios.
5. Convert to runtime JSON when direct schema validation is needed.

Use JSON examples and the JSON generation prompt only when a client explicitly needs expanded runtime JSON.

## Public Resources

- Preferred authoring prompt: `ai-prompts/create-sfcr-notebook-yaml.md`
- Preferred examples: `notebook-examples/*.example.notebook.yaml`
- JSON compatibility prompt: `ai-prompts/create-sfcr-notebook.md`
- JSON compatibility examples: `notebook-examples/*.example.notebook.json`
- Machine schema for expanded runtime JSON: `sfcr-notebook.schema.json`

## Compact YAML Shape

A compact notebook starts with a small document header and then an ordered `cells:` list.

```yaml
format: sfcr-notebook-yaml
formatVersion: 1
id: simple-model-notebook
title: Simple Model
metadata:
  version: 1
  template: simple
cells:
  - markdown:
      id: intro
      title: Overview
      source: A small executable SFC model.
  - equations:
      id: equations-main
      title: Model equations
      modelId: simple
      rows:
        - [Y, G, "Income", $/year, flow, identity]
```

Required top-level fields:

- `format`: must be `sfcr-notebook-yaml`
- `formatVersion`: must be `1`
- `id`: unique kebab-case notebook identifier
- `title`: descriptive notebook title shown in the UI
- `metadata.version`: must be `1`
- `cells`: ordered list of wrapped cell entries

Supported wrapped cell keys include:

- `markdown`
- `matrix`
- `sequence`
- `sankey`
- `hydraulics`
- `equations`
- `solver`
- `externals`
- `initial-values`
- `run`
- `chart`
- `table`

Each entry should contain exactly one wrapper key. The fields inside the wrapper are the cell fields, minus the redundant `type`.

## Starter Template

Use `notebook-examples/starter.example.notebook.yaml` when generating a new notebook from scratch. It provides the minimum valid scaffold with matrices, equations, externals, initial values, a solver, a baseline run, and sequence views.

Use the larger examples selectively:

- Use the SIM notebook for the smallest canonical Godley-Lavoie baseline and scenario notebook.
- Use the BMW notebook for sector and band matrices, baseline runs, and scenario layout.
- Use the GL6-DIS rentier notebook when the model splits households or needs distributional structure.
- Treat examples as pattern references, not as whole-notebook defaults.

## Minimal Working Notebook

```yaml
format: sfcr-notebook-yaml
formatVersion: 1
id: simple-model-notebook
title: Simple Model
metadata:
  version: 1
  template: simple
cells:
  - markdown:
      id: intro
      title: Overview
      source: Minimal executable notebook.
  - equations:
      id: equations-main
      title: Model equations
      modelId: simple
      rows:
        - [Y, G, "Income", $/year, flow, identity]
        - [C, alpha0 + alpha1 * Y + alpha2 * M', "Consumption", $/year, flow, behavioral]
        - [M, M' + Y - C, "Money stock", $, stock, accumulation]
  - solver:
      id: solver-main
      title: Solver options
      modelId: simple
      method: gauss-seidel
      tolerance: "1e-10"
      maxIterations: 100
      defaultInitialValue: "0"
  - externals:
      id: externals-main
      title: Externals
      modelId: simple
      rows:
        - [G, 100, "Government expenditure", $/year, aux]
        - [alpha0, 20, "Autonomous consumption", $/year, aux]
        - [alpha1, 0.6, "Income propensity", "", aux]
        - [alpha2, 0.1, "Wealth propensity", 1/year, aux]
  - initial-values:
      id: initial-values-main
      title: Initial values
      modelId: simple
      rows:
        - [M, 50]
  - run:
      id: baseline-run
      title: Baseline run
      mode: baseline
      periods: 50
      resultKey: simple_baseline
      sourceModelId: simple
  - chart:
      id: baseline-chart
      title: Results
      sourceRunCellId: baseline-run
      variables: [Y, C, M]
```

## Equations

Use compact row arrays inside an `equations` cell.

```yaml
  - equations:
      id: equations-main
      title: Model equations
      modelId: sim
      rows:
        - [Y, Cs + Gs, "Income = GDP", $/year, flow, identity]
        - [YD, WBs + rm' * Mh', "Disposable income", $/year, flow, identity]
        - [Mh, Mh' + (YD - Cd) * dt, "Household money deposits", $, stock, accumulation]
```

Equation row shape:

- `[name, expression]`
- `[name, expression, "description", unit, type, role]`
- Optional trailing `id` may be used when preserving a runtime ID that differs from the generated ID.
- Section comments: a **quoted** string row such as `- "Equalize supply to demand."` (unquoted lines starting with `#` are YAML comments and are dropped). Text may use a small inline markdown subset in the UI: `**bold**`, `*italic*`, and `` `code` ``. Also accepts `{ comment: "Section title" }` or `{ kind: comment, text: "..." }`. Comment rows appear in the cell table but are not sent to the solver.

Always quote descriptions in generated YAML. Units and expressions may stay unquoted when YAML accepts them safely; quote expressions containing characters that YAML could misread.

Expression syntax:

- `varName'`: previous period value (preferred)
- `lag(varName)` or `varName[-1]`: equivalent lag syntax
- `d(varName)`: change in variable, current minus lagged value
- `I(flowExpr)`: stock accumulation shorthand
- `dt`: time step, usually `1`
- Standard operators: `+`, `-`, `*`, `/`
- Exponentiation: `pow(base, exponent)`; the `^` character is reserved for paper-style notation such as `H^P`
- Functions: `max()`, `min()`, `pow()`, `sqrt()`, `exp()`, `log()`, `abs()`

Equation ordering does not determine execution order. The solver builds the dependency order from the expressions.

## Externals And Initial Values

Use `externals` for exogenous constants or series. Most constant externals should use compact row arrays. You may insert the same quoted section-comment string rows between external rows for grouping.

```yaml
  - externals:
      id: externals-main
      title: Externals
      modelId: sim
      rows:
        - [G, 20, "Government expenditure", $/year, aux]
        - [theta, 0.2, "Tax rate", "", aux]
```

External row shape:

- `[name, value]`
- `[name, value, "description", unit, type]`
- Optional trailing `id` may be used when preserving a runtime ID.

Use object rows for non-constant series when the row needs `kind: series` and `valueText`.

```yaml
        - id: ext-shock
          name: shock
          desc: Shock sequence.
          kind: series
          valueText: "[0, 0, 1.5, 1.5, 1.0]"
          type: aux
```

Use `initial-values` for stock variables, lagged expectations, and any variable whose period-0 value should not come from the solver default.

```yaml
  - initial-values:
      id: initial-values-main
      title: Initial values
      modelId: sim
      rows:
        - [Mh, 100]
        - [K, 150]
        - [s_E, 100]
```

Initial-value row shape:

- `[name, value]`
- Optional trailing `id` may be used when preserving a runtime ID.

## Solver

```yaml
  - solver:
      id: solver-main
      title: Solver options
      modelId: sim
      method: newton
      tolerance: "1e-10"
      maxIterations: 200
      defaultInitialValue: "1e-15"
      hiddenLeftVariable: Ms
      hiddenRightVariable: Mh
      hiddenTolerance: "0.00001"
      relativeHiddenTolerance: false
```

Solver methods:

- `newton`: Newton-Raphson, best for well-behaved systems
- `gauss-seidel`: robust fixed-point iteration, usually slower
- `broyden`: quasi-Newton method

Use the hidden-equation fields when one equation is redundant, such as a Walras-law closure `Ms = Mh`. The solver removes that equation from the simultaneous system and enforces the two variables within `hiddenTolerance`.

## Matrices

Use compact row arrays inside `matrix` cells. Each row is `[band, label, ...values]`, and the number of values must match `columns`.

```yaml
  - matrix:
      id: balance-sheet
      accountingKind: balance-sheet
      title: Balance sheet
      columns: [Households, Government, Sum]
      sectors: [Households, Government, ""]
      rows:
        - [Money, Money stock, +Hh, -Hs, "0"]
        - [Balance, Net worth, -Hh, +Hs, "0"]
        - [Sum, Sum, "0", "0", "0"]
```

Transactions-flow matrices use the same structure.

```yaml
  - matrix:
      id: transaction-flow
      accountingKind: transaction-flow
      title: Transactions-flow matrix
      columns: [Households, Production, Government, Sum]
      sectors: [Households, Firms, Government, ""]
      rows:
        - [Consumption, Consumption, -Cd, +Cs, "", "0"]
        - [Government, Government expenditure, "", +Gs, -Gd, "0"]
        - [Taxes, Taxes, -TXs, "", +TXd, "0"]
        - [Money, Change in money stock, +d(Hh), "", -d(Hs), "0"]
        - [Sum, Sum, "0", "0", "0", "0"]
```

Matrix rules:

- `accountingKind` (optional but recommended): `balance-sheet`, `transaction-flow`, or `account-transactions`. YAML aliases such as `Balance`, `transactionFlow`, and `accountTransactions` are normalized at load. When set, this drives balance-sheet stock badges (A/L/E), flow unit validation, account-column layout, and Sum-row checks instead of guessing from row labels or cell id/title.
- `columns` are the displayed column headers.
- `sectors` must have the same length as `columns`.
- Use `_current` and `_capital` suffixes for sector account splits when helpful.
- Use empty string `""` for sum-sector labels and blank matrix cells.
- Use signs directly in values, such as `+Mh` and `-Ms`.
- Prefer `varName'` in equations; use `[-1]` notation in matrix display formulas when matching paper-style tables.
- Common balance-sheet bands: `Money`, `Loans`, `Equities`, `Inventories`, `Balance`.
- Common transactions-flow bands: `Consumption`, `Investment`, `Wages`, `Profits`, `Interest`, `Taxes`, `Deposits`, `Loans`.

## Runs, Charts, And Tables

Use a `run` cell for the main simulation.

```yaml
  - run:
      id: baseline-run
      title: Baseline run
      description: Baseline simulation with government expenditure fixed at 20.
      mode: baseline
      resultKey: sim_baseline
      periods: 60
      sourceModelId: sim
```

Use `chart` and `table` cells for result views. To bucket variables onto shared axes instead of one axis per variable, add `axisGroups` (each inner array shares a y-axis; omitted variables get their own axis), e.g. `axisGroups: [[Y, Cd, Mh], [W]]`.

```yaml
  - chart:
      id: baseline-chart
      title: Baseline income and money
      sourceRunCellId: baseline-run
      variables: [Y, YD, Cd, Hh]
      axisMode: separate
      timeRangeInclusive: [1, 60]
  - table:
      id: baseline-table
      title: Baseline summary
      sourceRunCellId: baseline-run
      variables: [Y, YD, Cd, Hh, TXd, Gd]
```

For scenarios, use a markdown note, a scenario run, and scenario result views.

```yaml
  - markdown:
      id: scenario-note
      title: Scenario 1
      source: Scenario 1 raises government expenditure from period 5 through 60.
  - run:
      id: scenario-run
      title: "Scenario 1: government spending shock"
      mode: scenario
      scenario:
        shocks:
          - rangeInclusive: [5, 60]
            variables:
              Gd:
                kind: constant
                value: 30
      baselineRunCellId: baseline-run
      periods: 60
      resultKey: sim_scenario_gd_30
      sourceModelId: sim
  - chart:
      id: scenario-chart
      title: Scenario 1 output and fiscal variables
      sourceRunCellId: scenario-run
      variables: [Y, YD, Cd, Hh, Gd]
      axisMode: separate
      referenceTrace: baseline
```

Scenario rules:

- `rangeInclusive` is `[startPeriod, endPeriod]`, with both endpoints included.
- Scenario `variables` can use `kind: constant` or `kind: series`.
- `baselineRunCellId` should point to the baseline run cell.
- `sourceModelId` should match the model id used by the equation system.

## Sequence Views

Sequence cells can visualize transaction flows or equation dependencies.

```yaml
  - sequence:
      id: transaction-flow-sequence
      title: Transaction flow sequence
      source:
        kind: matrix
        matrixCellId: transaction-flow
        includeZeroFlows: false
      participantColumnOrder: [Households, Firms, Banks]
      description: Sequence view generated from the transactions-flow matrix.
  - sequence:
      id: equation-dependency-graph
      title: Equation dependency graph
      source:
        kind: dependency
        modelId: sim
        showAccountingStrips: true
        showExogenous: false
        stripMapping:
          transactionMatrixCellId: transaction-flow
          balanceMatrixCellId: balance-sheet
```

Dependency source options:

- `modelId`: equation system to visualize
- `stripSectorSource`: `columns` or `sectors`
- `showAccountingStrips`: group by accounting bands
- `showExogenous`: include exogenous variables
- `showDebugOverlay`: include debugging details
- `stripMapping`: matrix cells used for sector and band inference

## Recommended Notebook Order

Because the compact format now uses one ordered `cells:` list, the file order is the display order.

1. Overview / intro markdown
2. Balance sheet, if applicable
3. Transactions-flow matrix, if applicable
4. Sequence cells derived from matrices or dependency graphs
5. Equations
6. Solver
7. Externals
8. Initial values
9. Baseline run
10. Baseline charts and tables
11. Scenario notes
12. Scenario runs
13. Scenario charts and tables

## Naming And Documentation

- Notebook ids: `{model-name}-notebook` or `{model-name}-{variant}-notebook`
- Cell ids: descriptive kebab-case, such as `baseline-run` or `scenario-1-chart`
- Model ids: short stable names, such as `sim`, `equations`, or `main-model`
- Result keys: `{model}_{run-type}`, such as `bmw_baseline` or `bmw_s1`
- Every cell should have a meaningful `title`.
- Add `description` to runs and result views when it helps users understand the output.
- Use markdown cells before scenarios.
- Add `note` fields to matrices when accounting signs or source conventions need explanation.

Equation naming conventions:

- Use clear variable names from the model literature.
- Stock variables often use uppercase names such as `K`, `Mh`, and `Ld`.
- Rates and ratios often use lowercase names such as `rl`, `rm`, and `pr`.
- Expectations commonly use `_E`, such as `s_E` or `ydhsw_E`.
- Keep real and nominal conventions consistent, such as `c` for real consumption and `C` for nominal consumption.

## Common Equation Patterns

```yaml
  - equations:
      id: equations-main
      title: Model equations
      modelId: model
      rows:
        - [K, K' + (I - delta * K') * dt, "Accumulation", $, stock, accumulation]
        - [Y_E, theta * Y' + (1 - theta) * Y_E', "Adaptive expectations", $/year, flow, definition]
        - [I, gamma * (K_T - K') + delta * K', "Target-based adjustment", $/year, flow, behavioral]
        - [C, alpha0 + alpha1 * YD + alpha2 * Mh', "Consumption function", $/year, flow, behavioral]
```

## Validation Checklist

Before finalizing a notebook:

- [ ] Top-level `format`, `formatVersion`, `id`, `title`, and `metadata.version: 1` are present.
- [ ] `cells` is an ordered list of wrapped cell entries.
- [ ] Every wrapped cell has a unique `id` and a meaningful `title`.
- [ ] `modelId` is consistent across equations, solver, externals, initial values, and runs.
- [ ] `sourceModelId` references point to valid model ids.
- [ ] `sourceRunCellId`, `baselineRunCellId`, and `matrixCellId` references point to valid cells.
- [ ] Matrix `columns` and `sectors` arrays have the same length.
- [ ] Matrix row values match the column count.
- [ ] Scenario `rangeInclusive` bounds are `[start, end]` with both endpoints included.
- [ ] No undefined variables appear in expressions.
- [ ] Stock variables have initial values or acceptable defaults.
- [ ] Equation roles match actual usage when roles are supplied.
- [ ] Large generated cells are collapsed when the notebook would otherwise be noisy.

## Expanded JSON Compatibility

Expanded JSON is still useful for runtime interchange, direct schema validation, and clients that cannot emit YAML reliably. It is not the preferred authoring surface.

The compact wrapped YAML cells compile into expanded notebook cells shaped like this:

```json
{
  "id": "simple-model-notebook",
  "title": "Simple Model",
  "metadata": { "version": 1 },
  "cells": [
    {
      "id": "equations-main",
      "type": "equations",
      "title": "Model equations",
      "modelId": "simple",
      "equations": [
        { "id": "eq-0-y", "name": "Y", "expression": "G" }
      ]
    }
  ]
}
```

Expanded YAML that mirrors the JSON cell array, and the older top-level shorthand sections, may still be imported for backwards compatibility. New generated YAML should use the wrapped `cells:` pattern shown above.

## Common Errors And Solutions

### Error: "Notebook JSON must contain string id and title fields"

Add `id` and `title` at the top level of the notebook source.

### Error: "Notebook JSON metadata.version must be 1"

Add `metadata.version: 1` at the top level.

### Error: "Cell source must include id"

Every wrapped cell in the `cells` array must include an `id` field.

### Error: "Matrix cells require columns to be an array"

Matrix cells must have `columns: [...]` as an array.

### Error: "Unknown variable in expression"

Ensure all variables are defined as equations, externals, initial values, or valid lag references.

### Error: "Circular dependency"

Check for missing lag terms (`varName'`). Stock-flow feedback loops usually need lagged stock terms.

### Error: "Hidden equation variables not found"

`hiddenLeftVariable` and `hiddenRightVariable` must match actual variable names.

### Error: "Source cell not found"

Check that source references, such as `sourceRunCellId` and `matrixCellId`, point to valid cells.

## Summary

Create new notebooks in compact `sfcr-notebook-yaml` with one ordered `cells:` list. Start from the YAML starter template, borrow targeted patterns from the BMW and GL6-DIS examples, and keep expanded JSON for schema validation or clients that explicitly require runtime interchange.
