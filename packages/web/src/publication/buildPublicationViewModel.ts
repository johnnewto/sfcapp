import { resolveContentsOutlineLevel } from "../notebook/contentsOutline";
import type { NotebookCell, NotebookDocument } from "../notebook/types";
import type { NotebookTemplateId } from "../notebook/templates";
import type { PublicationRenderMode } from "./publicationRouteHelpers";

type PublicationSectionKind =
  | "prose"
  | "equations"
  | "abm-model"
  | "matrix"
  | "chart"
  | "table"
  | "sequence"
  | "sankey"
  | "run"
  | "appendix";

/** Anchor id for the publication Appendix heading (contents + in-page scroll). */
export const PUBLICATION_APPENDIX_ANCHOR_ID = "appendix";

export interface PublicationSection {
  kind: PublicationSectionKind;
  cell: NotebookCell;
  anchorId: string;
}

export interface PublicationViewModel {
  title: string;
  templateId: NotebookTemplateId;
  mode: PublicationRenderMode;
  embedCellId: string | null;
  bodySections: PublicationSection[];
  appendixSections: PublicationSection[];
}

export interface PublicationContentsEntry {
  anchorId: string;
  title: string;
  /** 0 = markdown section; 1 = nested under the preceding markdown. */
  level: 0 | 1;
}

export function buildPublicationContentsEntries(
  bodySections: PublicationSection[],
  appendixSections: PublicationSection[] = []
): PublicationContentsEntry[] {
  const entries = bodySections
    .map((section) => ({
      anchorId: section.anchorId,
      title: section.cell.title.trim(),
      level: resolveContentsOutlineLevel(section.cell)
    }))
    .filter((entry) => entry.title.length > 0);

  const appendixEntries = appendixSections
    .map((section) => ({
      anchorId: section.anchorId,
      title: section.cell.title.trim(),
      level: 1 as const
    }))
    .filter((entry) => entry.title.length > 0);

  if (appendixEntries.length === 0) {
    return entries;
  }

  return [
    ...entries,
    { anchorId: PUBLICATION_APPENDIX_ANCHOR_ID, title: "Appendix", level: 0 },
    ...appendixEntries
  ];
}

function classifyCellPlacement(cell: NotebookCell): "body" | "appendix" | "skip" {
  switch (cell.type) {
    case "markdown":
    case "equations":
    case "model":
    case "abm-model":
    case "matrix":
    case "chart":
    case "chart-grid":
    case "table":
    case "run":
      return "body";
    case "externals":
    case "observed":
    case "initial-values":
    case "solver":
      return "appendix";
    case "sequence":
      // Only matrix-sourced sequences render as multiport transaction-flow figures.
      return cell.source.kind === "matrix" ? "body" : "skip";
    case "sankey":
      return cell.source.kind === "matrix" ? "body" : "skip";
    default:
      return "skip";
  }
}

function resolveSectionKind(cell: NotebookCell): PublicationSectionKind {
  switch (cell.type) {
    case "markdown":
      return "prose";
    case "equations":
    case "model":
      return "equations";
    case "abm-model":
      return "abm-model";
    case "matrix":
      return "matrix";
    case "chart":
    case "chart-grid":
      return "chart";
    case "table":
      return "table";
    case "sequence":
      return "sequence";
    case "sankey":
      return "sankey";
    case "run":
      return "run";
    default:
      return "appendix";
  }
}

function isEmbedEligible(cell: NotebookCell): boolean {
  return classifyCellPlacement(cell) === "body";
}

export function buildPublicationViewModel(args: {
  document: NotebookDocument;
  templateId: NotebookTemplateId;
  mode: PublicationRenderMode;
  embedCellId?: string | null;
}): PublicationViewModel {
  const embedCellId = args.embedCellId?.trim() || null;
  const bodySections: PublicationSection[] = [];
  const appendixSections: PublicationSection[] = [];

  for (const cell of args.document.cells) {
    const placement = classifyCellPlacement(cell);
    if (placement === "skip") {
      continue;
    }

    const section: PublicationSection = {
      kind: resolveSectionKind(cell),
      cell,
      anchorId: cell.id
    };

    if (placement === "appendix") {
      appendixSections.push(section);
    } else {
      bodySections.push(section);
    }
  }

  if (args.mode === "embed") {
    if (!embedCellId) {
      return {
        title: args.document.title,
        templateId: args.templateId,
        mode: args.mode,
        embedCellId: null,
        bodySections: [],
        appendixSections: []
      };
    }

    const embedSection = bodySections.find(
      (section) => section.anchorId === embedCellId && isEmbedEligible(section.cell)
    );

    return {
      title: args.document.title,
      templateId: args.templateId,
      mode: args.mode,
      embedCellId,
      bodySections: embedSection ? [embedSection] : [],
      appendixSections: []
    };
  }

  return {
    title: args.document.title,
    templateId: args.templateId,
    mode: args.mode,
    embedCellId: null,
    bodySections,
    appendixSections
  };
}
