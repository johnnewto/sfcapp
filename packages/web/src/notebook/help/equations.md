The equations cell is the model ledger. It defines the endogenous variables the solver computes each period, along with descriptions, roles, and unit metadata.

## How To Use

1. Press **Edit** on the equations cell.
2. Add one row per variable you want the model to solve.
3. Fill in **Name**, **Description**, **Expression**, **Role**, and units where useful.
4. Press **Apply** to save the draft back into the notebook.
5. Run a baseline or scenario run cell to solve the model.

In the read-only view, hover an equation to preview inputs and outputs. Click a row to pin that link highlight; click again to return to hover mode. Shift-click pins outputs, and Ctrl/Cmd-click pins inputs.

## Equation Names

Use short variable names such as `Y`, `YD`, `Cd`, `Mh`, or `K`. Names are case-sensitive. Keep them stable once downstream charts, tables, matrices, and run cells depend on them.

Good names are:

- Consistent with the model article or workbook you are adapting.
- Short enough to scan in charts and matrices.
- Unique across equations and external parameters.

Avoid names that differ only by capitalization unless the source model truly uses that distinction.

## Expressions

Expressions describe how the variable is computed. Common forms:

- `Y = Cs + Is` is entered as name `Y`, expression `Cs + Is`.
- `Mh = Mh' + (YD - Cd) * dt` is entered as name `Mh`, expression `Mh' + (YD - Cd) * dt`.
- `KT = kappa * Y'` is entered as name `KT`, expression `kappa * Y'`.

Supported syntax includes:

- Arithmetic: `+`, `-`, `*`, `/`.
- Lagged values: `X'` (preferred), or `lag(X)`, or `X[-1]`.
- Stock changes: `d(X)`.
- Time step: `dt`.
- Functions such as `min(a, b)`, `max(a, b)`, `abs(x)`, `sqrt(x)`, `floor(x)` (alias `int(x)`), `pow(x, n)`, `exp(x)`, `log(x)`, and ABM `runif(lo, hi)`.
- Conditionals such as `if (condition) { expr } else { expr }`.

## Roles

Roles explain what kind of equation a row represents. They help readers and tools understand the model.

| Role | Use For | Example |
| --- | --- | --- |
| Accumulation | Stock updates from flows | `Mh' + (YD - Cd) * dt` |
| Identity | Accounting or closure relations | `Cs + Is` |
| Definition | Direct algebraic definitions | `rl` |
| Behavioral | Decision rules or estimated behavior | `alpha0 + alpha1 * YD + alpha2 * Mh'` |
| Target | Desired or notional levels | `kappa * Y'` |
| Auto | Let the app infer the role | Short exploratory rows |

Use **Accumulation** for equations that update stocks. These are strong stock-flow links and should usually include a lagged stock plus a flow multiplied by `dt`.

## Stocks And Flows

SFC equations should respect stock-flow units:

- Stocks have units like `$`.
- Flows have units like `$/yr`.
- A stock update usually has the form `stock = stock' + flow * dt` or alternatively `stock = I(flow)`
- Do not add a flow directly to a stock without multiplying by `dt`.

Examples:

`Mh = Mh' + (YD - Cd) * dt`

`K = K' + (Id - DA) * dt`

If the unit checker reports a mismatch, inspect whether a flow needs `* dt`, whether a lag is missing, or whether the unit metadata is inconsistent.

## Initial Values

Any equation that depends on a lagged value such as `X'` needs a previous-period value for `X`. The app can use the solver's default initial value, but important stocks should usually have explicit initial values.

Add explicit initial values for:

- Stock variables such as money, debt, capital, inventories, wealth, or bonds.
- Variables that make the first period sensitive to starting conditions.
- Models that need a known steady-state start.

## External Parameters

If an expression uses a symbol that is not defined as an equation, it should usually be declared in the externals cell. Examples include `alpha1`, `delta`, `gamma`, `rl`, `pr`, and policy variables.

Use externals for:

- Constants.
- Time series.
- Scenario shock targets.
- Parameters you want to change without rewriting equations.

## Debugging

When a model does not solve:

1. Check equation names for typos.
2. Check that every referenced parameter appears in equations or externals.
3. Check accumulation equations for missing lag terms (`X'`) or `dt`.
4. Check divisions for possible zero denominators.
5. Check units if a diagnostic says stocks and flows are mixed.
6. Start with a baseline run before adding scenario shocks.

The dependency highlighting is often the fastest way to understand a problem: select the failing or suspicious variable, then inspect its inputs and outputs.
