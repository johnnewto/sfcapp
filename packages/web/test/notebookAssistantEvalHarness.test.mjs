import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import simNotebook from "../public/notebook-examples/sim.example.notebook.json";
import {
  listFixtures,
  loadEvaluatorModule,
  loadFixture,
  runNotebookAssistantEval
} from "../evals/notebook-assistant/lib.mjs";
import {
  extractNotebookAssistantToolRequests,
  filterNotebookAssistantToolRequestsForMode
} from "../src/notebook/notebookAssistantFlow";
import { evaluateNotebookAssistantResponse } from "../src/notebook/notebookAssistantEval";

describe("notebook assistant eval harness", () => {
  beforeAll(async () => {
    await loadEvaluatorModule();
  }, 30000);

  it("lists the seed fixtures", async () => {
    await expect(listFixtures()).resolves.toEqual(
      expect.arrayContaining([
        "ask-list-runs",
        "chart-update-baseline-vars",
        "chart-update-options",
        "chart-update-reject-other",
        "edit-change-alpha1",
        "edit-add-chart",
        "edit-extend-runs",
        "edit-add-equation",
        "equation-explain-cd",
        "equation-update-cd",
        "equation-update-reject-other"
      ])
    );
  });

  it("loads fixture metadata", async () => {
    const fixture = await loadFixture("edit-change-alpha1");

    expect(fixture.mode).toBe("edit");
    expect(fixture.expected.toolNames).toContain("createUpdateParameterPatch");
  });

  it("extracts and mode-filters assistant tool requests", () => {
    const extraction = extractNotebookAssistantToolRequests(
      '{ "notebookAssistantToolRequests": [{ "name": "listRuns", "args": {} }, { "name": "createUpdateParameterPatch", "args": { "modelId": "sim", "variable": "alpha1", "value": 0.65 } }] }'
    );

    expect(extraction.requests.map((request) => request.name)).toEqual(["listRuns", "createUpdateParameterPatch"]);
    expect(filterNotebookAssistantToolRequestsForMode("ask", extraction.requests).blocked.map((request) => request.name)).toEqual([
      "createUpdateParameterPatch"
    ]);
  });

  it("runs an ask-mode fixture without producing a patch", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-ask-"));
    const result = await runNotebookAssistantEval({ fixtureId: "ask-list-runs", artifactDir });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).toBeNull();
    expect(result.summary.tools.allowed.map((tool) => tool.name)).toEqual(["listRuns"]);
    expect(await fs.stat(path.join(artifactDir, "summary.json"))).toBeTruthy();
    expect(await fs.stat(path.join(artifactDir, "tool-results.json"))).toBeTruthy();
  });

  it("evaluates saved responses with the production notebook assistant modules", async () => {
    const fixture = await loadFixture("edit-change-alpha1");
    const rawResponse = await fs.readFile(path.resolve("evals/notebook-assistant", fixture.savedResponsePath), "utf8");
    const result = evaluateNotebookAssistantResponse({
      document: simNotebook,
      fixture,
      rawResponse
    });

    expect(result.summary.ok).toBe(true);
    expect(result.summary.tools.allowed.map((tool) => tool.name)).toEqual(["createUpdateParameterPatch"]);
    expect(result.patch?.operations[0].path).toBe("/cells/by-id/externals/externals/2/valueText");
    expect(result.preview?.ok).toBe(true);
    expect(result.preview?.summary).toEqual({ addedCells: 0, changedCells: 1, operationCount: 1, removedCells: 0 });
  });

  it("runs an edit fixture and validates the previewed patch", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-edit-"));
    const progressEvents = [];
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "edit-change-alpha1",
      onProgress(stage, message) {
        progressEvents.push({ stage, message });
        console.info(`[notebook-assistant-eval:${stage}] ${message}`);
      }
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch.operations).toHaveLength(1);
    expect(result.preview.ok).toBe(true);
    expect(result.preview.summary).toEqual({ addedCells: 0, changedCells: 1, operationCount: 1, removedCells: 0 });
    expect(progressEvents.map((event) => event.stage)).toEqual([
      "start",
      "fixture",
      "snapshot",
      "response",
      "tools",
      "patch",
      "validation",
      "scoring",
      "artifacts"
    ]);
  });

  it("runs a chart-update fixture and keeps the patch on the bound chart", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-chart-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "chart-update-baseline-vars"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).not.toBeNull();
    expect(result.patch.operations.every((operation) => operation.path.includes("baseline-chart"))).toBe(true);
  });

  it("rejects chart-update requests that target another chart", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-chart-reject-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "chart-update-reject-other"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).toBeNull();
    expect(result.modeFiltered.blocked.map((request) => request.name)).toEqual(["createUpdateChartVariablesPatch"]);
  });

  it("runs an equation-update fixture for the bound variable only", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-eq-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "equation-update-cd"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).not.toBeNull();
    expect(result.patch.operations.every((operation) => operation.path.includes("equations-newton"))).toBe(true);
  });

  it("rejects equation-update requests for a different variable", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-eq-reject-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "equation-update-reject-other"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).toBeNull();
    expect(result.modeFiltered.blocked.map((request) => request.name)).toEqual(["createUpdateEquationPatch"]);
  });

  it("runs a chart-options fixture for the bound chart", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-chart-opts-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "chart-update-options"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).not.toBeNull();
    expect(result.patch.operations).toHaveLength(2);
    expect(result.patch.operations.every((operation) => operation.path.includes("baseline-chart"))).toBe(true);
  });

  it("runs an equation explain fixture without producing a patch", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "sfcr-notebook-assistant-eq-explain-"));
    const result = await runNotebookAssistantEval({
      artifactDir,
      fixtureId: "equation-explain-cd"
    });

    expect(result.summary.ok).toBe(true);
    expect(result.patch).toBeNull();
    expect(result.summary.tools.allowed.map((tool) => tool.name)).toEqual(["getEquation"]);
  });
});
