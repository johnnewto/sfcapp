# DEFINE 1.1 (August 2022)

R code for the DEFINE 1.1 global ecological stock-flow consistent model from Dafermos & Nikolaidi (2022), _Assessing climate policies: an ecological stock-flow consistent perspective_, European Journal of Economics and Economic Policies: Intervention.

Upstream: [DEFINE-model/VERSION_1.1_AUG2022](https://github.com/DEFINE-model/VERSION_1.1_AUG2022). Manual: [define-1.1-manual-aug-22.pdf](https://define-model.org/wp-content/uploads/2022/10/define-1.1-manual-aug-22.pdf).

`R DEFINE 1.1-Aug2022 CODE.R` is the official simulation script. `_DEFINE_Carbontaxes.csv` supplies the SSP3 carbon-tax and intensity paths. They are used for notebook parity via `scripts/generate_define_r_fixture.R` and `scripts/generate_define_notebook.py`.

```bash
Rscript scripts/generate_define_r_fixture.R
python3 scripts/generate_define_notebook.py
pnpm --filter @sfcr/web compile:notebook-yaml -- --write define
```
