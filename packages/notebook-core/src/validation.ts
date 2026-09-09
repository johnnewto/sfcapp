import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import notebookSchema from "./sfcr-notebook.schema.json" with { type: "json" };
import { createNotebookDiagnostic, type NotebookDiagnostic } from "./diagnostics";
import { resolveAccountingMatrixKind } from "./accountingMatrixKind";
import { validateMatrixAccountColumnsLayout } from "./matrixAccountColumns";
import { validateMatrixColumnTreeMatchesColumns } from "./matrixColumnTree";
import { isRecord } from "./document/documentUtils";
import { isRowComment } from "./rowComments";
import type {
  AbmModelCell,
  ChartCell,
  MatrixCell,
  NotebookCell,
  NotebookDocument,
  RunCell,
  HydraulicsCell,
  SankeyCell,
  SequenceCell
} from "./types";

export type { AccountingMatrixKind } from "./accountingMatrixKind";
export {
  inferAccountingMatrixKind,
  normalizeAccountingMatrixKindInput,
  normalizeMatrixCellAccountingKind,
  resolveAccountingMatrixKind
} from "./accountingMatrixKind";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateNotebookSchema = ajv.compile(notebookSchema);

export type NotebookValidationIssue = NotebookDiagnostic & { domain: "schema" | "notebook" };

export function validateNotebookSchemaObject(value: unknown): NotebookValidationIssue[] {
  if (validateNotebookSchema(value)) {
    return [];
  }

  return filterSchemaErrors(value, validateNotebookSchema.errors ?? []).map(formatSchemaError);
}

const CELL_TYPE_SCHEMA_BRANCH: Record<string, number> = {
  markdown: 0,
  equations: 1,
  solver: 2,
  externals: 3,
  "initial-values": 4,
  run: 5,
  chart: 6,
  table: 7,
  matrix: 8,
  sequence: 9,
  sankey: 10,
  "abm-model": 11,
  diagram: 12
};

function filterSchemaErrors(value: unknown, errors: ErrorObject[]): ErrorObject[] {
  const filtered = errors.filter((error) => shouldKeepSchemaError(value, error));
  const seen = new Set<string>();
  return filtered.filter((error) => {
    const key = `${error.keyword}:${error.instancePath}:${error.schemaPath}:${JSON.stringify(error.params)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function shouldKeepSchemaError(value: unknown, error: ErrorObject): boolean {
  const cellPath = getCellPath(error.instancePath);
  if (!cellPath) {
    return true;
  }

  if (error.keyword === "oneOf" && error.schemaPath === "#/oneOf") {
    return false;
  }

  const cell = getJsonPointerValue(value, cellPath);
  const cellType = cell && typeof cell === "object" ? (cell as { type?: unknown }).type : undefined;
  if (typeof cellType !== "string") {
    return true;
  }

  const branchIndex = CELL_TYPE_SCHEMA_BRANCH[cellType];
  if (branchIndex == null) {
    return true;
  }

  const oneOfBranchMatch = error.schemaPath.match(/^#\/oneOf\/(\d+)\//);
  if (!oneOfBranchMatch) {
    return true;
  }

  return Number.parseInt(oneOfBranchMatch[1], 10) === branchIndex;
}

function getCellPath(path: string): string | null {
  const match = path.match(/^(\/cells\/\d+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function getJsonPointerValue(value: unknown, path: string): unknown {
  if (!path || path === "/") {
    return value;
  }

  return path
    .split("/")
    .slice(1)
    .reduce<unknown>((current, segment) => {
      if (current == null || typeof current !== "object") {
        return undefined;
      }

      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (Array.isArray(current)) {
        const index = Number.parseInt(key, 10);
        return Number.isNaN(index) ? undefined : current[index];
      }

      return (current as Record<string, unknown>)[key];
    }, value);
}

export function validateNotebookDocument(document: NotebookDocument): NotebookValidationIssue[] {
  const issues: NotebookValidationIssue[] = [];
  const cellIds = new Set<string>();
  const duplicatedCellIds = new Set<string>();
  const runCellIds = new Set<string>();
  const matrixCellIds = new Set<string>();
  const modelCellIds = new Set<string>();
  const sectionModelIds = new Set<string>();
  const abmModelIds = new Set<string>();

  for (const cell of document.cells) {
    if (cellIds.has(cell.id)) {
      duplicatedCellIds.add(cell.id);
    }
    cellIds.add(cell.id);

    if (cell.type === "run") {
      runCellIds.add(cell.id);
    }
    if (cell.type === "matrix") {
      matrixCellIds.add(cell.id);
    }
    if (cell.type === "model") {
      modelCellIds.add(cell.id);
    }
    if (cell.type === "abm-model") {
      abmModelIds.add(cell.modelId);
    }
    if (
      cell.type === "equations" ||
      cell.type === "solver" ||
      cell.type === "externals" ||
      cell.type === "observed" ||
      cell.type === "initial-values"
    ) {
      sectionModelIds.add(cell.modelId);
    }
  }

  for (const id of duplicatedCellIds) {
    issues.push(createNotebookIssue(`Duplicate notebook cell id '${id}'.`));
  }

  for (const cell of document.cells) {
    validateCellReferences(cell, {
      issues,
      matrixCellIds,
      modelCellIds,
      runCellIds,
      sectionModelIds,
      abmModelIds
    });
    if (cell.type === "matrix") {
      validateMatrixCell(cell, issues);
    }
    if (cell.type === "chart") {
      validateChartCell(cell, issues);
    }
    if (cell.type === "abm-model") {
      validateAbmModelCell(cell, issues);
    }
  }

  validateModelSectionNames(document.cells, issues);

  return issues;
}

function formatSchemaError(error: ErrorObject): NotebookValidationIssue {
  const path = error.instancePath || "/";
  const message = buildSchemaErrorMessage(error);
  const relatedProperty =
    error.keyword === "required"
      ? (error.params as { missingProperty?: string }).missingProperty
      : error.keyword === "additionalProperties"
        ? (error.params as { additionalProperty?: string }).additionalProperty
        : undefined;
  return createSchemaIssue({
    keyword: error.keyword,
    path,
    relatedProperty,
    schemaPath: error.schemaPath,
    message: `${path}: ${message}`
  });
}

function buildSchemaErrorMessage(error: ErrorObject): string {
  if (error.keyword === "required") {
    const missingProperty = (error.params as { missingProperty?: string }).missingProperty;
    return missingProperty ? `missing required property '${missingProperty}'` : "missing required property";
  }

  if (error.keyword === "additionalProperties") {
    const additionalProperty = (error.params as { additionalProperty?: string }).additionalProperty;
    return additionalProperty
      ? `unexpected property '${additionalProperty}'`
      : "contains an unexpected property";
  }

  if (error.keyword === "const") {
    const allowedValue = (error.params as { allowedValue?: unknown }).allowedValue;
    return `must be ${JSON.stringify(allowedValue)}`;
  }

  if (error.keyword === "enum") {
    const allowedValues = (error.params as { allowedValues?: unknown[] }).allowedValues;
    return allowedValues ? `must be one of ${allowedValues.map(String).join(", ")}` : "must be an allowed value";
  }

  return error.message ?? `failed schema rule '${error.keyword}'`;
}

function createSchemaIssue(input: Omit<NotebookValidationIssue, "domain" | "severity">): NotebookValidationIssue {
  return createNotebookDiagnostic(input, { domain: "schema" }) as NotebookValidationIssue;
}

function createNotebookIssue(
  message: string,
  path?: string,
  severity: NotebookValidationIssue["severity"] = "error"
): NotebookValidationIssue {
  return createNotebookDiagnostic({ message, path, severity }, { domain: "notebook" }) as NotebookValidationIssue;
}

function validateCellReferences(
  cell: NotebookCell,
  context: {
    issues: NotebookValidationIssue[];
    matrixCellIds: Set<string>;
    modelCellIds: Set<string>;
    runCellIds: Set<string>;
    sectionModelIds: Set<string>;
    abmModelIds: Set<string>;
  }
): void {
  if ("sourceRunCellId" in cell && cell.sourceRunCellId && !context.runCellIds.has(cell.sourceRunCellId)) {
    context.issues.push(createNotebookIssue(`Cell '${cell.id}' references missing run cell '${cell.sourceRunCellId}'.`));
  }

  if (cell.type === "run") {
    validateRunCellReferences(cell, context);
  }

  if (cell.type === "sequence") {
    validateSequenceCellReferences(cell, context);
  }

  if (cell.type === "sankey") {
    validateSankeyCellReferences(cell, context);
  }

  if (cell.type === "diagram") {
    validateHydraulicsCellReferences(cell, context);
  }
}

function validateRunCellReferences(
  cell: RunCell,
  context: {
    issues: NotebookValidationIssue[];
    modelCellIds: Set<string>;
    runCellIds: Set<string>;
    sectionModelIds: Set<string>;
    abmModelIds: Set<string>;
  }
): void {
  if (!Number.isInteger(cell.periods) || cell.periods < 1) {
    context.issues.push(createNotebookIssue(`Run cell '${cell.id}' must define periods as an integer >= 1.`));
  }

  if (cell.baselineRunCellId && !context.runCellIds.has(cell.baselineRunCellId)) {
    context.issues.push(createNotebookIssue(`Run cell '${cell.id}' references missing baseline run '${cell.baselineRunCellId}'.`));
  }

  if (cell.sourceModelCellId && !context.modelCellIds.has(cell.sourceModelCellId)) {
    context.issues.push(createNotebookIssue(`Run cell '${cell.id}' references missing model cell '${cell.sourceModelCellId}'.`));
  }

  if (cell.engine === "abm") {
    if (!cell.sourceModelId) {
      context.issues.push(
        createNotebookIssue(`ABM run cell '${cell.id}' must set sourceModelId to an abm-model modelId.`)
      );
      return;
    }
    if (!context.abmModelIds.has(cell.sourceModelId)) {
      context.issues.push(
        createNotebookIssue(
          `ABM run cell '${cell.id}' references missing abm-model id '${cell.sourceModelId}'.`
        )
      );
    }
    return;
  }

  if (cell.sourceModelId && !context.sectionModelIds.has(cell.sourceModelId)) {
    context.issues.push(createNotebookIssue(`Run cell '${cell.id}' references missing model id '${cell.sourceModelId}'.`));
  }

  if (!cell.sourceModelCellId && !cell.sourceModelId) {
    context.issues.push(createNotebookIssue(`Run cell '${cell.id}' must reference a source model.`));
  }
}

function validateAbmModelCell(cell: AbmModelCell, issues: NotebookValidationIssue[]): void {
  if (!cell.modelId?.trim()) {
    issues.push(createNotebookIssue(`ABM model cell '${cell.id}' must define modelId.`));
  }
  if (!Array.isArray(cell.populations) || cell.populations.length < 1) {
    issues.push(createNotebookIssue(`ABM model cell '${cell.id}' needs populations.`));
  }
  if (!Array.isArray(cell.ticks) || cell.ticks.length < 1) {
    issues.push(createNotebookIssue(`ABM model cell '${cell.id}' needs ticks.`));
  }
  if (cell.state != null) {
    if (typeof cell.state !== "object" || Array.isArray(cell.state)) {
      issues.push(createNotebookIssue(`ABM model cell '${cell.id}' state must be an object.`));
    } else {
      const aggregates = (cell.state as { aggregates?: unknown }).aggregates;
      if (aggregates != null) {
        if (typeof aggregates !== "object" || Array.isArray(aggregates)) {
          issues.push(
            createNotebookIssue(`ABM model cell '${cell.id}' state.aggregates must be an object.`)
          );
        } else {
          for (const [name, value] of Object.entries(aggregates as Record<string, unknown>)) {
            if (typeof value !== "number" || !Number.isFinite(value)) {
              issues.push(
                createNotebookIssue(
                  `ABM model cell '${cell.id}' state.aggregates '${name}' must be a finite number.`
                )
              );
            }
          }
        }
      }
    }
  }
}

function validateSequenceCellReferences(
  cell: SequenceCell,
  context: {
    issues: NotebookValidationIssue[];
    matrixCellIds: Set<string>;
    modelCellIds: Set<string>;
    sectionModelIds: Set<string>;
  }
): void {
  if (cell.source.kind === "matrix" && !context.matrixCellIds.has(cell.source.matrixCellId)) {
    context.issues.push(createNotebookIssue(`Sequence cell '${cell.id}' references missing matrix '${cell.source.matrixCellId}'.`));
  }

  if (cell.source.kind !== "dependency" && cell.source.kind !== "cld") {
    return;
  }

  if (cell.source.sourceModelCellId && !context.modelCellIds.has(cell.source.sourceModelCellId)) {
    context.issues.push(createNotebookIssue(`Sequence cell '${cell.id}' references missing model cell '${cell.source.sourceModelCellId}'.`));
  }

  const modelId = cell.source.modelId ?? cell.source.sourceModelId;
  if (modelId && !context.sectionModelIds.has(modelId)) {
    context.issues.push(createNotebookIssue(`Sequence cell '${cell.id}' references missing model id '${modelId}'.`));
  }
}

function validateSankeyCellReferences(
  cell: SankeyCell,
  context: {
    issues: NotebookValidationIssue[];
    matrixCellIds: Set<string>;
  }
): void {
  if (cell.source.kind === "matrix" && !context.matrixCellIds.has(cell.source.matrixCellId)) {
    context.issues.push(
      createNotebookIssue(`Sankey cell '${cell.id}' references missing matrix '${cell.source.matrixCellId}'.`)
    );
  }
}

function validateHydraulicsCellReferences(
  cell: HydraulicsCell,
  context: {
    issues: NotebookValidationIssue[];
    matrixCellIds: Set<string>;
    runCellIds: Set<string>;
  }
): void {
  if (!context.matrixCellIds.has(cell.source.transactionMatrixCellId)) {
    context.issues.push(
      createNotebookIssue(
        `Stock-flow diagram cell '${cell.id}' references missing matrix '${cell.source.transactionMatrixCellId}'.`
      )
    );
  }
  if (cell.source.balanceMatrixCellId && !context.matrixCellIds.has(cell.source.balanceMatrixCellId)) {
    context.issues.push(
      createNotebookIssue(
        `Stock-flow diagram cell '${cell.id}' references missing matrix '${cell.source.balanceMatrixCellId}'.`
      )
    );
  }
  if (cell.source.sourceRunCellId && !context.runCellIds.has(cell.source.sourceRunCellId)) {
    context.issues.push(
      createNotebookIssue(`Stock-flow diagram cell '${cell.id}' references missing run cell '${cell.source.sourceRunCellId}'.`)
    );
  }
}

function validateChartCell(cell: ChartCell, issues: NotebookValidationIssue[]): void {
  if (!cell.axisGroups || cell.axisGroups.length === 0) {
    return;
  }

  const knownNames = new Set<string>();
  for (const name of cell.variables ?? []) {
    knownNames.add(name.trim());
  }
  for (const spec of cell.series ?? []) {
    knownNames.add(spec.expression.trim());
    if (spec.label) {
      knownNames.add(spec.label.trim());
    }
  }

  const seen = new Set<string>();
  for (const group of cell.axisGroups) {
    for (const member of group) {
      const trimmed = member.trim();
      if (trimmed === "") {
        continue;
      }
      if (knownNames.size > 0 && !knownNames.has(trimmed)) {
        issues.push(
          createNotebookIssue(
            `Chart cell '${cell.id}' axisGroups references '${trimmed}', which is not one of its variables or series.`,
            undefined,
            "warning"
          )
        );
      }
      if (seen.has(trimmed)) {
        issues.push(
          createNotebookIssue(
            `Chart cell '${cell.id}' axisGroups lists '${trimmed}' in more than one group.`,
            undefined,
            "warning"
          )
        );
      }
      seen.add(trimmed);
    }
  }
}

function validateMatrixCell(cell: MatrixCell, issues: NotebookValidationIssue[]): void {
  cell.rows.forEach((row, index) => {
    if (row.values.length !== cell.columns.length) {
      issues.push(createNotebookIssue(`Matrix cell '${cell.id}' row ${index + 1} has ${row.values.length} values for ${cell.columns.length} columns.`));
    }
  });

  const accountLayoutIssue = validateMatrixAccountColumnsLayout(
    cell.columns,
    cell.sectors,
    cell.columnBadges,
    cell.variables
  );
  if (accountLayoutIssue) {
    issues.push(createNotebookIssue(`Matrix cell '${cell.id}' ${accountLayoutIssue}`));
  }

  if (cell.columnTree && cell.columnTree.length > 0 && !cell.columnBadges?.length) {
    const treeIssue = validateMatrixColumnTreeMatchesColumns(cell.columnTree, cell.columns);
    if (treeIssue) {
      issues.push(createNotebookIssue(`Matrix cell '${cell.id}' ${treeIssue}`));
    }
  }

  validateMatrixBalanceChecks(cell, issues);
}

function validateMatrixBalanceChecks(cell: MatrixCell, issues: NotebookValidationIssue[]): void {
  const matrixKind = resolveAccountingMatrixKind(cell);
  if (!matrixKind) {
    return;
  }

  const hasSumColumn = cell.columns.some((column) => isSumLabel(column));
  const hasSumRow = cell.rows.some((row) => isSumLabel(row.label));

  if (
    (matrixKind === "transaction-flow" ||
      matrixKind === "balance-sheet" ||
      matrixKind === "account-transactions") &&
    !hasSumColumn
  ) {
    issues.push(
      createNotebookIssue(
        `Matrix cell '${cell.id}' should include a 'Sum' column so row balances are visible.`,
        undefined,
        "warning"
      )
    );
  }

  if ((matrixKind === "transaction-flow" || matrixKind === "account-transactions") && !hasSumRow) {
    issues.push(
      createNotebookIssue(
        `Matrix cell '${cell.id}' should include a 'Sum' row so column balances are visible.`,
        undefined,
        "warning"
      )
    );
  }
}

function isSumLabel(value: string): boolean {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ") === "sum";
}

function validateModelSectionNames(
  cells: NotebookCell[],
  issues: NotebookValidationIssue[]
): void {
  const namesByModelAndKind = new Map<string, Map<string, Set<string>>>();

  for (const cell of cells) {
    if (
      cell.type !== "equations" &&
      cell.type !== "externals" &&
      cell.type !== "observed" &&
      cell.type !== "initial-values" &&
      cell.type !== "model"
    ) {
      continue;
    }

    if (cell.type === "model") {
      validateNamesForKind(cell.id, "equations", cell.editor.equations, namesByModelAndKind, issues);
      validateNamesForKind(cell.id, "externals", cell.editor.externals, namesByModelAndKind, issues);
      validateNamesForKind(
        cell.id,
        "initial-values",
        cell.editor.initialValues,
        namesByModelAndKind,
        issues
      );
      continue;
    }

    const entries =
      cell.type === "equations"
        ? cell.equations
        : cell.type === "externals" || cell.type === "observed"
          ? cell.externals
          : cell.initialValues;
    // Observed rows share the externals namespace so collisions across the two
    // sections (and against externals) are reported.
    const kind = cell.type === "observed" ? "externals" : cell.type;
    validateNamesForKind(cell.modelId, kind, entries, namesByModelAndKind, issues);
  }
}

function validateNamesForKind(
  modelId: string,
  kind: string,
  entries: unknown[],
  namesByModelAndKind: Map<string, Map<string, Set<string>>>,
  issues: NotebookValidationIssue[]
): void {
  const namesByKind = namesByModelAndKind.get(modelId) ?? new Map<string, Set<string>>();
  const seen = namesByKind.get(kind) ?? new Set<string>();

  for (const entry of entries) {
    if (isRowComment(entry)) {
      continue;
    }
    const name =
      isRecord(entry) && typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      continue;
    }
    if (seen.has(name)) {
      issues.push(createNotebookIssue(`Model '${modelId}' has duplicate ${kind} variable '${name}'.`));
    }
    seen.add(name);
  }

  namesByKind.set(kind, seen);
  namesByModelAndKind.set(modelId, namesByKind);
}
