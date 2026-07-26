import { describe, expect, it } from "vitest";

import {
  buildAbmVariableDescriptions,
  buildEditorStateFromAbmModelCell,
  findAbmModelCell
} from "../src/notebook/abmInspect";
import { buildVariableCatalogRows, listCatalogModelContexts } from "../src/lib/variableCatalog";
import { buildEditorStateForInspectorModelSource } from "../src/lib/variableInspect";
import { buildEditorStateForNotebookModel } from "../src/notebook/modelSections";
import { buildNotebookVariableDescriptions } from "../src/notebook/notebookAppHelpers";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("ABM variable inspect", () => {
  it("builds a synthetic editor from the ABM-SIM template", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const abmCell = findAbmModelCell(document.cells, "abm-sim");
    expect(abmCell).toBeTruthy();
    const editor = buildEditorStateFromAbmModelCell(abmCell!);
    expect(editor.equations.some((row) => row.name === "Y" && row.expression.includes("pr * N"))).toBe(
      true
    );
    expect(editor.equations.some((row) => row.name === "c_h1")).toBe(true);
    expect(editor.equations.some((row) => row.name === "c_hLast")).toBe(true);
    expect(editor.externals.some((row) => row.name === "theta")).toBe(true);
    expect(editor.externals.some((row) => row.name === "alpha1")).toBe(true);
    expect(editor.externals.find((row) => row.name === "alpha1")?.valueText).toMatch(/uniform/i);
    expect(editor.externals.find((row) => row.name === "alpha1")?.desc).toMatch(
      /propensity to consume out of income/i
    );
    expect(editor.equations.find((row) => row.name === "Y")?.desc).toMatch(/Output/i);
  });

  it("resolves ABM models through buildEditorStateForNotebookModel", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const editor = buildEditorStateForNotebookModel(document, {
      sourceModelId: "abm-sim",
      periods: 100
    });
    expect(editor).toBeTruthy();
    expect(editor?.equations.some((row) => row.name === "H_d")).toBe(true);

    const viaInspect = buildEditorStateForInspectorModelSource(document, {
      sourceModelId: "abm-sim"
    });
    expect(viaInspect?.equations.some((row) => row.name === "UR")).toBe(true);
  });

  it("lists ABM-SIM in the variable catalog", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const contexts = listCatalogModelContexts(document);
    expect(contexts.some((context) => context.modelId === "abm-sim")).toBe(true);

    const rows = buildVariableCatalogRows({ document });
    expect(rows.some((row) => row.name === "Y" && row.modelId === "abm-sim")).toBe(true);
    expect(rows.some((row) => row.name === "c_h1" && row.modelId === "abm-sim")).toBe(true);
    expect(rows.some((row) => row.name === "theta" && row.endogenousExogenous === "exogenous")).toBe(
      true
    );
    expect(rows.find((row) => row.name === "Y")?.description).toMatch(/Output/i);
  });

  it("includes ABM descriptions in notebook-wide variable descriptions", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const descriptions = buildNotebookVariableDescriptions(document.cells);
    expect(descriptions.get("Y")).toMatch(/Output/i);
    expect(descriptions.get("c")).toMatch(/micro/i);
    expect(buildAbmVariableDescriptions(findAbmModelCell(document.cells, "abm-sim")!).get("N")).toMatch(
      /Job lottery|Employment|hired/i
    );
  });
});
