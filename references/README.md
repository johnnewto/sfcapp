# References

This directory holds non-primary implementations that are kept for verification, parity checks, and migration support.

Current contents:

- `java/`: Java reference engine used when validating or porting behavior into the TypeScript solver
- `r-sfcr/`: upstream R implementation pinned as a git submodule for parity and behavior checks
- `keynote_speech_Florence/`: Marco Veronese Passarella's ECO-3IO-PC prototype (IO + SFC + ecological block) from the Florence 2025 summer school keynote
- `define-simple-1.1/`: Dafermos & Nikolaidi DEFINE-SIMPLE 1.1 Model Builder R export (households, firms, banks, green capital, carbon intensity)
- `six_lectures_on_sfc_models/`: Marco Veronese Passarella's Six Lectures on SFC Models course code (Nov–Dec 2023), including Model IO-PC in `IOPC_model.R`
- `Italy-SFC-Model/`: Canelli & Veronese Passarella empirical SFC model for Italy (marcoverpas/Italy-SFC-Model), with the `bimets` model in `1_Model_upload`, the observed matrices in `2_BS_obs`/`3_TFM_obs`, and the bundled `Data_Aalborg.csv` dataset used by `scripts/generate_italy_sfc_r_fixture.R`
- `leeds_lectures_2026/`: Marco Veronese Passarella's Leeds 2026 NARTI lecture scripts — agent-based SIM, PC, and BMW in `ABM_SIM.R`, `ABM_PC.R`, and `ABM_BMW.R`

Regression checkpoints for notebook templates (including Florence baseline numbers) are documented in [`devdocs/r-regression-fixtures.md`](../devdocs/r-regression-fixtures.md).

If the submodule has not been fetched yet, run:

```bash
git submodule update --init --recursive
```

These projects are not the default entry point for new product work.
