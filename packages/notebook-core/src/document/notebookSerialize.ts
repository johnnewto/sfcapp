import { isRowComment } from "../rowComments";
import type { NotebookCell, NotebookDocument } from "../types";
import { normalizeAbmModelCell } from "../abmModelCell";
import { normalizeUnitMetaAliases, serializeUnitMetaAliases } from "../unitMetaAliases";
import { normalizeScenarioFromNotebook, serializeScenarioForNotebook } from "./scenarioFormat";
import { validateCell } from "./documentUtils";

export function serializeNotebookCell(cell: NotebookCell): NotebookCell {
  switch (cell.type) {
    case "model":
      return {
        ...cell,
        editor: {
          ...cell.editor,
          equations: cell.editor.equations.map((equation) =>
            isRowComment(equation)
              ? equation
              : {
                  ...equation,
                  unitMeta: serializeUnitMetaAliases(equation.unitMeta)
                }
          ),
          externals: cell.editor.externals.map((external) =>
            isRowComment(external)
              ? external
              : {
                  ...external,
                  unitMeta: serializeUnitMetaAliases(external.unitMeta)
                }
          )
        }
      };
    case "equations":
      return {
        ...cell,
        equations: cell.equations.map((equation) =>
          isRowComment(equation)
            ? equation
            : {
                ...equation,
                unitMeta: serializeUnitMetaAliases(equation.unitMeta)
              }
        )
      };
    case "externals":
    case "observed":
      return {
        ...cell,
        externals: cell.externals.map((external) =>
          isRowComment(external)
            ? external
            : {
                ...external,
                unitMeta: serializeUnitMetaAliases(external.unitMeta)
              }
        )
      };
    case "run":
      return {
        ...cell,
        ...(cell.externalOverrides
          ? {
              externalOverrides: cell.externalOverrides.map((external) =>
                isRowComment(external)
                  ? external
                  : {
                      ...external,
                      unitMeta: serializeUnitMetaAliases(external.unitMeta)
                    }
              )
            }
          : {}),
        ...(cell.scenario
          ? {
              scenario: serializeScenarioForNotebook(normalizeScenarioFromNotebook(cell.scenario))
            }
          : {})
      };
    default:
      return structuredClone(cell);
  }
}

export function serializeNotebookDocument(document: NotebookDocument): NotebookDocument {
  return {
    ...document,
    cells: document.cells.map(serializeNotebookCell)
  };
}

export function normalizeNotebookDocument(document: NotebookDocument): NotebookDocument {
  return {
    ...document,
    cells: document.cells.map(normalizeNotebookCell)
  };
}

export function normalizeNotebookCell(cell: NotebookCell): NotebookCell {
  const lifted = cell.type === "abm-model" ? normalizeAbmModelCell(cell) : cell;

  switch (lifted.type) {
    case "model":
      return {
        ...lifted,
        editor: {
          ...lifted.editor,
          equations: lifted.editor.equations.map((equation) =>
            isRowComment(equation)
              ? equation
              : {
                  ...equation,
                  unitMeta: normalizeUnitMetaAliases(equation.unitMeta)
                }
          ),
          externals: lifted.editor.externals.map((external) =>
            isRowComment(external)
              ? external
              : {
                  ...external,
                  unitMeta: normalizeUnitMetaAliases(external.unitMeta)
                }
          )
        }
      };
    case "equations":
      return {
        ...lifted,
        equations: lifted.equations.map((equation) =>
          isRowComment(equation)
            ? equation
            : {
                ...equation,
                unitMeta: normalizeUnitMetaAliases(equation.unitMeta)
              }
        )
      };
    case "externals":
    case "observed":
      return {
        ...lifted,
        externals: lifted.externals.map((external) =>
          isRowComment(external)
            ? external
            : {
                ...external,
                unitMeta: normalizeUnitMetaAliases(external.unitMeta)
              }
        )
      };
    case "run":
      return {
        ...lifted,
        ...(lifted.externalOverrides
          ? {
              externalOverrides: lifted.externalOverrides.map((external) =>
                isRowComment(external)
                  ? external
                  : {
                      ...external,
                      unitMeta: normalizeUnitMetaAliases(external.unitMeta)
                    }
              )
            }
          : {}),
        ...(lifted.scenario
          ? {
              scenario: normalizeScenarioFromNotebook(lifted.scenario)
            }
          : {})
      };
    default:
      return lifted;
  }
}

export function normalizeNotebookObject(
  parsed: Partial<NotebookDocument>,
  formatLabel: "JSON" | "YAML"
): NotebookDocument {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Notebook ${formatLabel} must be an object.`);
  }
  if (typeof parsed.id !== "string" || typeof parsed.title !== "string") {
    throw new Error(`Notebook ${formatLabel} must contain string id and title fields.`);
  }
  if (!Array.isArray(parsed.cells)) {
    throw new Error(`Notebook ${formatLabel} must contain a cells array.`);
  }

  parsed.cells.forEach(validateCell);

  return normalizeNotebookDocument(parsed as NotebookDocument);
}
