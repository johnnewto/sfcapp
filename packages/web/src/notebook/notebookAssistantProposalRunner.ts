import {
  extractNotebookAssistantToolRequests,
  getPatchFromNotebookAssistantToolResults,
  summarizeNotebookAssistantToolResults
} from "./notebookAssistantFlow";
import {
  buildNotebookAssistantLocalToolResultAnswer,
  buildScopedNotebookAssistantContext,
  requestNotebookAssistantAnswer,
  type NotebookAssistantInlinePatch,
  type NotebookAssistantMessage
} from "./notebookAssistantRuntime";
import {
  buildScopedNotebookProposalSemanticSummary,
  filterNotebookAssistantToolRequestsForScope,
  getNotebookAssistantScopeContract,
  resolveNotebookAssistantScopeTarget,
  validateNotebookPatchAgainstScope,
  type NotebookAssistantProposalScope
} from "./notebookAssistantScope";
import {
  dispatchNotebookAssistantToolRequests,
  type NotebookAssistantSnapshot,
  type NotebookAssistantToolRequest,
  type NotebookAssistantToolResult
} from "./notebookAssistantTools";
import { previewNotebookPatch, type NotebookPatch } from "./notebookPatch";

export interface ScopedNotebookAssistantProposalResult {
  blocked: NotebookAssistantToolRequest[];
  extractionError?: string;
  inlinePatch: NotebookAssistantInlinePatch | null;
  patch: NotebookPatch | null;
  scopeViolations: string[];
  semanticSummary: string[];
  text: string;
  toolResults: NotebookAssistantToolResult[];
}

export function processScopedNotebookAssistantResponse(args: {
  question: string;
  responseText: string;
  scope: NotebookAssistantProposalScope;
  snapshot: NotebookAssistantSnapshot;
}): ScopedNotebookAssistantProposalResult {
  const target = resolveNotebookAssistantScopeTarget(args.snapshot.document, args.scope);
  if (!target.ok) {
    return emptyScopedProposalResult(target.message);
  }

  const extraction = extractNotebookAssistantToolRequests(args.responseText);
  if (extraction.error) {
    return {
      ...emptyScopedProposalResult(extraction.error),
      extractionError: extraction.error
    };
  }

  if (extraction.requests.length === 0) {
    return {
      ...emptyScopedProposalResult(args.responseText.trim() || "No tool requests were returned for this scoped proposal."),
      text: args.responseText.trim()
    };
  }

  const filtered = filterNotebookAssistantToolRequestsForScope(args.scope, extraction.requests);
  if (filtered.allowed.length === 0) {
    const blockedNames = filtered.blocked.map((request) => request.name).join(", ");
    return {
      blocked: filtered.blocked,
      inlinePatch: null,
      patch: null,
      scopeViolations: [
        `All tool requests were blocked for this ${args.scope.kind} scope (${blockedNames || "none"}).`
      ],
      semanticSummary: [],
      text: [
        getNotebookAssistantScopeContract(args.scope),
        blockedNames
          ? `Blocked tool request${filtered.blocked.length === 1 ? "" : "s"}: ${blockedNames}.`
          : null
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n\n"),
      toolResults: []
    };
  }

  const toolDispatch = dispatchNotebookAssistantToolRequests(args.snapshot, filtered.allowed);
  const proposedPatch =
    toolDispatch.proposedPatch ?? getPatchFromNotebookAssistantToolResults(toolDispatch.toolResults, filtered.allowed);

  if (!proposedPatch) {
    const toolSummary = summarizeNotebookAssistantToolResults(toolDispatch.toolResults);
    return {
      blocked: filtered.blocked,
      inlinePatch: null,
      patch: null,
      scopeViolations: [],
      semanticSummary: [],
      text: args.responseText.trim() || toolSummary,
      toolResults: toolDispatch.toolResults
    };
  }

  const scopeViolations = validateNotebookPatchAgainstScope(args.snapshot.document, args.scope, proposedPatch);
  if (scopeViolations.length > 0) {
    return {
      blocked: filtered.blocked,
      inlinePatch: null,
      patch: null,
      scopeViolations,
      semanticSummary: [],
      text: [
        "A patch was prepared, but it was rejected because it left the allowed cell scope.",
        ...scopeViolations
      ].join("\n"),
      toolResults: toolDispatch.toolResults
    };
  }

  const preview = previewNotebookPatch(args.snapshot.document, proposedPatch);
  const semanticSummary = buildScopedNotebookProposalSemanticSummary({
    document: args.snapshot.document,
    patch: proposedPatch,
    scope: args.scope
  });
  const localAnswer = buildNotebookAssistantLocalToolResultAnswer({
    proposedPatch,
    toolResults: toolDispatch.toolResults
  });

  return {
    blocked: filtered.blocked,
    inlinePatch: {
      isJsonVisible: false,
      patch: proposedPatch,
      preview,
      status: "ready"
    },
    patch: proposedPatch,
    scopeViolations: [],
    semanticSummary,
    text:
      localAnswer ??
      [
        proposedPatch.description?.trim() || "Proposed notebook change prepared.",
        ...semanticSummary,
        "Review the proposal below, then apply it when ready."
      ].join("\n\n"),
    toolResults: toolDispatch.toolResults
  };
}

export async function runScopedNotebookAssistantProposal(args: {
  betaPassword: string;
  messages?: NotebookAssistantMessage[];
  model: string;
  onTextDelta?: (delta: string) => void;
  question: string;
  resultCount: number;
  scope: NotebookAssistantProposalScope;
  selectedPeriodIndex: number;
  snapshot: NotebookAssistantSnapshot;
  uiMessage?: string | null;
}): Promise<ScopedNotebookAssistantProposalResult> {
  const target = resolveNotebookAssistantScopeTarget(args.snapshot.document, args.scope);
  if (!target.ok) {
    return emptyScopedProposalResult(target.message);
  }

  const context = buildScopedNotebookAssistantContext({
    document: args.snapshot.document,
    resultCount: args.resultCount,
    scope: args.scope,
    selectedPeriodIndex: args.selectedPeriodIndex,
    uiMessage: args.uiMessage ?? null
  });

  const answer = await requestNotebookAssistantAnswer({
    betaPassword: args.betaPassword,
    context,
    messages: args.messages ?? [],
    model: args.model,
    onTextDelta: args.onTextDelta,
    question: args.question
  });

  return processScopedNotebookAssistantResponse({
    question: args.question,
    responseText: answer.text,
    scope: args.scope,
    snapshot: args.snapshot
  });
}

function emptyScopedProposalResult(text: string): ScopedNotebookAssistantProposalResult {
  return {
    blocked: [],
    inlinePatch: null,
    patch: null,
    scopeViolations: [],
    semanticSummary: [],
    text,
    toolResults: []
  };
}
