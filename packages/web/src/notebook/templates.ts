import abmBmwNotebookYaml from "./templates/abm_bmw.notebook.yaml?raw";
import abmPcNotebookYaml from "./templates/abm_pc.notebook.yaml?raw";
import abmSimNotebookYaml from "./templates/abm_sim.notebook.yaml?raw";
import io3PcNotebookYaml from "./templates/3io-pc.notebook.yaml?raw";
import bmwNotebookYaml from "./templates/bmw.notebook.yaml?raw";
import eco3IoPcNotebookYaml from "./templates/eco-3io-pc.notebook.yaml?raw";
import defineSimpleNotebookYaml from "./templates/define_simple.notebook.yaml?raw";
import endogenousMoneyNotebookYaml from "./templates/endogenous-money.notebook.yaml?raw";
import gl2PcNotebookYaml from "./templates/gl2-pc.notebook.yaml?raw";
import ioPcNotebookYaml from "./templates/io-pc.notebook.yaml?raw";
import gl6DisNotebookYaml from "./templates/gl6-dis.notebook.yaml?raw";
import gl7InsoutNotebookYaml from "./templates/gl7-insout.notebook.yaml?raw";
import gl8GrowthNotebookYaml from "./templates/gl8-growth.notebook.yaml?raw";
import godleyFiscalSfcNotebookYaml from "./templates/godley_fiscal_sfc.notebook.yaml?raw";
import interbankLiquidityRiskNotebookYaml from "./templates/interbank-liquidity-risk.notebook.yaml?raw";
import italySfcNotebookYaml from "./templates/italy_sfc.notebook.yaml?raw";
import opensimplestLevyNotebookYaml from "./templates/opensimplest-levy.notebook.yaml?raw";
import opensimplestNotebookYaml from "./templates/opensimplest.notebook.yaml?raw";
import predatorPreyNotebookYaml from "./templates/predator-prey.notebook.yaml?raw";
import simpleEpidemicNotebookYaml from "./templates/simple-epidemic.notebook.yaml?raw";
import simNotebookYaml from "./templates/sim.notebook.yaml?raw";
import { analyzeNotebookSource, type NotebookSourceDiagnostic } from "./document";
import type { NotebookDocument } from "./types";

export type NotebookTemplateId =
  | "3io-pc"
  | "abm-bmw"
  | "abm-pc"
  | "abm-sim"
  | "bmw"
  | "eco-3io-pc"
  | "define-simple"
  | "endogenous-money"
  | "gl2-pc"
  | "io-pc"
  | "gl6-dis"
  | "gl7-insout"
  | "gl8-growth"
  | "godley-fiscal-sfc"
  | "interbank-liquidity-risk"
  | "italy-sfc"
  | "opensimplest-levy"
  | "opensimplest"
  | "predator-prey"
  | "simple-epidemic"
  | "sim";
export const DEFAULT_NOTEBOOK_TEMPLATE_ID: NotebookTemplateId = "bmw";

export interface NotebookTemplateDefinition {
  id: NotebookTemplateId;
  label: string;
  description: string;
}

export type NotebookTemplateLoadResult =
  | { ok: true; document: NotebookDocument }
  | { ok: false; diagnostics: NotebookSourceDiagnostic[] };

const NOTEBOOK_TEMPLATE_YAML: Record<NotebookTemplateId, string> = {
  sim: simNotebookYaml,
  "abm-bmw": abmBmwNotebookYaml,
  "abm-pc": abmPcNotebookYaml,
  "abm-sim": abmSimNotebookYaml,
  bmw: bmwNotebookYaml,
  "3io-pc": io3PcNotebookYaml,
  "eco-3io-pc": eco3IoPcNotebookYaml,
  "define-simple": defineSimpleNotebookYaml,
  "endogenous-money": endogenousMoneyNotebookYaml,
  "gl2-pc": gl2PcNotebookYaml,
  "io-pc": ioPcNotebookYaml,
  "gl6-dis": gl6DisNotebookYaml,
  "gl7-insout": gl7InsoutNotebookYaml,
  "gl8-growth": gl8GrowthNotebookYaml,
  "godley-fiscal-sfc": godleyFiscalSfcNotebookYaml,
  "interbank-liquidity-risk": interbankLiquidityRiskNotebookYaml,
  "italy-sfc": italySfcNotebookYaml,
  opensimplest: opensimplestNotebookYaml,
  "opensimplest-levy": opensimplestLevyNotebookYaml,
  "predator-prey": predatorPreyNotebookYaml,
  "simple-epidemic": simpleEpidemicNotebookYaml
};

export const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateDefinition> = {
  sim: {
    id: "sim",
    label: "SIM",
    description:
      "Godley-Lavoie SIM notebook with baseline, government-spending scenario, accounting matrices, and result views."
  },
  "abm-sim": {
    id: "abm-sim",
    label: "ABM-SIM",
    description:
      "Agent-based SIM (Leeds lectures 2026): heterogeneous households, job lottery, FCFS goods market, Monte Carlo means."
  },
  "abm-pc": {
    id: "abm-pc",
    label: "ABM-PC",
    description:
      "Agent-based PC (Leeds lectures 2026): bill/cash portfolio, interest-rate shock, job lottery, Monte Carlo means."
  },
  "abm-bmw": {
    id: "abm-bmw",
    label: "ABM-BMW",
    description:
      "Agent-based BMW (Leeds lectures 2026): deposits, investment accelerator, residual wages, job lottery, Monte Carlo means."
  },
  bmw: {
    id: "bmw",
    label: "BMW",
    description: "BMW browser notebook with a baseline run, two scenarios, and accounting views."
  },
  "3io-pc": {
    id: "3io-pc",
    label: "Model 3IO-PC",
    description:
      "Florence keynote 3IO-PC notebook with three-industry input-output structure, endogenous reproduction prices, inflation-tax consumption, and a government-spending scenario."
  },
  "eco-3io-pc": {
    id: "eco-3io-pc",
    label: "ECO-3IO-PC",
    description:
      "Florence keynote ECO-3IO-PC notebook with three-industry IO structure, ecological stocks and flows, and a temperature-feedback scenario."
  },
  "define-simple": {
    id: "define-simple",
    label: "DEFINE-SIMPLE",
    description:
      "DEFINE-SIMPLE 1.1 notebook with households, firms and banks, green vs conventional capital, and carbon-intensity scenarios."
  },
  "endogenous-money": {
    id: "endogenous-money",
    label: "Endogenous Money",
    description:
      "Runnable BOMD notebook based on the Money From First Principles endogenous-money section."
  },
  "gl2-pc": {
    id: "gl2-pc",
    label: "GL2 PC",
    description:
      "PC notebook based on the gl2-pc article baseline, balance-sheet views, account-transactions matrix, and two deterministic extensions."
  },
  "io-pc": {
    id: "io-pc",
    label: "Model IO-PC",
    description:
      "Six Lectures IO-PC notebook with two-industry input-output structure, inflation-tax consumption, and interest-rate and propensity scenarios."
  },
  "gl6-dis": {
    id: "gl6-dis",
    label: "GL6 DIS",
    description: "DIS notebook based on the gl6-dis article baseline, matrices, and two scenarios."
  },
  "gl7-insout": {
    id: "gl7-insout",
    label: "GL7 INSOUT",
    description:
      "INSOUT notebook based on the gl7-insout article baseline, matrices, and selected scenario experiments."
  },
  "gl8-growth": {
    id: "gl8-growth",
    label: "GL8 GROWTH",
    description:
      "GROWTH notebook based on the gl8-growth article baseline, accounting matrices, and selected policy experiments."
  },
  "godley-fiscal-sfc": {
    id: "godley-fiscal-sfc",
    label: "Godley Fiscal SFC",
    description:
      "Godley-Lavoie Levy WP 494 fiscal-policy growth model with endogenous government spending, debt dynamics, and trade-deficit scenarios."
  },
  "interbank-liquidity-risk": {
    id: "interbank-liquidity-risk",
    label: "Interbank liquidity risk",
    description:
      "Runnable starter notebook inspired by Reale's interbank-market SFC paper, with two-bank funding choice, reserve management, and a liquidity-stress scenario."
  },
  "italy-sfc": {
    id: "italy-sfc",
    label: "Italy SFC",
    description:
      "Empirical six-sector SFC model for Italy (Canelli & Veronese Passarella), reproducing the observed balance-sheet and transactions-flow matrices and a dynamic in-sample simulation over 1998-2021."
  },
  opensimplest: {
    id: "opensimplest",
    label: "OPENSIMPLEST",
    description:
      "Compact open-economy SFC notebook with four sectors, portfolio allocation, exchange-rate adjustment, and an export-shock scenario."
  },
  "opensimplest-levy": {
    id: "opensimplest-levy",
    label: "OPENSIMPLEST Levy",
    description:
      "Levy WP 1105 aligned OPENSIMPLEST notebook using paper-style superscript symbols, lagged interest-rate flows, and a 150-period baseline."
  },
  "predator-prey": {
    id: "predator-prey",
    label: "Predator-prey",
    description:
      "Minimal reference notebook with lagged predator-prey dynamics, one baseline run, and one scenario shock."
  },
  "simple-epidemic": {
    id: "simple-epidemic",
    label: "Simple epidemic",
    description:
      "Runnable version of the legacy simple epidemic model with stock equations, a contact lookup approximation, and a baseline chart."
  }
};

const loadedDocuments = new Map<NotebookTemplateId, NotebookDocument>();
const loadErrors = new Map<NotebookTemplateId, NotebookSourceDiagnostic[]>();

export function loadNotebookTemplate(id: NotebookTemplateId): NotebookTemplateLoadResult {
  const cachedDocument = loadedDocuments.get(id);
  if (cachedDocument) {
    return { ok: true, document: cachedDocument };
  }

  const cachedError = loadErrors.get(id);
  if (cachedError) {
    return { ok: false, diagnostics: cachedError };
  }

  const analysis = analyzeNotebookSource(NOTEBOOK_TEMPLATE_YAML[id], "yaml");
  if (analysis.parseDiagnostics.length > 0) {
    loadErrors.set(id, analysis.parseDiagnostics);
    return { ok: false, diagnostics: analysis.parseDiagnostics };
  }

  if (analysis.schemaDiagnostics.length > 0) {
    loadErrors.set(id, analysis.schemaDiagnostics);
    return { ok: false, diagnostics: analysis.schemaDiagnostics };
  }

  if (!analysis.document) {
    const diagnostics: NotebookSourceDiagnostic[] = [
      {
        domain: "source",
        message: "Unable to parse template YAML.",
        phase: "parse",
        severity: "error"
      }
    ];
    loadErrors.set(id, diagnostics);
    return { ok: false, diagnostics };
  }

  loadedDocuments.set(id, analysis.document);
  return { ok: true, document: analysis.document };
}

export function isNotebookTemplateLoadable(id: NotebookTemplateId): boolean {
  return loadNotebookTemplate(id).ok;
}

export function formatNotebookTemplateLoadError(
  id: NotebookTemplateId,
  diagnostics: NotebookSourceDiagnostic[]
): string {
  const label = NOTEBOOK_TEMPLATES[id].label;
  const detail = diagnostics
    .slice(0, 2)
    .map(formatNotebookTemplateDiagnostic)
    .join("; ");
  return `Template “${label}” failed to load: ${detail}`;
}

function formatNotebookTemplateDiagnostic(diagnostic: NotebookSourceDiagnostic): string {
  if (diagnostic.line != null && diagnostic.column != null) {
    return `${diagnostic.message} (line ${diagnostic.line}, column ${diagnostic.column})`;
  }

  return diagnostic.message;
}

export function getNotebookTemplateDocument(id: NotebookTemplateId): NotebookDocument {
  const result = loadNotebookTemplate(id);
  if (!result.ok) {
    throw new Error(formatNotebookTemplateLoadError(id, result.diagnostics));
  }

  return result.document;
}

/** Raw YAML source for a template (includes author comments). */
export function getNotebookTemplateYamlSource(id: NotebookTemplateId): string {
  return NOTEBOOK_TEMPLATE_YAML[id];
}

export function createNotebookFromTemplate(
  id: NotebookTemplateId = DEFAULT_NOTEBOOK_TEMPLATE_ID
): NotebookDocument {
  return structuredClone(getNotebookTemplateDocument(id));
}

export function createNotebookFromTemplateWithFallback(
  templateId: NotebookTemplateId,
  fallbackId: NotebookTemplateId = DEFAULT_NOTEBOOK_TEMPLATE_ID
): {
  document: NotebookDocument;
  loadError: string | null;
  requestedTemplateId: NotebookTemplateId;
  resolvedTemplateId: NotebookTemplateId;
} {
  const requested = loadNotebookTemplate(templateId);
  if (requested.ok) {
    return {
      document: structuredClone(requested.document),
      loadError: null,
      requestedTemplateId: templateId,
      resolvedTemplateId: templateId
    };
  }

  const loadError = formatNotebookTemplateLoadError(templateId, requested.diagnostics);
  if (templateId === fallbackId) {
    throw new Error(loadError);
  }

  const fallback = loadNotebookTemplate(fallbackId);
  if (!fallback.ok) {
    throw new Error(
      `${loadError}; fallback template “${NOTEBOOK_TEMPLATES[fallbackId].label}” also failed to load.`
    );
  }

  return {
    document: structuredClone(fallback.document),
    loadError,
    requestedTemplateId: templateId,
    resolvedTemplateId: fallbackId
  };
}

export function isNotebookTemplateId(value: string): value is NotebookTemplateId {
  return value in NOTEBOOK_TEMPLATES;
}
