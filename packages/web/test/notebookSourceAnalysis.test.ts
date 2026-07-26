import { describe, expect, it } from "vitest";

import { validateNotebookDocument } from "@sfcr/notebook-core";

import {
  analyzeNotebookSource,
  detectNotebookSourceFormat,
  notebookFromMarkdown,
  notebookFromYaml,
  notebookToCompactYaml,
  notebookToMarkdown,
  parseNotebookSource
} from "../src/notebook/document";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

describe("analyzeNotebookSource", () => {
  it("detects and parses JSON, Markdown, and YAML notebook source", () => {
    const jsonSource = JSON.stringify({
      id: "example",
      title: "Example",
      metadata: { version: 1 },
      cells: [{ id: "intro", type: "markdown", title: "Intro", source: "Hi" }]
    });
    const markdownSource = [
      "# Example",
      "",
      "## Intro",
      "",
      "Hi"
    ].join("\n");
    const yamlSource = [
      "format: sfcr-notebook-yaml",
      "formatVersion: 1",
      "id: example",
      "title: Example",
      "metadata:",
      "  version: 1",
      "cells:",
      "  - id: intro",
      "    type: markdown",
      "    title: Intro",
      "    source: Hi"
    ].join("\n");

    expect(detectNotebookSourceFormat(jsonSource)).toBe("json");
    expect(detectNotebookSourceFormat(markdownSource)).toBe("markdown");
    expect(detectNotebookSourceFormat(yamlSource)).toBe("yaml");
    expect(
      detectNotebookSourceFormat(
        ["# leading comment", "format: sfcr-notebook-yaml", "formatVersion: 1", "id: example", "title: Example", "cells: []"].join(
          "\n"
        )
      )
    ).toBe("yaml");
    expect(() => detectNotebookSourceFormat("title = 'Example'")).toThrow(/Expected JSON, Markdown, or YAML/);
    expect(parseNotebookSource(jsonSource).document.title).toBe("Example");
    expect(parseNotebookSource(markdownSource).document.cells[0]?.type).toBe("markdown");
    expect(parseNotebookSource(yamlSource).document.cells[0]?.type).toBe("markdown");
  });

  it("round-trips Markdown through the shared notebook source pipeline", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "example",
        title: "Example",
        metadata: { version: 1 },
        cells: [{ id: "intro", type: "markdown", title: "Intro", source: "Hi" }]
      }),
      "json"
    ).document;

    const markdown = notebookToMarkdown(document);
    const parsed = notebookFromMarkdown(markdown);

    expect(parsed.title).toBe("Example");
    expect(parsed.cells).toHaveLength(1);
    expect(parsed.cells[0]).toMatchObject({ type: "markdown", title: "Intro" });
  });

  it("round-trips compact YAML through the shared notebook source pipeline", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "example",
        title: "Example",
        metadata: { version: 1 },
        cells: [
          { id: "intro", type: "markdown", title: "Intro", source: "Hi" },
          {
            id: "equations",
            type: "equations",
            title: "Equations",
            modelId: "main",
            equations: [{ id: "eq-0-Y", name: "Y", expression: "G" }]
          }
        ]
      }),
      "json"
    ).document;

    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    const parsed = notebookFromYaml(yaml);

    expect(yaml).toContain("format: sfcr-notebook-yaml");
    expect(yaml).toContain("equations:");
    expect(yaml).toContain("- [Y, G]");
    expect(parsed.title).toBe("Example");
    expect(parsed.cells.some((cell) => cell.type === "equations" && cell.title === "Equations")).toBe(true);
  });

  it("keeps observed series rows compact in YAML source", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "example",
        title: "Example",
        metadata: { version: 1 },
        cells: [
          {
            id: "observed",
            type: "observed",
            title: "Observed history",
            modelId: "main",
            externals: [
              {
                id: "ext-0-oph",
                name: "oph",
                desc: "Other payments or receipts of households",
                kind: "series",
                valueText: "1, 2, 3",
                observed: true
              }
            ]
          }
        ]
      }),
      "json"
    ).document;

    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    const parsed = notebookFromYaml(yaml);

    expect(yaml).toContain("- {name: oph, kind: series, observed: true");
    expect(yaml).toContain('valueText: "1, 2, 3"}');
    expect(yaml).not.toContain("id: ext-0-oph");
    expect(parsed.cells[0]).toMatchObject({
      type: "observed",
      externals: [{ id: "ext-0-oph", name: "oph", kind: "series", observed: true, valueText: "1, 2, 3" }]
    });
  });

  it("keeps chart-grid charts compact in YAML source", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "example",
        title: "Example",
        metadata: { version: 1 },
        cells: [
          {
            id: "chart-grid-1",
            type: "chart-grid",
            title: "Charts",
            gridColumns: 2,
            charts: [
              {
                id: "chart-1",
                type: "chart",
                title: "GDP",
                sourceRunCellId: "baseline-run",
                variables: ["y"],
                referenceTrace: "observed",
                axisMode: "shared"
              },
              {
                id: "chart-2",
                type: "chart",
                title: "Yield",
                sourceRunCellId: "baseline-run",
                series: [{ expression: "100 * rb", label: "Yield", unit: "%" }],
                referenceTrace: "observed",
                axisMode: "shared"
              }
            ]
          }
        ]
      }),
      "json"
    ).document;

    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    const parsed = notebookFromYaml(yaml);

    expect(yaml).toContain("  - chart-grid:");
    expect(yaml).toContain('- {type: chart, id: chart-1, title: GDP, variables: [y], axisMode: shared, referenceTrace: observed, sourceRunCellId: baseline-run}');
    expect(yaml).toContain('- {type: chart, id: chart-2, title: Yield, series: [{expression: 100 * rb, label: Yield, unit: "%"}], axisMode: shared, referenceTrace: observed, sourceRunCellId: baseline-run}');
    expect(parsed.cells[0]).toMatchObject({
      type: "chart-grid",
      charts: [
        { id: "chart-1", type: "chart", sourceRunCellId: "baseline-run", variables: ["y"] },
        { id: "chart-2", type: "chart", sourceRunCellId: "baseline-run" }
      ]
    });
  });

  it("round-trips abm-model cells through compact YAML", () => {
    const yamlSource = `format: sfcr-notebook-yaml
formatVersion: 1
id: abm-roundtrip
title: ABM roundtrip
metadata:
  version: 1
cells:
  - abm-model:
      id: abm-sim-model
      title: Spec
      modelId: abm-sim
      populations:
        - name: households
          size: 10
          state: [h, cd]
          params:
            alpha1: { draw: uniform, lo: 0.2, hi: 1.0 }
      params: { alpha2: 0.4, theta: 0.2 }
      ticks:
        - do:
            - [G, "20"]
        - for:
            households:
              - [cd, "alpha1 * lag(h)"]
        - do:
            - [H_d, "sum(households.h)"]
      record:
        series: [G, H_d]
  - run:
      id: baseline-run
      title: Baseline
      mode: baseline
      engine: abm
      sourceModelId: abm-sim
      periods: 5
      resultKey: abm_baseline
      abm: { monteCarlo: 2, households: 10 }
`;
    const document = parseNotebookSource(yamlSource, "yaml").document;
    expect(document.cells[0]).toMatchObject({
      type: "abm-model",
      modelId: "abm-sim"
    });
    expect(document.cells[1]).toMatchObject({
      type: "run",
      engine: "abm",
      sourceModelId: "abm-sim"
    });

    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    const parsed = notebookFromYaml(yaml);
    expect(yaml).toContain("  - abm-model:");
    expect(yaml).toMatch(/- do:/);
    expect(yaml).toMatch(/for:/);
    expect(yaml).toMatch(/households:/);
    expect(yaml).toMatch(/state: \[h, cd\]/);
    expect(yaml).toMatch(/- \[G, "20"\]/);
    expect(yaml).toMatch(/- \[cd, "alpha1 \* lag\(h\)"\]/);
    expect(yaml).toMatch(/series: \[G, H_d\]/);
    expect(yaml).not.toMatch(/^\s+- - G$/m);
    expect(parsed.cells[0]).toMatchObject({
      type: "abm-model",
      modelId: "abm-sim"
    });
    expect(validateNotebookDocument(parsed)).toEqual([]);
  });

  it("lifts legacy nested abm-model spec onto the cell", () => {
    const yamlSource = `format: sfcr-notebook-yaml
formatVersion: 1
id: abm-legacy
title: ABM legacy
metadata:
  version: 1
cells:
  - abm-model:
      id: abm-sim-model
      title: Spec
      modelId: abm-sim
      spec:
        modelId: abm-sim
        populations:
          - name: households
            size: 5
            state: [h]
        ticks:
          - aggregate:
              - [G, "20"]
        record:
          series: [G]
`;
    const document = parseNotebookSource(yamlSource, "yaml").document;
    const cell = document.cells[0] as Extract<(typeof document.cells)[number], { type: "abm-model" }>;
    expect(cell.type).toBe("abm-model");
    expect(cell.modelId).toBe("abm-sim");
    expect(cell.populations).toEqual([{ name: "households", size: 5, state: ["h"] }]);
    expect(cell.ticks).toBeDefined();
    expect(cell.record).toEqual({ series: ["G"] });
    expect((cell as { spec?: unknown }).spec).toBeUndefined();
    expect(validateNotebookDocument(document)).toEqual([]);
  });

  it("keeps abm-sim template equations as flow-style YAML rows", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    expect(yaml).toMatch(
      /- \[G, "if \(t >= shockPeriod\) \{ g1 \} else \{ g0 \}", "Government spending \(shock from period 60\)"\]/
    );
    expect(yaml).toMatch(
      /- \[cd, "min\(alpha1 \* lag\(yd\) \+ alpha2 \* lag\(h\), lag\(h\)\)", "Planned consumption \(own alpha1\)"\]/
    );
    expect(yaml).toMatch(/- \[Y, "pr \* N", "Output \/ income \(MC mean\)"\]/);
    expect(yaml).toMatch(/- do:/);
    expect(yaml).toMatch(/for:/);
    expect(yaml).toMatch(/state: \[h, yd, cd, c, y, e\]/);
    // series/micro allowlists omitted — defaults apply at runtime; descriptions may remain
    expect(yaml).not.toMatch(/agents:/);
    expect(yaml).not.toMatch(/variables: \[c, h, e\]/);
    expect(yaml).not.toMatch(/^\s+- - G$/m);
    expect(yaml).not.toMatch(/^\s+- - cd$/m);
  });

  it("keeps run exogenize arrays compact in YAML source", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "example",
        title: "Example",
        metadata: { version: 1 },
        cells: [
          {
            id: "baseline-run",
            type: "run",
            title: "Baseline run",
            mode: "baseline",
            periods: 25,
            simType: "STATIC",
            exogenize: ["oph", "opf", "opb", "opcb", "oacb", "oaf", "oab", "oag", "oah", "rstar", "Lp_row", "Lp_en"],
            resultKey: "baseline",
            sourceModelId: "main"
          }
        ]
      }),
      "json"
    ).document;

    const yaml = notebookToCompactYaml(document, { preserveIds: true });
    const parsed = notebookFromYaml(yaml);

    expect(yaml).toContain("exogenize: [oph, opf, opb, opcb, oacb, oaf, oab, oag, oah, rstar, Lp_row, Lp_en]");
    expect(parsed.cells[0]).toMatchObject({
      type: "run",
      exogenize: ["oph", "opf", "opb", "opcb", "oacb", "oaf", "oab", "oag", "oah", "rstar", "Lp_row", "Lp_en"]
    });
  });

  it("preserves typed compact YAML wrappers when canonical cell ids match cell types", () => {
    const document = parseNotebookSource(
      JSON.stringify({
        id: "sim-notebook",
        title: "SIM",
        metadata: { version: 1, template: "sim" },
        cells: [
          {
            id: "equations",
            type: "equations",
            title: "SIM equations",
            modelId: "sim",
            equations: [{ id: "eq-0-y", name: "Y", expression: "G" }]
          },
          {
            id: "solver",
            type: "solver",
            title: "Solver options",
            modelId: "sim",
            options: {
              solverMethod: "BROYDEN",
              toleranceText: "1e-8",
              maxIterations: 100,
              defaultInitialValueText: "1e-15",
              hiddenLeftVariable: "",
              hiddenRightVariable: "",
              hiddenToleranceText: "1e-5",
              relativeHiddenTolerance: false
            }
          },
          {
            id: "externals",
            type: "externals",
            title: "Externals",
            modelId: "sim",
            externals: [{ id: "ext-0-g", name: "G", kind: "constant", valueText: "20" }]
          }
        ]
      }),
      "json"
    ).document;

    const yaml = notebookToCompactYaml(document);

    expect(yaml).toContain("  - equations:");
    expect(yaml).toContain("  - solver:");
    expect(yaml).toContain("  - externals:");
    expect(yaml).not.toMatch(/  - markdown:\n      id: equations-/);
  });

  it("parses expanded YAML for backwards compatibility", () => {
    const yaml = [
      "format: sfcr-notebook-yaml",
      "formatVersion: 1",
      "id: example",
      "title: Example",
      "metadata:",
      "  version: 1",
      "cells:",
      "  - id: intro",
      "    type: markdown",
      "    title: Intro",
      "    source: Hi"
    ].join("\n");

    const parsed = notebookFromYaml(yaml);

    expect(parsed.title).toBe("Example");
    expect(parsed.cells[0]).toMatchObject({ type: "markdown", title: "Intro" });
  });

  it("requires the canonical YAML format header", () => {
    const source = [
      "id: example",
      "title: Example",
      "metadata:",
      "  version: 1",
      "cells: []"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "yaml");

    expect(analysis.document).toBeNull();
    expect(analysis.parseDiagnostics[0]?.message).toContain("format: sfcr-notebook-yaml");
  });

  it("compiles compact domain-first YAML into expanded notebook cells", () => {
    const source = [
      "format: sfcr-notebook-yaml",
      "formatVersion: 1",
      "id: bmw-notebook",
      "title: BMW Model YAML Source",
      "metadata:",
      "  version: 1",
      "  template: bmw",
      "  description: >",
      "    Closed economy BMW model showing interactions between households, firms, and banks.",
      "sectors: [Households, Firms, Banks, Sum]",
      "variables:",
      "  Y:",
      "    description: Income/output",
      "    unit: \"$/year\"",
      "    type: flow",
      "  C:",
      "    description: Consumption",
      "    unit: \"$/year\"",
      "    type: flow",
      "  V:",
      "    description: Household wealth",
      "    unit: \"$\"",
      "    type: stock",
      "equations: |",
      "  Y ~ C + G",
      "  C ~ alpha1 * Y + alpha2 * V[-1]",
      "  V ~ V[-1] + (Y - C)",
      "balance:",
      "  columns: [Households, Firms, Banks, Sum]",
      "  rows:",
      "    - [Deposits, Money deposits, +V, \"\", -V, 0]",
      "parameters:",
      "  alpha1: 0.6",
      "  alpha2: 0.4",
      "  G: 20",
      "initial-values:",
      "  Y: 100",
      "  V: 80",
      "solver:",
      "  method: newton",
      "  periods: 50",
      "  tolerance: 1e-6",
      "charts:",
      "  - id: income-consumption",
      "    title: Income vs Consumption",
      "    variables: [Y, C]",
      "tables:",
      "  - id: summary",
      "    variables: [Y, C, V]",
      "notes: |",
      "  This YAML format is designed for human readability."
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "yaml");

    expect(analysis.parseDiagnostics).toEqual([]);
    expect(analysis.schemaDiagnostics).toEqual([]);
    expect(analysis.document?.cells.map((cell) => cell.type)).toEqual([
      "markdown",
      "matrix",
      "equations",
      "externals",
      "initial-values",
      "solver",
      "run",
      "chart",
      "table",
      "markdown"
    ]);
    const equationsCell = analysis.document?.cells.find((cell) => cell.type === "equations");
    expect(equationsCell?.type).toBe("equations");
    if (!equationsCell || equationsCell.type !== "equations") {
      throw new Error("Expected equations cell.");
    }
    expect(equationsCell.equations[1]).toMatchObject({
      name: "C",
      expression: "alpha1 * Y + alpha2 * V[-1]",
      unitMeta: { signature: { money: 1, time: -1 }, stockFlow: "flow" }
    });
  });

  it("rejects YAML anchors and aliases", () => {
    const source = [
      "format: sfcr-notebook-yaml",
      "formatVersion: 1",
      "id: example",
      "title: Example",
      "metadata: &metadata",
      "  version: 1",
      "cells: []"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "yaml");

    expect(analysis.document).toBeNull();
    expect(analysis.parseDiagnostics[0]?.message).toContain("anchors");
  });

  it("anchors misspelled required YAML properties to the typo instead of the root object", () => {
    const source = [
      "format: sfcr-notebook-yaml",
      "formatVersion: 1",
      "id: example",
      "titleq: Example",
      "metadata:",
      "  version: 1",
      "cells: []"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "yaml");

    expect(analysis.document).toBeNull();
    expect(analysis.schemaDiagnostics.length).toBeGreaterThan(0);
    expect(analysis.schemaDiagnostics[0]?.line).toBe(4);
  });

  it("anchors misspelled required JSON properties to the typo instead of the root object", () => {
    const source = [
      "{",
      '  "id": "opensimplest-levy-notebook",',
      '  "titleq": "OPENSIMPLEST Levy WP 1105 Aligned Model",',
      '  "metadata": { "version": 1, "template": "opensimplest-levy" },',
      '  "cells": []',
      "}"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "json");

    expect(analysis.document).toBeNull();
    expect(analysis.schemaDiagnostics.length).toBeGreaterThan(0);
    expect(analysis.schemaDiagnostics[0]?.offset).toBeGreaterThan(1);
    expect(analysis.schemaDiagnostics[0]?.line).toBe(3);
  });

  it("keeps cell schema diagnostics local to the declared cell type", () => {
    const source = [
      "{",
      '  "id": "example",',
      '  "title": "Example",',
      '  "metadata": { "version": 1 },',
      '  "cells": [',
      '    { "id": "intro", "type": "markdown", "title": "Intro", "source": "Hi" },',
      '    { "ids": "matrix", "type": "matrix", "title": "Matrix", "sourceRunCellId": "run", "columns": [], "rows": [] }',
      "  ]",
      "}"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "json");
    const messages = analysis.schemaDiagnostics.map((diagnostic) => diagnostic.message);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("missing required property 'id'");
    expect(messages[1]).toContain("unexpected property 'ids'");
    expect(messages.join("\n")).not.toContain("missing required property 'source'");
    expect(messages.join("\n")).not.toContain("unexpected property 'sourceRunCellId'");
    expect(messages.join("\n")).not.toContain("unexpected property 'columns'");
  });

  it("rejects capitalized Band on matrix rows", () => {
    const source = [
      "{",
      '  "id": "example",',
      '  "title": "Example",',
      '  "metadata": { "version": 1 },',
      '  "cells": [',
      '    { "id": "matrix", "type": "matrix", "title": "Matrix", "columns": ["Households"], "rows": [',
      '      { "Band": "Assets", "label": "Money", "values": ["+H"] }',
      "    ] }",
      "  ]",
      "}"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "json");
    const messages = analysis.schemaDiagnostics.map((diagnostic) => diagnostic.message);

    expect(analysis.document).toBeNull();
    expect(messages).toContainEqual(expect.stringContaining("unexpected property 'Band'"));
  });

  it("accepts unit aliases in notebook JSON and normalizes them", () => {
    const source = [
      "{",
      '  "id": "example",',
      '  "title": "Example",',
      '  "metadata": { "version": 1 },',
      '  "cells": [',
      '    {',
      '      "id": "equations",',
      '      "type": "equations",',
      '      "title": "Equations",',
      '      "modelId": "main",',
      '      "equations": [',
      '        {',
      '          "id": "eq-0-Y",',
      '          "name": "Y",',
      '          "expression": "G",',
      '          "unitMeta": {',
      '            "stockFlow": "flow",',
      '            "units": { "$": 1, "yr": -1 }',
      "          }",
      "        }",
      "      ]",
      "    },",
      '    {',
      '      "id": "externals",',
      '      "type": "externals",',
      '      "title": "Externals",',
      '      "modelId": "main",',
      '      "externals": [',
      '        { "id": "ext-0-G", "name": "G", "kind": "constant", "valueText": "20", "unitMeta": { "units": { "$": 1, "yr": -1 } } }',
      "      ]",
      "    }",
      "  ]",
      "}"
    ].join("\n");

    const analysis = analyzeNotebookSource(source, "json");

    expect(analysis.schemaDiagnostics).toHaveLength(0);
    expect(analysis.document).not.toBeNull();
    const equationsCell = analysis.document?.cells.find((cell) => cell.type === "equations");
    expect(equationsCell?.type).toBe("equations");
    if (!equationsCell || equationsCell.type !== "equations") {
      throw new Error("Expected equations cell.");
    }
    expect(equationsCell.equations[0]?.unitMeta).toEqual({
      signature: { money: 1, time: -1 },
      stockFlow: "flow"
    });
  });

});
