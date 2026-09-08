import type { NotebookCell, NotebookDocument } from "../types";

export interface NotebookYamlEnvelope extends Partial<NotebookDocument> {
  balance?: unknown;
  baselineRun?: unknown;
  cellOrder?: unknown;
  charts?: unknown;
  equationCell?: unknown;
  equations?: unknown;
  format?: unknown;
  formatVersion?: unknown;
  introCell?: unknown;
  initialValuesCell?: unknown;
  "initial-values"?: unknown;
  modelId?: unknown;
  notes?: unknown;
  parameters?: unknown;
  parametersCell?: unknown;
  sectors?: unknown;
  solver?: unknown;
  solverCell?: unknown;
  tables?: unknown;
  transactions?: unknown;
  units?: unknown;
  variables?: unknown;
}

export const NOTEBOOK_YAML_FORMAT = "sfcr-notebook-yaml";
export const NOTEBOOK_YAML_FORMAT_VERSION = 1;
export const NOTEBOOK_CELL_TYPES = new Set<NotebookCell["type"]>([
  "markdown",
  "model",
  "equations",
  "solver",
  "externals",
  "observed",
  "initial-values",
  "abm-model",
  "run",
  "chart",
  "chart-grid",
  "table",
  "matrix",
  "sequence",
  "sankey",
  "hydraulics"
]);

export interface CompactYamlFormatOptions {
  preserveIds?: boolean;
}

