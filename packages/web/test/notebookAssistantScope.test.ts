import { runBaseline } from "@sfcr/core";
import { describe, expect, it } from "vitest";

import { bmwBaselineModel, bmwBaselineOptions } from "../../core/src/fixtures/bmw";
import { processScopedNotebookAssistantResponse } from "../src/notebook/notebookAssistantProposalRunner";
import { buildScopedNotebookAssistantContext } from "../src/notebook/notebookAssistantRuntime";
import {
  buildScopedNotebookProposalSemanticSummary,
  filterNotebookAssistantToolRequestsForScope,
  getNotebookAssistantScopeContract,
  getNotebookAssistantScopeToolNames,
  validateNotebookAssistantToolRequestTargets,
  validateNotebookPatchAgainstScope
} from "../src/notebook/notebookAssistantScope";
import type { NotebookAssistantSnapshot } from "../src/notebook/notebookAssistantTools";
import type { NotebookPatch } from "../src/notebook/notebookPatch";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import type { EquationsCell } from "../src/notebook/types";

const bmwResult = runBaseline(bmwBaselineModel, bmwBaselineOptions);

function findBmwEquationsCell(document = createNotebookFromTemplate("bmw")): EquationsCell {
  const cell = document.cells.find(
    (entry): entry is EquationsCell => entry.type === "equations" && entry.modelId === "equations-newton"
  );
  if (!cell) {
    throw new Error("BMW equations cell missing.");
  }
  return cell;
}

function bmwEquationPathIndex(variableName: string): number {
  const index = findBmwEquationsCell().equations.findIndex(
    (row) => "name" in row && row.name === variableName
  );
  if (index < 0) {
    throw new Error(`Equation '${variableName}' missing from BMW template.`);
  }
  return index;
}

function bmwSnapshot(): NotebookAssistantSnapshot {
  return {
    document: createNotebookFromTemplate("bmw"),
    runtime: {
      errors: {},
      outputs: {
        "baseline-newton": {
          type: "result",
          result: bmwResult
        }
      },
      status: {
        "baseline-newton": "success"
      }
    },
    selectedPeriodIndex: 0,
    selectedCellId: "baseline-chart"
  };
}

describe("notebook assistant scope", () => {
  it("advertises only chart-update tools for chart scopes", () => {
    const tools = getNotebookAssistantScopeToolNames({ kind: "chart-update", cellId: "baseline-chart" });

    expect([...tools]).toEqual(
      expect.arrayContaining([
        "createUpdateChartVariablesPatch",
        "createUpdateChartOptionsPatch",
        "listVariables",
        "getSeriesWindow"
      ])
    );
    expect(tools.has("createAddChartPatch")).toBe(false);
    expect(tools.has("createUpdateEquationPatch")).toBe(false);
    expect(getNotebookAssistantScopeContract({ kind: "chart-update", cellId: "baseline-chart" })).toContain(
      "baseline-chart"
    );
  });

  it("advertises only equation-update tools for equation scopes", () => {
    const tools = getNotebookAssistantScopeToolNames({
      kind: "equation-update",
      cellId: "equations-newton",
      modelId: "equations-newton",
      variable: "Cd"
    });

    expect([...tools]).toEqual(
      expect.arrayContaining(["createUpdateEquationPatch", "getEquation", "getDependencyGraph"])
    );
    expect(tools.has("createAddEquationPatch")).toBe(false);
    expect(tools.has("createRemoveEquationPatch")).toBe(false);
    expect(tools.has("createUpdateChartVariablesPatch")).toBe(false);
  });

  it("advertises read-only tools for equations-cell-ask scopes", () => {
    const tools = getNotebookAssistantScopeToolNames({
      kind: "equations-cell-ask",
      cellId: "equations-newton",
      modelId: "equations-newton"
    });

    expect([...tools]).toEqual(
      expect.arrayContaining(["getEquation", "getDependencyGraph", "getCausalLoopDiagram", "listVariables"])
    );
    expect(tools.has("createUpdateEquationPatch")).toBe(false);
    expect(
      getNotebookAssistantScopeContract({
        kind: "equations-cell-ask",
        cellId: "equations-newton",
        modelId: "equations-newton"
      })
    ).toContain("read tools only");
  });

  it("blocks out-of-scope tools and mismatched targets", () => {
    const chartScope = { kind: "chart-update" as const, cellId: "baseline-chart" };
    const filtered = filterNotebookAssistantToolRequestsForScope(chartScope, [
      { name: "createUpdateChartVariablesPatch", args: { chartId: "baseline-chart", variables: ["Y", "Cd"] } },
      { name: "createUpdateChartVariablesPatch", args: { chartId: "other-chart", variables: ["Y"] } },
      { name: "createAddChartPatch", args: { runId: "baseline-newton", variables: ["Y"] } },
      { name: "listVariables", args: {} }
    ]);

    expect(filtered.allowed).toEqual([
      { name: "createUpdateChartVariablesPatch", args: { chartId: "baseline-chart", variables: ["Y", "Cd"] } },
      { name: "listVariables", args: {} }
    ]);
    expect(filtered.blocked.map((request) => request.name)).toEqual([
      "createUpdateChartVariablesPatch",
      "createAddChartPatch"
    ]);
    expect(
      validateNotebookAssistantToolRequestTargets(chartScope, {
        name: "createUpdateChartVariablesPatch",
        args: { chartId: "other-chart", variables: ["Y"] }
      })
    ).toContain("scoped to 'baseline-chart'");
  });

  it("rejects equation patches that rename or touch another row", () => {
    const document = createNotebookFromTemplate("bmw");
    const cdIndex = bmwEquationPathIndex("Cd");
    const scope = {
      kind: "equation-update" as const,
      cellId: "equations-newton",
      modelId: "equations-newton",
      variable: "Cd"
    };
    const renamePatch: NotebookPatch = {
      operations: [
        {
          op: "replace",
          path: `/cells/by-id/equations-newton/equations/${cdIndex}`,
          value: {
            id: "eq-cd",
            name: "Cd2",
            expression: "alpha1 * YD"
          }
        }
      ]
    };

    expect(validateNotebookPatchAgainstScope(document, scope, renamePatch).join("\n")).toContain(
      "does not allow renaming"
    );
  });

  it("builds semantic summaries for chart and equation patches", () => {
    const document = createNotebookFromTemplate("bmw");
    const cdIndex = bmwEquationPathIndex("Cd");

    expect(
      buildScopedNotebookProposalSemanticSummary({
        document,
        scope: { kind: "chart-update", cellId: "baseline-chart" },
        patch: {
          operations: [
            {
              op: "replace",
              path: "/cells/by-id/baseline-chart/variables",
              value: ["YD", "Cd"]
            }
          ]
        }
      })[0]
    ).toContain("→ YD, Cd");

    expect(
      buildScopedNotebookProposalSemanticSummary({
        document,
        scope: {
          kind: "equation-update",
          cellId: "equations-newton",
          modelId: "equations-newton",
          variable: "Cd"
        },
        patch: {
          operations: [
            {
              op: "replace",
              path: `/cells/by-id/equations-newton/equations/${cdIndex}`,
              value: {
                id: "eq",
                name: "Cd",
                expression: "alpha1 * YD"
              }
            }
          ]
        }
      })[0]
    ).toContain("Cd:");
  });
});

describe("scoped notebook assistant context", () => {
  it("builds compact chart-update context without full notebook JSON", () => {
    const document = createNotebookFromTemplate("bmw");
    const context = buildScopedNotebookAssistantContext({
      document,
      resultCount: 1,
      scope: { kind: "chart-update", cellId: "baseline-chart" },
      selectedPeriodIndex: 4,
      uiMessage: null
    });

    expect(context).toContain("Assistant scope: chart-update");
    expect(context).toContain("createUpdateChartVariablesPatch");
    expect(context).toContain("Scoped notebook JSON:");
    expect(context).not.toContain("Notebook JSON:");
    expect(context).toContain('"fmt":"sfcr-assistant-cell-scope"');
    expect(context).toContain('"id":"baseline-chart"');
    expect(context).not.toContain("createAddChartPatch");
  });

  it("builds equation-update context with the bound focus and full model equations", () => {
    const document = createNotebookFromTemplate("bmw");
    const context = buildScopedNotebookAssistantContext({
      document,
      resultCount: 0,
      scope: {
        kind: "equation-update",
        cellId: "equations-newton",
        modelId: "equations-newton",
        variable: "Cd"
      },
      selectedPeriodIndex: 0
    });

    expect(context).toContain("Assistant scope: equation-update");
    expect(context).toContain("createUpdateEquationPatch");
    expect(context).toContain('"variable":"Cd"');
    expect(context).toContain('"focus"');
    expect(context).toContain('"equations"');
    expect(context).toContain('"externals"');
    expect(context).toContain("Equation syntax:");
    expect(context).not.toContain("createAddEquationPatch");
  });

  it("builds equations-cell-ask context with the full model and read tools only", () => {
    const document = createNotebookFromTemplate("bmw");
    const context = buildScopedNotebookAssistantContext({
      document,
      resultCount: 1,
      scope: {
        kind: "equations-cell-ask",
        cellId: "equations-newton",
        modelId: "equations-newton"
      },
      selectedPeriodIndex: 0
    });

    expect(context).toContain("Assistant scope: equations-cell-ask");
    expect(context).toContain("getDependencyGraph");
    expect(context).toContain('"equations"');
    expect(context).toContain('"externals"');
    expect(context).not.toContain("createUpdateEquationPatch");
    expect(context).not.toContain('"focus"');
  });
});

describe("scoped notebook assistant proposal runner", () => {
  it("prepares a chart variables proposal from a scoped helper response", () => {
    const snapshot = bmwSnapshot();
    const result = processScopedNotebookAssistantResponse({
      question: "Show YD and Cd",
      responseText:
        '```json\n{"notebookAssistantToolRequests":[{"name":"createUpdateChartVariablesPatch","args":{"chartId":"baseline-chart","variables":["YD","Cd"]}}]}\n```',
      scope: { kind: "chart-update", cellId: "baseline-chart" },
      snapshot
    });

    expect(result.patch?.operations).toEqual([
      expect.objectContaining({
        op: "replace",
        path: "/cells/by-id/baseline-chart/variables",
        value: ["YD", "Cd"]
      })
    ]);
    expect(result.inlinePatch?.status).toBe("ready");
    expect(result.inlinePatch?.preview.ok).toBe(true);
    expect(result.semanticSummary[0]).toContain("→ YD, Cd");
    expect(result.scopeViolations).toEqual([]);
  });

  it("blocks helper requests that target another chart", () => {
    const snapshot = bmwSnapshot();
    const result = processScopedNotebookAssistantResponse({
      question: "Show YD",
      responseText:
        '```json\n{"notebookAssistantToolRequests":[{"name":"createUpdateChartVariablesPatch","args":{"chartId":"other-chart","variables":["YD"]}}]}\n```',
      scope: { kind: "chart-update", cellId: "baseline-chart" },
      snapshot
    });

    expect(result.patch).toBeNull();
    expect(result.blocked).toHaveLength(1);
    expect(result.scopeViolations[0]).toContain("blocked");
    expect(result.text).toContain("baseline-chart");
  });

  it("prepares an equation update proposal for the bound variable", () => {
    const snapshot = bmwSnapshot();
    const result = processScopedNotebookAssistantResponse({
      question: "Use only income in consumption",
      responseText:
        '```json\n{"notebookAssistantToolRequests":[{"name":"createUpdateEquationPatch","args":{"modelId":"equations-newton","variable":"Cd","expression":"alpha0 + alpha1 * YD"}}]}\n```',
      scope: {
        kind: "equation-update",
        cellId: "equations-newton",
        modelId: "equations-newton",
        variable: "Cd"
      },
      snapshot
    });

    expect(result.patch?.operations[0]).toEqual(
      expect.objectContaining({
        op: "replace",
        value: expect.objectContaining({
          name: "Cd",
          expression: "alpha0 + alpha1 * YD"
        })
      })
    );
    expect(result.inlinePatch?.preview.ok).toBe(true);
    expect(result.semanticSummary[0]).toContain("Cd:");
  });

  it("rejects equation helper requests for a different variable", () => {
    const snapshot = bmwSnapshot();
    const result = processScopedNotebookAssistantResponse({
      question: "Change Y",
      responseText:
        '```json\n{"notebookAssistantToolRequests":[{"name":"createUpdateEquationPatch","args":{"modelId":"equations-newton","variable":"Y","expression":"Cs"}}]}\n```',
      scope: {
        kind: "equation-update",
        cellId: "equations-newton",
        modelId: "equations-newton",
        variable: "Cd"
      },
      snapshot
    });

    expect(result.patch).toBeNull();
    expect(result.blocked[0]?.args).toEqual(
      expect.objectContaining({
        variable: "Y"
      })
    );
  });

  it("blocks patch helpers in equations-cell-ask scope", () => {
    const snapshot = bmwSnapshot();
    const result = processScopedNotebookAssistantResponse({
      question: "Explain the household block",
      responseText:
        '```json\n{"notebookAssistantToolRequests":[{"name":"createUpdateEquationPatch","args":{"modelId":"equations-newton","variable":"Cd","expression":"alpha1 * YD"}}]}\n```',
      scope: {
        kind: "equations-cell-ask",
        cellId: "equations-newton",
        modelId: "equations-newton"
      },
      snapshot
    });

    expect(result.patch).toBeNull();
    expect(result.blocked.map((request) => request.name)).toEqual(["createUpdateEquationPatch"]);
    expect(result.text).toContain("read tools only");
  });
});
