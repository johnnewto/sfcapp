import { describe, expect, it } from "vitest";

import {
  buildSourceHelperActions,
  buildSourceHelpText,
  getNotebookHelpTopicIdForCell,
  parseCellSource,
  readCellSourceTitle,
  serializeCellBody,
  validateAbmModelCellSemantics,
  writeCellSourceTitle
} from "../src/notebook/sourceEditing";
import type { ChartCell, MatrixCell } from "../src/notebook/types";

function matrixCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    id: "matrix-1",
    type: "matrix",
    title: "Matrix",
    columns: ["A"],
    rows: [{ label: "Row", values: ["0"] }],
    ...overrides
  };
}

describe("sourceEditing matrix help", () => {
  it("routes matrix cells to accounting-kind help topics", () => {
    expect(
      getNotebookHelpTopicIdForCell(
        matrixCell({ accountingKind: "balance-sheet", title: "Generic" })
      )
    ).toBe("balance-sheet-matrix");
    expect(
      getNotebookHelpTopicIdForCell(
        matrixCell({ accountingKind: "transaction-flow", title: "Generic" })
      )
    ).toBe("transaction-flow-matrix");
    expect(
      getNotebookHelpTopicIdForCell(
        matrixCell({ accountingKind: "account-transactions", title: "Generic" })
      )
    ).toBe("account-transactions-matrix");
    expect(getNotebookHelpTopicIdForCell(matrixCell())).toBe("matrix");
  });

  it("routes abm-model cells to the ABM help topic", () => {
    expect(
      getNotebookHelpTopicIdForCell({
        id: "abm-1",
        type: "abm-model",
        title: "ABM",
        modelId: "abm-sim",
        populations: [],
        ticks: [],
        record: { series: ["Y"] }
      })
    ).toBe("abm-model");
  });

  it("accepts ABM source without recording overrides", () => {
    const cell = {
      id: "abm-1",
      type: "abm-model" as const,
      title: "ABM",
      modelId: "abm-sim",
      populations: [{ name: "households", size: 2, state: ["income"] }],
      ticks: [{ for: { households: [["income", "1"]] } }]
    };

    const next = parseCellSource(cell, serializeCellBody(cell));
    expect(next.type).toBe("abm-model");
    expect(next.record).toBeUndefined();
    expect(next.ticks).toEqual(cell.ticks);
  });

  it("documents Visual editing and optional recording overrides", () => {
    const help = buildSourceHelpText({
      id: "abm-1",
      type: "abm-model",
      title: "ABM",
      modelId: "abm-sim",
      populations: [],
      ticks: []
    });

    expect(help).toContain("Use Visual for normal editing");
    expect(help).toContain("When record is omitted");
    expect(help).not.toMatch(/Required fields:[\s\S]*- record/);
  });

  it("reports ABM semantic errors before apply", () => {
    const error = validateAbmModelCellSemantics({
      id: "abm-1",
      type: "abm-model",
      title: "ABM",
      modelId: "abm-sim",
      populations: [{ name: "households", size: 2, state: ["demand", "served"] }],
      ticks: [
        { do: [["Y", "1"]] },
        {
          "ration-fcfs": {
            population: "households",
            demand: "demand",
            supply: "Y",
            into: "served"
          }
        }
      ],
      record: { series: ["Y"] }
    });

    expect(error).toMatch(/shuffle/i);
  });

  it("documents accountingKind in matrix syntax help", () => {
    const help = buildSourceHelpText(matrixCell());
    expect(help).toContain("accountingKind");
    expect(help).toContain("account-transactions");
    expect(help).toContain("transaction-flow");
    expect(help).toContain("balance-sheet");
  });

  it("offers insert snippets for accounting kinds", () => {
    const labels = buildSourceHelperActions(matrixCell()).map((action) => action.label);
    expect(labels).toContain("Balance sheet kind");
    expect(labels).toContain("Transaction flow kind");
    expect(labels).toContain("Account transactions kind");

    const inserts = buildSourceHelperActions(matrixCell()).map((action) => action.insert);
    expect(inserts).toContain('"accountingKind": "balance-sheet"');
    expect(inserts).toContain('"accountingKind": "transaction-flow"');
    expect(inserts).toContain('"accountingKind": "account-transactions"');
  });
});

function chartCell(overrides: Partial<ChartCell> = {}): ChartCell {
  return {
    id: "chart-1",
    type: "chart",
    title: "Chart",
    sourceRunCellId: "run-1",
    variables: ["Y", "Cd"],
    ...overrides
  };
}

describe("sourceEditing chart axisGroups insert", () => {
  function axisGroupsInsert(cell: ChartCell, suggestion?: string[][]): string | undefined {
    return buildSourceHelperActions(cell, { chartAxisGroupSuggestion: suggestion }).find(
      (action) => action.label === "Axis groups"
    )?.insert;
  }

  it("uses the provided suggestion in the insert snippet", () => {
    expect(axisGroupsInsert(chartCell(), [["Y", "Cd", "Mh"], ["W"]])).toBe(
      '"axisGroups": [["Y", "Cd", "Mh"], ["W"]]'
    );
    expect(axisGroupsInsert(chartCell(), [["ydhs", "c"], ["p"]])).toBe(
      '"axisGroups": [["ydhs", "c"], ["p"]]'
    );
  });

  it("falls back to a generic example when no suggestion is given", () => {
    expect(axisGroupsInsert(chartCell())).toBe('"axisGroups": [["Y", "Cd", "Mh"], ["W"]]');
  });
});

describe("parseCellSource markdown more", () => {
  it("sets, updates, and clears the optional more field", () => {
    const cell = {
      id: "intro",
      type: "markdown" as const,
      title: "Overview",
      source: "Short body."
    };

    expect(parseCellSource(cell, "Short body.", "Overview", "Longer detail.").more).toBe(
      "Longer detail."
    );
    expect(
      parseCellSource(
        { ...cell, more: "Old detail." },
        "Short body.",
        "Overview",
        "Updated detail."
      ).more
    ).toBe("Updated detail.");
    expect(
      parseCellSource({ ...cell, more: "Old detail." }, "Short body.", "Overview", "   ").more
    ).toBeUndefined();
    expect(parseCellSource({ ...cell, more: "Keep me." }, "Short body.", "Overview").more).toBe(
      "Keep me."
    );
  });

  it("applies more for non-markdown cells and omits it from serialized source body", () => {
    const cell = {
      id: "baseline-run",
      type: "run" as const,
      title: "Baseline run",
      sourceModelId: "model",
      mode: "baseline" as const,
      resultKey: "baseline",
      periods: 10,
      more: "Existing more."
    };

    expect(serializeCellBody(cell)).not.toContain('"more"');
    expect(serializeCellBody(cell)).toContain('"title": "Baseline run"');

    const next = parseCellSource(cell, serializeCellBody(cell), undefined, "Run detail.");
    expect(next.type).toBe("run");
    expect(next.more).toBe("Run detail.");
    expect(parseCellSource(cell, serializeCellBody(cell), undefined, "  ").more).toBeUndefined();
  });

  it("overrides title from the title editor for non-markdown cells", () => {
    const cell = {
      id: "baseline-run",
      type: "run" as const,
      title: "Baseline run",
      sourceModelId: "model",
      mode: "baseline" as const,
      resultKey: "baseline",
      periods: 10
    };

    const next = parseCellSource(cell, serializeCellBody(cell), "Updated baseline run");
    expect(next.title).toBe("Updated baseline run");
    expect(() => parseCellSource(cell, serializeCellBody(cell), "   ")).toThrow(
      /title is required/i
    );
  });

  it("reads and writes title in the JSON source draft", () => {
    const source = serializeCellBody({
      id: "baseline-run",
      type: "run",
      title: "Baseline run",
      sourceModelId: "model",
      mode: "baseline",
      resultKey: "baseline",
      periods: 10
    });

    expect(readCellSourceTitle(source)).toBe("Baseline run");
    expect(readCellSourceTitle("{")).toBeNull();

    const rewritten = writeCellSourceTitle(source, "Updated baseline run");
    expect(rewritten).not.toBeNull();
    expect(readCellSourceTitle(rewritten!)).toBe("Updated baseline run");
    expect(writeCellSourceTitle("{", "Nope")).toBeNull();
  });
});
