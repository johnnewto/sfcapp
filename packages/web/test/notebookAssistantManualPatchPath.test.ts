// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createNotebookFromTemplate } from "../src/notebook/templates";
import { previewNotebookPatch } from "../src/notebook/notebookPatch";

describe("assistant manual patch paths", () => {
  it("accepts by-id periods update on baseline-newton", () => {
    const document = createNotebookFromTemplate("bmw");
    const result = previewNotebookPatch(document, {
      operations: [{ op: "replace", path: "/cells/by-id/baseline-newton/periods", value: 40 }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const run = result.document.cells.find((cell) => cell.id === "baseline-newton");
      expect(run && run.type === "run" ? run.periods : null).toBe(40);
    }
  });

  it("rejects the stale /cells/8/periods path used by the old scrubber test", () => {
    const document = createNotebookFromTemplate("bmw");
    const result = previewNotebookPatch(document, {
      operations: [{ op: "replace", path: "/cells/8/periods", value: 40 }]
    });
    expect(result.ok).toBe(false);
  });
});
