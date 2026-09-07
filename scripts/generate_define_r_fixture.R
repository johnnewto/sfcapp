#!/usr/bin/env Rscript

# Snapshot DEFINE 1.1 (August 2022) R baseline values for the notebook.
# Run from the repository root with R 4.x and jsonlite:
#   Rscript scripts/generate_define_r_fixture.R

library(jsonlite)

output_dir <- "packages/web/test/fixtures/r-regressions"
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
dump_dir <- "scripts/generated"
dir.create(dump_dir, recursive = TRUE, showWarnings = FALSE)

round_value <- function(x) {
  round(unname(as.numeric(x)), digits = 12)
}

period_snapshot <- function(names, period) {
  stats <- lapply(names, function(name) {
    value <- get(name, envir = globalenv())
    round_value(value[period])
  })
  names(stats) <- names
  stats
}

model_path <- "references/define-1.1/R DEFINE 1.1-Aug2022 CODE.R"
csv_path <- "references/define-1.1/_DEFINE_Carbontaxes.csv"
if (!file.exists(model_path)) {
  stop("Missing ", model_path)
}
if (!file.exists(csv_path)) {
  stop("Missing ", csv_path)
}

raw_lines <- readLines(model_path, warn = FALSE)
figures_hits <- grep("^#7\\. FIGURES", raw_lines, perl = TRUE)
if (length(figures_hits) < 1) {
  stop("Could not find '#7. FIGURES' in ", model_path)
}
figures_at <- tail(figures_hits, 1)
core_lines <- raw_lines[seq_len(figures_at - 1L)]
core_lines <- sub("^loops<-12", "loops<-1", core_lines)
core_lines <- sub("^figures_dummy<-1", "figures_dummy<-0", core_lines)
core_lines <- sub("^scenarios_print<-1", "scenarios_print<-1", core_lines)
core_lines <- sub("^rm\\(list=ls\\(all=T\\))", "# rm(list=ls(all=T))", core_lines)
core_text <- paste(core_lines, collapse = "\n")

old_wd <- getwd()
work_dir <- file.path(old_wd, "scripts/generated/define-1.1-run")
unlink(work_dir, recursive = TRUE)
dir.create(work_dir, recursive = TRUE)
on.exit(setwd(old_wd), add = TRUE)
file.copy(csv_path, file.path(work_dir, "_DEFINE_Carbontaxes.csv"))
core_file <- file.path(work_dir, "define_core.R")
writeLines(core_text, core_file)
setwd(work_dir)
write.csv <- function(...) invisible(NULL)
cat("Running DEFINE 1.1 baseline (one scenario, no figures)...\n")
sys.source(core_file, envir = globalenv())
if (!exists("Data", envir = globalenv())) {
  stop("DEFINE run did not create Data. Objects: ", paste(head(ls(envir = globalenv()), 40), collapse = ", "))
}

is_num_atomic <- function(x) {
  is.numeric(x) && !is.matrix(x) && !is.array(x)
}

scalar_names <- ls(envir = globalenv(), all.names = TRUE)
scalars <- list()
period1 <- list()
for (name in scalar_names) {
  value <- get(name, envir = globalenv())
  if (!is_num_atomic(value)) {
    next
  }
  if (length(value) == 1L && is.finite(value)) {
    scalars[[name]] <- round_value(value)
  } else if (length(value) == T) {
    period1[[name]] <- round_value(value[1])
  }
}

data_frame <- get("Data", envir = globalenv())
series <- list(
  tau_C_baseline = as.numeric(data_frame[[1]]) / 1000,
  tau_C_policy_Medium = as.numeric(data_frame[[2]]) / 1000,
  tau_C_policy_High = as.numeric(data_frame[[3]]) / 1000,
  EMIS_F_Y_SSP360 = as.numeric(data_frame[[4]]),
  tau_C_baseline_per = as.numeric(data_frame[[1]]),
  tau_C_policy_Medium_per = as.numeric(data_frame[[2]]),
  tau_C_policy_High_per = as.numeric(data_frame[[3]])
)

checkpoint_names <- c(
  "Y", "g_Y", "CO_PRI", "I_PRI", "I_GOV", "CO_GOV", "IG_PRI", "IC_PRI",
  "TEMP", "EMIS", "EMIS_F", "EMIS_L", "CO2_CUM", "theta", "mu", "epsilon",
  "rho", "omega", "seq", "ur", "POP", "LF", "N", "u", "ue", "um",
  "SEC", "SEC_H", "SEC_B", "SEC_CB", "SEC_CBred", "D", "HPM", "A",
  "L", "LC", "LG", "K_PRI", "KG_PRI", "KC_PRI", "K_GOV", "K",
  "TP", "RP", "DP", "BP", "Y_H", "r", "def", "CAR", "lev_B", "dsr",
  "CR", "CR_G", "spr", "int_G", "yield_C", "yield_G", "tau_C", "SUB",
  "gov_SUB", "TAX", "TAX_C", "fiscal_balance", "beta_S1", "kappa",
  "delta", "v", "lambda", "wage", "h", "W", "SES", "REV_M", "REV_E",
  "dep_M", "dep_E", "D_T", "g_POP", "s_W"
)
checkpoint_names <- checkpoint_names[checkpoint_names %in% ls(envir = globalenv())]

consistency_error <- sum(abs(SEC_CB - SEC_CBred))
average_consistency_error <- consistency_error / T

dump <- list(
  scalars = scalars,
  period1 = period1,
  series = series,
  checkpoints = list(
    "5" = period_snapshot(checkpoint_names, 5),
    "50" = period_snapshot(checkpoint_names, 50),
    "80" = period_snapshot(checkpoint_names, 80)
  ),
  consistency = list(
    hiddenEquation = "SEC_CBred - SEC_CB",
    averageError = round_value(average_consistency_error),
    cumulativeError = round_value(consistency_error)
  )
)

setwd(old_wd)
dump_path <- file.path(dump_dir, "define_1_1_r_dump.json")
writeLines(
  toJSON(dump, pretty = TRUE, auto_unbox = TRUE, digits = NA),
  dump_path
)

fixture <- list(
  templateId = "define",
  sourceScript = "references/define-1.1/R DEFINE 1.1-Aug2022 CODE.R",
  sourceScenarioScript = "packages/web/src/notebook/templates/define.notebook.yaml (runScenario from 2021, shocks from period 4)",
  checkpoints = list(
    "baseline-run" = list(
      periods = dump$checkpoints
    )
  ),
  consistencyCheck = dump$consistency
)

fixture_path <- file.path(output_dir, "define.json")
if (file.exists(fixture_path)) {
  existing <- fromJSON(fixture_path)
  for (name in names(existing$checkpoints)) {
    if (name != "baseline-run") {
      fixture$checkpoints[[name]] <- existing$checkpoints[[name]]
    }
  }
  if (!is.null(existing$sourceScenarioScript)) {
    fixture$sourceScenarioScript <- existing$sourceScenarioScript
  }
}

writeLines(
  toJSON(fixture, pretty = TRUE, auto_unbox = TRUE, digits = NA),
  fixture_path
)

cat(sprintf("Wrote %s\n", dump_path))
cat(sprintf("Wrote %s\n", fixture_path))
cat(sprintf("g_Y[2]=%.4f TEMP[80]=%.3f SEC_CB-SEC_CBred avg=%.3e\n", g_Y[2], TEMP[80], average_consistency_error))
