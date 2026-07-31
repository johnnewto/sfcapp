import type { Dispatch, SetStateAction } from "react";
import { createNotebookDiagnostic, isRowComment } from "@sfcr/notebook-core";

import { extractOpenAiTextResponse, extractOpenAiUsageResponse, postAssistantJson, type OpenAiTextResponse } from "../assistant/client";
import { readAssistantSseResponse, type AssistantTokenUsage } from "../assistant/sse";
import type { NotebookPatch, NotebookPatchResult } from "./notebookPatch";
import { previewNotebookPatch } from "./notebookPatch";
import { notebookToJson } from "./document";
import {
  findEquationsCell,
  findExternalsCell,
  findInitialValuesCell,
  findSolverCell,
  resolveRunCellModelKey
} from "./modelSections";
import {
  formatNotebookAssistantMode,
  getNotebookAssistantModeContract,
  type NotebookAssistantMode
} from "./notebookAssistantFlow";
import {
  getNotebookAssistantScopeContract,
  getNotebookAssistantScopeToolNames,
  resolveNotebookAssistantScopeTarget,
  summarizeNotebookAssistantScopeToolSyntax,
  buildEquationsModelContextPayload,
  type NotebookAssistantProposalScope
} from "./notebookAssistantScope";
import {
  summarizeNotebookAssistantTools,
  summarizeNotebookAssistantToolSyntax,
  summarizeNotebookEquationExpressionSyntax,
  type NotebookAssistantToolResult
} from "./notebookAssistantTools";
import { summarizeCellTypes } from "./notebookSourceWorkflow";
import type { EquationsCell, NotebookDocument } from "./types";

export const NOTEBOOK_ASSISTANT_API_URL = resolveNotebookAssistantApiUrl();
export const NOTEBOOK_ASSISTANT_DEFAULT_MODEL = "gpt-5.4-mini";
export const NOTEBOOK_ASSISTANT_MODEL_STORAGE_KEY = "sfcr:notebook-assistant-model";
export const NOTEBOOK_ASSISTANT_MODE_STORAGE_KEY = "sfcr:notebook-assistant-mode";
export const NOTEBOOK_ASSISTANT_MAX_TOOL_REQUESTS_PER_ROUND = 8;

export interface NotebookAssistantMessage {
  id: string;
  patch?: NotebookAssistantInlinePatch;
  role: "assistant" | "user";
  text: string;
}

export interface NotebookAssistantAnswer {
  text: string;
  usage?: AssistantTokenUsage;
}

export interface NotebookAssistantInlinePatch {
  isJsonVisible: boolean;
  isJsonDirty?: boolean;
  jsonText?: string;
  patch: NotebookPatch;
  preview: NotebookPatchResult;
  status: "ready" | "applied" | "discarded";
}

export const NOTEBOOK_ASSISTANT_INITIAL_MESSAGES: NotebookAssistantMessage[] = [
  {
    id: "assistant-1",
    role: "assistant",
    text: "Ask about the current notebook, selected variable, validation state, or run results. I will explain and suggest changes without applying them."
  }
];

export async function requestNotebookAssistantAnswer(args: {
  betaPassword: string;
  context: string;
  messages: NotebookAssistantMessage[];
  model: string;
  onTextDelta?: (delta: string) => void;
  question: string;
}): Promise<NotebookAssistantAnswer> {
  const assistantApiUrl = NOTEBOOK_ASSISTANT_API_URL || resolveNotebookAssistantApiUrl();
  if (!assistantApiUrl) {
    throw new Error("Notebook assistant API endpoint is not configured.");
  }

  const response = await postAssistantJson({
    fallbackErrorMessage: "Failed to ask notebook assistant.",
    url: assistantApiUrl,
    body: {
      ...(args.betaPassword.trim() ? { betaPassword: args.betaPassword.trim() } : {}),
      context: args.context,
      messages: args.messages.map((message) => ({
        role: message.role,
        text: message.text
      })),
      model: args.model,
      question: args.question
    }
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  const jsonFallbackResponse = response.body ? response.clone() : response;
  const sseFallbackResponse = response.body ? response.clone() : null;
  if (response.body && contentType.includes("text/event-stream")) {
    const streamedResult = await readNotebookAssistantSseResponse(response, args.onTextDelta);
    if (streamedResult.text.trim()) {
      return {
        text: streamedResult.text.trim(),
        usage: streamedResult.usage
      };
    }
  }

  let result: OpenAiTextResponse;
  try {
    result = await jsonFallbackResponse.json() as OpenAiTextResponse;
  } catch (error) {
    if (sseFallbackResponse) {
      const streamedResult = await readNotebookAssistantSseResponse(sseFallbackResponse, args.onTextDelta);
      if (streamedResult.text.trim()) {
        return {
          text: streamedResult.text.trim(),
          usage: streamedResult.usage
        };
      }
    }
    throw error;
  }
  const text = extractOpenAiTextResponse(result);

  if (!text) {
    throw new Error("Assistant response did not include text.");
  }

  args.onTextDelta?.(text);
  return {
    text,
    usage: extractOpenAiUsageResponse(result)
  };
}

export function setNotebookAssistantMessageText(
  setMessages: Dispatch<SetStateAction<NotebookAssistantMessage[]>>,
  messageId: string,
  text: string
): void {
  setMessages((current) =>
    current.map((message) => (message.id === messageId ? { ...message, text } : message))
  );
}

export function setNotebookAssistantMessagePatch(
  setMessages: Dispatch<SetStateAction<NotebookAssistantMessage[]>>,
  messageId: string,
  patch: NotebookPatch,
  document: NotebookDocument
): void {
  const preview = previewNotebookPatch(document, patch);
  setMessages((current) =>
    current.map((message) =>
      message.id === messageId
        ? {
            ...message,
            patch: {
              isJsonVisible: false,
              patch,
              preview,
              status: "ready"
            }
          }
        : message
    )
  );
}

export function rearmNotebookAssistantMessagePatchAfterUndo(
  messages: NotebookAssistantMessage[],
  document: NotebookDocument,
  messageId?: string
): NotebookAssistantMessage[] {
  if (!messageId) {
    return messages;
  }

  return messages.map((message) => {
    if (message.id !== messageId || !message.patch || message.patch.status !== "applied") {
      return message;
    }

    return {
      ...message,
      patch: {
        ...message.patch,
        preview: previewNotebookPatch(document, message.patch.patch),
        status: "ready"
      }
    };
  });
}

export function buildNotebookAssistantContext(args: {
  document: NotebookDocument;
  inspectorContext: {
    currentValues: Record<string, number | undefined>;
    selectedVariable: string;
  } | null;
  resultCount: number;
  assistantMode: NotebookAssistantMode;
  selectedPeriodIndex: number;
  selectedVariable?: string;
  uiMessage: string | null;
  userRequest?: string;
}): string {
  if (args.assistantMode === "edit") {
    const compactContext = buildCompactNotebookAssistantContext(args);
    return truncateNotebookAssistantContext(
      [
        "Assistant mode: Edit. Prepare proposed patches only; never claim edits were applied.",
        `Tool syntax:\n${summarizeEditNotebookAssistantToolSyntax()}`,
        compactContext.intent === "parameter-update" ? null : `Equation syntax:\n${summarizeNotebookEquationExpressionSyntax()}`,
        "Compact notebook JSON:",
        JSON.stringify(compactContext)
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    );
  }

  const notebookJson = notebookToJson(args.document);
  return truncateNotebookAssistantContext(
    [
      `Notebook title: ${args.document.title}`,
      `Notebook id: ${args.document.id}`,
      `Assistant mode: ${formatNotebookAssistantMode(args.assistantMode)}`,
      `Assistant mode contract: ${getNotebookAssistantModeContract(args.assistantMode)}`,
      `Cells: ${args.document.cells.length}`,
      `Cell types: ${summarizeCellTypes(args.document.cells)}`,
      `Available notebook assistant tools: ${summarizeNotebookAssistantTools()}`,
      `Notebook assistant tool syntax:\n${summarizeNotebookAssistantToolSyntax(args.assistantMode)}`,
      `Notebook equation expression syntax:\n${summarizeNotebookEquationExpressionSyntax()}`,
      `Selected period index: ${args.selectedPeriodIndex}`,
      `Completed run result count: ${args.resultCount}`,
      args.selectedVariable ? `Selected variable: ${args.selectedVariable}` : null,
      args.inspectorContext
        ? `Selected variable current values: ${JSON.stringify(args.inspectorContext.currentValues)}`
        : null,
      args.uiMessage ? `Current UI message: ${args.uiMessage}` : null,
      "Notebook JSON:",
      notebookJson
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );
}

export function buildScopedNotebookAssistantContext(args: {
  document: NotebookDocument;
  resultCount: number;
  scope: NotebookAssistantProposalScope;
  selectedPeriodIndex: number;
  uiMessage?: string | null;
}): string {
  if (args.scope.kind === "global-ask") {
    return buildNotebookAssistantContext({
      assistantMode: "ask",
      document: args.document,
      inspectorContext: null,
      resultCount: args.resultCount,
      selectedPeriodIndex: args.selectedPeriodIndex,
      uiMessage: args.uiMessage ?? null
    });
  }

  const target = resolveNotebookAssistantScopeTarget(args.document, args.scope);
  if (!target.ok) {
    return truncateNotebookAssistantContext(
      [
        `Assistant scope: ${args.scope.kind}`,
        `Assistant scope contract: ${getNotebookAssistantScopeContract(args.scope)}`,
        `Scope target error: ${target.message}`
      ].join("\n")
    );
  }

  const scopedPayload =
    args.scope.kind === "chart-update" && "chart" in target
      ? compactObject({
          v: 1,
          fmt: "sfcr-assistant-cell-scope",
          scope: args.scope.kind,
          nb: [args.document.id, args.document.title],
          chart: compactObject({
            id: target.chart.id,
            title: target.chart.title,
            sourceRunCellId: target.chart.sourceRunCellId,
            variables: target.chart.variables,
            axisMode: target.chart.axisMode,
            compareMode: target.chart.compareMode,
            niceScale: target.chart.niceScale,
            referenceTrace: target.chart.referenceTrace,
            showScenarioShocks: target.chart.showScenarioShocks,
            timeRangeInclusive: target.chart.timeRangeInclusive,
            yAxisTickCount: target.chart.yAxisTickCount
          }),
          resultCount: args.resultCount,
          sel: [args.selectedPeriodIndex],
          ui: args.uiMessage ?? null,
          tools: listScopedToolNames(args.scope)
        })
      : args.scope.kind === "equation-update" && "equationsCell" in target && "equationName" in target
        ? compactObject({
            v: 1,
            fmt: "sfcr-assistant-cell-scope",
            scope: args.scope.kind,
            nb: [args.document.id, args.document.title],
            model: buildEquationsModelContextPayload(args.document, target.equationsCell, {
              variable: target.equationName,
              expression: target.expression,
              description: findEquationDescription(target.equationsCell, target.equationName)
            }),
            resultCount: args.resultCount,
            sel: [args.selectedPeriodIndex],
            ui: args.uiMessage ?? null,
            tools: listScopedToolNames(args.scope)
          })
        : args.scope.kind === "equations-cell-ask" && "equationsCell" in target
          ? compactObject({
              v: 1,
              fmt: "sfcr-assistant-cell-scope",
              scope: args.scope.kind,
              nb: [args.document.id, args.document.title],
              model: buildEquationsModelContextPayload(args.document, target.equationsCell),
              resultCount: args.resultCount,
              sel: [args.selectedPeriodIndex],
              ui: args.uiMessage ?? null,
              tools: listScopedToolNames(args.scope)
            })
        : null;

  return truncateNotebookAssistantContext(
    [
      `Assistant scope: ${args.scope.kind}`,
      `Assistant scope contract: ${getNotebookAssistantScopeContract(args.scope)}`,
      `Tool syntax:\n${summarizeNotebookAssistantScopeToolSyntax(args.scope)}`,
      args.scope.kind === "equation-update" || args.scope.kind === "equations-cell-ask"
        ? `Equation syntax:\n${summarizeNotebookEquationExpressionSyntax()}`
        : null,
      "Scoped notebook JSON:",
      JSON.stringify(scopedPayload)
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );
}

export function buildNotebookAssistantToolResultContext(args: {
  assistantMode: NotebookAssistantMode;
  document: NotebookDocument;
  resultCount: number;
  selectedPeriodIndex: number;
  selectedVariable?: string;
  toolResults: NotebookAssistantToolResult[];
  uiMessage: string | null;
}): string {
  return truncateNotebookAssistantContext(
    [
      `Notebook title: ${args.document.title}`,
      `Notebook id: ${args.document.id}`,
      `Assistant mode: ${formatNotebookAssistantMode(args.assistantMode)}`,
      `Assistant mode contract: ${getNotebookAssistantModeContract(args.assistantMode)}`,
      args.assistantMode === "edit" ? `Patch helper syntax:\n${summarizeEditFollowupPatchHelperSyntax()}` : null,
      "Tool result follow-up context JSON:",
      JSON.stringify(
        compactObject({
          v: 1,
          fmt: "sfcr-assistant-tool-result-context",
          mode: args.assistantMode,
          nb: [args.document.id, args.document.title],
          sel: compactArray([args.selectedVariable, args.selectedPeriodIndex]),
          resultCount: args.resultCount,
          ui: args.uiMessage,
          toolResults: args.toolResults.map(compactToolResult)
        })
      )
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );
}

export function buildNotebookAssistantLocalToolResultAnswer(args: {
  proposedPatch: NotebookPatch | null;
  toolResults: NotebookAssistantToolResult[];
}): string | null {
  if (!args.proposedPatch || args.toolResults.length === 0 || args.toolResults.some((result) => !result.ok)) {
    return null;
  }

  const previewSummary = findSuccessfulToolPreviewSummary(args.toolResults);
  const description = args.proposedPatch.description?.trim();
  const operationCount = previewSummary?.operationCount ?? args.proposedPatch.operations.length;
  const changedCellCount = previewSummary
    ? previewSummary.addedCells + previewSummary.changedCells + previewSummary.removedCells
    : null;
  const changeText = changedCellCount == null
    ? `with ${formatCount(operationCount, "operation")}`
    : `changing ${formatCount(changedCellCount, "cell")} with ${formatCount(operationCount, "operation")}`;

  return [
    description ? `Proposed change prepared: ${description}` : "Proposed notebook change prepared.",
    `The patch preview is valid, with no issues, ${changeText}. Review it below, then apply it when ready.`
  ].join("\n\n");
}

type CompactAssistantContextArgs = Parameters<typeof buildNotebookAssistantContext>[0];
type CompactModelRow = {
  ex?: unknown[][];
  eq?: unknown[][];
  id: string;
  iv?: unknown[][];
  opt?: Record<string, unknown>;
  title?: string;
};

function buildCompactNotebookAssistantContext(args: CompactAssistantContextArgs): Record<string, unknown> {
  const parameterTargets = inferExplicitParameterTargets(args.document, args.userRequest);
  const selectedVariable = args.selectedVariable ?? args.inspectorContext?.selectedVariable;
  const selectedModelId = parameterTargets?.modelIds[0] ?? resolveSelectedModelId(args.document, selectedVariable);
  const modelIds = parameterTargets?.modelIds ?? (selectedModelId ? [selectedModelId] : findNotebookModelIds(args.document));
  const runRows = buildCompactRunRows(args.document, new Set(modelIds));
  const selectedParameterTarget = parameterTargets?.variables.length === 1
    ? parameterTargets.variables[0]
    : parameterTargets?.variables;

  return compactObject({
    v: 1,
    fmt: "sfcr-assistant-compact",
    mode: args.assistantMode,
    nb: [args.document.id, args.document.title],
    cells: args.document.cells.length,
    cellTypes: summarizeCellTypes(args.document.cells),
    intent: parameterTargets ? "parameter-update" : undefined,
    sel: compactArray([selectedModelId, selectedVariable ?? selectedParameterTarget, args.selectedPeriodIndex]),
    resultCount: args.resultCount,
    ui: args.uiMessage,
    cur: args.inspectorContext?.currentValues,
    m: modelIds.map((modelId) => buildCompactModelRow(args.document, modelId, parameterTargets)),
    r: runRows,
    tools: summarizeNotebookAssistantTools().split(", ")
  });
}

function resolveSelectedModelId(document: NotebookDocument, selectedVariable: string | undefined): string | null {
  if (selectedVariable) {
    for (const cell of document.cells) {
      if (
        cell.type === "equations" &&
        cell.equations.some(
          (equation) => !isRowComment(equation) && equation.name === selectedVariable
        )
      ) {
        return cell.modelId;
      }
      if (
        cell.type === "externals" &&
        cell.externals.some(
          (external) => !isRowComment(external) && external.name === selectedVariable
        )
      ) {
        return cell.modelId;
      }
      if (
        cell.type === "initial-values" &&
        cell.initialValues.some(
          (initialValue) => !isRowComment(initialValue) && initialValue.name === selectedVariable
        )
      ) {
        return cell.modelId;
      }
    }
  }

  return findNotebookModelIds(document)[0] ?? null;
}

function findNotebookModelIds(document: NotebookDocument): string[] {
  const modelIds = new Set<string>();
  for (const cell of document.cells) {
    if (
      (cell.type === "equations" || cell.type === "externals" || cell.type === "initial-values" || cell.type === "solver") &&
      cell.modelId.trim()
    ) {
      modelIds.add(cell.modelId);
    }
  }
  return [...modelIds];
}

function buildCompactModelRow(
  document: NotebookDocument,
  modelId: string,
  parameterTargets: ExplicitParameterTargets | null = null
): CompactModelRow {
  const equationsCell = findEquationsCell(document.cells, modelId);
  const externalsCell = findExternalsCell(document.cells, modelId);
  const initialValuesCell = findInitialValuesCell(document.cells, modelId);
  const solverCell = findSolverCell(document.cells, modelId);
  const parameterVariables = parameterTargets?.variablesByModel.get(modelId);
  const parameterOnly = Boolean(parameterVariables);

  return compactObject({
    id: modelId,
    title: equationsCell?.title,
    eq:
      parameterOnly
        ? []
        : equationsCell?.equations.flatMap((equation) =>
            isRowComment(equation)
              ? []
              : [compactArray([equation.name, equation.expression, equation.role, equation.desc])]
          ) ?? [],
    ex:
      externalsCell?.externals.flatMap((external) => {
        if (isRowComment(external)) {
          return [];
        }
        if (parameterOnly && !parameterVariables?.has(external.name)) {
          return [];
        }
        return [compactArray([external.name, external.kind, external.valueText, external.desc])];
      }) ?? [],
    iv: parameterOnly
      ? []
      : initialValuesCell?.initialValues.flatMap((initialValue) =>
          isRowComment(initialValue)
            ? []
            : [compactArray([initialValue.name, initialValue.valueText])]
        ) ?? [],
    opt: solverCell
      ? compactObject({
          method: solverCell.options.solverMethod,
          periods: solverCell.options.periods,
          tolerance: solverCell.options.toleranceText,
          maxIterations: solverCell.options.maxIterations,
          defaultInitialValue: solverCell.options.defaultInitialValueText
        })
      : undefined
  }) as CompactModelRow;
}

type ExplicitParameterTargets = {
  modelIds: string[];
  variables: string[];
  variablesByModel: Map<string, Set<string>>;
};

function inferExplicitParameterTargets(
  document: NotebookDocument,
  userRequest: string | undefined
): ExplicitParameterTargets | null {
  if (!userRequest || !/\b(set|change|update|make)\b/i.test(userRequest) || !/\b(to|=)\b/i.test(userRequest)) {
    return null;
  }

  const normalizedRequest = userRequest.toLowerCase();
  const uniqueDescriptionTokens = collectUniqueExternalDescriptionTokens(document);
  const variablesByModel = new Map<string, Set<string>>();
  for (const cell of document.cells) {
    if (cell.type !== "externals") {
      continue;
    }
    for (const external of cell.externals) {
      if (isRowComment(external)) {
        continue;
      }
      const variable = external.name.trim();
      if (!variable) {
        continue;
      }
      if (matchesExternalMention(normalizedRequest, variable, external.desc, uniqueDescriptionTokens.get(externalKey(cell.modelId, external.name)))) {
        const variables = variablesByModel.get(cell.modelId) ?? new Set<string>();
        variables.add(external.name);
        variablesByModel.set(cell.modelId, variables);
      }
    }
  }

  if (variablesByModel.size === 0) {
    return null;
  }

  return {
    modelIds: [...variablesByModel.keys()],
    variables: [...variablesByModel.values()].flatMap((variables) => [...variables]),
    variablesByModel
  };
}

function collectUniqueExternalDescriptionTokens(document: NotebookDocument): Map<string, Set<string>> {
  const tokenCounts = new Map<string, number>();
  const tokensByExternal = new Map<string, Set<string>>();

  for (const cell of document.cells) {
    if (cell.type !== "externals") {
      continue;
    }

    for (const external of cell.externals) {
      if (isRowComment(external)) {
        continue;
      }
      const tokens = new Set(tokenizeParameterDescription(external.desc));
      tokensByExternal.set(externalKey(cell.modelId, external.name), tokens);
      for (const token of tokens) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      }
    }
  }

  return new Map(
    [...tokensByExternal.entries()].map(([key, tokens]) => [
      key,
      new Set([...tokens].filter((token) => tokenCounts.get(token) === 1))
    ])
  );
}

function externalKey(modelId: string, variable: string): string {
  return `${modelId}\u0000${variable}`;
}

function matchesExternalMention(
  normalizedRequest: string,
  variable: string,
  description: string | undefined,
  uniqueDescriptionTokens: Set<string> | undefined
): boolean {
  const variablePattern = new RegExp(`(?:^|[^A-Za-z0-9_{}^])${escapeRegExp(variable.toLowerCase())}(?:$|[^A-Za-z0-9_{}^])`);
  if (variablePattern.test(normalizedRequest)) {
    return true;
  }

  const descriptionTokens = tokenizeParameterDescription(description);
  return (
    (descriptionTokens.length > 0 && descriptionTokens.every((token) => hasWord(normalizedRequest, token))) ||
    [...(uniqueDescriptionTokens ?? [])].some((token) => hasWord(normalizedRequest, token))
  );
}

function tokenizeParameterDescription(description: string | undefined): string[] {
  if (!description) {
    return [];
  }

  const stopWords = new Set([
    "and",
    "change",
    "consume",
    "consumption",
    "current",
    "disposable",
    "expected",
    "from",
    "lagged",
    "make",
    "of",
    "out",
    "past",
    "propensity",
    "set",
    "the",
    "to",
    "update"
  ]);

  return [...new Set(description.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(
    (token) => token.length > 2 && !stopWords.has(token)
  );
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_{}^])${escapeRegExp(word)}(?:$|[^A-Za-z0-9_{}^])`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCompactRunRows(document: NotebookDocument, modelIds: Set<string>): unknown[][] {
  return document.cells
    .filter((cell) => cell.type === "run")
    .flatMap((cell) => {
      const modelKey = resolveRunCellModelKey(document.cells, cell);
      const modelId = modelKey?.startsWith("model:") ? modelKey.slice("model:".length) : null;
      if (!modelId || !modelIds.has(modelId)) {
        return [];
      }

      return [
        compactArray([
          cell.id,
          modelId,
          cell.periods,
          cell.mode,
          cell.title,
          cell.description,
          cell.baselineRunCellId,
          cell.baselineStartPeriod,
          cell.scenario
        ])
      ];
    });
}

function compactToolResult(result: NotebookAssistantToolResult): unknown[] {
  if (!result.ok) {
    return compactArray([result.name, false, result.error]);
  }

  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? (result.data as Record<string, unknown>)
    : {};
  const patch = data.patch && typeof data.patch === "object" && !Array.isArray(data.patch)
    ? (data.patch as Record<string, unknown>)
    : null;
  const operations = patch && Array.isArray(patch.operations) ? patch.operations : [];
  const preview = data.preview && typeof data.preview === "object" && !Array.isArray(data.preview)
    ? (data.preview as Record<string, unknown>)
    : null;
  const issues = preview && Array.isArray(preview.issues) ? preview.issues : [];

  return compactArray([
    result.name,
    true,
    patch && typeof patch.description === "string" ? patch.description : undefined,
    operations.length || undefined,
    issues.length || undefined
  ]);
}

function findSuccessfulToolPreviewSummary(toolResults: NotebookAssistantToolResult[]): {
  addedCells: number;
  changedCells: number;
  operationCount: number;
  removedCells: number;
} | null {
  for (const result of toolResults) {
    if (!result.ok || !result.data || typeof result.data !== "object") {
      continue;
    }

    const preview = (result.data as { preview?: unknown }).preview;
    if (!preview || typeof preview !== "object" || (preview as { ok?: unknown }).ok === false) {
      continue;
    }

    const summary = (preview as { summary?: unknown }).summary;
    if (!summary || typeof summary !== "object") {
      continue;
    }

    const candidate = summary as Record<string, unknown>;
    if (
      typeof candidate.addedCells === "number" &&
      typeof candidate.changedCells === "number" &&
      typeof candidate.operationCount === "number" &&
      typeof candidate.removedCells === "number"
    ) {
      return {
        addedCells: candidate.addedCells,
        changedCells: candidate.changedCells,
        operationCount: candidate.operationCount,
        removedCells: candidate.removedCells
      };
    }
  }

  return null;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function summarizeEditNotebookAssistantToolSyntax(): string {
  return [
    `Request tools only as JSON: { "notebookAssistantToolRequests": [{ "name": "toolName", "args": { ... } }] }`,
    "Patch helpers use canonical long arg names, never compact context keys.",
    "Common patch helpers:",
    "- createUpdateParameterPatch { modelId, variable, value }",
    "- createUpdateEquationPatch { modelId, variable, expression, description?, role?, unitMeta? }",
    "- createAddEquationPatch { modelId, equation | name+expression, description?, role?, insertAfterVariable?, unitMeta? }",
    "- createAddExternalPatch { modelId, name, kind, value, description?, insertAfterVariable?, unitMeta? }",
    "- createAddChartPatch { runId, variables, title?, chartId? }",
    "- createUpdateChartVariablesPatch { chartId, variables } for existing chart variable changes; do not use createUpdateChartPatch.",
    "- createUpdateRunOptionsPatch { runId, periods?, solverMethod?, tolerance?, scenario?, baselineRunCellId?, baselineStartPeriod? }",
    "Read helpers when ids/data are missing: listRuns {}, listCharts {}, listVariables {}, getSeriesWindow { runId, variable, start, end }."
  ].join("\n");
}

function summarizeEditFollowupPatchHelperSyntax(): string {
  return [
    "Request patch helpers only as JSON: { \"notebookAssistantToolRequests\": [{ \"name\": \"toolName\", \"args\": { ... } }] }",
    "Use canonical long arg names, never compact context keys.",
    "- createAddMatrixRowPatch { matrixId, label, values, band?, insertAfterLabel? }",
    "- createUpdateMatrixRowPatch { matrixId, label, values?, newLabel?, band? }",
    "- createUpdateMatrixPatch { matrixId, columns, rows, sectors? } for structural matrix column/sector updates."
  ].join("\n");
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      if (typeof entry === "object") {
        return Object.keys(entry).length > 0;
      }
      return true;
    })
  ) as T;
}

function compactArray(values: unknown[]): unknown[] {
  const compacted = [...values];
  while (compacted.length > 0 && (compacted[compacted.length - 1] === undefined || compacted[compacted.length - 1] === null)) {
    compacted.pop();
  }
  return compacted.map((value) => (value === undefined ? null : value));
}

export function createAssistantPatchIssue(message: string) {
  return createNotebookDiagnostic({ message }, { domain: "assistant" }) as NotebookPatchResult["issues"][number];
}

function resolveNotebookAssistantApiUrl(): string {
  const configuredAssistantUrl = (import.meta.env.VITE_NOTEBOOK_ASSISTANT_API_URL ?? "").trim();
  if (configuredAssistantUrl) {
    return configuredAssistantUrl;
  }

  const configuredChatUrl = (import.meta.env.VITE_CHAT_BUILDER_API_URL ?? "").trim();
  if (configuredChatUrl) {
    return configuredChatUrl.replace(/\/v1\/chat-builder\/draft\/?$/, "/v1/notebook-assistant/ask");
  }

  if (
    typeof window !== "undefined" &&
    (
      window.location.hostname === "" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    )
  ) {
    return "http://localhost:8787/v1/notebook-assistant/ask";
  }

  return "";
}

async function readNotebookAssistantSseResponse(
  response: Response,
  onTextDelta: ((delta: string) => void) | undefined
): Promise<Awaited<ReturnType<typeof readAssistantSseResponse>>> {
  return readAssistantSseResponse(response, parseNotebookAssistantSseEvent, onTextDelta);
}

function parseNotebookAssistantSseEvent(event: unknown): string {
  if (
    event &&
    typeof event === "object" &&
    "type" in event &&
    "delta" in event &&
    event.type === "response.output_text.delta" &&
    typeof event.delta === "string"
  ) {
    return event.delta;
  }

  if (
    event &&
    typeof event === "object" &&
    "type" in event &&
    "text" in event &&
    event.type === "response.output_text.done" &&
    typeof event.text === "string"
  ) {
    return event.text;
  }

  if (
    event &&
    typeof event === "object" &&
    "type" in event &&
    "response" in event &&
    event.type === "response.completed"
  ) {
    return extractOpenAiTextResponse(event.response as Parameters<typeof extractOpenAiTextResponse>[0]) ?? "";
  }

  return "";
}

function truncateNotebookAssistantContext(context: string): string {
  const maxLength = 56000;
  if (context.length <= maxLength) {
    return context;
  }

  return `${context.slice(0, maxLength)}\n\n[Context truncated for size.]`;
}

function listScopedToolNames(scope: NotebookAssistantProposalScope): string[] {
  return [...getNotebookAssistantScopeToolNames(scope)];
}

function findEquationDescription(equationsCell: EquationsCell, variable: string): string | undefined {
  for (const row of equationsCell.equations) {
    if (isRowComment(row)) {
      continue;
    }
    if (row.name === variable) {
      return row.desc;
    }
  }
  return undefined;
}
