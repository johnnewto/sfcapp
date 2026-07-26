import { describe, expect, it } from "vitest";

import {
  graftYamlComments,
  notebookToCompactYaml,
  notebookToJson,
  parseNotebookSource,
  stampYamlSourceFileName
} from "../src/notebook/document";
import type { NotebookDocument } from "../src/notebook/types";
import {
  createNotebookFromTemplate,
  getNotebookTemplateYamlSource
} from "../src/notebook/templates";
import { withNotebookSourceFileName } from "../src/notebook/notebookSourceWorkflow";

const BASE_YAML = `# header comment for the notebook
format: sfcr-notebook-yaml
formatVersion: 1
id: graft-demo
title: Graft Demo
metadata:
  version: 1
cells:
  # intro cell comment
  - markdown:
      id: intro
      title: Overview
      source: Hello
  # equations cell comment
  - equations:
      id: equations
      title: Equations
      modelId: graft
      rows:
        # tax identity
        - [TXs, TXd, "Taxes", $, flow, identity]
        - [YD, "W * Ns - TXs", "Disposable income", $/year, flow, definition]
  - run:
      id: baseline-run
      title: Baseline
      mode: baseline
      periods: 10
      resultKey: graft_baseline
      sourceModelId: graft
`;

function parseYaml(source: string): NotebookDocument {
  return parseNotebookSource(source, "yaml").document;
}

function serialize(document: NotebookDocument): string {
  return notebookToCompactYaml(document, { preserveIds: true });
}

describe("graftYamlComments", () => {
  it("preserves comments when an unrelated cell is edited", () => {
    const document = parseYaml(BASE_YAML);
    const edited: NotebookDocument = {
      ...document,
      cells: document.cells.map((cell) =>
        cell.id === "intro" && cell.type === "markdown"
          ? { ...cell, source: "Hello, edited." }
          : cell
      )
    };

    const grafted = graftYamlComments(BASE_YAML, serialize(edited));
    expect(grafted.source).toContain("# header comment for the notebook");
    expect(grafted.source).toContain("# intro cell comment");
    expect(grafted.source).toContain("# equations cell comment");
    expect(grafted.source).toContain("# tax identity");
    expect(grafted.source).toMatch(/source:\s*Hello, edited\./);

    const verified = parseYaml(grafted.source);
    expect(serialize(verified)).toBe(serialize(edited));
    expect(grafted.droppedCount).toBe(0);
  });

  it("preserves comments across a cell reorder", () => {
    const document = parseYaml(BASE_YAML);
    const reordered: NotebookDocument = {
      ...document,
      cells: [document.cells[1]!, document.cells[0]!, document.cells[2]!]
    };

    const grafted = graftYamlComments(BASE_YAML, serialize(reordered));
    expect(grafted.source).toContain("# intro cell comment");
    expect(grafted.source).toContain("# equations cell comment");
    expect(grafted.source).toContain("# tax identity");

    const verified = parseYaml(grafted.source);
    expect(verified.cells.map((cell) => cell.id)).toEqual(["equations", "intro", "baseline-run"]);
    expect(serialize(verified)).toBe(serialize(reordered));
  });

  it("drops and counts comments for a deleted cell", () => {
    const document = parseYaml(BASE_YAML);
    const withoutIntro: NotebookDocument = {
      ...document,
      cells: document.cells.filter((cell) => cell.id !== "intro")
    };

    const grafted = graftYamlComments(BASE_YAML, serialize(withoutIntro));
    expect(grafted.source).not.toContain("# intro cell comment");
    expect(grafted.source).toContain("# equations cell comment");
    expect(grafted.droppedCount).toBeGreaterThan(0);

    const verified = parseYaml(grafted.source);
    expect(serialize(verified)).toBe(serialize(withoutIntro));
  });

  it("keeps document identity after grafting", () => {
    const document = parseYaml(BASE_YAML);
    const grafted = graftYamlComments(BASE_YAML, serialize(document));
    const verified = parseYaml(grafted.source);
    expect(serialize(verified)).toBe(serialize(document));
  });

  it("keeps SIM template header comments after serialize + graft", () => {
    const raw = getNotebookTemplateYamlSource("sim");
    const doc = createNotebookFromTemplate("sim");
    const grafted = graftYamlComments(raw, serialize(doc));
    expect(grafted.source.trimStart().startsWith("#")).toBe(true);
    expect(notebookToJson(parseYaml(grafted.source))).toBe(notebookToJson(doc));
  });

  it("keeps comments when grafting onto a save payload with sourceFileName", () => {
    const document = parseYaml(BASE_YAML);
    const forSave = withNotebookSourceFileName(document, "graft-demo (1).notebook.yaml");
    const grafted = graftYamlComments(BASE_YAML, serialize(forSave));
    expect(grafted.source).toContain("# header comment for the notebook");
    expect(grafted.source).toContain("# intro cell comment");
    expect(grafted.source).toMatch(/sourceFileName:\s*graft-demo \(1\)\.notebook\.yaml/);
    expect(notebookToJson(parseYaml(grafted.source))).toBe(notebookToJson(forSave));
  });

  it("stamps sourceFileName onto editor YAML without dropping comments", () => {
    const stamped = stampYamlSourceFileName(BASE_YAML, "from-editor.notebook.yaml");
    expect(stamped).toContain("# header comment for the notebook");
    expect(stamped).toContain("# intro cell comment");
    expect(stamped).toContain("# tax identity");
    expect(stamped).toMatch(/sourceFileName:\s*from-editor\.notebook\.yaml/);
    expect(parseYaml(stamped).metadata.sourceFileName).toBe("from-editor.notebook.yaml");
  });
});
