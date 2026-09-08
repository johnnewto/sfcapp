import { derivativeBalanceStockName, type ShockVariableDef } from "@sfcr/core";
import { isRowComment } from "@sfcr/notebook-core";

import type { EquationRow, ExternalRow, InitialValueRow } from "../lib/editorModel";
import { resolveNearestNotebookContextCell } from "./notebookContext";
import { resolveRunCellModelKey } from "./modelSections";
import type {
  AbmModelCell,
  ChartCell,
  EquationsCell,
  ExternalsCell,
  InitialValuesCell,
  HydraulicsCell,
  MatrixCell,
  ModelCell,
  NotebookCell,
  RunCell,
  SequenceCell,
  SolverCell,
  TableCell
} from "./types";

const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_.^{}]*/g;

export type ModelRenameScope =
  | { kind: "modelId"; modelId: string }
  | { kind: "legacyModelCell"; cellId: string };

export interface VariableReferenceCell {
  cellId: string;
  cellTitle: string;
  cellType: NotebookCell["type"];
  referenceCount: number;
}

export interface VariableReferenceCount {
  affectedCells: VariableReferenceCell[];
  cellCount: number;
  referenceCount: number;
}

export function replaceIdentifierInSource(source: string, oldName: string, newName: string): string {
  if (!source || oldName === newName) {
    return source;
  }

  return source.replace(IDENTIFIER_PATTERN, (token) => (token === oldName ? newName : token));
}

export function isModelVariableNameAvailable(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  variable: string,
  options?: {
    excludeEquationId?: string;
    excludeExternalId?: string;
    excludeInitialValueId?: string;
  }
): boolean {
  const normalizedVariable = variable.trim();
  if (!normalizedVariable) {
    return false;
  }

  for (const cell of cells) {
    if (!cellMatchesScope(cell, cells, scope)) {
      continue;
    }

    if (cell.type === "equations") {
      if (
        cell.equations.some(
          (equation) =>
            !isRowComment(equation) &&
            equationNameDefinesVariable(equation.name, normalizedVariable) &&
            equation.id !== options?.excludeEquationId
        )
      ) {
        return false;
      }
    }

    if (cell.type === "externals" || cell.type === "observed") {
      if (
        cell.externals.some(
          (external) =>
            !isRowComment(external) &&
            external.name.trim() === normalizedVariable &&
            external.id !== options?.excludeExternalId
        )
      ) {
        return false;
      }
    }

    if (cell.type === "initial-values") {
      if (
        cell.initialValues.some(
          (row) =>
            !isRowComment(row) &&
            row.name.trim() === normalizedVariable &&
            row.id !== options?.excludeInitialValueId
        )
      ) {
        return false;
      }
    }

    if (cell.type === "model") {
      if (
        cell.editor.equations.some(
          (equation) =>
            !isRowComment(equation) &&
            equationNameDefinesVariable(equation.name, normalizedVariable) &&
            equation.id !== options?.excludeEquationId
        )
      ) {
        return false;
      }
      if (
        cell.editor.externals.some(
          (external) =>
            !isRowComment(external) &&
            external.name.trim() === normalizedVariable &&
            external.id !== options?.excludeExternalId
        )
      ) {
        return false;
      }
      if (
        cell.editor.initialValues.some(
          (row) =>
            !isRowComment(row) &&
            row.name.trim() === normalizedVariable &&
            row.id !== options?.excludeInitialValueId
        )
      ) {
        return false;
      }
    }

    if (cell.type === "abm-model" && abmModelDefinesVariable(cell, normalizedVariable)) {
      return false;
    }
  }

  return true;
}

export interface ModelVariableDefinition {
  kind: "equation" | "external" | "initial value";
  cellTitle: string;
}

export function findModelVariableDefinition(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  variable: string,
  options?: {
    excludeEquationId?: string;
    excludeExternalId?: string;
    excludeInitialValueId?: string;
  }
): ModelVariableDefinition | null {
  const normalizedVariable = variable.trim();
  if (!normalizedVariable) {
    return null;
  }

  for (const cell of cells) {
    if (!cellMatchesScope(cell, cells, scope)) {
      continue;
    }

    const cellTitle = cell.title.trim();

    if (cell.type === "equations") {
      if (
        cell.equations.some(
          (equation) =>
            !isRowComment(equation) &&
            equationNameDefinesVariable(equation.name, normalizedVariable) &&
            equation.id !== options?.excludeEquationId
        )
      ) {
        return { kind: "equation", cellTitle };
      }
    }

    if (cell.type === "externals" || cell.type === "observed") {
      if (
        cell.externals.some(
          (external) =>
            !isRowComment(external) &&
            external.name.trim() === normalizedVariable &&
            external.id !== options?.excludeExternalId
        )
      ) {
        return { kind: "external", cellTitle };
      }
    }

    if (cell.type === "initial-values") {
      if (
        cell.initialValues.some(
          (row) =>
            !isRowComment(row) &&
            row.name.trim() === normalizedVariable &&
            row.id !== options?.excludeInitialValueId
        )
      ) {
        return { kind: "initial value", cellTitle };
      }
    }

    if (cell.type === "model") {
      if (
        cell.editor.equations.some(
          (equation) =>
            !isRowComment(equation) &&
            equationNameDefinesVariable(equation.name, normalizedVariable) &&
            equation.id !== options?.excludeEquationId
        )
      ) {
        return { kind: "equation", cellTitle };
      }
      if (
        cell.editor.externals.some(
          (external) =>
            !isRowComment(external) &&
            external.name.trim() === normalizedVariable &&
            external.id !== options?.excludeExternalId
        )
      ) {
        return { kind: "external", cellTitle };
      }
      if (
        cell.editor.initialValues.some(
          (row) =>
            !isRowComment(row) &&
            row.name.trim() === normalizedVariable &&
            row.id !== options?.excludeInitialValueId
        )
      ) {
        return { kind: "initial value", cellTitle };
      }
    }

    if (cell.type === "abm-model") {
      const kind = abmModelDefinitionKind(cell, normalizedVariable);
      if (kind) {
        return { kind, cellTitle };
      }
    }
  }

  return null;
}

export function formatVariableAlreadyDefinedWarning(
  variable: string,
  definition: ModelVariableDefinition
): string {
  const location = definition.cellTitle ? ` in "${definition.cellTitle}"` : "";
  return `Variable '${variable.trim()}' is already defined in this model as an ${definition.kind}${location}.`;
}

export function countVariableReferences(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  variable: string
): VariableReferenceCount {
  const normalizedVariable = variable.trim();
  if (!normalizedVariable) {
    return { affectedCells: [], cellCount: 0, referenceCount: 0 };
  }

  const affectedCells: VariableReferenceCell[] = [];
  let referenceCount = 0;

  for (const cell of cells) {
    const cellReferences = countReferencesInCell(cell, cells, scope, normalizedVariable);
    if (cellReferences > 0) {
      affectedCells.push({
        cellId: cell.id,
        cellTitle: cell.title.trim() || cell.id,
        cellType: cell.type,
        referenceCount: cellReferences
      });
      referenceCount += cellReferences;
    }
  }

  return { affectedCells, cellCount: affectedCells.length, referenceCount };
}

export function renameVariableInNotebook(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  oldName: string,
  newName: string
): NotebookCell[] {
  const normalizedOldName = oldName.trim();
  const normalizedNewName = newName.trim();
  if (!normalizedOldName || !normalizedNewName || normalizedOldName === normalizedNewName) {
    return cells;
  }

  return cells.map((cell) => renameVariableInCell(cell, cells, scope, normalizedOldName, normalizedNewName));
}

export function patchEquationInNotebook(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  equationId: string,
  patch: Pick<EquationRow, "name" | "expression">
): NotebookCell[] {
  return cells.map((cell) => {
    if (cell.type === "equations" && cellMatchesScope(cell, cells, scope)) {
      return {
        ...cell,
        equations: cell.equations.map((equation) =>
          !isRowComment(equation) && equation.id === equationId
            ? {
                ...equation,
                name: patch.name,
                expression: patch.expression
              }
            : equation
        )
      };
    }

    if (cell.type === "model" && scope.kind === "legacyModelCell" && cell.id === scope.cellId) {
      return {
        ...cell,
        editor: {
          ...cell.editor,
          equations: cell.editor.equations.map((equation) =>
            !isRowComment(equation) && equation.id === equationId
              ? {
                  ...equation,
                  name: patch.name,
                  expression: patch.expression
                }
              : equation
          )
        }
      };
    }

    return cell;
  });
}

export function patchInitialValueInNotebook(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  initialValueId: string,
  patch: Pick<InitialValueRow, "name" | "valueText">
): NotebookCell[] {
  return cells.map((cell) => {
    if (cell.type === "initial-values" && cellMatchesScope(cell, cells, scope)) {
      return {
        ...cell,
        initialValues: cell.initialValues.map((row) =>
          !isRowComment(row) && row.id === initialValueId
            ? {
                ...row,
                name: patch.name,
                valueText: patch.valueText
              }
            : row
        )
      };
    }

    if (cell.type === "model" && scope.kind === "legacyModelCell" && cell.id === scope.cellId) {
      return {
        ...cell,
        editor: {
          ...cell.editor,
          initialValues: cell.editor.initialValues.map((row) =>
            !isRowComment(row) && row.id === initialValueId
              ? {
                  ...row,
                  name: patch.name,
                  valueText: patch.valueText
                }
              : row
          )
        }
      };
    }

    return cell;
  });
}

export function patchExternalInNotebook(
  cells: NotebookCell[],
  scope: ModelRenameScope,
  externalId: string,
  patch: Pick<ExternalRow, "name" | "valueText">
): NotebookCell[] {
  return cells.map((cell) => {
    if ((cell.type === "externals" || cell.type === "observed") && cellMatchesScope(cell, cells, scope)) {
      return {
        ...cell,
        externals: cell.externals.map((external) =>
          !isRowComment(external) && external.id === externalId
            ? {
                ...external,
                name: patch.name,
                valueText: patch.valueText
              }
            : external
        )
      };
    }

    if (cell.type === "model" && scope.kind === "legacyModelCell" && cell.id === scope.cellId) {
      return {
        ...cell,
        editor: {
          ...cell.editor,
          externals: cell.editor.externals.map((external) =>
            !isRowComment(external) && external.id === externalId
              ? {
                  ...external,
                  name: patch.name,
                  valueText: patch.valueText
                }
              : external
          )
        }
      };
    }

    return cell;
  });
}

function renameVariableInCell(
  cell: NotebookCell,
  cells: NotebookCell[],
  scope: ModelRenameScope,
  oldName: string,
  newName: string
): NotebookCell {
  if (!cellMatchesScope(cell, cells, scope)) {
    return cell;
  }

  switch (cell.type) {
    case "equations":
      return {
        ...cell,
        equations: cell.equations.map((equation) =>
          isRowComment(equation)
            ? equation
            : {
                ...equation,
                name: renameEquationTargetName(equation.name, oldName, newName),
                expression: replaceIdentifierInSource(equation.expression, oldName, newName)
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
                name: external.name.trim() === oldName ? newName : external.name
              }
        )
      };
    case "initial-values":
      return {
        ...cell,
        initialValues: cell.initialValues.map((row) =>
          isRowComment(row)
            ? row
            : {
                ...row,
                name: row.name.trim() === oldName ? newName : row.name
              }
        )
      };
    case "solver":
      return {
        ...cell,
        options: {
          ...cell.options,
          hiddenLeftVariable:
            cell.options.hiddenLeftVariable.trim() === oldName
              ? newName
              : cell.options.hiddenLeftVariable,
          hiddenRightVariable:
            cell.options.hiddenRightVariable.trim() === oldName
              ? newName
              : cell.options.hiddenRightVariable
        }
      };
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
                  name: renameEquationTargetName(equation.name, oldName, newName),
                  expression: replaceIdentifierInSource(equation.expression, oldName, newName)
                }
          ),
          externals: cell.editor.externals.map((external) =>
            isRowComment(external)
              ? external
              : {
                  ...external,
                  name: external.name.trim() === oldName ? newName : external.name
                }
          ),
          initialValues: cell.editor.initialValues.map((row) =>
            isRowComment(row)
              ? row
              : {
                  ...row,
                  name: row.name.trim() === oldName ? newName : row.name
                }
          ),
          options: {
            ...cell.editor.options,
            hiddenLeftVariable:
              cell.editor.options.hiddenLeftVariable.trim() === oldName
                ? newName
                : cell.editor.options.hiddenLeftVariable,
            hiddenRightVariable:
              cell.editor.options.hiddenRightVariable.trim() === oldName
                ? newName
                : cell.editor.options.hiddenRightVariable
          }
        }
      };
    case "matrix":
      return {
        ...cell,
        rows: cell.rows.map((row) => ({
          ...row,
          values: row.values.map((value) => replaceIdentifierInSource(value, oldName, newName))
        }))
      };
    case "table":
      return {
        ...cell,
        variables: cell.variables.map((name) =>
          name.trim() === oldName ? newName : replaceIdentifierInSource(name, oldName, newName)
        )
      };
    case "chart":
      return {
        ...cell,
        variables: cell.variables?.map((name) => (name.trim() === oldName ? newName : name)),
        axisGroups: cell.axisGroups?.map((group) =>
          group.map((name) => (name.trim() === oldName ? newName : name))
        ),
        series: cell.series?.map((entry) => ({
          ...entry,
          expression: replaceIdentifierInSource(entry.expression, oldName, newName),
          label: entry.label?.trim() === oldName ? newName : entry.label
        })),
        seriesRanges: renameSeriesRangeKeys(cell.seriesRanges, oldName, newName)
      };
    case "run":
      return {
        ...cell,
        scenario: cell.scenario ? renameScenario(cell.scenario, oldName, newName) : cell.scenario,
        abm: renameAbmRunOverrides(cell.abm, oldName, newName)
      };
    case "sequence":
      return renameSequenceCell(cell, oldName, newName);
    case "hydraulics":
      return renameHydraulicsCell(cell, oldName, newName);
    case "markdown":
      return {
        ...cell,
        source: replaceIdentifierInSource(cell.source, oldName, newName)
      };
    case "abm-model":
      return renameVariableInAbmModelCell(cell, oldName, newName);
    default:
      return cell;
  }
}

function renameSeriesRangeKeys(
  seriesRanges: ChartCell["seriesRanges"],
  oldName: string,
  newName: string
): ChartCell["seriesRanges"] {
  if (!seriesRanges) {
    return seriesRanges;
  }

  const next: NonNullable<ChartCell["seriesRanges"]> = {};
  for (const [key, value] of Object.entries(seriesRanges)) {
    next[key.trim() === oldName ? newName : key] = value;
  }
  return next;
}

function renameScenario<T extends NonNullable<RunCell["scenario"]>>(
  scenario: T,
  oldName: string,
  newName: string
): T {
  return {
    ...scenario,
    shocks: scenario.shocks.map((shock) => {
      const nextVariables: Record<string, ShockVariableDef> = {};
      for (const [key, value] of Object.entries(shock.variables)) {
        nextVariables[key.trim() === oldName ? newName : key] = value;
      }
      return {
        ...shock,
        variables: nextVariables
      };
    })
  } as T;
}

function renameSequenceCell(cell: SequenceCell, oldName: string, newName: string): SequenceCell {
  if (cell.source.kind !== "matrix" || !cell.source.aliases) {
    return cell;
  }

  const nextAliases: Record<string, string> = {};
  for (const [alias, variable] of Object.entries(cell.source.aliases)) {
    nextAliases[alias] = variable.trim() === oldName ? newName : variable;
  }

  return {
    ...cell,
    source: {
      ...cell.source,
      aliases: nextAliases
    }
  };
}

function renameHydraulicsCell(cell: HydraulicsCell, oldName: string, newName: string): HydraulicsCell {
  if (!cell.layout) {
    return cell;
  }

  return {
    ...cell,
    layout: {
      ...cell.layout,
      tanks: cell.layout.tanks?.map((tank) => ({
        ...tank,
        variable: tank.variable?.trim() === oldName ? newName : tank.variable,
        expression: tank.expression ? replaceIdentifierInSource(tank.expression, oldName, newName) : tank.expression
      })),
      pipes: cell.layout.pipes?.map((pipe) => ({
        ...pipe,
        variable: pipe.variable?.trim() === oldName ? newName : pipe.variable,
        expression: pipe.expression ? replaceIdentifierInSource(pipe.expression, oldName, newName) : pipe.expression
      }))
    }
  };
}

function countHydraulicsReferences(cell: HydraulicsCell, variable: string): number {
  if (!cell.layout) {
    return 0;
  }
  const tanks = cell.layout.tanks ?? [];
  const pipes = cell.layout.pipes ?? [];
  return (
    tanks.reduce(
      (total, tank) =>
        total +
        countExactNameMatch(tank.variable ?? "", variable) +
        countIdentifierOccurrences(tank.expression ?? "", variable),
      0
    ) +
    pipes.reduce(
      (total, pipe) =>
        total +
        countExactNameMatch(pipe.variable ?? "", variable) +
        countIdentifierOccurrences(pipe.expression ?? "", variable),
      0
    )
  );
}

function countReferencesInCell(
  cell: NotebookCell,
  cells: NotebookCell[],
  scope: ModelRenameScope,
  variable: string
): number {
  if (!cellMatchesScope(cell, cells, scope)) {
    return 0;
  }

  switch (cell.type) {
    case "equations":
      return cell.equations.reduce((total, equation) => {
        if (isRowComment(equation)) {
          return total;
        }
        return (
          total +
          countEquationNameMatch(equation.name, variable) +
          countIdentifierOccurrences(equation.expression, variable)
        );
      }, 0);
    case "externals":
    case "observed":
      return cell.externals.reduce(
        (total, external) =>
          isRowComment(external) ? total : total + countExactNameMatch(external.name, variable),
        0
      );
    case "initial-values":
      return cell.initialValues.reduce(
        (total, row) => (isRowComment(row) ? total : total + countExactNameMatch(row.name, variable)),
        0
      );
    case "solver":
      return (
        countExactNameMatch(cell.options.hiddenLeftVariable, variable) +
        countExactNameMatch(cell.options.hiddenRightVariable, variable)
      );
    case "model":
      return (
        cell.editor.equations.reduce((total, equation) => {
          if (isRowComment(equation)) {
            return total;
          }
          return (
            total +
            countEquationNameMatch(equation.name, variable) +
            countIdentifierOccurrences(equation.expression, variable)
          );
        }, 0) +
        cell.editor.externals.reduce(
          (total, external) =>
            isRowComment(external) ? total : total + countExactNameMatch(external.name, variable),
          0
        ) +
        cell.editor.initialValues.reduce(
          (total, row) => (isRowComment(row) ? total : total + countExactNameMatch(row.name, variable)),
          0
        ) +
        countExactNameMatch(cell.editor.options.hiddenLeftVariable, variable) +
        countExactNameMatch(cell.editor.options.hiddenRightVariable, variable)
      );
    case "matrix":
      return cell.rows.reduce(
        (total, row) =>
          total + row.values.reduce((rowTotal, value) => rowTotal + countIdentifierOccurrences(value, variable), 0),
        0
      );
    case "table":
      return cell.variables.reduce(
        (total, name) => total + countIdentifierOccurrences(name, variable),
        0
      );
    case "chart":
      return (
        (cell.variables ?? []).reduce((total, name) => total + countExactNameMatch(name, variable), 0) +
        (cell.series ?? []).reduce(
          (total, entry) => total + countIdentifierOccurrences(entry.expression, variable),
          0
        ) +
        Object.keys(cell.seriesRanges ?? {}).reduce(
          (total, key) => total + countExactNameMatch(key, variable),
          0
        )
      );
    case "run":
      if (!cell.scenario) {
        return countAbmRunOverrideReferences(cell, variable);
      }
      return (
        cell.scenario.shocks.reduce(
          (total, shock) =>
            total +
            Object.keys(shock.variables).reduce(
              (shockTotal, key) => shockTotal + countExactNameMatch(key, variable),
              0
            ),
          0
        ) + countAbmRunOverrideReferences(cell, variable)
      );
    case "sequence":
      if (cell.source.kind !== "matrix" || !cell.source.aliases) {
        return 0;
      }
      return Object.values(cell.source.aliases).reduce(
        (total, aliasVariable) => total + countExactNameMatch(aliasVariable, variable),
        0
      );
    case "hydraulics":
      return countHydraulicsReferences(cell, variable);
    case "markdown":
      return countIdentifierOccurrences(cell.source, variable);
    case "abm-model":
      return countReferencesInAbmModelCell(cell, variable);
    default:
      return 0;
  }
}

function equationNameDefinesVariable(equationName: string, variable: string): boolean {
  const trimmed = equationName.trim();
  if (trimmed === variable) {
    return true;
  }
  return derivativeBalanceStockName(trimmed) === variable;
}

function renameEquationTargetName(equationName: string, oldName: string, newName: string): string {
  const stockName = derivativeBalanceStockName(equationName);
  if (stockName !== null && stockName === oldName) {
    return `d(${newName})`;
  }
  return equationName.trim() === oldName ? newName : equationName;
}

function countEquationNameMatch(name: string, variable: string): number {
  return equationNameDefinesVariable(name, variable) ? 1 : 0;
}

function countExactNameMatch(name: string, variable: string): number {
  return name.trim() === variable ? 1 : 0;
}

function countIdentifierOccurrences(source: string, variable: string): number {
  if (!source) {
    return 0;
  }

  let count = 0;
  for (const match of source.matchAll(new RegExp(IDENTIFIER_PATTERN.source, "g"))) {
    if (match[0] === variable) {
      count += 1;
    }
  }
  return count;
}

function cellMatchesScope(cell: NotebookCell, cells: NotebookCell[], scope: ModelRenameScope): boolean {
  if (cell.type === "markdown") {
    const contextCell = resolveNearestNotebookContextCell(cells, cell);
    return contextCell != null && cellMatchesScope(contextCell, cells, scope);
  }

  if (scope.kind === "modelId") {
    return cellMatchesModelId(cell, cells, scope.modelId);
  }

  return cellMatchesLegacyModelCell(cell, cells, scope.cellId);
}

function cellMatchesModelId(cell: NotebookCell, cells: NotebookCell[], modelId: string): boolean {
  switch (cell.type) {
    case "equations":
    case "externals":
    case "observed":
    case "initial-values":
    case "solver":
    case "abm-model":
      return cell.modelId === modelId;
    case "run":
      return resolveRunCellModelKey(cells, cell) === `model:${modelId}`;
    case "matrix":
    case "table":
    case "chart":
      return runCellMatchesModelId(cells, cell.sourceRunCellId, modelId);
    case "sequence":
      if (cell.source.kind === "dependency" || cell.source.kind === "cld") {
        return (cell.source.modelId ?? cell.source.sourceModelId) === modelId;
      }
      if (cell.source.kind === "matrix") {
        return runCellMatchesModelId(cells, cell.source.sourceRunCellId, modelId);
      }
      return false;
    case "hydraulics":
      return runCellMatchesModelId(cells, cell.source.sourceRunCellId, modelId);
    default:
      return false;
  }
}

function cellMatchesLegacyModelCell(cell: NotebookCell, cells: NotebookCell[], cellId: string): boolean {
  if (cell.type === "model") {
    return cell.id === cellId;
  }

  if (cell.type === "run") {
    return cell.sourceModelCellId === cellId;
  }

  if (cell.type === "matrix" || cell.type === "table" || cell.type === "chart") {
    const run = cells.find((entry): entry is RunCell => entry.type === "run" && entry.id === cell.sourceRunCellId);
    return run?.sourceModelCellId === cellId;
  }

  if (
    cell.type === "sequence" &&
    (cell.source.kind === "dependency" || cell.source.kind === "cld")
  ) {
    return cell.source.sourceModelCellId === cellId;
  }

  if (cell.type === "sequence" && cell.source.kind === "matrix") {
    const sourceRunCellId = cell.source.sourceRunCellId;
    if (!sourceRunCellId) {
      return false;
    }
    const run = cells.find((entry): entry is RunCell => entry.type === "run" && entry.id === sourceRunCellId);
    return run?.sourceModelCellId === cellId;
  }

  return false;
}

function runCellMatchesModelId(
  cells: NotebookCell[],
  sourceRunCellId: string | undefined,
  modelId: string
): boolean {
  if (!sourceRunCellId) {
    return false;
  }

  const run = cells.find((entry): entry is RunCell => entry.type === "run" && entry.id === sourceRunCellId);
  return run ? resolveRunCellModelKey(cells, run) === `model:${modelId}` : false;
}

function countAbmRunOverrideReferences(cell: RunCell, variable: string): number {
  if (!cell.abm || typeof cell.abm !== "object") {
    return 0;
  }
  return Object.keys(cell.abm).reduce((total, key) => total + countExactNameMatch(key, variable), 0);
}

function renameAbmRunOverrides(
  abm: RunCell["abm"],
  oldName: string,
  newName: string
): RunCell["abm"] {
  if (!abm || typeof abm !== "object") {
    return abm;
  }
  const next: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(abm)) {
    next[key.trim() === oldName ? newName : key] = value;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function abmModelDefinesVariable(cell: AbmModelCell, variable: string): boolean {
  return abmModelDefinitionKind(cell, variable) != null;
}

function abmModelDefinitionKind(
  cell: AbmModelCell,
  variable: string
): ModelVariableDefinition["kind"] | null {
  if (isRecord(cell.params) && Object.prototype.hasOwnProperty.call(cell.params, variable)) {
    return "external";
  }

  const populations = Array.isArray(cell.populations) ? cell.populations : [];
  for (const pop of populations) {
    if (!isRecord(pop)) {
      continue;
    }
    if (Array.isArray(pop.state) && pop.state.some((name) => String(name).trim() === variable)) {
      return "equation";
    }
    if (isRecord(pop.params) && Object.prototype.hasOwnProperty.call(pop.params, variable)) {
      return "external";
    }
  }

  for (const row of collectAbmEquationRows(cell.ticks)) {
    if (row.name.trim() === variable) {
      return "equation";
    }
  }

  if (isRecord(cell.check)) {
    if (String(cell.check.left ?? "").trim() === variable || String(cell.check.right ?? "").trim() === variable) {
      return "equation";
    }
  }

  return null;
}

function collectAbmEquationRows(ticks: unknown): Array<{ name: string; expression: string; description?: string }> {
  if (!Array.isArray(ticks)) {
    return [];
  }
  const rows: Array<{ name: string; expression: string; description?: string }> = [];
  for (const tick of ticks) {
    if (!isRecord(tick)) {
      continue;
    }
    if (Array.isArray(tick.do)) {
      rows.push(...parseAbmEquationRowList(tick.do));
    }
    if (Array.isArray(tick.equations)) {
      rows.push(...parseAbmEquationRowList(tick.equations));
    }
    if (isRecord(tick.for)) {
      for (const equations of Object.values(tick.for)) {
        if (Array.isArray(equations)) {
          rows.push(...parseAbmEquationRowList(equations));
        }
      }
    }
    if (isRecord(tick["hire-lottery"])) {
      const body = tick["hire-lottery"];
      rows.push({
        name: String(body.into ?? ""),
        expression: `hire_lottery(${String(body.demand ?? "")}, ${String(body.spread ?? "")}, ${String(body.cap ?? "")})`
      });
    }
    if (isRecord(tick["ration-fcfs"])) {
      const body = tick["ration-fcfs"];
      rows.push({
        name: String(body.into ?? ""),
        expression: `ration_fcfs(${String(body.demand ?? "")}, ${String(body.supply ?? "")})`
      });
    }
    if (tick.kind === "hire-lottery") {
      rows.push({
        name: String(tick.into ?? ""),
        expression: `hire_lottery(${String(tick.demand ?? "")}, ${String(tick.spread ?? "")}, ${String(tick.cap ?? "")})`
      });
    }
    if (tick.kind === "ration-fcfs") {
      rows.push({
        name: String(tick.into ?? ""),
        expression: `ration_fcfs(${String(tick.demand ?? "")}, ${String(tick.supply ?? "")})`
      });
    }
  }
  return rows.filter((row) => row.name.trim() !== "");
}

function parseAbmEquationRowList(
  rows: unknown[]
): Array<{ name: string; expression: string; description?: string }> {
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) {
      return [];
    }
    const name = String(row[0] ?? "");
    const expression = String(row[1] ?? "");
    const description =
      row.length >= 3 && row[2] != null && String(row[2]).trim() !== "" ? String(row[2]) : undefined;
    return description != null ? [{ name, expression, description }] : [{ name, expression }];
  });
}

function countReferencesInAbmModelCell(cell: AbmModelCell, variable: string): number {
  let total = 0;

  if (isRecord(cell.params)) {
    total += Object.keys(cell.params).reduce(
      (sum, key) => sum + countExactNameMatch(key, variable),
      0
    );
  }

  const populations = Array.isArray(cell.populations) ? cell.populations : [];
  for (const pop of populations) {
    if (!isRecord(pop)) {
      continue;
    }
    if (Array.isArray(pop.state)) {
      total += pop.state.reduce(
        (sum, name) => sum + countExactNameMatch(String(name), variable),
        0
      );
    }
    if (isRecord(pop.params)) {
      total += Object.keys(pop.params).reduce(
        (sum, key) => sum + countExactNameMatch(key, variable),
        0
      );
    }
  }

  for (const row of collectAbmEquationRows(cell.ticks)) {
    total += countExactNameMatch(row.name, variable);
    total += countIdentifierOccurrences(row.expression, variable);
    if (row.description) {
      total += countIdentifierOccurrences(row.description, variable);
    }
  }

  if (isRecord(cell.record)) {
    if (Array.isArray(cell.record.series)) {
      total += cell.record.series.reduce(
        (sum, name) => sum + countExactNameMatch(String(name), variable),
        0
      );
    }
    if (Array.isArray(cell.record.bands)) {
      total += cell.record.bands.reduce(
        (sum, name) => sum + countExactNameMatch(String(name), variable),
        0
      );
    }
    if (isRecord(cell.record.descriptions)) {
      total += Object.keys(cell.record.descriptions).reduce(
        (sum, key) => sum + countExactNameMatch(key, variable),
        0
      );
      for (const description of Object.values(cell.record.descriptions)) {
        if (typeof description === "string") {
          total += countIdentifierOccurrences(description, variable);
        }
      }
    }
    if (Array.isArray(cell.record.micro)) {
      for (const entry of cell.record.micro) {
        if (!isRecord(entry) || !Array.isArray(entry.variables)) {
          continue;
        }
        total += entry.variables.reduce(
          (sum, name) => sum + countExactNameMatch(String(name), variable),
          0
        );
      }
    }
  } else if (Array.isArray(cell.record)) {
    for (const item of cell.record) {
      if (!isRecord(item)) {
        continue;
      }
      if (Array.isArray(item.variables)) {
        total += item.variables.reduce(
          (sum, name) => sum + countExactNameMatch(String(name), variable),
          0
        );
      }
      if (Array.isArray(item.bands)) {
        total += item.bands.reduce(
          (sum, name) => sum + countExactNameMatch(String(name), variable),
          0
        );
      }
      if (isRecord(item.descriptions)) {
        total += Object.keys(item.descriptions).reduce(
          (sum, key) => sum + countExactNameMatch(key, variable),
          0
        );
        for (const description of Object.values(item.descriptions)) {
          if (typeof description === "string") {
            total += countIdentifierOccurrences(description, variable);
          }
        }
      }
    }
  }

  if (isRecord(cell.check)) {
    total += countExactNameMatch(String(cell.check.left ?? ""), variable);
    total += countExactNameMatch(String(cell.check.right ?? ""), variable);
  }

  return total;
}

function renameVariableInAbmModelCell(
  cell: AbmModelCell,
  oldName: string,
  newName: string
): AbmModelCell {
  const nextParams = isRecord(cell.params)
    ? Object.fromEntries(
        Object.entries(cell.params).map(([key, value]) => [
          key.trim() === oldName ? newName : key,
          value
        ])
      )
    : cell.params;

  const nextPopulations = Array.isArray(cell.populations)
    ? cell.populations.map((pop) => {
        if (!isRecord(pop)) {
          return pop;
        }
        return {
          ...pop,
          state: Array.isArray(pop.state)
            ? pop.state.map((name) => (String(name).trim() === oldName ? newName : name))
            : pop.state,
          params: isRecord(pop.params)
            ? Object.fromEntries(
                Object.entries(pop.params).map(([key, value]) => [
                  key.trim() === oldName ? newName : key,
                  value
                ])
              )
            : pop.params
        };
      })
    : cell.populations;

  const nextTicks = Array.isArray(cell.ticks)
    ? cell.ticks.map((tick) => renameAbmTick(tick, oldName, newName))
    : cell.ticks;

  const nextRecord = Array.isArray(cell.record)
    ? cell.record.map((item) => {
        if (!isRecord(item)) {
          return item;
        }
        return {
          ...item,
          variables: Array.isArray(item.variables)
            ? item.variables.map((name) => (String(name).trim() === oldName ? newName : name))
            : item.variables,
          bands: Array.isArray(item.bands)
            ? item.bands.map((name) => (String(name).trim() === oldName ? newName : name))
            : item.bands,
          descriptions: isRecord(item.descriptions)
            ? Object.fromEntries(
                Object.entries(item.descriptions).map(([key, value]) => [
                  key.trim() === oldName ? newName : key,
                  typeof value === "string"
                    ? replaceIdentifierInSource(value, oldName, newName)
                    : value
                ])
              )
            : item.descriptions
        };
      })
    : isRecord(cell.record)
      ? {
          ...cell.record,
          series: Array.isArray(cell.record.series)
            ? cell.record.series.map((name) => (String(name).trim() === oldName ? newName : name))
            : cell.record.series,
          bands: Array.isArray(cell.record.bands)
            ? cell.record.bands.map((name) => (String(name).trim() === oldName ? newName : name))
            : cell.record.bands,
          descriptions: isRecord(cell.record.descriptions)
            ? Object.fromEntries(
                Object.entries(cell.record.descriptions).map(([key, value]) => [
                  key.trim() === oldName ? newName : key,
                  typeof value === "string"
                    ? replaceIdentifierInSource(value, oldName, newName)
                    : value
                ])
              )
            : cell.record.descriptions,
          micro: Array.isArray(cell.record.micro)
            ? cell.record.micro.map((entry) => {
                if (!isRecord(entry)) {
                  return entry;
                }
                return {
                  ...entry,
                  variables: Array.isArray(entry.variables)
                    ? entry.variables.map((name) =>
                        String(name).trim() === oldName ? newName : name
                      )
                    : entry.variables
                };
              })
            : cell.record.micro
        }
      : cell.record;

  const nextCheck = isRecord(cell.check)
    ? {
        ...cell.check,
        left:
          String(cell.check.left ?? "").trim() === oldName ? newName : cell.check.left,
        right:
          String(cell.check.right ?? "").trim() === oldName ? newName : cell.check.right
      }
    : cell.check;

  return {
    ...cell,
    params: nextParams as AbmModelCell["params"],
    populations: nextPopulations as AbmModelCell["populations"],
    ticks: nextTicks as AbmModelCell["ticks"],
    record: nextRecord as AbmModelCell["record"],
    check: nextCheck as AbmModelCell["check"]
  };
}

function renameAbmTick(tick: unknown, oldName: string, newName: string): unknown {
  if (!isRecord(tick)) {
    return tick;
  }

  const next: Record<string, unknown> = { ...tick };

  if (Array.isArray(tick.do)) {
    next.do = renameAbmEquationRowList(tick.do, oldName, newName);
  }
  if (Array.isArray(tick.equations)) {
    next.equations = renameAbmEquationRowList(tick.equations, oldName, newName);
  }
  if (isRecord(tick.for)) {
    next.for = Object.fromEntries(
      Object.entries(tick.for).map(([population, equations]) => [
        population,
        Array.isArray(equations) ? renameAbmEquationRowList(equations, oldName, newName) : equations
      ])
    );
  }
  if (isRecord(tick["hire-lottery"])) {
    const body = tick["hire-lottery"];
    next["hire-lottery"] = {
      ...body,
      demand: String(body.demand ?? "").trim() === oldName ? newName : body.demand,
      spread: String(body.spread ?? "").trim() === oldName ? newName : body.spread,
      into: String(body.into ?? "").trim() === oldName ? newName : body.into,
      cap:
        typeof body.cap === "string" && body.cap.trim() === oldName ? newName : body.cap
    };
  }
  if (isRecord(tick["ration-fcfs"])) {
    const body = tick["ration-fcfs"];
    next["ration-fcfs"] = {
      ...body,
      demand: String(body.demand ?? "").trim() === oldName ? newName : body.demand,
      supply: String(body.supply ?? "").trim() === oldName ? newName : body.supply,
      into: String(body.into ?? "").trim() === oldName ? newName : body.into
    };
  }
  if (tick.kind === "hire-lottery" || tick.kind === "ration-fcfs" || tick.kind === "agent" || tick.kind === "aggregate") {
    if (typeof tick.demand === "string" && tick.demand.trim() === oldName) {
      next.demand = newName;
    }
    if (typeof tick.spread === "string" && tick.spread.trim() === oldName) {
      next.spread = newName;
    }
    if (typeof tick.supply === "string" && tick.supply.trim() === oldName) {
      next.supply = newName;
    }
    if (typeof tick.into === "string" && tick.into.trim() === oldName) {
      next.into = newName;
    }
    if (typeof tick.cap === "string" && tick.cap.trim() === oldName) {
      next.cap = newName;
    }
  }

  return next;
}

function renameAbmEquationRowList(rows: unknown[], oldName: string, newName: string): unknown[] {
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length < 2) {
      return row;
    }
    const next = [...row];
    next[0] = String(row[0]).trim() === oldName ? newName : row[0];
    next[1] = replaceIdentifierInSource(String(row[1] ?? ""), oldName, newName);
    if (row.length >= 3 && row[2] != null) {
      next[2] = replaceIdentifierInSource(String(row[2]), oldName, newName);
    }
    return next;
  });
}
