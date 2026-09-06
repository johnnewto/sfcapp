# R regression fixtures for notebook templates

Notebook template regressions compare browser/TypeScript solver output against checked-in JSON checkpoints under `packages/web/test/fixtures/r-regressions/`. Most checkpoints come from R reference implementations; scenario semantics follow the TypeScript engine where they differ from R.

## Fixture layout

Each `*.json` file has:

- `templateId` — must match a key in `packages/web/src/notebook/templates.ts`
- `checkpoints` — map of run cell id → period → variable → expected value
- optional `sourceVignette` / `sourceScript` — where baseline numbers were generated
- optional `matrixValidation` — expected `sfcr_validate` messages (r-sfcr templates only)

Regression harness: `packages/web/test/notebookTemplateRegressionHarness.ts`  
Tolerance: per variable `max(5e-3 absolute, 1e-6 * |expected|)`. The absolute term keeps the small-magnitude theoretical templates strict; the relative term lets large-magnitude empirical templates (e.g. `italy-sfc`, whose flows/stocks are in the millions) match without weakening the absolute check.

| Fixture | Template | Generator | Test suite |
|---------|----------|-----------|------------|
| `bmw.json` | `bmw` | `scripts/generate_notebook_r_fixtures.R` | `notebookTemplateRegression.test.ts` |
| `gl2-pc.json` | `gl2-pc` | `scripts/generate_notebook_r_fixtures.R` | `notebookTemplateRegression.test.ts` |
| `gl6-dis.json` | `gl6-dis` | `scripts/generate_notebook_r_fixtures.R` | `notebookTemplateRegression.extended.test.ts` |
| `gl7-insout.json` | `gl7-insout` | `scripts/generate_notebook_r_fixtures.R` | `notebookTemplateRegression.extended.test.ts` |
| `gl8-growth.json` | `gl8-growth` | `scripts/generate_notebook_r_fixtures.R` | `notebookTemplateRegression.extended.test.ts` |
| `3io-pc.json` | `3io-pc` | baseline: `scripts/generate_3io_pc_r_fixture.R`; scenario: TypeScript (see below) | `notebookTemplateRegression.extended.test.ts` |
| `eco-3io-pc.json` | `eco-3io-pc` | baseline: `scripts/generate_florence_r_fixture.R`; scenario: TypeScript (see below) | `notebookTemplateRegression.extended.test.ts` |
| `define-simple.json` | `define-simple` | baseline: `scripts/generate_define_simple_r_fixture.R`; scenarios: TypeScript `runScenario` | `notebookTemplateRegression.extended.test.ts` |
| `io-pc.json` | `io-pc` | baseline: `scripts/generate_iopc_r_fixture.R`; scenarios: TypeScript (see below) | `notebookTemplateRegression.extended.test.ts` |
| `italy-sfc.json` | `italy-sfc` | `scripts/generate_italy_sfc_r_fixture.R` | `notebookTemplateRegression.extended.test.ts` |

## Refresh Godley-Lavoie / r-sfcr fixtures

Requires R, `jsonlite`, and the `references/r-sfcr` submodule (`git submodule update --init --recursive`).

From repo root:

```bash
Rscript scripts/generate_notebook_r_fixtures.R
```

This loads `references/r-sfcr` via `pkgload` and writes all five vignette-based fixtures. `gl8-growth` equations are parsed from `references/java/.../GrowthModels.java`.

Validate:

```bash
pnpm web:test:templates
```

Or only the default regression suite:

```bash
pnpm --filter @sfcr/web exec vitest run test/notebookTemplateRegression.test.ts
pnpm --filter @sfcr/web exec vitest run test/notebookTemplateRegression.extended.test.ts
```

## Refresh Model 3IO-PC (Florence keynote)

Reference code: `references/keynote_speech_Florence/0_3IO-PC-Model.R`.

### Baseline checkpoints

Requires R and `jsonlite` only (no r-sfcr package).

```bash
Rscript scripts/generate_3io_pc_r_fixture.R
```

The script sources `references/keynote_speech_Florence/0_3IO-PC-Model.R`, snapshots baseline scenario 1 at periods 5, 50, and 100, and writes `packages/web/test/fixtures/r-regressions/3io-pc.json`.

**Scenario checkpoints are preserved** on re-run: if `scenario-1-run` already exists in the JSON, the R script keeps it (and `sourceScenarioScript`) unchanged.

After editing the notebook YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write 3io-pc
```

### Scenario checkpoints (`scenario-1-run`)

The Florence R code runs two scenarios in one pass (path continuation). The SFCR notebook uses `runScenario`, which **restarts from the baseline terminal state** and applies shocks from period 1 — same pattern as `eco-3io-pc` and `io-pc`.

Do **not** copy R scenario-2 values into the fixture; they will not match the browser engine.

To refresh scenario checkpoints after changing the notebook or scenario definition:

1. Run the extended regression and note failing `3io-pc:scenario-1-run:…` diffs, or
2. Run a one-off dump from the TypeScript engine (same imports as `notebookTemplateRegressionHarness.ts`): `runBaseline` on `baseline-run`, then `runScenario` with the `scenario-1-run` cell shocks.
3. Update `checkpoints.scenario-1-run` in `3io-pc.json` and keep `sourceScenarioScript` accurate.

## Refresh ECO-3IO-PC (Florence keynote)

Reference code: `references/keynote_speech_Florence/` (cloned from [marcoverpas/keynote_speech_Florence](https://github.com/marcoverpas/keynote_speech_Florence)).

### Baseline checkpoints

Requires R and `jsonlite` only (no r-sfcr package).

```bash
Rscript scripts/generate_florence_r_fixture.R
```

The script sources `references/keynote_speech_Florence/1_ECO-3IO-PC-Model.R`, snapshots baseline scenario 1 at periods 5, 50, and 100, and writes `packages/web/test/fixtures/r-regressions/eco-3io-pc.json`.

**Scenario checkpoints are preserved** on re-run: if `scenario-1-run` already exists in the JSON, the R script keeps it (and `sourceScenarioScript`) unchanged.

After editing the notebook YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write eco-3io-pc
```

### Scenario checkpoints (`scenario-1-run`)

The Florence R code runs two scenarios in one pass (path continuation). The SFCR notebook uses `runScenario`, which **restarts from the baseline terminal state** and applies shocks from period 1 — same pattern as `gl2-pc`.

Do **not** copy R scenario-2 values into the fixture; they will not match the browser engine.

To refresh scenario checkpoints after changing the notebook or scenario definition:

1. Run the extended regression and note failing `eco-3io-pc:scenario-1-run:…` diffs, or
2. Run a one-off dump from the TypeScript engine (same imports as `notebookTemplateRegressionHarness.ts`): `runBaseline` on `baseline-run`, then `runScenario` with the `scenario-1-run` cell shocks.
3. Update `checkpoints.scenario-1-run` in `eco-3io-pc.json` and keep `sourceScenarioScript` accurate.

## Refresh DEFINE-SIMPLE 1.1

Reference code: `references/define-simple-1.1/DEFINE_SIMPLE.R` (from [DEFINE-model/SIMPLE-1.1](https://github.com/DEFINE-model/SIMPLE-1.1)).

### Baseline checkpoints

Requires R and `jsonlite`. From repo root:

```bash
Rscript scripts/generate_define_simple_r_fixture.R
```

The script sources the Model Builder export (charts stripped), snapshots baseline scenario 1 at periods 5, 50, and 78, and writes `packages/web/test/fixtures/r-regressions/define-simple.json`.

**Scenario checkpoints are preserved** on re-run.

After editing the notebook YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write define_simple
```

### Scenario checkpoints

The R code applies green-investment and degrowth shocks from period 5 on a path that starts in 2023. The SFCR notebook uses `runScenario`, which **restarts from the baseline terminal state** — same pattern as `eco-3io-pc`. Do not copy R scenario-2/3 values into the fixture.

## Refresh Model IO-PC (Six Lectures)

Reference code: `references/six_lectures_on_sfc_models/` (cloned from [marcoverpas/Six_lectures_on_sfc_models](https://github.com/marcoverpas/Six_lectures_on_sfc_models)).

### Baseline checkpoints

Requires R and `jsonlite` only (no r-sfcr package).

```bash
Rscript scripts/generate_iopc_r_fixture.R
```

The script sources `references/six_lectures_on_sfc_models/IOPC_model.R`, snapshots baseline scenario 1 at periods 5, 50, and 90, and writes `packages/web/test/fixtures/r-regressions/io-pc.json`.

**Scenario checkpoints are preserved** on re-run: if `scenario-1-run` or `scenario-2-run` already exist in the JSON, the R script keeps them (and `sourceScenarioScript`) unchanged.

After editing the notebook YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write io-pc
```

### Scenario checkpoints (`scenario-1-run`, `scenario-2-run`)

The Six Lectures R code runs three scenarios in one pass (path continuation). The SFCR notebook uses `runScenario` from the baseline terminal state — same pattern as `eco-3io-pc` and `gl2-pc`.

Do **not** copy R scenario-2 or scenario-3 values into the fixture; they will not match the browser engine.

To refresh scenario checkpoints after changing the notebook or scenario definition:

1. Run the extended regression and note failing `io-pc:scenario-…` diffs, or
2. Run a one-off dump from the TypeScript engine (same imports as `notebookTemplateRegressionHarness.ts`): `runBaseline` on `baseline-run`, then `runScenario` for each scenario run cell.
3. Update `checkpoints.scenario-1-run` and `checkpoints.scenario-2-run` in `io-pc.json` and keep `sourceScenarioScript` accurate.

## Refresh Italy SFC (empirical Eurostat model)

Reference code: `references/Italy-SFC-Model/` (cloned from [marcoverpas/Italy-SFC-Model](https://github.com/marcoverpas/Italy-SFC-Model)). The dataset `Data_Aalborg.csv` is kept alongside the cloned scripts (the upstream repo fetches it from Dropbox; a local copy makes generation reproducible offline).

Requires R 4.x with `bimets` and `jsonlite`. If `bimets` is not in the default library, install it into a repo-local `.rlib/` (the generator adds `./.rlib` to `.libPaths()` automatically):

```r
install.packages("bimets", lib = ".rlib")
```

Generate from repo root:

```bash
Rscript scripts/generate_italy_sfc_r_fixture.R
```

The script:

1. Sources a preprocessed copy of `references/Italy-SFC-Model/1_Model_upload` (Dropbox read swapped for the local CSV) to build and OLS-estimate the model with `bimets::ESTIMATE` over 1998-2019.
2. Runs a DYNAMIC `bimets::SIMULATE` over 1998-2021 with every behavioural variable (plus the firms' residual `opf`) exogenised to its observed series, so only the accounting identities are endogenous — exactly the variables the SFCR notebook keeps as equations.
3. Writes `packages/web/test/fixtures/r-regressions/italy-sfc.json` (baseline checkpoints at 1999/2008/2021, i.e. period keys `3`/`12`/`25`).
4. Writes `scripts/generated/italy_sfc_yaml_fragments.txt` — the observed external series, 1997 initial values, and estimated coefficients used to author/refresh `italy_sfc.notebook.yaml`.

The model is a forward DAG of identities, so the SFCR solve and the R simulation agree to ~9 significant figures; the relative tolerance term in the harness covers the million-scale magnitudes.

After editing the notebook YAML:

```bash
pnpm --filter @sfcr/web compile:notebook-yaml -- --write italy_sfc
```

This template has no scenario cell; the baseline is a pure in-sample reproduction.

## When to regenerate

- Changed equations, externals, solver options, or run periods in a template YAML → re-run the matching generator, then regression tests.
- Changed `references/r-sfcr` or Java growth model source → `generate_notebook_r_fixtures.R`.
- Changed Florence 3IO-PC R model → `generate_3io_pc_r_fixture.R` (baseline only unless you also refresh scenario JSON manually).
- Changed Florence ECO-3IO-PC R model → `generate_florence_r_fixture.R` (baseline only unless you also refresh scenario JSON manually).
- Changed DEFINE-SIMPLE 1.1 R model → `generate_define_simple_r_fixture.R` (baseline only unless you also refresh scenario JSON manually).
- Changed Six Lectures IO-PC R model → `generate_iopc_r_fixture.R` (baseline only unless you also refresh scenario JSON manually).
- Changed Italy SFC R model or `Data_Aalborg.csv` → `generate_italy_sfc_r_fixture.R`, then re-embed the regenerated externals/initial values from `scripts/generated/italy_sfc_yaml_fragments.txt` into `italy_sfc.notebook.yaml`.
- Intentional solver/port change that diverges from R → update fixture JSON and document why in the PR.

## Prerequisites

- **R** 4.x with `jsonlite`
- **r-sfcr fixtures**: submodule at `references/r-sfcr`, plus R deps used by that package (`pkgload`, etc.)
- **Florence fixture**: clone under `references/keynote_speech_Florence/` (see `references/README.md`)
- **IO-PC fixture**: clone under `references/six_lectures_on_sfc_models/` (see `references/README.md`)
- **Italy SFC fixture**: clone under `references/Italy-SFC-Model/` with `Data_Aalborg.csv`; R deps `bimets` and `jsonlite` (a repo-local `.rlib/` is supported)
