import { describe, expect, it } from "vitest";

import { parseNotebookSource } from "../src/notebook/document";
import { getNotebookTemplateDocument } from "../src/notebook/templates";
import { buildEditorStateFromAbmModelCell, findAbmModelCell } from "../src/notebook/abmInspect";
import { buildVariableCatalogRows } from "../src/lib/variableCatalog";

describe("ABM YAML inline comment descriptions", () => {
  it("harvests trailing param comments into record.descriptions", () => {
    const source = `format: sfcr-notebook-yaml
formatVersion: 1
id: comment-params
title: Comment Params
metadata:
  version: 1
cells:
  - abm-model:
      id: model
      title: Model
      modelId: demo
      populations:
        - name: households
          size: 3
          state: [h]
          params:
            # Drawn once per household
            alpha1: { draw: uniform, lo: 0.2, hi: 1.0 } # Propensity to consume out of income
      params:
        alpha2: 0.4 # Propensity to consume out of wealth
        theta: 0.2 # Average tax rate on income
      ticks:
        - do:
            - [H_d, "sum(households.h)"] # Total household money
      record:
        series: [H_d]
  - run:
      id: baseline-run
      title: Baseline
      mode: baseline
      engine: abm
      sourceModelId: demo
      periods: 5
      resultKey: baseline
`;

    const document = parseNotebookSource(source, "yaml").document;
    const cell = findAbmModelCell(document.cells, "demo");
    expect(cell).toBeTruthy();
    const descriptions = (cell!.record as { descriptions?: Record<string, string> }).descriptions;
    expect(descriptions?.alpha2).toBe("Propensity to consume out of wealth");
    expect(descriptions?.theta).toBe("Average tax rate on income");
    expect(descriptions?.alpha1).toBe("Propensity to consume out of income");
    expect(descriptions?.H_d).toBe("Total household money");

    const ticks = cell!.ticks as Array<{ do?: unknown[] }>;
    expect(ticks[0]?.do?.[0]).toEqual(["H_d", "sum(households.h)", "Total household money"]);

    const editor = buildEditorStateFromAbmModelCell(cell!);
    expect(editor.externals.find((row) => row.name === "alpha2")?.desc).toBe(
      "Propensity to consume out of wealth"
    );
  });

  it("does not overwrite explicit equation descriptions with trailing comments", () => {
    const source = `format: sfcr-notebook-yaml
formatVersion: 1
id: comment-keep
title: Keep
metadata:
  version: 1
cells:
  - abm-model:
      id: model
      title: Model
      modelId: demo
      populations:
        - name: households
          size: 2
          state: [h]
      params:
        alpha2: 0.4
      ticks:
        - do:
            - [Y, "1", "Explicit desc"] # trailing ignored for third slot
      record:
        series: [Y]
        descriptions:
          alpha2: Explicit param desc
  - run:
      id: baseline-run
      title: Baseline
      mode: baseline
      engine: abm
      sourceModelId: demo
      periods: 2
      resultKey: baseline
`;

    const document = parseNotebookSource(source, "yaml").document;
    const cell = findAbmModelCell(document.cells, "demo");
    const ticks = cell!.ticks as Array<{ do?: unknown[] }>;
    expect(ticks[0]?.do?.[0]).toEqual(["Y", "1", "Explicit desc"]);
    expect((cell!.record as { descriptions?: Record<string, string> }).descriptions?.alpha2).toBe(
      "Explicit param desc"
    );
  });

  it("exposes ABM-SIM param comment descriptions in the catalog", () => {
    const document = getNotebookTemplateDocument("abm-sim");
    const abm = findAbmModelCell(document.cells, "abm-sim");
    expect(abm).toBeTruthy();
    const descriptions = (abm!.record as { descriptions?: Record<string, string> }).descriptions;
    expect(descriptions?.alpha1).toMatch(/propensity to consume out of income/i);
    expect(descriptions?.alpha2).toMatch(/wealth/i);

    const rows = buildVariableCatalogRows({ document });
    expect(rows.find((row) => row.name === "theta")?.description).toMatch(/tax rate/i);
    expect(rows.find((row) => row.name === "alpha2")?.description).toMatch(/wealth/i);
    expect(rows.find((row) => row.name === "shockPeriod")?.description).toMatch(/period 60/i);
  });
});
