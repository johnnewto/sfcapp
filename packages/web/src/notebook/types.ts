import type { NotebookCell } from "@sfcr/notebook-core";

export * from "@sfcr/notebook-core";

export type NotebookCellInsertType = Extract<
	NotebookCell["type"],
	"chart" | "chart-grid" | "markdown" | "matrix" | "run" | "sankey" | "hydraulics" | "sequence" | "table"
>;
