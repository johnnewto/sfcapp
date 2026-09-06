# DEFINE-SIMPLE 1.1

R code for the DEFINE-SIMPLE 1.1 model from Dafermos & Nikolaidi (2026), _Ecological stock-flow consistent modelling: a theoretical and practical guide_, in D’Alessandro, Distefano and Morlin (eds.), _Handbook of Ecological Macroeconomics_, Open Book Publishers, forthcoming.

Upstream: [DEFINE-model/SIMPLE-1.1](https://github.com/DEFINE-model/SIMPLE-1.1). Manual: [define-model.org/define-simple](https://define-model.org/define-simple/).

`DEFINE_SIMPLE.R` is the Model Builder export (9 June 2026). It is used for notebook parity via `scripts/generate_define_simple_r_fixture.R`.

```bash
Rscript scripts/generate_define_simple_r_fixture.R
pnpm --filter @sfcr/web compile:notebook-yaml -- --write define_simple
```
