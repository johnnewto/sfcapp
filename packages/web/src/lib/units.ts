import {
  derivativeBalanceStockName,
  isAccumulationEquation,
  isDerivativeBalanceTarget,
  isIdentityLike,
  parseEquation,
  parseExpression,
  type Expr
} from "@sfcr/core";
import { isRowComment, type EquationListItem, type ExternalListItem } from "@sfcr/notebook-core";

import type { EquationRow, ExternalRow } from "./editorModel";
import {
  coerceUnitMeta,
  divideSignatures,
  formatSignature,
  formatUnitTextForVariableName,
  multiplySignatures,
  normalizeSignature,
  signaturesEqual,
  type StockFlowKind,
  type UnitMeta,
  type UnitSignature,
  type VariableUnitMetadata
} from "./unitMeta";

export interface UnitDiagnostic {
  message: string;
  severity: "error" | "warning";
}

/** Unit consistency checks are advisory; they must not block notebook apply. */
const UNIT_CHECK_SEVERITY: UnitDiagnostic["severity"] = "warning";

export interface InferredUnit {
  diagnostics: UnitDiagnostic[];
  signature: UnitSignature | null;
}

const DIMENSIONLESS: UnitSignature = {};
const TIME_STEP: UnitSignature = { time: 1 };
const DT_VARIABLE = "dt";

export function buildVariableUnitMetadata(args: {
  equations?: readonly (EquationRow | EquationListItem)[];
  externals?: readonly (ExternalRow | ExternalListItem)[];
}): VariableUnitMetadata {
  const metadata: VariableUnitMetadata = new Map();

  for (const equation of args.equations ?? []) {
    if (isRowComment(equation)) {
      continue;
    }
    setVariableUnitMeta(metadata, equation.name, equation.unitMeta);
    const stockName = derivativeBalanceStockName(equation.name);
    if (stockName && stockName !== equation.name.trim()) {
      setVariableUnitMeta(metadata, stockName, equation.unitMeta);
    }
  }

  for (const external of args.externals ?? []) {
    if (isRowComment(external)) {
      continue;
    }
    setVariableUnitMeta(metadata, external.name, external.unitMeta);
  }

  return metadata;
}

function getVariableUnitMeta(
  metadata: VariableUnitMetadata,
  variableName: string
): UnitMeta | undefined {
  return metadata.get(variableName.trim());
}

export { formatUnitTextForVariableName } from "./unitMeta";

export function getVariableUnitLabel(
  metadata: VariableUnitMetadata,
  variableName: string
): string | null {
  return formatUnitTextForVariableName(
    variableName,
    getVariableUnitMeta(metadata, variableName)
  );
}

export function getVariableUnitText(
  metadata: VariableUnitMetadata,
  variableName: string
): string | null {
  return formatUnitTextForVariableName(
    variableName,
    getVariableUnitMeta(metadata, variableName)
  );
}

export function getEquationRowUnitLabel(
  equationName: string,
  unitMeta?: UnitMeta
): string | null {
  return formatUnitTextForVariableName(equationName, unitMeta);
}

export interface SuggestedEquationUnitMeta {
  signature: UnitSignature;
  stockFlow?: StockFlowKind;
}

export function suggestEquationUnitMeta(args: {
  variableName: string;
  expression: string;
  variableUnitMetadata: VariableUnitMetadata;
}): SuggestedEquationUnitMeta | null {
  const expression = args.expression.trim();
  if (!expression) {
    return null;
  }

  try {
    const parsed = parseEquation(args.variableName, expression);
    if (isDerivativeBalanceTarget(args.variableName)) {
      const stockName = derivativeBalanceStockName(args.variableName);
      const stockMeta = stockName
        ? coerceUnitMeta(args.variableUnitMetadata.get(stockName))
        : undefined;
      if (stockMeta?.signature) {
        return {
          signature: normalizeSignature(stockMeta.signature),
          stockFlow: "stock"
        };
      }

      const inferred = inferUnits(parseExpression(expression), args.variableUnitMetadata);
      const flowSignature = inferred.signature ? normalizeSignature(inferred.signature) : null;
      if (!flowSignature || Object.keys(flowSignature).length === 0) {
        return null;
      }

      return {
        signature: multiplySignatures(flowSignature, TIME_STEP),
        stockFlow: "stock"
      };
    }

    const inferred = inferUnits(parsed.sourceExpression, args.variableUnitMetadata);
    const signature = inferred.signature ? normalizeSignature(inferred.signature) : null;
    if (!signature || Object.keys(signature).length === 0) {
      return null;
    }

    return {
      signature,
      ...(isAccumulationEquation(parsed) ? { stockFlow: "stock" as const } : {})
    };
  } catch {
    return null;
  }
}

function collectIdentityLikeOperandNames(expr: Expr): string[] {
  const names = new Set<string>();

  function walk(node: Expr): void {
    switch (node.type) {
      case "Variable":
        if (node.name !== DT_VARIABLE) {
          names.add(node.name);
        }
        break;
      case "Lag":
      case "Diff":
        if (node.name !== DT_VARIABLE) {
          names.add(node.name);
        }
        break;
      case "Unary":
        walk(node.expr);
        break;
      case "Binary":
        if (node.op === "+" || node.op === "-") {
          walk(node.left);
          walk(node.right);
        }
        break;
    }
  }

  walk(expr);
  return [...names];
}

function hasMirrorableUnitSignature(
  unitMeta: UnitMeta | undefined
): unitMeta is UnitMeta & { signature: UnitSignature } {
  const normalized = coerceUnitMeta(unitMeta);
  if (!normalized?.signature) {
    return false;
  }
  return Object.keys(normalizeSignature(normalized.signature)).length > 0;
}

function resolveAgreeingStockFlow(metas: UnitMeta[]): StockFlowKind | undefined {
  const stockFlows = metas
    .map((meta) => meta.stockFlow)
    .filter((stockFlow): stockFlow is StockFlowKind => stockFlow != null);
  if (stockFlows.length === 0) {
    return undefined;
  }

  const first = stockFlows[0]!;
  return stockFlows.every((stockFlow) => stockFlow === first) ? first : undefined;
}

function unitMetaMatchesSuggestion(
  current: UnitMeta | undefined,
  proposed: SuggestedEquationUnitMeta
): boolean {
  const normalizedCurrent = coerceUnitMeta(current);
  if (!normalizedCurrent?.signature || !proposed.signature) {
    return false;
  }
  if (!signaturesEqual(normalizedCurrent.signature, proposed.signature)) {
    return false;
  }
  if (normalizedCurrent.stockFlow && proposed.stockFlow) {
    return normalizedCurrent.stockFlow === proposed.stockFlow;
  }

  return true;
}

export function suggestMirroredAdditiveUnitMeta(args: {
  variableName: string;
  expression: string;
  variableUnitMetadata: VariableUnitMetadata;
}): SuggestedEquationUnitMeta | null {
  const expression = args.expression.trim();
  const variableName = args.variableName.trim();
  if (!expression || !variableName) {
    return null;
  }

  if (isDerivativeBalanceTarget(variableName)) {
    return null;
  }

  try {
    const parsed = parseEquation(variableName, expression);
    if (isAccumulationEquation(parsed)) {
      return null;
    }
    if (!isIdentityLike(parsed.sourceExpression)) {
      return null;
    }

    const taggedOperands = collectIdentityLikeOperandNames(parsed.sourceExpression)
      .filter((name) => name !== variableName)
      .map((name) => coerceUnitMeta(args.variableUnitMetadata.get(name)))
      .filter(hasMirrorableUnitSignature);

    if (taggedOperands.length === 0) {
      return null;
    }

    const signature = normalizeSignature(taggedOperands[0]!.signature);
    for (const meta of taggedOperands.slice(1)) {
      if (!signaturesEqual(signature, normalizeSignature(meta.signature!))) {
        return null;
      }
    }

    const stockFlow = resolveAgreeingStockFlow(taggedOperands);
    const definedStockFlows = taggedOperands
      .map((meta) => meta.stockFlow)
      .filter((value): value is StockFlowKind => value != null);
    if (definedStockFlows.length > 0 && !stockFlow) {
      return null;
    }

    return {
      signature,
      ...(stockFlow ? { stockFlow } : {})
    };
  } catch {
    return null;
  }
}

interface MirroredAdditiveUnitTargets {
  proposed: SuggestedEquationUnitMeta;
  operandNames: string[];
  untaggedOperandNames: string[];
}

function collectMirroredAdditiveUnitTargets(args: {
  variableName: string;
  expression: string;
  variableUnitMetadata: VariableUnitMetadata;
}): MirroredAdditiveUnitTargets | null {
  const proposed = suggestMirroredAdditiveUnitMeta(args);
  if (!proposed?.signature) {
    return null;
  }

  try {
    const parsed = parseEquation(args.variableName.trim(), args.expression.trim());
    const operandNames = collectIdentityLikeOperandNames(parsed.sourceExpression).filter(
      (name) => name !== args.variableName.trim()
    );
    const untaggedOperandNames = operandNames.filter((name) => {
      const current = coerceUnitMeta(args.variableUnitMetadata.get(name));
      return !unitMetaMatchesSuggestion(current, proposed);
    });

    return {
      proposed,
      operandNames,
      untaggedOperandNames
    };
  } catch {
    return null;
  }
}

function resolveMirroredUnitChangeExpression(
  equation: EquationListItem,
  sourceEquation: EquationListItem
): string {
  if (isRowComment(equation) || isRowComment(sourceEquation)) {
    return "";
  }

  if (equation.id === sourceEquation.id) {
    return equation.expression.trim();
  }

  return `${sourceEquation.name.trim()} = ${sourceEquation.expression.trim()}`;
}

function queueMirroredUnitUpdate(args: {
  changes: Map<string, MirroredEquationUnitChange>;
  equation: EquationListItem;
  initialEquations: readonly EquationListItem[];
  pending: Map<string, UnitMeta>;
  proposed: SuggestedEquationUnitMeta;
  sourceEquation: EquationListItem;
}): boolean {
  if (isRowComment(args.equation)) {
    return false;
  }
  if (unitMetaMatchesSuggestion(args.equation.unitMeta, args.proposed)) {
    return false;
  }

  const pendingMeta = args.proposed as UnitMeta;
  const existingPending = args.pending.get(args.equation.id);
  if (existingPending && !unitMetaMatchesSuggestion(existingPending, args.proposed)) {
    return false;
  }

  args.pending.set(args.equation.id, pendingMeta);
  if (!args.changes.has(args.equation.id)) {
    const original = args.initialEquations.find((entry) => entry.id === args.equation.id);
    args.changes.set(args.equation.id, {
      variable: args.equation.name.trim(),
      expression: resolveMirroredUnitChangeExpression(args.equation, args.sourceEquation),
      previous: original && !isRowComment(original) ? original.unitMeta : undefined,
      proposed: pendingMeta
    });
  } else {
    args.changes.get(args.equation.id)!.proposed = pendingMeta;
  }

  return true;
}

export interface MirroredEquationUnitChange {
  variable: string;
  expression: string;
  previous?: UnitMeta;
  proposed: UnitMeta;
}

export interface MirroredEquationUnitApplyResult {
  equations: EquationListItem[];
  changes: MirroredEquationUnitChange[];
}

export function applyMirroredEquationUnitSuggestions(args: {
  equations: EquationListItem[];
  variableUnitMetadata: VariableUnitMetadata;
}): MirroredEquationUnitApplyResult {
  const initialEquations = args.equations;
  const changes = new Map<string, MirroredEquationUnitChange>();
  let current = args.equations;
  let metadata = args.variableUnitMetadata;
  let anyChanged = false;

  while (true) {
    const pending = new Map<string, UnitMeta>();
    let passChanged = false;

    for (const equation of current) {
      if (isRowComment(equation)) {
        continue;
      }

      const targets = collectMirroredAdditiveUnitTargets({
        variableName: equation.name,
        expression: equation.expression,
        variableUnitMetadata: metadata
      });
      if (!targets) {
        continue;
      }

      if (
        queueMirroredUnitUpdate({
          changes,
          equation,
          initialEquations,
          pending,
          proposed: targets.proposed,
          sourceEquation: equation
        })
      ) {
        passChanged = true;
      }

      for (const operandName of targets.untaggedOperandNames) {
        const operandEquation = current.find(
          (entry) => !isRowComment(entry) && entry.name.trim() === operandName
        );
        if (!operandEquation || isRowComment(operandEquation)) {
          continue;
        }

        if (
          queueMirroredUnitUpdate({
            changes,
            equation: operandEquation,
            initialEquations,
            pending,
            proposed: targets.proposed,
            sourceEquation: equation
          })
        ) {
          passChanged = true;
        }
      }
    }

    if (!passChanged) {
      return {
        equations: anyChanged ? current : args.equations,
        changes: [...changes.values()].sort((left, right) => left.variable.localeCompare(right.variable))
      };
    }

    anyChanged = true;
    current = current.map((equation) =>
      pending.has(equation.id) ? { ...equation, unitMeta: pending.get(equation.id) } : equation
    );
    metadata = buildVariableUnitMetadata({ equations: current });
  }
}

export type VariableUnitStatusKind = "ok" | "untagged" | "warning" | "error";

export interface VariableUnitStatusRow {
  variable: string;
  source: "equation" | "external";
  rowId: string;
  expression?: string;
  declared?: UnitMeta;
  declaredLabel: string | null;
  inferredLabel: string | null;
  diagnostics: UnitDiagnostic[];
  suggestion: SuggestedEquationUnitMeta | null;
  status: VariableUnitStatusKind;
}

function hasDeclaredUnitSignature(unitMeta?: UnitMeta): boolean {
  const normalized = coerceUnitMeta(unitMeta);
  if (!normalized?.signature) {
    return false;
  }
  return Object.keys(normalizeSignature(normalized.signature)).length > 0;
}

function resolveVariableUnitStatusKind(
  diagnostics: UnitDiagnostic[],
  hasDeclaredSignature: boolean
): VariableUnitStatusKind {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "error";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "warning";
  }
  if (!hasDeclaredSignature) {
    return "untagged";
  }
  return "ok";
}

export function buildVariableUnitStatusReport(args: {
  equations?: readonly (EquationRow | EquationListItem)[];
  externals?: readonly (ExternalRow | ExternalListItem)[];
  variableUnitMetadata?: VariableUnitMetadata;
}): VariableUnitStatusRow[] {
  const variableUnits =
    args.variableUnitMetadata ?? buildVariableUnitMetadata(args);
  const rows: VariableUnitStatusRow[] = [];

  for (const equation of args.equations ?? []) {
    if (isRowComment(equation)) {
      continue;
    }

    const name = equation.name.trim();
    if (!name) {
      continue;
    }

    const expression = equation.expression.trim();
    const declared = coerceUnitMeta(equation.unitMeta);
    const declaredLabel = getEquationRowUnitLabel(name, declared);
    let diagnostics: UnitDiagnostic[] = [];
    let inferredLabel: string | null = null;
    let suggestion: SuggestedEquationUnitMeta | null = null;

    if (expression) {
      try {
        const parsed = parseEquation(name, expression);
        diagnostics = diagnoseEquationUnits(name, parsed.sourceExpression, variableUnits);
        const inferred = inferUnits(parsed.sourceExpression, variableUnits);
        if (inferred.signature != null) {
          inferredLabel = formatSignature(inferred.signature);
        }
      } catch {
        // Parse errors are surfaced by validateEditorState, not this report.
      }

      suggestion = suggestEquationUnitMeta({
        variableName: name,
        expression,
        variableUnitMetadata: variableUnits
      });
    }

    rows.push({
      variable: name,
      source: "equation",
      rowId: equation.id,
      expression,
      declared,
      declaredLabel,
      inferredLabel,
      diagnostics,
      suggestion,
      status: resolveVariableUnitStatusKind(
        diagnostics,
        hasDeclaredUnitSignature(declared)
      )
    });
  }

  for (const external of args.externals ?? []) {
    if (isRowComment(external)) {
      continue;
    }

    const name = external.name.trim();
    if (!name) {
      continue;
    }

    const declared = coerceUnitMeta(external.unitMeta);
    rows.push({
      variable: name,
      source: "external",
      rowId: external.id,
      declared,
      declaredLabel: formatUnitTextForVariableName(name, declared),
      inferredLabel: null,
      diagnostics: [],
      suggestion: null,
      status: hasDeclaredUnitSignature(declared) ? "ok" : "untagged"
    });
  }

  return rows.sort((left, right) => left.variable.localeCompare(right.variable));
}

export function applyVariableUnitMetaPatch(args: {
  equations: EquationListItem[];
  externals: ExternalListItem[];
  source: "equation" | "external";
  rowId: string;
  unitMeta: UnitMeta | undefined;
}): { equations: EquationListItem[]; externals: ExternalListItem[] } {
  if (args.source === "equation") {
    return {
      equations: args.equations.map((equation) =>
        equation.id === args.rowId ? { ...equation, unitMeta: args.unitMeta } : equation
      ),
      externals: args.externals
    };
  }

  return {
    equations: args.equations,
    externals: args.externals.map((external) =>
      external.id === args.rowId ? { ...external, unitMeta: args.unitMeta } : external
    )
  };
}

export function diagnoseEquationUnits(
  equationName: string,
  expression: Expr,
  variableUnits: VariableUnitMetadata
): UnitDiagnostic[] {
  if (isDerivativeBalanceTarget(equationName)) {
    const stockName = derivativeBalanceStockName(equationName);
    if (stockName) {
      return diagnoseDerivativeBalanceEquation(
        equationName,
        stockName,
        expression,
        variableUnits
      );
    }
  }

  const leftMeta = coerceUnitMeta(variableUnits.get(equationName.trim()));
  const integralDiagnostics = leftMeta
    ? diagnoseIntegralEquation(equationName, expression, leftMeta, variableUnits)
    : null;
  if (integralDiagnostics !== null) {
    return integralDiagnostics;
  }

  const stockAccumulationDiagnostics = leftMeta
    ? diagnoseStockAccumulation(equationName, expression, leftMeta, variableUnits)
    : null;
  if (stockAccumulationDiagnostics !== null) {
    return stockAccumulationDiagnostics;
  }

  const rhs = inferUnits(expression, variableUnits);
  const diagnostics = [...rhs.diagnostics];

  if (!leftMeta?.signature) {
    return diagnostics;
  }

  if (rhs.signature != null && !signaturesEqual(leftMeta.signature, rhs.signature)) {
    diagnostics.push({
      severity: UNIT_CHECK_SEVERITY,
      message: `Equation '${equationName}' has units ${formatSignature(leftMeta.signature)} but its RHS infers ${formatSignature(rhs.signature)}.`
    });
  }

  return diagnostics;
}

export function inferUnits(expr: Expr, variableUnits: VariableUnitMetadata): InferredUnit {
  switch (expr.type) {
    case "Number":
      return known(DIMENSIONLESS);
    case "Variable":
      if (expr.name === DT_VARIABLE) {
        return known(TIME_STEP);
      }
      if (expr.name.includes(".")) {
        return inferMatrixColumnSumUnits(variableUnits);
      }
      return fromMeta(variableUnits.get(expr.name));
    case "Lag":
      if (expr.name === DT_VARIABLE) {
        return known(TIME_STEP);
      }
      return fromMeta(variableUnits.get(expr.name));
    case "Diff": {
      if (expr.name === DT_VARIABLE) {
        return known(DIMENSIONLESS);
      }
      const meta = variableUnits.get(expr.name);
      if (!meta?.signature) {
        return unknown();
      }
      return known(divideSignatures(meta.signature, TIME_STEP));
    }
    case "Integral": {
      const inner = inferUnits(expr.expr, variableUnits);
      if (inner.signature == null) {
        return inner;
      }
      return {
        signature: multiplySignatures(inner.signature, TIME_STEP),
        diagnostics: inner.diagnostics
      };
    }
    case "Unary": {
      const inner = inferUnits(expr.expr, variableUnits);
      return { signature: inner.signature, diagnostics: inner.diagnostics };
    }
    case "If":
      return inferIfUnits(expr, variableUnits);
    case "Function":
      return inferFunctionUnits(expr, variableUnits);
    case "MatrixColumnSum":
      return inferMatrixColumnSumUnits(variableUnits);
    case "Binary":
      return inferBinaryUnits(expr, variableUnits);
  }
}

function inferMatrixColumnSumUnits(variableUnits: VariableUnitMetadata): InferredUnit {
  for (const meta of variableUnits.values()) {
    if (meta.stockFlow === "flow" && meta.signature) {
      return known(meta.signature);
    }
  }
  return unknown();
}

function inferIfUnits(
  expr: Extract<Expr, { type: "If" }>,
  variableUnits: VariableUnitMetadata
): InferredUnit {
  const whenTrue = inferUnits(expr.whenTrue, variableUnits);
  const whenFalse = inferUnits(expr.whenFalse, variableUnits);
  const diagnostics = mergeDiagnostics(whenTrue, whenFalse);

  if (whenTrue.signature == null || whenFalse.signature == null) {
    return { signature: null, diagnostics };
  }
  if (!signaturesEqual(whenTrue.signature, whenFalse.signature)) {
    diagnostics.push({
      severity: UNIT_CHECK_SEVERITY,
      message: `Conditional branches must use matching units, got ${formatSignature(whenTrue.signature)} and ${formatSignature(whenFalse.signature)}.`
    });
    return { signature: null, diagnostics };
  }

  return { signature: whenTrue.signature, diagnostics };
}

function inferFunctionUnits(
  expr: Extract<Expr, { type: "Function" }>,
  variableUnits: VariableUnitMetadata
): InferredUnit {
  switch (expr.name) {
    case "min":
    case "max": {
      const left = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      const right = inferUnits(expr.args[1] ?? { type: "Number", value: 0 }, variableUnits);
      const diagnostics = mergeDiagnostics(left, right);

      if (left.signature == null || right.signature == null) {
        return { signature: null, diagnostics };
      }
      if (!signaturesEqual(left.signature, right.signature)) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: `${expr.name}() arguments must use matching units, got ${formatSignature(left.signature)} and ${formatSignature(right.signature)}.`
        });
        return { signature: null, diagnostics };
      }

      return { signature: left.signature, diagnostics };
    }
    case "abs": {
      const argument = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      return argument;
    }
    case "floor": {
      const argument = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      return argument;
    }
    case "runif": {
      const lo = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      const hi = inferUnits(expr.args[1] ?? { type: "Number", value: 0 }, variableUnits);
      const diagnostics = mergeDiagnostics(lo, hi);
      if (lo.signature == null || hi.signature == null) {
        return { signature: null, diagnostics };
      }
      if (!signaturesEqual(lo.signature, hi.signature)) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: `runif() bounds must use matching units, got ${formatSignature(lo.signature)} and ${formatSignature(hi.signature)}.`
        });
        return { signature: null, diagnostics };
      }
      return { signature: lo.signature, diagnostics };
    }
    case "log":
    case "exp": {
      const argument = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      const diagnostics = [...argument.diagnostics];

      if (argument.signature != null && !signaturesEqual(argument.signature, DIMENSIONLESS)) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: `${expr.name}() requires a dimensionless argument.`
        });
      }

      return { signature: DIMENSIONLESS, diagnostics };
    }
    case "sqrt": {
      const argument = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      const diagnostics = [...argument.diagnostics];

      if (argument.signature == null) {
        return { signature: null, diagnostics };
      }

      const sqrtSignature = normalizeSignature({
        money: (argument.signature.money ?? 0) / 2,
        items: (argument.signature.items ?? 0) / 2,
        mass: (argument.signature.mass ?? 0) / 2,
        energy: (argument.signature.energy ?? 0) / 2,
        pp: (argument.signature.pp ?? 0) / 2,
        carbon: (argument.signature.carbon ?? 0) / 2,
        time: (argument.signature.time ?? 0) / 2
      });

      return { signature: sqrtSignature, diagnostics };
    }
    case "pow": {
      const base = inferUnits(expr.args[0] ?? { type: "Number", value: 0 }, variableUnits);
      const exponent = inferUnits(expr.args[1] ?? { type: "Number", value: 0 }, variableUnits);
      const diagnostics = mergeDiagnostics(base, exponent);

      if (exponent.signature != null && !signaturesEqual(exponent.signature, DIMENSIONLESS)) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: "pow() exponent must be dimensionless."
        });
      }
      if (base.signature != null && !signaturesEqual(base.signature, DIMENSIONLESS)) {
        diagnostics.push({
          severity: "warning",
          message: "pow() of non-dimensionless quantities is not fully supported."
        });
      }

      return { signature: base.signature, diagnostics };
    }
  }
}

function isDimensionlessSignature(signature?: UnitSignature): boolean {
  return Object.keys(normalizeSignature(signature)).length === 0;
}

function isInverseTimeOnlySignature(signature?: UnitSignature): boolean {
  const normalized = normalizeSignature(signature);
  return (
    (normalized.time ?? 0) === -1 &&
    normalized.money == null &&
    normalized.items == null &&
    normalized.mass == null &&
    normalized.energy == null &&
    normalized.pp == null &&
    normalized.carbon == null
  );
}

function resolveAdditiveUnitSignature(
  left: UnitSignature,
  right: UnitSignature
): UnitSignature | null {
  if (signaturesEqual(left, right)) {
    return left;
  }

  if (
    (isDimensionlessSignature(left) && isInverseTimeOnlySignature(right)) ||
    (isInverseTimeOnlySignature(left) && isDimensionlessSignature(right))
  ) {
    return DIMENSIONLESS;
  }

  return null;
}

function inferBinaryUnits(
  expr: Extract<Expr, { type: "Binary" }>,
  variableUnits: VariableUnitMetadata
): InferredUnit {
  const stockDifferenceSignature = inferStockDifferenceSignature(expr, variableUnits);
  if (stockDifferenceSignature) {
    return known(stockDifferenceSignature);
  }

  const left = inferUnits(expr.left, variableUnits);
  const right = inferUnits(expr.right, variableUnits);
  const diagnostics = mergeDiagnostics(left, right);

  switch (expr.op) {
    case "+":
    case "-":
      if (left.signature == null || right.signature == null) {
        return { signature: null, diagnostics };
      }
      const additiveSignature = resolveAdditiveUnitSignature(left.signature, right.signature);
      if (additiveSignature == null) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: `Cannot combine ${formatSignature(left.signature)} with ${formatSignature(right.signature)} using '${expr.op}'.`
        });
        return { signature: null, diagnostics };
      }
      return { signature: additiveSignature, diagnostics };
    case "*":
      if (left.signature == null || right.signature == null) {
        return { signature: null, diagnostics };
      }
      return { signature: multiplySignatures(left.signature, right.signature), diagnostics };
    case "/":
      if (left.signature == null || right.signature == null) {
        return { signature: null, diagnostics };
      }
      return { signature: divideSignatures(left.signature, right.signature), diagnostics };
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==":
    case "!=":
      if (
        left.signature != null &&
        right.signature != null &&
        !signaturesEqual(left.signature, right.signature)
      ) {
        diagnostics.push({
          severity: UNIT_CHECK_SEVERITY,
          message: `Comparison requires matching units, got ${formatSignature(left.signature)} and ${formatSignature(right.signature)}.`
        });
      }
      return { signature: DIMENSIONLESS, diagnostics };
    case "&&":
    case "||":
      return { signature: DIMENSIONLESS, diagnostics };
  }
}

function diagnoseStockAccumulation(
  equationName: string,
  expression: Expr,
  leftMeta: UnitMeta,
  variableUnits: VariableUnitMetadata
): UnitDiagnostic[] | null {
  if (leftMeta.stockFlow !== "stock" || !leftMeta.signature) {
    return null;
  }

  const incrementExpr = extractLagAnchorRemainder(expression, equationName.trim());
  if (!incrementExpr) {
    return null;
  }

  const hasExplicitDt = containsDtVariable(incrementExpr);
  const incrementSignature = hasExplicitDt
    ? leftMeta.signature
    : divideSignatures(leftMeta.signature, TIME_STEP);
  const inferred = inferUnits(incrementExpr, variableUnits);
  const diagnostics: UnitDiagnostic[] = [...inferred.diagnostics];

  if (inferred.signature == null) {
    return diagnostics;
  }

  if (!signaturesEqual(inferred.signature, incrementSignature)) {
    diagnostics.push({
      severity: UNIT_CHECK_SEVERITY,
      message: `Stock '${equationName}' can only combine lag(${equationName}) with increments of ${formatSignature(incrementSignature)}.`
    });
    return diagnostics;
  }

  if (containsStockDifferenceLike(incrementExpr, variableUnits)) {
    diagnostics.push({
      severity: "warning",
      message: `Prefer d(name) instead of stock differences like '${renderExpr(incrementExpr)}' for clearer stock-change notation.`
    });
  }

  if (containsExplicitDiff(incrementExpr) && !hasExplicitDt) {
    diagnostics.push({
      severity: "warning",
      message: `Stock '${equationName}' uses d(name) as a per-year stock-change term. Prefer adding '* dt' explicitly, e.g. lag(${equationName}) + d(name) * dt.`
    });
  } else if (!hasExplicitDt) {
    diagnostics.push({
      severity: "warning",
      message: `Stock '${equationName}' assumes an implicit dt = 1 when adding increment terms.`
    });
  }
  return diagnostics;
}

function diagnoseDerivativeBalanceEquation(
  equationName: string,
  stockName: string,
  expression: Expr,
  variableUnits: VariableUnitMetadata
): UnitDiagnostic[] {
  const leftMeta = coerceUnitMeta(
    variableUnits.get(stockName) ?? variableUnits.get(equationName.trim())
  );
  if (!leftMeta) {
    const rhs = inferUnits(expression, variableUnits);
    return [...rhs.diagnostics];
  }

  // parseEquation rewrites d(stock) = flowExpr to stock = I(flowExpr) in sourceExpression.
  if (expression.type === "Integral") {
    return diagnoseIntegralEquation(stockName, expression, leftMeta, variableUnits) ?? [];
  }

  const diagnostics: UnitDiagnostic[] = [];

  if (!leftMeta.signature) {
    const rhs = inferUnits(expression, variableUnits);
    return [...rhs.diagnostics];
  }

  if (leftMeta.stockFlow !== "stock") {
    diagnostics.push({
      severity: "error",
      message: `Derivative-balance equation '${equationName}' should define a stock, but '${stockName}' is not marked as a stock.`
    });
    return diagnostics;
  }

  const inner = inferUnits(expression, variableUnits);
  diagnostics.push(...inner.diagnostics);
  if (inner.signature == null) {
    return diagnostics;
  }

  const expectedInner = divideSignatures(leftMeta.signature, TIME_STEP);
  if (!signaturesEqual(inner.signature, expectedInner)) {
    diagnostics.push({
      severity: UNIT_CHECK_SEVERITY,
      message: `Derivative-balance equation '${equationName}' expects a flow with units ${formatSignature(expectedInner)}, but got ${formatSignature(inner.signature)}.`
    });
  }

  return diagnostics;
}

function diagnoseIntegralEquation(
  equationName: string,
  expression: Expr,
  leftMeta: UnitMeta,
  variableUnits: VariableUnitMetadata
): UnitDiagnostic[] | null {
  if (expression.type !== "Integral") {
    return null;
  }

  const diagnostics: UnitDiagnostic[] = [];

  if (leftMeta.stockFlow !== "stock" || !leftMeta.signature) {
    diagnostics.push({
      severity: "error",
      message: `I(...) should define a stock variable, but '${equationName}' is not marked as a stock.`
    });
    return diagnostics;
  }

  const inner = inferUnits(expression.expr, variableUnits);
  diagnostics.push(...inner.diagnostics);
  if (inner.signature == null) {
    return diagnostics;
  }

  const expectedInner = divideSignatures(leftMeta.signature, TIME_STEP);
  if (!signaturesEqual(inner.signature, expectedInner)) {
    diagnostics.push({
      severity: UNIT_CHECK_SEVERITY,
      message: `I(...) for stock '${equationName}' expects a flow with units ${formatSignature(expectedInner)}, but got ${formatSignature(inner.signature)}.`
    });
  }

  return diagnostics;
}

function containsDtVariable(expr: Expr): boolean {
  if (
    (expr.type === "Variable" || expr.type === "Lag" || expr.type === "Diff") &&
    expr.name === DT_VARIABLE
  ) {
    return true;
  }
  if (expr.type === "Unary") {
    return containsDtVariable(expr.expr);
  }
  if (expr.type === "Integral") {
    return containsDtVariable(expr.expr);
  }
  if (expr.type === "Binary") {
    return containsDtVariable(expr.left) || containsDtVariable(expr.right);
  }
  if (expr.type === "Function") {
    return expr.args.some((arg) => containsDtVariable(arg));
  }
  if (expr.type === "If") {
    return (
      containsDtVariable(expr.condition) ||
      containsDtVariable(expr.whenTrue) ||
      containsDtVariable(expr.whenFalse)
    );
  }
  return false;
}

function containsExplicitDiff(expr: Expr): boolean {
  if (expr.type === "Diff") {
    return true;
  }
  if (expr.type === "Unary") {
    return containsExplicitDiff(expr.expr);
  }
  if (expr.type === "Integral") {
    return containsExplicitDiff(expr.expr);
  }
  if (expr.type === "Binary") {
    return containsExplicitDiff(expr.left) || containsExplicitDiff(expr.right);
  }
  if (expr.type === "Function") {
    return expr.args.some((arg) => containsExplicitDiff(arg));
  }
  if (expr.type === "If") {
    return (
      containsExplicitDiff(expr.condition) ||
      containsExplicitDiff(expr.whenTrue) ||
      containsExplicitDiff(expr.whenFalse)
    );
  }
  return false;
}

function containsStockDifferenceLike(expr: Expr, variableUnits: VariableUnitMetadata): boolean {
  if (isStockDifferenceLike(expr, variableUnits)) {
    return true;
  }
  if (expr.type === "Unary") {
    return containsStockDifferenceLike(expr.expr, variableUnits);
  }
  if (expr.type === "Integral") {
    return containsStockDifferenceLike(expr.expr, variableUnits);
  }
  if (expr.type === "Binary") {
    return (
      containsStockDifferenceLike(expr.left, variableUnits) ||
      containsStockDifferenceLike(expr.right, variableUnits)
    );
  }
  if (expr.type === "Function" || expr.type === "If") {
    return false;
  }
  return false;
}

function isStockDifferenceLike(expr: Expr, variableUnits: VariableUnitMetadata): boolean {
  if (expr.type !== "Binary" || expr.op !== "-") {
    return false;
  }

  const leftName =
    expr.left.type === "Variable"
      ? expr.left.name
      : expr.left.type === "Lag"
        ? expr.left.name
        : null;
  const rightName =
    expr.right.type === "Variable"
      ? expr.right.name
      : expr.right.type === "Lag"
        ? expr.right.name
        : null;

  if (!leftName || !rightName || leftName !== rightName) {
    return false;
  }

  return (variableUnits.get(leftName)?.stockFlow ?? "aux") === "stock";
}

function inferStockDifferenceSignature(
  expr: Extract<Expr, { type: "Binary" }>,
  variableUnits: VariableUnitMetadata
): UnitSignature | null {
  if (!isStockDifferenceLike(expr, variableUnits)) {
    return null;
  }

  const variableName =
    expr.left.type === "Variable" || expr.left.type === "Lag"
      ? expr.left.name
      : expr.right.type === "Variable" || expr.right.type === "Lag"
        ? expr.right.name
        : null;
  if (!variableName) {
    return null;
  }

  const meta = coerceUnitMeta(variableUnits.get(variableName));
  return meta?.signature ? divideSignatures(meta.signature, TIME_STEP) : null;
}

function extractLagAnchorRemainder(expr: Expr, variableName: string): Expr | null {
  if (expr.type === "Binary" && expr.op === "+") {
    if (expr.left.type === "Lag" && expr.left.name === variableName) {
      return expr.right;
    }
    if (expr.right.type === "Lag" && expr.right.name === variableName) {
      return expr.left;
    }
    const leftRemainder = extractLagAnchorRemainder(expr.left, variableName);
    if (leftRemainder) {
      return { type: "Binary", op: "+", left: leftRemainder, right: expr.right };
    }
    const rightRemainder = extractLagAnchorRemainder(expr.right, variableName);
    if (rightRemainder) {
      return { type: "Binary", op: "+", left: expr.left, right: rightRemainder };
    }
  }

  if (expr.type === "Binary" && expr.op === "-") {
    if (expr.left.type === "Lag" && expr.left.name === variableName) {
      return { type: "Unary", op: "-", expr: expr.right };
    }
    const leftRemainder = extractLagAnchorRemainder(expr.left, variableName);
    if (leftRemainder) {
      return { type: "Binary", op: "-", left: leftRemainder, right: expr.right };
    }
  }

  return null;
}

function renderExpr(expr: Expr): string {
  switch (expr.type) {
    case "Number":
      return String(expr.value);
    case "Variable":
      return expr.name;
    case "Lag":
      return `lag(${expr.name})`;
    case "Diff":
      return `d(${expr.name})`;
    case "Integral":
      return `I(${renderExpr(expr.expr)})`;
    case "Unary":
      return `-${renderExpr(expr.expr)}`;
    case "Binary":
      return `${renderExpr(expr.left)} ${expr.op} ${renderExpr(expr.right)}`;
    case "If":
      return `if (...)`;
    case "Function":
      return `${expr.name}(...)`;
    case "MatrixColumnSum":
      return expr.columnRef;
    default:
      return "";
  }
}

function fromMeta(meta?: UnitMeta): InferredUnit {
  const normalizedMeta = coerceUnitMeta(meta);
  if (!normalizedMeta?.signature) {
    return unknown();
  }
  return known(normalizedMeta.signature);
}

function known(signature: UnitSignature): InferredUnit {
  return { signature: normalizeSignature(signature), diagnostics: [] };
}

function unknown(): InferredUnit {
  return { signature: null, diagnostics: [] };
}

function mergeDiagnostics(...parts: InferredUnit[]): UnitDiagnostic[] {
  return parts.flatMap((part) => part.diagnostics);
}

function setVariableUnitMeta(
  metadata: VariableUnitMetadata,
  variableName: string,
  unitMeta?: UnitMeta
): void {
  const normalizedName = variableName.trim();
  const normalizedMeta = coerceUnitMeta(unitMeta);
  if (!normalizedName || metadata.has(normalizedName) || !normalizedMeta?.signature) {
    return;
  }

  metadata.set(normalizedName, {
    signature: normalizeSignature(normalizedMeta.signature),
    stockFlow: normalizedMeta.stockFlow
  });
}
