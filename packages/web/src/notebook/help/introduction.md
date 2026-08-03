This notebook environment combines executable stock-flow consistent (SFC) models with documentation, accounting matrices, runs, charts, tables, and visual inspection tools.

## What The Notebook Is For

Use a notebook to keep the whole modelling workflow in one place:

- Explain the model and assumptions.
- Define equations, parameters, initial values, and solver settings.
- Run baseline and scenario simulations.
- Inspect results with charts, tables, matrices, and sequences.
- Check accounting consistency across flows and stocks.

The notebook is browser-first: cells are editable, runnable, and inspectable without leaving the page.

## Main Cell Types

| Cell Type | Purpose |
| --- | --- |
| Markdown | Narrative text, assumptions, interpretation, and section notes |
| Matrix | Balance sheets, transaction-flow matrices, and accounting checks |
| Sequence | Step-by-step transaction flows or equation dependency views |
| Equations | Endogenous model equations |
| Externals | Parameters and exogenous series |
| Initial Values | Starting values for lagged variables and stocks |
| Solver | Numerical method, tolerances, and hidden-equation checks |
| Run | Baseline and scenario simulation execution |
| Chart | Visual time-series inspection |
| Table | Numeric result inspection |
| Model | A combined model cell containing equations, externals, initial values, and solver settings |
| ABM Model | Agent-based specification with populations, ticks, and Monte Carlo recording |

## Typical Workflow

1. Read or write the overview markdown.
2. Review the accounting matrices.
3. Define or inspect equations.
4. Check external parameters and initial values.
5. Confirm solver settings.
6. Run the baseline.
7. Inspect baseline charts, tables, and matrices.
8. Add scenario runs.
9. Compare scenario results against the baseline.
10. Document the interpretation in markdown cells.

For SFC work, the accounting matrices and equations should tell the same story. Flows in transaction matrices update stocks in balance sheets through accumulation equations.

## Editing Cells

Most cells have an **Edit** button. Editable source cells can use structured editors such as grid mode for matrices or run mode for runs. JSON mode remains available for bulk edits and precise source changes.

After editing, press **Apply** to save the cell. Press **Cancel** to discard the draft.

## Running Models

Run cells execute models. A baseline run creates the reference path. A scenario run applies shocks and compares against a baseline path.

When something fails:

- Start with the first failing run cell.
- Check solver diagnostics and hidden-equation checks.
- Inspect the equations feeding the failing variable.
- Check initial values for lagged stocks.
- Confirm scenario shocks target externals, not solved equations.

## Using Help

Use the contents list in this Help tab to jump between help topics. Pressing a cell's **Help** button opens the matching topic and keeps the cell title as context.

The introduction is a map. The individual help topics explain each cell type in more detail.
