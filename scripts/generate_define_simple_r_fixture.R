#!/usr/bin/env Rscript

# Snapshot DEFINE-SIMPLE 1.1 R baseline checkpoints for the notebook regression fixture.
# Run from the repository root with R 4.x and jsonlite:
#   Rscript scripts/generate_define_simple_r_fixture.R

library(jsonlite)

output_dir <- "packages/web/test/fixtures/r-regressions"
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

round_value <- function(x) {
  round(unname(as.numeric(x)), digits = 12)
}

period_snapshot <- function(frame, period, names) {
  stats <- lapply(names, function(name) round_value(frame[[name]][period]))
  names(stats) <- names
  stats
}

write_fixture <- function(name, payload) {
  writeLines(
    toJSON(payload, pretty = TRUE, auto_unbox = TRUE, digits = NA),
    file.path(output_dir, sprintf("%s.json", name))
  )
}

model_path <- "references/define-simple-1.1/DEFINE_SIMPLE.R"
if (!file.exists(model_path)) {
  stop("Missing ", model_path)
}

raw_lines <- readLines(model_path, warn = FALSE)
chart_at <- grep("^# -- Charts --", raw_lines, perl = TRUE)[1]
if (is.na(chart_at)) {
  stop("Could not find '# -- Charts --' in ", model_path)
}
core_text <- paste(raw_lines[seq_len(chart_at - 1L)], collapse = "\n")
core_text <- sub("rm\\(list = ls\\(all = TRUE\\)\\)", "", core_text)

work_dir <- tempfile("define-simple-")
dir.create(work_dir)
old_wd <- getwd()
on.exit(
  {
    setwd(old_wd)
    unlink(work_dir, recursive = TRUE)
  },
  add = TRUE
)
setwd(work_dir)
write.csv <- function(...) invisible(NULL)

# DEFINE_SIMPLE.R assigns with <<- into the global environment.
eval(parse(text = core_text), envir = globalenv())

baseline <- results[[1]]
checkpoint_names <- c(
  "Y", "CO", "I", "D", "L", "K", "K_G", "K_C", "EMIS_F", "CI",
  "g_Y", "lev", "beta", "u", "r", "Y_H", "W", "TP", "RP", "DP",
  "BP", "I_G", "I_C", "L_G", "L_C", "D_red", "Y_P"
)

consistency_error <- sum(abs(baseline$D - baseline$D_red))
average_consistency_error <- consistency_error / nrow(baseline)

fixture <- list(
  templateId = "define-simple",
  sourceScript = "references/define-simple-1.1/DEFINE_SIMPLE.R",
  sourceScenarioScript = "packages/web/src/notebook/templates/define_simple.notebook.yaml (runScenario from baseline terminal state)",
  checkpoints = list(
    "baseline-run" = list(
      periods = list(
        "5" = period_snapshot(baseline, 5, checkpoint_names),
        "50" = period_snapshot(baseline, 50, checkpoint_names),
        "78" = period_snapshot(baseline, 78, checkpoint_names)
      )
    )
  ),
  consistencyCheck = list(
    hiddenEquation = "D_red - D",
    averageError = round_value(average_consistency_error),
    cumulativeError = round_value(consistency_error)
  )
)

fixture_path <- file.path(old_wd, output_dir, "define-simple.json")
if (file.exists(fixture_path)) {
  existing <- fromJSON(fixture_path)
  if (!is.null(existing$checkpoints[["scenario-1-run"]])) {
    fixture$checkpoints[["scenario-1-run"]] <- existing$checkpoints[["scenario-1-run"]]
  }
  if (!is.null(existing$checkpoints[["scenario-2-run"]])) {
    fixture$checkpoints[["scenario-2-run"]] <- existing$checkpoints[["scenario-2-run"]]
  }
  if (!is.null(existing$sourceScenarioScript)) {
    fixture$sourceScenarioScript <- existing$sourceScenarioScript
  }
}

setwd(old_wd)
write_fixture("define-simple", fixture)
cat(sprintf("Wrote %s\n", file.path(output_dir, "define-simple.json")))
