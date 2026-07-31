import {
  dispatchNotebookAssistantTool,
  dispatchNotebookAssistantToolRequests,
  type NotebookAssistantSnapshot,
  type NotebookAssistantToolRequest,
  type NotebookAssistantToolResult
} from "./notebookAssistantTools";
import {
  evaluateNotebookAssistantDirectPatchPolicy,
  extractNotebookAssistantToolRequests,
  extractNotebookPatchProposal,
  filterNotebookAssistantToolRequestsForMode,
  getPatchFromNotebookAssistantToolResults,
  type NotebookAssistantMode,
  type NotebookAssistantToolRequestExtraction
} from "./notebookAssistantFlow";
import { processScopedNotebookAssistantResponse } from "./notebookAssistantProposalRunner";
import {
  type NotebookAssistantProposalScope
} from "./notebookAssistantScope";
import {
  previewNotebookPatch,
  validateNotebookPatch,
  type NotebookPatch,
  type NotebookPatchResult,
  type NotebookPatchSummary
} from "./notebookPatch";
import { isRowComment } from "@sfcr/notebook-core";
import { notebookFromJson } from "./document";
import type { NotebookDocument } from "./types";

export interface NotebookAssistantEvalFixture {
  expected?: NotebookAssistantEvalExpected;
  id: string;
  label: string;
  mode: NotebookAssistantMode;
  notebookPath: string;
  question: string;
  runtime?: NotebookAssistantSnapshot["runtime"];
  savedResponsePath: string;
  /** When set, score through scoped cell AI filtering instead of global Ask/Edit mode. */
  scope?: NotebookAssistantProposalScope;
  selectedCellId?: string | null;
  selectedPeriodIndex?: number;
  selectedVariable?: string | null;
}

interface NotebookAssistantEvalExpected {
  addedChart?: { id: string; variables?: string[] };
  addedEquation?: { expression?: string; name: string };
  allowedPathPrefixes?: string[];
  blockedToolNames?: string[];
  changedChartVariables?: { id: string; variables: string[] };
  changedEquation?: { expression: string; name: string };
  changedExternal?: { name: string; valueText: string };
  forbiddenToolNames?: string[];
  patch?: boolean;
  patchSummary?: Partial<NotebookPatchSummary>;
  runPeriods?: { periods: number; runId: string };
  scopeViolations?: boolean;
  toolNames?: string[];
}

interface NotebookAssistantEvalDiagnostic {
  message: string;
  path?: string;
  phase: string;
}

interface NotebookAssistantEvalSummary {
  diagnostics: NotebookAssistantEvalDiagnostic[];
  diagnosticsCount: number;
  fixtureId: string;
  label: string;
  live: boolean;
  mode: NotebookAssistantMode;
  ok: boolean;
  patchSummary: NotebookPatchSummary | null;
  request: {
    assistantMode: NotebookAssistantMode;
    mode: "offline";
    questionChars: number;
    questionPreview: string;
    savedResponsePath: string;
  };
  response: {
    chars: number;
    preview: string;
  };
  tools: {
    allowed: Array<{ args: Record<string, unknown>; name: string }>;
    blocked: Array<{ args: Record<string, unknown>; name: string }>;
    failed: Array<{ error: string; name: string }>;
    requested: Array<{ args: Record<string, unknown>; name: string }>;
  };
}

export interface NotebookAssistantEvalResult {
  extraction: NotebookAssistantToolRequestExtraction;
  modeFiltered: {
    allowed: NotebookAssistantToolRequest[];
    blocked: NotebookAssistantToolRequest[];
  };
  patch: NotebookPatch | null;
  preview: NotebookPatchResult | null;
  scoring: {
    diagnostics: NotebookAssistantEvalDiagnostic[];
    ok: boolean;
  };
  summary: NotebookAssistantEvalSummary;
  toolResults: NotebookAssistantToolResult[];
  validation: NotebookPatchResult | null;
}

export function evaluateNotebookAssistantResponse(args: {
  document: NotebookDocument;
  fixture: NotebookAssistantEvalFixture;
  live?: boolean;
  rawResponse: string;
}): NotebookAssistantEvalResult {
  const document = notebookFromJson(JSON.stringify(args.document));
  const snapshot = buildNotebookAssistantEvalSnapshot(document, args.fixture);

  if (args.fixture.scope) {
    return evaluateScopedNotebookAssistantResponse({
      document,
      fixture: args.fixture,
      live: Boolean(args.live),
      rawResponse: args.rawResponse,
      snapshot
    });
  }

  const extraction = extractNotebookAssistantToolRequests(args.rawResponse);
  const modeFiltered = filterNotebookAssistantToolRequestsForMode(args.fixture.mode, extraction.requests);
  const toolDispatch = dispatchNotebookAssistantToolRequests(snapshot, modeFiltered.allowed);
  const toolResults = toolDispatch.toolResults;
  const patch = resolveNotebookAssistantEvalPatch({
    document,
    fixture: args.fixture,
    rawResponse: args.rawResponse,
    snapshot,
    toolResults,
    toolDispatchPatch: toolDispatch.proposedPatch,
    toolRequests: modeFiltered.allowed
  });
  const validation = patch ? validateNotebookPatch(document, patch) : null;
  const preview = patch ? previewNotebookPatch(document, patch) : null;
  const scoring = scoreNotebookAssistantEval({
    extraction,
    fixture: args.fixture,
    modeFiltered,
    patch,
    preview,
    scopeViolations: [],
    toolResults,
    validation
  });
  const summary = buildNotebookAssistantEvalSummary({
    extraction,
    fixture: args.fixture,
    live: Boolean(args.live),
    modeFiltered,
    preview,
    rawResponse: args.rawResponse,
    scoring,
    toolResults
  });

  return {
    extraction,
    modeFiltered,
    patch,
    preview,
    scoring,
    summary,
    toolResults,
    validation
  };
}

function evaluateScopedNotebookAssistantResponse(args: {
  document: NotebookDocument;
  fixture: NotebookAssistantEvalFixture;
  live: boolean;
  rawResponse: string;
  snapshot: NotebookAssistantSnapshot;
}): NotebookAssistantEvalResult {
  const scope = args.fixture.scope;
  if (!scope) {
    throw new Error("Scoped eval requires fixture.scope.");
  }

  const extraction = extractNotebookAssistantToolRequests(args.rawResponse);
  const scoped = processScopedNotebookAssistantResponse({
    question: args.fixture.question,
    responseText: args.rawResponse,
    scope,
    snapshot: args.snapshot
  });
  const modeFiltered = {
    allowed: extraction.requests.filter(
      (request) =>
        !scoped.blocked.some(
          (blocked) =>
            blocked.name === request.name &&
            JSON.stringify(blocked.args ?? {}) === JSON.stringify(request.args ?? {})
        )
    ),
    blocked: scoped.blocked
  };

  const patch = scoped.patch;
  const validation = patch ? validateNotebookPatch(args.document, patch) : null;
  const preview = patch ? previewNotebookPatch(args.document, patch) : null;
  const scoring = scoreNotebookAssistantEval({
    extraction,
    fixture: args.fixture,
    modeFiltered,
    patch,
    preview,
    scopeViolations: scoped.scopeViolations,
    toolResults: scoped.toolResults,
    validation
  });
  const summary = buildNotebookAssistantEvalSummary({
    extraction,
    fixture: args.fixture,
    live: args.live,
    modeFiltered,
    preview,
    rawResponse: args.rawResponse,
    scoring,
    toolResults: scoped.toolResults
  });

  return {
    extraction,
    modeFiltered,
    patch,
    preview,
    scoring,
    summary,
    toolResults: scoped.toolResults,
    validation
  };
}

function buildNotebookAssistantEvalSnapshot(
  document: NotebookDocument,
  fixture: NotebookAssistantEvalFixture
): NotebookAssistantSnapshot {
  return {
    document,
    runtime: fixture.runtime ?? { errors: {}, outputs: {}, status: {} },
    selectedCellId: fixture.selectedCellId ?? null,
    selectedPeriodIndex: fixture.selectedPeriodIndex ?? 0,
    selectedVariable: fixture.selectedVariable ?? null
  };
}

function scoreNotebookAssistantEval(args: {
  extraction: NotebookAssistantToolRequestExtraction;
  fixture: NotebookAssistantEvalFixture;
  modeFiltered: { allowed: NotebookAssistantToolRequest[]; blocked: NotebookAssistantToolRequest[] };
  patch: NotebookPatch | null;
  preview: NotebookPatchResult | null;
  scopeViolations: string[];
  toolResults: NotebookAssistantToolResult[];
  validation: NotebookPatchResult | null;
}): { diagnostics: NotebookAssistantEvalDiagnostic[]; ok: boolean } {
  const diagnostics: NotebookAssistantEvalDiagnostic[] = [];
  const expected = args.fixture.expected ?? {};
  const requestedNames = args.extraction.requests.map((request) => request.name);
  const allowedNames = args.modeFiltered.allowed.map((request) => request.name);
  const blockedNames = args.modeFiltered.blocked.map((request) => request.name);
  const failedToolResults = args.toolResults.filter((result): result is Extract<NotebookAssistantToolResult, { ok: false }> => !result.ok);
  const expectsScopeBlock = expected.scopeViolations === true || (expected.blockedToolNames?.length ?? 0) > 0;

  if (args.extraction.error) {
    diagnostics.push({ phase: "tools", message: args.extraction.error });
  }
  if (args.modeFiltered.blocked.length > 0 && !expectsScopeBlock && !args.fixture.scope) {
    diagnostics.push({
      phase: "mode",
      message: `Blocked tools in ${args.fixture.mode} mode: ${args.modeFiltered.blocked.map((request) => request.name).join(", ")}`
    });
  }
  if (expected.scopeViolations === true && args.scopeViolations.length === 0 && args.modeFiltered.blocked.length === 0) {
    diagnostics.push({ phase: "scope", message: "Expected scope violations or blocked tools, but none were reported." });
  }
  if (expected.scopeViolations === false && args.scopeViolations.length > 0) {
    diagnostics.push({
      phase: "scope",
      message: `Unexpected scope violations: ${args.scopeViolations.join("; ")}`
    });
  }
  for (const toolName of expected.toolNames ?? []) {
    if (!allowedNames.includes(toolName)) {
      diagnostics.push({ phase: "tools", message: `Expected tool ${toolName} to be allowed.` });
    }
  }
  for (const toolName of expected.blockedToolNames ?? []) {
    if (!blockedNames.includes(toolName)) {
      diagnostics.push({ phase: "scope", message: `Expected tool ${toolName} to be blocked by scope.` });
    }
  }
  for (const toolName of expected.forbiddenToolNames ?? []) {
    if (requestedNames.includes(toolName)) {
      diagnostics.push({ phase: "tools", message: `Forbidden tool ${toolName} was requested.` });
    }
  }
  for (const result of failedToolResults) {
    diagnostics.push({ phase: "tools", message: `${result.name} failed: ${result.error}` });
  }
  if (expected.patch === false && args.patch) {
    diagnostics.push({ phase: "patch", message: "Expected no patch, but a patch was proposed." });
  }
  if (expected.patch === true && !args.patch) {
    diagnostics.push({ phase: "patch", message: "Expected a patch, but none was proposed." });
  }
  if (args.patch && args.validation && !args.validation.ok) {
    diagnostics.push(...args.validation.issues.map((issue) => ({ phase: "validation", message: issue.message, path: issue.path })));
  }
  if (args.patch && args.preview && !args.preview.ok) {
    diagnostics.push(...args.preview.issues.map((issue) => ({ phase: "preview", message: issue.message, path: issue.path })));
  }
  if (expected.patchSummary && args.preview) {
    for (const [key, value] of Object.entries(expected.patchSummary) as Array<[keyof NotebookPatchSummary, number]>) {
      if (args.preview.summary[key] !== value) {
        diagnostics.push({ phase: "summary", message: `Expected patch summary ${key}=${value}, got ${args.preview.summary[key]}.` });
      }
    }
  }
  if (expected.allowedPathPrefixes && args.patch) {
    for (const operation of args.patch.operations) {
      if (!expected.allowedPathPrefixes.some((prefix) => operation.path.startsWith(prefix))) {
        diagnostics.push({ phase: "target", path: operation.path, message: `Patch path ${operation.path} is outside the expected target.` });
      }
    }
  }
  if (args.preview?.ok) {
    diagnostics.push(...validateExpectedDocument(args.preview.document, expected));
  }

  return { diagnostics, ok: diagnostics.length === 0 };
}

function resolveNotebookAssistantEvalPatch(args: {
  document: NotebookDocument;
  fixture: NotebookAssistantEvalFixture;
  rawResponse: string;
  snapshot: NotebookAssistantSnapshot;
  toolDispatchPatch: NotebookPatch | null;
  toolRequests: NotebookAssistantToolRequest[];
  toolResults: NotebookAssistantToolResult[];
}): NotebookPatch | null {
  const toolPatch = args.toolDispatchPatch ?? getPatchFromNotebookAssistantToolResults(args.toolResults, args.toolRequests);
  if (toolPatch) {
    return toolPatch;
  }
  if (args.fixture.mode !== "edit") {
    return null;
  }

  const directPatch = extractNotebookPatchProposal({
    document: args.document,
    question: args.fixture.question,
    text: args.rawResponse
  });
  if (!directPatch) {
    return null;
  }

  const policy = evaluateNotebookAssistantDirectPatchPolicy(args.document, directPatch);
  if (!policy.ok) {
    return directPatch;
  }
  if ("patch" in policy) {
    return policy.patch;
  }

  const helperResult = dispatchNotebookAssistantTool(args.snapshot, policy.request);
  return getPatchFromNotebookAssistantToolResults([helperResult], [policy.request]);
}

function buildNotebookAssistantEvalSummary(args: {
  extraction: NotebookAssistantToolRequestExtraction;
  fixture: NotebookAssistantEvalFixture;
  live: boolean;
  modeFiltered: { allowed: NotebookAssistantToolRequest[]; blocked: NotebookAssistantToolRequest[] };
  preview: NotebookPatchResult | null;
  rawResponse: string;
  scoring: { diagnostics: NotebookAssistantEvalDiagnostic[]; ok: boolean };
  toolResults: NotebookAssistantToolResult[];
}): NotebookAssistantEvalSummary {
  return {
    fixtureId: args.fixture.id,
    label: args.fixture.label,
    live: args.live,
    mode: args.fixture.mode,
    ok: args.scoring.ok,
    diagnosticsCount: args.scoring.diagnostics.length,
    request: {
      mode: "offline",
      assistantMode: args.fixture.mode,
      questionChars: args.fixture.question.length,
      questionPreview: summarizeText(args.fixture.question),
      savedResponsePath: args.fixture.savedResponsePath
    },
    response: {
      chars: args.rawResponse.length,
      preview: summarizeText(args.rawResponse)
    },
    tools: {
      requested: args.extraction.requests.map(summarizeToolRequest),
      allowed: args.modeFiltered.allowed.map(summarizeToolRequest),
      blocked: args.modeFiltered.blocked.map(summarizeToolRequest),
      failed: args.toolResults
        .filter((result): result is Extract<NotebookAssistantToolResult, { ok: false }> => !result.ok)
        .map((result) => ({ name: result.name, error: result.error }))
    },
    patchSummary: args.preview?.summary ?? null,
    diagnostics: args.scoring.diagnostics
  };
}

function validateExpectedDocument(
  document: NotebookDocument,
  expected: NotebookAssistantEvalExpected
): NotebookAssistantEvalDiagnostic[] {
  const diagnostics: NotebookAssistantEvalDiagnostic[] = [];

  if (expected.changedExternal) {
    const external = findExternal(document, expected.changedExternal.name);
    if (!external || external.valueText !== String(expected.changedExternal.valueText)) {
      diagnostics.push({ phase: "expected", message: `Expected external ${expected.changedExternal.name} valueText=${expected.changedExternal.valueText}.` });
    }
  }
  if (expected.addedChart) {
    const chart = document.cells.find((cell) => cell.type === "chart" && cell.id === expected.addedChart?.id);
    if (!chart || chart.type !== "chart") {
      diagnostics.push({ phase: "expected", message: `Expected chart ${expected.addedChart.id} to exist.` });
    } else if (expected.addedChart.variables && !sameStrings(chart.variables ?? [], expected.addedChart.variables)) {
      diagnostics.push({ phase: "expected", message: `Expected chart ${expected.addedChart.id} variables ${expected.addedChart.variables.join(", ")}.` });
    }
  }
  if (expected.runPeriods) {
    const run = document.cells.find((cell) => cell.type === "run" && cell.id === expected.runPeriods?.runId);
    if (!run || run.type !== "run" || run.periods !== expected.runPeriods.periods) {
      diagnostics.push({ phase: "expected", message: `Expected run ${expected.runPeriods.runId} periods=${expected.runPeriods.periods}.` });
    }
  }
  if (expected.addedEquation) {
    const equation = findEquation(document, expected.addedEquation.name);
    if (!equation) {
      diagnostics.push({ phase: "expected", message: `Expected equation ${expected.addedEquation.name} to exist.` });
    } else if (expected.addedEquation.expression && equation.expression !== expected.addedEquation.expression) {
      diagnostics.push({ phase: "expected", message: `Expected equation ${expected.addedEquation.name} expression ${expected.addedEquation.expression}.` });
    }
  }
  if (expected.changedChartVariables) {
    const chart = document.cells.find(
      (cell) => cell.type === "chart" && cell.id === expected.changedChartVariables?.id
    );
    if (!chart || chart.type !== "chart") {
      diagnostics.push({
        phase: "expected",
        message: `Expected chart ${expected.changedChartVariables.id} to exist.`
      });
    } else if (!sameStrings(chart.variables ?? [], expected.changedChartVariables.variables)) {
      diagnostics.push({
        phase: "expected",
        message: `Expected chart ${expected.changedChartVariables.id} variables ${expected.changedChartVariables.variables.join(", ")}.`
      });
    }
  }
  if (expected.changedEquation) {
    const equation = findEquation(document, expected.changedEquation.name);
    if (!equation) {
      diagnostics.push({
        phase: "expected",
        message: `Expected equation ${expected.changedEquation.name} to exist.`
      });
    } else if (equation.expression !== expected.changedEquation.expression) {
      diagnostics.push({
        phase: "expected",
        message: `Expected equation ${expected.changedEquation.name} expression ${expected.changedEquation.expression}.`
      });
    }
  }

  return diagnostics;
}

function findExternal(document: NotebookDocument, name: string): { valueText: string } | null {
  for (const cell of document.cells) {
    if (cell.type === "externals") {
      const external = cell.externals.find(
        (candidate) => !isRowComment(candidate) && candidate.name === name
      );
      if (external && !isRowComment(external)) {
        return external;
      }
    }
  }
  return null;
}

function findEquation(document: NotebookDocument, name: string): { expression: string } | null {
  for (const cell of document.cells) {
    if (cell.type === "equations") {
      const equation = cell.equations.find(
        (candidate) => !isRowComment(candidate) && candidate.name === name
      );
      if (equation && !isRowComment(equation)) {
        return equation;
      }
    }
  }
  return null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function summarizeToolRequest(request: NotebookAssistantToolRequest): { args: Record<string, unknown>; name: string } {
  return { name: request.name, args: request.args ?? {} };
}

function summarizeText(value: string, max = 120): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}...`;
}
