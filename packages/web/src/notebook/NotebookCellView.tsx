import { parseLenientJsonValue } from "@sfcr/notebook-core";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { AssistantMarkdown } from "../components/AssistantMarkdown";
import type { EditorState } from "../lib/editorModel";
import { applyFixedMenuPosition } from "../lib/clampFixedMenuPosition";
import { isPartialSimulationResult, partialResultFailurePeriodIndex } from "../lib/partialRunResult";
import {
  buildVariableDescriptions,
  type VariableDescriptions
} from "../lib/variableDescriptions";
import { buildVariableUnitMetadata } from "../lib/units";
import {
  findRunCellForInspectorModelSource,
  resolveInspectorModelSource,
  type VariableInspectRequest
} from "../lib/variableInspect";
import {
  buildEditorStateForNotebookModel,
  collectModelExternals,
  findEquationsCell,
  findExternalsCell,
  findInitialValuesCell,
  findSolverCell
} from "./modelSections";
import { buildAbmVariableDescriptions } from "./abmInspect";
import { resolveNearestNotebookContextCell } from "./notebookContext";
import { MatrixUnitMetaDialog } from "./components/MatrixUnitMetaDialog";
import { NotebookCellMore } from "./components/NotebookCellMore";
import { MatrixEquationProposalDialog } from "./components/MatrixEquationProposalDialog";
import { MatrixSourceEditor } from "./MatrixSourceEditor";
import { NotebookHighlightedSourceEditor } from "./NotebookHighlightedSourceEditor";
import {
  applyMatrixEquationUpdates,
  collectProposedMatrixEquationUpdates,
  sumRowHasStockAnnotations,
  defaultSelectedMatrixEquationVariables,
  isAccountTransactionsMatrix,
  type ProposedMatrixEquationUpdate
} from "./matrixAccountSumRow";
import {
  applyMatrixUnitMetaUpdates,
  collectProposedMatrixUnitUpdates,
  defaultSelectedMatrixUnitVariables,
  resolveModelIdFromSourceRunCell,
  buildVariableUnitMetadataForModel
} from "./matrixUnitMetadataSync";
import { formatMatrixCellUnitValidationMessage } from "./matrixUnitValidation";
import { resolveAccountingMatrixKind } from "./validation";
import { NotebookRenderProfiler } from "./notebookProfiler";
import { RunSourceEditor } from "./RunSourceEditor";
import {
  applySourceHelper,
  buildNotebookCellHelpText,
  buildSourceHelpText,
  buildSourceHelperActions,
  formatCellBody,
  isSourceEditable,
  parseCellSource,
  readCellSourceTitle,
  serializeCellBody,
  writeCellSourceTitle
} from "./sourceEditing";
import {
  NotebookCellHeaderActions,
  NotebookCellPinButton,
  NotebookLinkedEditorHeader
} from "./components/NotebookCellHeader";
import {
  ExternalsCellView,
  InitialValuesCellView,
  SolverCellView
} from "./components/LinkedSectionViews";
import { AbmModelCellView } from "./components/AbmModelCellView";
import {
  appendChartVariable,
  buildResolvedChartSeries,
  moveChartSeriesByDisplayName,
  removeChartSeriesByDisplayName,
  resolveChartSeriesDisplayNames,
  setChartTimeRangeInclusive,
  suggestChartAxisGroups
} from "./chartSeries";
import {
  formatChartCompareMode,
  getNextChartCompareMode,
  resolveChartCompareMode
} from "./chartCompareMode";
import { ChartCellView, RunCellView } from "./components/RunChartViews";
import type { MatrixGraphSliceHighlight } from "./graphDocumentHighlight";
import { MatrixCellView } from "./components/MatrixCellView";
import { MatrixEntryDisplayModeToggle } from "./components/MatrixEntryDisplayModeToggle";
import { type MatrixEntryDisplayMode } from "./matrixEntryDisplay";
import type { MatrixGraphRequest } from "./matrixSliceGraph";
import {
  buildEditorStateForStandaloneModelSections,
  buildIssueMapForStandaloneModelSections,
  EquationsCellView,
  ModelCellView
} from "./components/ModelEquationViews";
import { SequenceCellView } from "./components/SequenceCellView";
import { SankeyCellView } from "./components/SankeyCellView";
import { TableCellView } from "./components/TableCellView";
import type {
  ChartCell,
  EquationsCell,
  ExternalsCell,
  InitialValuesCell,
  MatrixCell,
  ModelCell,
  NotebookCellInsertType,
  NotebookCell,
  RunCell,
  SequenceCell,
  SolverCell,
  TableCell
} from "./types";
import { useNotebookRunner } from "./useNotebookRunner";
import { useViewportObserver } from "../hooks/useViewportObserver";

const VIEWPORT_DEFERRED_CELL_TYPES = new Set<NotebookCell["type"]>([
  "chart",
  "chart-grid",
  "table",
  "matrix",
  "sequence",
  "sankey"
]);

const CELL_INSERT_TYPES: NotebookCellInsertType[] = [
  "markdown",
  "run",
  "chart",
  "chart-grid",
  "table",
  "matrix",
  "sequence",
  "sankey"
];

function formatCellInsertType(type: NotebookCellInsertType): string {
  switch (type) {
    case "markdown":
      return "Markdown";
    case "run":
      return "Run";
    case "chart":
      return "Chart";
    case "chart-grid":
      return "Chart grid";
    case "table":
      return "Table";
    case "matrix":
      return "Matrix";
    case "sequence":
      return "Sequence";
    case "sankey":
      return "Sankey";
  }
}

function getInsertDisabledReason(
  type: NotebookCellInsertType,
  context: { hasModelSource: boolean; hasRunSource: boolean }
): string | null {
  if (type === "run" && !context.hasModelSource) {
    return "Requires a model cell.";
  }
  if (
    (type === "chart" || type === "chart-grid" || type === "table") &&
    !context.hasRunSource
  ) {
    return "Requires a run cell.";
  }
  return null;
}

function hasRunnableModelSource(cells: NotebookCell[]): boolean {
  if (cells.some((cell) => cell.type === "model")) {
    return true;
  }

  const equationModelIds = new Set(
    cells.filter((cell) => cell.type === "equations").map((cell) => cell.modelId)
  );
  return cells.some((cell) => cell.type === "solver" && equationModelIds.has(cell.modelId));
}

interface MatrixSequenceViewState {
  highlightedStepIndex: number | null;
  layoutMode: "swimlane" | "multiport" | "lifelines";
  participantColumnOrder?: string[];
  pendingPeriodAdvance: boolean;
  pendingPeriodRetreat: boolean;
  previousCellId: string;
  previousPeriodIndex: number;
  visibleStepCount: number;
}

type NotebookCellPresentation = "canvas" | "pinned-panel";

export interface NotebookCellViewProps {
  activeEditorCellId: string | null;
  cell: NotebookCell;
  cells: NotebookCell[];
  notebookScopeId: string;
  getModelCurrentValues(ref: {
    modelId?: string;
    sourceModelId?: string;
    sourceModelCellId?: string;
  }): Record<string, number | undefined>;
  getModelLaggedCurrentValues(ref: {
    modelId?: string;
    sourceModelId?: string;
    sourceModelCellId?: string;
  }): Record<string, number | undefined>;
  isPinnedInPanel?: boolean;
  maxPeriodIndex: number;
  /** When set, chart time axes render calendar years from `metadata.timeAxis.startYear`. */
  timeAxisStartYear?: number;
  onPinCellRequest?(cellId: string): void;
  presentation?: NotebookCellPresentation;
  viewportRoot: Element | null;
  onActiveEditorCellIdChange(cellId: string | null): void;
  onSelectedCellIdChange(cellId: string): void;
  onSetCellUrl(cellId: string): void;
  onSelectedPeriodIndexChange(nextIndex: number): void;
  onDeleteCell(cellId: string): void;
  onInsertCell(cellId: string, placement: "above" | "below", type: NotebookCellInsertType): void;
  onMoveCell(cellId: string, direction: -1 | 1): void;
  onModelChange(cellId: string, editor: EditorState): void;
  onCellChange(cellId: string, updater: (cell: NotebookCell) => NotebookCell): void;
  onReplaceCells(nextCells: NotebookCell[]): void;
  onCellHelpRequest(args: {
    cellId: string;
    cellType: NotebookCell["type"];
    title: string;
  }): void;
  onMatrixGraphRequest?(request: MatrixGraphRequest): void;
  onVariableInspectRequest(args: VariableInspectRequest): void;
  onDiagnoseBlockConvergence?(runCell: RunCell): void;
  onShowSolverBlockDag?(runCell: RunCell): void;
  onTestBlockConvergence?(args: {
    modelId: string;
    initialValues: InitialValuesCell["initialValues"];
  }): void;
  blockConvergenceComputing?: boolean;
  highlightedVariable?: string | null;
  graphSliceHighlight?: MatrixGraphSliceHighlight | null;
  runner: ReturnType<typeof useNotebookRunner>;
  selectedCellId: string | null;
  selectedPeriodIndex: number;
  onRunTourRequest?(): void;
  showRunTourButton?: boolean;
}

function NotebookCellViewComponent({
  activeEditorCellId,
  cell,
  cells,
  notebookScopeId,
  getModelCurrentValues,
  getModelLaggedCurrentValues,
  isPinnedInPanel = false,
  maxPeriodIndex,
  timeAxisStartYear,
  onPinCellRequest,
  presentation = "canvas",
  viewportRoot,
  onActiveEditorCellIdChange,
  onSelectedCellIdChange,
  onSetCellUrl,
  onSelectedPeriodIndexChange,
  onDeleteCell,
  onInsertCell,
  onMoveCell,
  runner,
  selectedCellId,
  selectedPeriodIndex,
  onModelChange,
  onCellChange,
  onReplaceCells,
  onCellHelpRequest,
  onMatrixGraphRequest,
  onVariableInspectRequest,
  onDiagnoseBlockConvergence,
  onShowSolverBlockDag,
  onTestBlockConvergence,
  blockConvergenceComputing = false,
  highlightedVariable = null,
  graphSliceHighlight = null,
  onRunTourRequest,
  showRunTourButton = false
}: NotebookCellViewProps) {
  const status = runner.status[cell.id] ?? "idle";
  const error = runner.errors[cell.id];
  const runResult = cell.type === "run" ? runner.getResult(cell.id) : null;
  const partialRunPeriodIndex =
    runResult && isPartialSimulationResult(runResult)
      ? partialResultFailurePeriodIndex(runResult)
      : null;
  const laggedPeriodLabel = selectedPeriodIndex > 0 ? `period ${selectedPeriodIndex}` : undefined;
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [titleDraft, setTitleDraft] = useState(() => cell.title);
  const [sourceDraft, setSourceDraft] = useState(() => serializeCellBody(cell));
  const [moreDraft, setMoreDraft] = useState(() => cell.more ?? "");
  const [sourceLayoutMode, setSourceLayoutMode] = useState<
    "pretty" | "compact" | "grid" | "run"
  >(cell.type === "matrix" ? "grid" : cell.type === "run" ? "run" : "compact");
  const [openSourceMenu, setOpenSourceMenu] = useState<"insert" | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceValidationError, setSourceValidationError] = useState<string | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isCellInsertMenuOpen, setIsCellInsertMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isMatrixUnitMetaDialogOpen, setIsMatrixUnitMetaDialogOpen] = useState(false);
  const [matrixUnitMetaSelection, setMatrixUnitMetaSelection] = useState<Set<string>>(new Set());
  const [isMatrixEquationProposalDialogOpen, setIsMatrixEquationProposalDialogOpen] = useState(false);
  const [matrixEquationProposalSelection, setMatrixEquationProposalSelection] = useState<Set<string>>(
    new Set()
  );
  const [matrixEntryDisplayModes, setMatrixEntryDisplayModes] = useState<
    Record<string, MatrixEntryDisplayMode>
  >({});
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const cellContextMenuRef = useRef<HTMLDivElement | null>(null);
  const deferredBodyRef = useRef<HTMLDivElement | null>(null);
  const [measuredDeferredBodyHeight, setMeasuredDeferredBodyHeight] = useState<number | null>(null);
  const currentSerializedBody = serializeCellBody(cell);
  const currentMore = cell.more ?? "";
  const hasSourceEdits =
    titleDraft !== cell.title ||
    sourceDraft !== currentSerializedBody ||
    moreDraft !== currentMore;
  const isCollapsed = cell.collapsed === true && !isEditingSource && !isLinkedModelEditorCell(cell);
  const variableDescriptions = useMemo(
    () => resolveCellVariableDescriptions(cells, cell),
    [cells, cell]
  );
  const variableUnitMetadata = useMemo(
    () => resolveCellVariableUnitMetadata(cells, cell),
    [cells, cell]
  );
  const draftMatrixUnitMetaContext = useMemo(() => {
    if (!isEditingSource || cell.type !== "matrix" || sourceLayoutMode !== "grid") {
      return null;
    }

    try {
      const parsed = parseCellSource(cell, sourceDraft) as MatrixCell;
      const accountingKind = resolveAccountingMatrixKind(parsed);
      const modelId = resolveModelIdFromSourceRunCell(cells, parsed.sourceRunCellId);
      if (!accountingKind || !modelId) {
        return null;
      }

      const modelUnitMetadata = buildVariableUnitMetadataForModel(cells, modelId);
      const proposals = collectProposedMatrixUnitUpdates({
        cells,
        matrix: parsed,
        modelId,
        variableUnitMetadata: modelUnitMetadata
      });

      return {
        matrixTitle: parsed.title,
        modelId,
        proposals
      };
    } catch {
      return null;
    }
  }, [cell, cells, isEditingSource, sourceDraft, sourceLayoutMode]);
  const draftMatrixEquationContext = useMemo(() => {
    if (!isEditingSource || cell.type !== "matrix" || sourceLayoutMode !== "grid") {
      return null;
    }

    try {
      const parsed = parseCellSource(cell, sourceDraft) as MatrixCell;
      const modelId = resolveModelIdFromSourceRunCell(cells, parsed.sourceRunCellId);
      if (!isAccountTransactionsMatrix(parsed) || !modelId) {
        return null;
      }

      const proposals = collectProposedMatrixEquationUpdates({
        cells,
        matrix: parsed,
        modelId
      });

      return {
        matrixTitle: parsed.title,
        modelId,
        proposals,
        hasStockAnnotations: sumRowHasStockAnnotations(parsed)
      };
    } catch {
      return null;
    }
  }, [cell, cells, isEditingSource, sourceDraft, sourceLayoutMode]);
  const markdownInspectionContext = useMemo(
    () =>
      cell.type === "markdown"
        ? resolveNotebookInspectionContext({
            cell,
            cells,
            getModelCurrentValues,
            runner,
            selectedPeriodIndex
          })
        : null,
    [cell, cells, getModelCurrentValues, runner, selectedPeriodIndex]
  );
  const runInspectionContext = useMemo(
    () =>
      cell.type === "run"
        ? resolveNotebookInspectionContext({
            cell,
            cells,
            getModelCurrentValues,
            runner,
            selectedPeriodIndex
          })
        : null,
    [cell, cells, getModelCurrentValues, runner, selectedPeriodIndex]
  );
  const chartInspectionContext = useMemo(
    () =>
      cell.type === "chart"
        ? resolveNotebookInspectionContext({
            cell,
            cells,
            getModelCurrentValues,
            runner,
            selectedPeriodIndex
          })
        : null,
    [cell, cells, getModelCurrentValues, runner, selectedPeriodIndex]
  );
  const abmInspectionContext = useMemo(
    () =>
      cell.type === "abm-model"
        ? resolveNotebookInspectionContext({
            cell,
            cells,
            getModelCurrentValues,
            runner,
            selectedPeriodIndex
          })
        : null,
    [cell, cells, getModelCurrentValues, runner, selectedPeriodIndex]
  );
  const noteInspectionContext = useMemo(
    () =>
      resolveNotebookInspectionContext({
        cell,
        cells,
        getModelCurrentValues,
        runner,
        selectedPeriodIndex
      }),
    [cell, cells, getModelCurrentValues, runner, selectedPeriodIndex]
  );
  const chartAxisGroupSuggestion = useMemo(() => {
    if (cell.type !== "chart") {
      return undefined;
    }
    const result = runner.getResult(cell.sourceRunCellId);
    if (result) {
      try {
        const grouped = suggestChartAxisGroups(
          buildResolvedChartSeries(cell, result, (runCellId) => runner.getResult(runCellId))
        );
        if (grouped.length > 0) {
          return grouped;
        }
      } catch {
        // Fall through to name-based suggestion below.
      }
    }
    // No run result yet: still reflect this chart's actual variables in one group.
    const names = resolveChartSeriesDisplayNames(cell);
    return names.length > 0 ? [names] : undefined;
  }, [cell, runner]);
  const showToolbarHelp = !isLinkedModelEditorCell(cell);
  const toolbarHelpText = showToolbarHelp ? buildNotebookCellHelpText(cell) : null;
  const requestCellHelp = () =>
    onCellHelpRequest({
      cellId: cell.id,
      cellType: cell.type,
      title: cell.title
    });
  const linkedEditorPinProps =
    presentation === "canvas" && onPinCellRequest
      ? {
          isPinnedInPanel,
          onPinCellRequest: () => onPinCellRequest(cell.id)
        }
      : {};
  const [isLinkedEditorEditing, setIsLinkedEditorEditing] = useState(false);
  const [matrixSequenceViewState, setMatrixSequenceViewState] = useState<MatrixSequenceViewState | null>(null);
  const isActivelyEditing = isEditingSource || isLinkedEditorEditing;
  const cellViewport = useViewportObserver<HTMLElement>({
    disabled:
      isCollapsed ||
      isActivelyEditing ||
      !isViewportDeferredCellType(cell.type),
    root: viewportRoot,
    rootMargin: "800px 0px"
  });
  const shouldMountViewportDeferredBody =
    !isViewportDeferredCellType(cell.type) ||
    isCollapsed ||
    isActivelyEditing ||
    cellViewport.isInViewport ||
    selectedCellId === cell.id ||
    activeEditorCellId === cell.id;
  const showViewportDeferredPlaceholder =
    !isCollapsed &&
    !isActivelyEditing &&
    isViewportDeferredCellType(cell.type) &&
    !shouldMountViewportDeferredBody;
  const cellIndex = cells.findIndex((candidate) => candidate.id === cell.id);
  const canMoveCellUp = cellIndex > 0;
  const canMoveCellDown = cellIndex >= 0 && cellIndex < cells.length - 1;
  const hasCellInsertModelSource = hasRunnableModelSource(cells);
  const hasCellInsertRunSource = cells.some((candidate) => candidate.type === "run");
  const cellDescription = getNotebookCellDescription(cell);
  const cellNote = getNotebookCellNote(cell);
  const cellMore = getNotebookCellMore(cell);

  useEffect(() => {
    setTitleDraft(cell.title);
    setSourceDraft(serializeCellBody(cell));
    setMoreDraft(cell.more ?? "");
    setSourceLayoutMode(cell.type === "matrix" ? "grid" : cell.type === "run" ? "run" : "compact");
    setOpenSourceMenu(null);
    setSourceError(null);
    setSourceValidationError(null);
    setIsEditingSource(false);
    setIsLinkedEditorEditing(false);
    setIsMatrixUnitMetaDialogOpen(false);
    setMatrixUnitMetaSelection(new Set());
    setIsMatrixEquationProposalDialogOpen(false);
    setMatrixEquationProposalSelection(new Set());
    setMatrixSequenceViewState(null);
  }, [cell]);

  useEffect(() => {
    setMeasuredDeferredBodyHeight(null);
  }, [cell.id, cell.type]);

  useEffect(() => {
    if (isActivelyEditing) {
      onActiveEditorCellIdChange(cell.id);
      return;
    }

    if (activeEditorCellId === cell.id) {
      onActiveEditorCellIdChange(null);
    }
  }, [activeEditorCellId, cell.id, isActivelyEditing, onActiveEditorCellIdChange]);

  useEffect(() => {
    if (!isEditingSource) {
      setSourceValidationError(null);
      return;
    }

    try {
      const nextCell = parseCellSource(cell, sourceDraft, titleDraft, moreDraft);
      if (nextCell.type === "matrix") {
        setSourceValidationError(
          formatMatrixCellUnitValidationMessage(nextCell, variableUnitMetadata)
        );
        return;
      }

      setSourceValidationError(null);
    } catch (validationError) {
      setSourceValidationError(
        validationError instanceof Error ? validationError.message : "Invalid cell source"
      );
    }
  }, [cell, isEditingSource, moreDraft, sourceDraft, titleDraft, variableUnitMetadata]);

  useEffect(() => {
    if (!isEditingSource || openSourceMenu == null) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (insertMenuRef.current?.contains(target)) {
        return;
      }

      setOpenSourceMenu(null);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpenSourceMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isEditingSource, openSourceMenu]);

  useEffect(() => {
    if (!shouldMountViewportDeferredBody || !isViewportDeferredCellType(cell.type)) {
      return;
    }

    const deferredBody = deferredBodyRef.current;
    if (!deferredBody) {
      return;
    }

    function updateMeasuredHeight(): void {
      if (!deferredBody) {
        return;
      }

      const nextHeight = Math.ceil(deferredBody.getBoundingClientRect().height);
      if (nextHeight <= 0) {
        return;
      }

      setMeasuredDeferredBodyHeight((currentHeight) =>
        currentHeight == null || Math.abs(currentHeight - nextHeight) > 1
          ? nextHeight
          : currentHeight
      );
    }

    updateMeasuredHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateMeasuredHeight);
    observer.observe(deferredBody);

    return () => {
      observer.disconnect();
    };
  }, [cell.type, shouldMountViewportDeferredBody]);

  function handleApplySource(): void {
    try {
      const nextCell = parseCellSource(cell, sourceDraft, titleDraft, moreDraft);
      onCellChange(cell.id, () => nextCell);
      setSourceError(null);
      setSourceValidationError(null);
      setIsEditingSource(false);
    } catch (applyError) {
      setSourceError(applyError instanceof Error ? applyError.message : "Invalid cell source");
    }
  }

  function handleOpenMatrixUnitMetaDialog(): void {
    if (!draftMatrixUnitMetaContext) {
      return;
    }

    setMatrixUnitMetaSelection(defaultSelectedMatrixUnitVariables(draftMatrixUnitMetaContext.proposals));
    setIsMatrixUnitMetaDialogOpen(true);
  }

  function handleOpenMatrixEquationProposalDialog(): void {
    if (!draftMatrixEquationContext) {
      return;
    }

    setMatrixEquationProposalSelection(
      defaultSelectedMatrixEquationVariables(draftMatrixEquationContext.proposals)
    );
    setIsMatrixEquationProposalDialogOpen(true);
  }

  function handleApplyMatrixUnitMetaUpdates(): void {
    if (!draftMatrixUnitMetaContext) {
      return;
    }

    const selectedUpdates = draftMatrixUnitMetaContext.proposals.filter((proposal) =>
      matrixUnitMetaSelection.has(proposal.variable)
    );
    if (selectedUpdates.length === 0) {
      return;
    }

    onReplaceCells(applyMatrixUnitMetaUpdates(cells, selectedUpdates));
    setIsMatrixUnitMetaDialogOpen(false);
  }

  function handleApplyMatrixEquationUpdates(updates: ProposedMatrixEquationUpdate[]): void {
    if (updates.length === 0) {
      return;
    }

    onReplaceCells(applyMatrixEquationUpdates(cells, updates));
    setIsMatrixEquationProposalDialogOpen(false);
  }

  function handleCancelSource(): void {
    setTitleDraft(cell.title);
    setSourceDraft(serializeCellBody(cell));
    setMoreDraft(cell.more ?? "");
    setSourceLayoutMode(cell.type === "matrix" ? "grid" : cell.type === "run" ? "run" : "compact");
    setOpenSourceMenu(null);
    setSourceError(null);
    setSourceValidationError(null);
    setIsMatrixUnitMetaDialogOpen(false);
    setMatrixUnitMetaSelection(new Set());
    setIsMatrixEquationProposalDialogOpen(false);
    setMatrixEquationProposalSelection(new Set());
    setIsEditingSource(false);
  }

  function resolveSourceJsonLayoutMode(): "pretty" | "compact" {
    return sourceLayoutMode === "pretty" ? "pretty" : "compact";
  }

  function handleTitleDraftChange(nextTitle: string): void {
    setTitleDraft(nextTitle);
    if (cell.type === "markdown") {
      return;
    }

    const nextSource = writeCellSourceTitle(sourceDraft, nextTitle, resolveSourceJsonLayoutMode());
    if (nextSource != null) {
      setSourceDraft(nextSource);
    }
  }

  function handleSourceDraftChange(nextSource: string): void {
    setSourceDraft(nextSource);
    if (cell.type === "markdown") {
      return;
    }

    const nextTitle = readCellSourceTitle(nextSource);
    if (nextTitle != null && nextTitle !== titleDraft) {
      setTitleDraft(nextTitle);
    }
  }

  function handleSourceLayoutModeChange(nextMode: "pretty" | "compact" | "grid" | "run"): void {
    if (cell.type === "markdown") {
      setSourceLayoutMode(nextMode);
      return;
    }

    if (nextMode === "grid" || nextMode === "run") {
      try {
        const parsed = parseLenientJsonValue(sourceDraft) as NotebookCell;
        setSourceDraft(formatCellBody(parsed, "compact"));
      } catch {
        // Keep the current draft; the structured matrix editor only renders from valid cell state.
      }

      setSourceLayoutMode(nextMode);
      return;
    }

    try {
      const parsed = parseLenientJsonValue(sourceDraft) as NotebookCell;
      setSourceDraft(formatCellBody(parsed, nextMode));
      setSourceLayoutMode(nextMode);
    } catch {
      setSourceLayoutMode(nextMode);
    }
  }

  function handleCellClick(event: React.MouseEvent<HTMLElement>): void {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, summary, a, input, select, textarea, label, details")
    ) {
      return;
    }

    onSelectedCellIdChange(cell.id);
  }

  function handleCellContextMenu(event: React.MouseEvent<HTMLElement>): void {
    if (isActivelyEditing) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        [
          "input",
          "select",
          "textarea",
          "[contenteditable='true']",
          ".chart-legend",
          ".chart-legend-context-menu",
          ".result-chart",
          ".notebook-model-view-row",
          ".notebook-matrix-table",
          ".notebook-cell-context-menu"
        ].join(", ")
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectedCellIdChange(cell.id);
    setCellContextMenu({ x: event.clientX, y: event.clientY });
  }

  function closeCellContextMenu(): void {
    setCellContextMenu(null);
    setIsCellInsertMenuOpen(false);
  }

  useEffect(() => {
    if (isActivelyEditing && cellContextMenu != null) {
      closeCellContextMenu();
    }
  }, [cellContextMenu, isActivelyEditing]);

  useLayoutEffect(() => {
    if (cellContextMenu && cellContextMenuRef.current) {
      applyFixedMenuPosition(cellContextMenuRef.current, cellContextMenu.x, cellContextMenu.y);
    }
  }, [cellContextMenu]);

  useEffect(() => {
    if (cellContextMenu == null) {
      return;
    }

    function handlePointerDown(): void {
      closeCellContextMenu();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeCellContextMenu();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cellContextMenu]);

  return (
    <NotebookRenderProfiler
      id="NotebookCellView"
      metadata={{
        cellId: cell.id,
        cellType: cell.type,
        isCollapsed,
        isSelected: selectedCellId === cell.id
      }}
    >
      <article
        ref={(node) => {
          cellViewport.targetRef.current = node;
        }}
        id={presentation === "canvas" ? cell.id : undefined}
        className={`notebook-cell notebook-cell-${cell.type}${
          presentation === "pinned-panel" ? " notebook-cell-is-pinned-panel" : ""
        }${
          isCompactLinkedCellHeader(cell) ? " notebook-cell-linked-collapsed" : ""
        }${selectedCellId === cell.id ? " notebook-cell-is-selected" : ""}${
          activeEditorCellId === cell.id ? " notebook-cell-is-active-editor" : ""
        }`}
        onClick={presentation === "canvas" ? handleCellClick : undefined}
      >
        <div
          className="notebook-cell-content"
          onContextMenu={presentation === "canvas" ? handleCellContextMenu : undefined}
        >
        <div className="notebook-cell-toolbar">
          <NotebookLinkedEditorHeader
            actions={
              <NotebookCellHeaderActions
                helpDialogContent={
                  isEditingSource && cell.type === "chart" ? (
                    <pre className="notebook-source-help-code">{buildSourceHelpText(cell)}</pre>
                  ) : undefined
                }
                helpDialogTitle={
                  isEditingSource && cell.type === "chart" ? "Chart Syntax" : undefined
                }
                helpText={toolbarHelpText}
                isCollapsed={cell.collapsed === true}
                isEditing={isEditingSource}
                leadingActions={
                  cell.type === "run" ? (
                    <>
                      <button
                        type="button"
                        className="notebook-run-button"
                        onClick={() => void runner.runCell(cell.id)}
                        disabled={status === "running"}
                      >
                        {status === "running" ? "Running..." : "Run cell"}
                      </button>
                      <span className={`run-status run-status-${status}`}>{status}</span>
                    </>
                  ) : null
                }
                onEditToggle={
                  !isLinkedModelEditorCell(cell) && !isEditingSource
                    ? () => setIsEditingSource(true)
                    : null
                }
                onHelpRequest={
                  toolbarHelpText
                    ? () =>
                        onCellHelpRequest({
                          cellId: cell.id,
                          cellType: cell.type,
                          title: cell.title
                        })
                    : null
                }
                onToggleCollapsed={
                  !isLinkedModelEditorCell(cell)
                    ? () =>
                        onCellChange(cell.id, (current) => ({
                          ...current,
                          collapsed: !current.collapsed
                        }))
                    : null
                }
                title={cell.title}
                trailingActions={
                  <>
                    {presentation === "canvas" && onPinCellRequest ? (
                      <NotebookCellPinButton
                        isPinnedInPanel={isPinnedInPanel}
                        onPinCellRequest={() => onPinCellRequest(cell.id)}
                      />
                    ) : null}
                    {cell.type === "matrix" && !isEditingSource && cell.collapsed !== true ? (
                      <MatrixEntryDisplayModeToggle
                        mode={matrixEntryDisplayModes[cell.id] ?? "both"}
                        onChange={(nextMode) =>
                          setMatrixEntryDisplayModes((current) => ({
                            ...current,
                            [cell.id]: nextMode
                          }))
                        }
                      />
                    ) : null}
                    {cell.type === "chart" && !isEditingSource ? (
                      <>
                        <button
                          type="button"
                          className={`notebook-run-button notebook-chart-compare-toggle${
                            resolveChartCompareMode(cell) === "levels" ? "" : " is-active"
                          }`}
                          onClick={() =>
                            onCellChange(cell.id, (current) =>
                              current.type === "chart"
                                ? {
                                    ...current,
                                    compareMode: getNextChartCompareMode(
                                      resolveChartCompareMode(current)
                                    )
                                  }
                                : current
                            )
                          }
                        >
                          Compare: {formatChartCompareMode(resolveChartCompareMode(cell))}
                        </button>
                        <button
                          type="button"
                          className={`notebook-run-button notebook-reference-trace-toggle${
                            resolveChartReferenceTrace(cell, cells) === "none" ? "" : " is-active"
                          }`}
                          onClick={() =>
                            onCellChange(cell.id, (current) =>
                              current.type === "chart"
                                ? {
                                    ...current,
                                    referenceTrace: getNextChartReferenceTrace(
                                      resolveChartReferenceTrace(current, cells)
                                    )
                                  }
                                : current
                            )
                          }
                        >
                          Reference: {formatChartReferenceTrace(resolveChartReferenceTrace(cell, cells))}
                        </button>
                      </>
                    ) : null}
                    {isSourceEditable(cell) && isEditingSource ? (
                      <>
                        <button
                          type="button"
                          className="notebook-run-button notebook-source-toggle"
                          onClick={handleApplySource}
                          disabled={!hasSourceEdits || sourceValidationError != null}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className="notebook-run-button notebook-source-toggle"
                          onClick={handleCancelSource}
                        >
                          Cancel
                        </button>
                      </>
                    ) : null}
                  </>
                }
              />
            }
            descriptionContent={
              cellDescription ? (
                <AssistantMarkdown
                  className="notebook-cell-description-markdown"
                  currentValues={noteInspectionContext?.currentValues}
                  highlightedVariable={highlightedVariable}
                  onSelectVariable={
                    noteInspectionContext == null
                      ? undefined
                      : (selectedVariable) =>
                          onVariableInspectRequest({
                            ...noteInspectionContext,
                            selectedVariable
                          })
                  }
                  text={cellDescription}
                  variableDescriptions={variableDescriptions}
                  variableUnitMetadata={variableUnitMetadata}
                />
              ) : null
            }
            title={cell.title}
            titleRowTrailing={
              showRunTourButton && onRunTourRequest && !isEditingSource ? (
                <button
                  type="button"
                  className="notebook-markdown-tour-button"
                  onClick={onRunTourRequest}
                >
                  Run Tour
                </button>
              ) : null
            }
            typeLabel={cell.type}
          />
        </div>

        {!isCollapsed && error ? <div className="error-text">Error: {error}</div> : null}
        {!isCollapsed && partialRunPeriodIndex != null ? (
          <div className="status-hint">
            <p>
              Partial results through period {partialRunPeriodIndex + 1} are available for inspection. Values at
              the failure period reflect the last solver iteration and may not be converged.
            </p>
            {cell.type === "run" && onDiagnoseBlockConvergence ? (
              <button
                type="button"
                className="secondary-button"
                disabled={blockConvergenceComputing}
                onClick={() => onDiagnoseBlockConvergence(cell)}
              >
                {blockConvergenceComputing ? "Diagnosing…" : "Diagnose block convergence"}
              </button>
            ) : null}
          </div>
        ) : null}
        {!isCollapsed && sourceError ? <div className="error-text">Source error: {sourceError}</div> : null}

        {isEditingSource ? (
          <div className="notebook-source-editor">
            <div className="notebook-source-toolbar">
              <div className="notebook-source-menu" ref={insertMenuRef}>
                <button
                  type="button"
                  className="secondary-button"
                  aria-controls={`source-insert-menu-${cell.id}`}
                  aria-expanded={openSourceMenu === "insert" ? "true" : "false"}
                  onClick={() =>
                    setOpenSourceMenu((current) => (current === "insert" ? null : "insert"))
                  }
                >
                  Insert
                </button>
                {openSourceMenu === "insert" ? (
                  <div
                    id={`source-insert-menu-${cell.id}`}
                    className="notebook-source-menu-panel"
                    aria-label="Source insert actions"
                  >
                    {buildSourceHelperActions(cell, { chartAxisGroupSuggestion }).map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className="secondary-button notebook-source-helper"
                        onClick={() => {
                          setSourceDraft((current) => applySourceHelper(current, action.insert));
                          setOpenSourceMenu(null);
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {cell.type !== "markdown" ? (
                <fieldset className="notebook-source-layout" aria-label="Source layout mode">
                  {cell.type === "matrix" ? (
                    <label className="notebook-source-layout-option">
                      <input
                        type="radio"
                        name={`source-layout-${cell.id}`}
                        checked={sourceLayoutMode === "grid"}
                        onChange={() => handleSourceLayoutModeChange("grid")}
                      />
                      <span>Grid</span>
                    </label>
                  ) : null}
                  {cell.type === "run" ? (
                    <label className="notebook-source-layout-option">
                      <input
                        type="radio"
                        name={`source-layout-${cell.id}`}
                        checked={sourceLayoutMode === "run"}
                        onChange={() => handleSourceLayoutModeChange("run")}
                      />
                      <span>Run</span>
                    </label>
                  ) : null}
                  <label className="notebook-source-layout-option">
                    <input
                      type="radio"
                      name={`source-layout-${cell.id}`}
                      checked={sourceLayoutMode === "pretty"}
                      onChange={() => handleSourceLayoutModeChange("pretty")}
                    />
                    <span>Pretty</span>
                  </label>
                  <label className="notebook-source-layout-option">
                    <input
                      type="radio"
                      name={`source-layout-${cell.id}`}
                      checked={sourceLayoutMode === "compact"}
                      onChange={() => handleSourceLayoutModeChange("compact")}
                    />
                    <span>Compact</span>
                  </label>
                </fieldset>
              ) : null}
              {cell.type === "chart" ? null : (
                <details className="notebook-source-help notebook-source-help-inline">
                  <summary>Syntax help</summary>
                  <pre className="notebook-source-help-code">{buildSourceHelpText(cell)}</pre>
                </details>
              )}
            </div>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={titleDraft}
                onChange={(event) => handleTitleDraftChange(event.target.value)}
                aria-label={`Title editor for ${cell.title}`}
              />
            </label>
            {cell.type === "run" && sourceLayoutMode === "run" ? (
              <RunSourceEditor
                cells={cells}
                runCellId={cell.id}
                value={sourceDraft}
                onChange={handleSourceDraftChange}
                onReplaceCells={onReplaceCells}
              />
            ) : cell.type === "matrix" && sourceLayoutMode === "grid" ? (
              <MatrixSourceEditor value={sourceDraft} onChange={handleSourceDraftChange} />
            ) : (
              <NotebookHighlightedSourceEditor
                active={isEditingSource}
                ariaLabel={`Source editor for ${cell.title}`}
                highlightCellType={cell.type}
                onChange={handleSourceDraftChange}
                value={sourceDraft}
              />
            )}
            <div className="notebook-source-more-section">
              <div className="notebook-source-more-label">More</div>
              <NotebookHighlightedSourceEditor
                active={isEditingSource}
                ariaLabel={`More editor for ${cell.title}`}
                highlightCellType="markdown"
                onChange={setMoreDraft}
                value={moreDraft}
              />
            </div>
            <div className="notebook-source-validation-footer">
              {sourceValidationError ? (
                <div className="notebook-source-validation" aria-live="polite">
                  Live validation: {sourceValidationError}
                </div>
              ) : (
                <div className="notebook-source-validation is-valid" aria-live="polite">
                  Live validation: ready to apply
                </div>
              )}
              {draftMatrixUnitMetaContext ? (
                <button
                  className="secondary-button notebook-matrix-unit-meta-button"
                  disabled={draftMatrixUnitMetaContext.proposals.length === 0}
                  onClick={handleOpenMatrixUnitMetaDialog}
                  type="button"
                >
                  Set variable units from matrix…
                </button>
              ) : null}
              {draftMatrixEquationContext ? (
                <button
                  className="secondary-button notebook-matrix-unit-meta-button"
                  disabled={!draftMatrixEquationContext.hasStockAnnotations}
                  onClick={handleOpenMatrixEquationProposalDialog}
                  type="button"
                >
                  Set accumulation equations…
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {isCollapsed ? null : cell.type === "markdown" ? (
          <AssistantMarkdown
            className="notebook-markdown"
            currentValues={markdownInspectionContext?.currentValues}
            highlightedVariable={highlightedVariable}
            onSelectVariable={
              markdownInspectionContext == null
                ? undefined
                : (selectedVariable) =>
                    onVariableInspectRequest({
                      ...markdownInspectionContext,
                      selectedVariable
                    })
            }
            text={cell.source}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        ) : null}
        {isCollapsed ? null : cell.type === "equations" ? (
          <EquationsCellView
            cell={cell}
            cells={cells}
            currentValues={getModelCurrentValues({ modelId: cell.modelId })}
            laggedCurrentValues={getModelLaggedCurrentValues({ modelId: cell.modelId })}
            laggedPeriodLabel={laggedPeriodLabel}
            externals={findExternalsCell(cells, cell.modelId)?.externals ?? []}
            initialValuesCount={
              findInitialValuesCell(cells, cell.modelId)?.initialValues.length ?? 0
            }
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            onVariableInspectRequest={onVariableInspectRequest}
            highlightedVariable={highlightedVariable}
            viewportRoot={viewportRoot}
            onReplaceCells={onReplaceCells}
            selectedPeriodIndex={selectedPeriodIndex}
            solverCell={findSolverCell(cells, cell.modelId)}
            title={cell.title}
            onChange={(equations) =>
              onCellChange(cell.id, (current) =>
                current.type === "equations" ? { ...current, equations } : current
              )
            }
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "equations"
                  ? { ...current, collapsed: !current.collapsed }
                  : current
              )
            }
          />
        ) : null}
        {isCollapsed ? null : cell.type === "model" ? (
          <ModelCellView
            cell={cell}
            cells={cells}
            currentValues={getModelCurrentValues({ sourceModelCellId: cell.id })}
            laggedCurrentValues={getModelLaggedCurrentValues({ sourceModelCellId: cell.id })}
            laggedPeriodLabel={laggedPeriodLabel}
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            onChange={(editor) => onModelChange(cell.id, editor)}
            onReplaceCells={onReplaceCells}
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "model" ? { ...current, collapsed: !current.collapsed } : current
              )
            }
            title={cell.title}
            onVariableInspectRequest={onVariableInspectRequest}
            highlightedVariable={highlightedVariable            }
          />
        ) : null}
        {isCollapsed ? null : cell.type === "abm-model" ? (
          <AbmModelCellView
            cell={cell}
            currentValues={abmInspectionContext?.currentValues ?? {}}
            highlightedVariable={highlightedVariable}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
            onVariableInspectRequest={(args) => {
              if (!abmInspectionContext) {
                return;
              }
              onVariableInspectRequest({
                ...abmInspectionContext,
                selectedVariable: args.selectedVariable
              });
            }}
          />
        ) : null}
        {isCollapsed ? null : cell.type === "solver" ? (
          <SolverCellView
            cell={cell}
            issueMap={buildIssueMapForStandaloneModelSections(cells, cell.modelId)}
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            title={cell.title}
            onChange={(options) =>
              onCellChange(cell.id, (current) =>
                current.type === "solver" ? { ...current, options } : current
              )
            }
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "solver" ? { ...current, collapsed: !current.collapsed } : current
              )
            }
          />
        ) : null}
        {isCollapsed ? null : cell.type === "externals" ? (
          <ExternalsCellView
            cell={cell}
            cells={cells}
            currentValues={getModelCurrentValues({ modelId: cell.modelId })}
            editor={buildEditorStateForStandaloneModelSections(cells, cell.modelId)}
            issueMap={buildIssueMapForStandaloneModelSections(cells, cell.modelId)}
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            onReplaceCells={onReplaceCells}
            onVariableInspectRequest={onVariableInspectRequest}
            highlightedVariable={highlightedVariable}
            viewportRoot={viewportRoot}
            title={cell.title}
            onChange={(externals) =>
              onCellChange(cell.id, (current) =>
                current.type === "externals" ? { ...current, externals } : current
              )
            }
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "externals"
                  ? { ...current, collapsed: !current.collapsed }
                  : current
              )
            }
          />
        ) : null}
        {isCollapsed ? null : cell.type === "observed" ? (
          <ExternalsCellView
            cell={cell}
            cells={cells}
            currentValues={getModelCurrentValues({ modelId: cell.modelId })}
            editor={buildEditorStateForStandaloneModelSections(cells, cell.modelId)}
            issueMap={buildIssueMapForStandaloneModelSections(cells, cell.modelId)}
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            onReplaceCells={onReplaceCells}
            onVariableInspectRequest={onVariableInspectRequest}
            highlightedVariable={highlightedVariable}
            viewportRoot={viewportRoot}
            title={cell.title}
            onChange={(externals) =>
              onCellChange(cell.id, (current) =>
                current.type === "observed" ? { ...current, externals } : current
              )
            }
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "observed"
                  ? { ...current, collapsed: !current.collapsed }
                  : current
              )
            }
          />
        ) : null}
        {isCollapsed ? null : cell.type === "initial-values" ? (
          <InitialValuesCellView
            cell={cell}
            cells={cells}
            currentValues={getModelCurrentValues({ modelId: cell.modelId })}
            editor={buildEditorStateForStandaloneModelSections(cells, cell.modelId)}
            issueMap={buildIssueMapForStandaloneModelSections(cells, cell.modelId)}
            {...linkedEditorPinProps}
            onEditingChange={setIsLinkedEditorEditing}
            onHelpRequest={requestCellHelp}
            onReplaceCells={onReplaceCells}
            onVariableInspectRequest={onVariableInspectRequest}
            highlightedVariable={highlightedVariable}
            viewportRoot={viewportRoot}
            title={cell.title}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
            onChange={(initialValues) =>
              onCellChange(cell.id, (current) =>
                current.type === "initial-values" ? { ...current, initialValues } : current
              )
            }
            onToggleCollapsed={() =>
              onCellChange(cell.id, (current) =>
                current.type === "initial-values"
                  ? { ...current, collapsed: !current.collapsed }
                  : current
              )
            }
            onTestBlockConvergence={
              onTestBlockConvergence
                ? (initialValues) => onTestBlockConvergence({ modelId: cell.modelId, initialValues })
                : undefined
            }
            blockConvergenceComputing={blockConvergenceComputing}
          />
        ) : null}
        {isCollapsed ? null : cell.type === "run" ? (
          <RunCellView
            cell={cell}
            cells={cells}
            currentValues={runInspectionContext?.currentValues ?? {}}
            editor={runInspectionContext?.editor ?? null}
            onVariableInspectRequest={onVariableInspectRequest}
            onShowSolverBlockDag={
              onShowSolverBlockDag ? () => onShowSolverBlockDag(cell) : undefined
            }
            highlightedVariable={highlightedVariable}
            runner={runner}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        ) : null}
        {showViewportDeferredPlaceholder ? (
          <DeferredNotebookCellPlaceholder
            cell={cell}
            measuredHeight={measuredDeferredBodyHeight}
          />
        ) : null}
        {shouldRenderViewportDeferredBody(cell, isCollapsed, isEditingSource, shouldMountViewportDeferredBody) ? (
          <div className="notebook-cell-deferred-body" ref={deferredBodyRef}>
            {cell.type === "chart" ? (
              <ChartCellView
                cell={cell}
                cells={cells}
                currentValues={chartInspectionContext?.currentValues ?? {}}
                editor={chartInspectionContext?.editor ?? null}
                onAddVariable={(variableName) =>
                  onCellChange(cell.id, (current) =>
                    current.type === "chart" ? appendChartVariable(current, variableName) : current
                  )
                }
                onMoveVariable={(variableName, direction) =>
                  onCellChange(cell.id, (current) =>
                    current.type === "chart"
                      ? moveChartSeriesByDisplayName(current, variableName, direction)
                      : current
                  )
                }
                onRemoveVariable={(variableName) =>
                  onCellChange(cell.id, (current) =>
                    current.type === "chart"
                      ? removeChartSeriesByDisplayName(current, variableName)
                      : current
                  )
                }
                onTimeRangeInclusiveChange={(range) =>
                  onCellChange(cell.id, (current) =>
                    current.type === "chart" ? setChartTimeRangeInclusive(current, range) : current
                  )
                }
                onVariableInspectRequest={onVariableInspectRequest}
                originYear={timeAxisStartYear}
                runner={runner}
                selectedPeriodIndex={selectedPeriodIndex}
                highlightedVariable={highlightedVariable}
                variableDescriptions={variableDescriptions}
                variableUnitMetadata={variableUnitMetadata}
              />
            ) : null}
            {cell.type === "chart-grid" ? (
              <div
                className="notebook-chart-grid"
                style={
                  {
                    "--chart-grid-max-columns": Math.max(1, Math.floor(cell.gridColumns))
                  } as CSSProperties
                }
              >
                {cell.charts.map((chart) => (
                  <figure key={chart.id} className="notebook-chart-grid-item">
                    {chart.title.trim() ? (
                      <figcaption className="notebook-chart-grid-caption">
                        {chart.title}
                      </figcaption>
                    ) : null}
                    <ChartCellView
                      cell={chart}
                      cells={cells}
                      gridAxisFontSize={cell.axisFontSize}
                      currentValues={chartInspectionContext?.currentValues ?? {}}
                      editor={chartInspectionContext?.editor ?? null}
                      onAddVariable={(variableName) =>
                        onCellChange(cell.id, (current) =>
                          current.type === "chart-grid"
                            ? {
                                ...current,
                                charts: current.charts.map((entry) =>
                                  entry.id === chart.id
                                    ? appendChartVariable(entry, variableName)
                                    : entry
                                )
                              }
                            : current
                        )
                      }
                      onMoveVariable={(variableName, direction) =>
                        onCellChange(cell.id, (current) =>
                          current.type === "chart-grid"
                            ? {
                                ...current,
                                charts: current.charts.map((entry) =>
                                  entry.id === chart.id
                                    ? moveChartSeriesByDisplayName(
                                        entry,
                                        variableName,
                                        direction
                                      )
                                    : entry
                                )
                              }
                            : current
                        )
                      }
                      onRemoveVariable={(variableName) =>
                        onCellChange(cell.id, (current) =>
                          current.type === "chart-grid"
                            ? {
                                ...current,
                                charts: current.charts.map((entry) =>
                                  entry.id === chart.id
                                    ? removeChartSeriesByDisplayName(entry, variableName)
                                    : entry
                                )
                              }
                            : current
                        )
                      }
                      onTimeRangeInclusiveChange={(range) =>
                        onCellChange(cell.id, (current) =>
                          current.type === "chart-grid"
                            ? {
                                ...current,
                                charts: current.charts.map((entry) =>
                                  entry.id === chart.id
                                    ? setChartTimeRangeInclusive(entry, range)
                                    : entry
                                )
                              }
                            : current
                        )
                      }
                      onVariableInspectRequest={onVariableInspectRequest}
                      originYear={timeAxisStartYear}
                      runner={runner}
                      selectedPeriodIndex={selectedPeriodIndex}
                      highlightedVariable={highlightedVariable}
                      variableDescriptions={variableDescriptions}
                      variableUnitMetadata={variableUnitMetadata}
                    />
                  </figure>
                ))}
              </div>
            ) : null}
            {cell.type === "table" ? (
              <TableCellView
                cell={cell}
                cells={cells}
                runner={runner}
                selectedPeriodIndex={selectedPeriodIndex}
                variableDescriptions={variableDescriptions}
                variableUnitMetadata={variableUnitMetadata}
                onVariableInspectRequest={onVariableInspectRequest}
                highlightedVariable={highlightedVariable}
              />
            ) : null}
            {cell.type === "matrix" ? (
              <MatrixCellView
                cell={cell}
                cells={cells}
                entryDisplayMode={matrixEntryDisplayModes[cell.id] ?? "both"}
                notebookScopeId={notebookScopeId}
                runner={runner}
                selectedPeriodIndex={selectedPeriodIndex}
                variableDescriptions={variableDescriptions}
                variableUnitMetadata={variableUnitMetadata}
                viewportRoot={viewportRoot}
                onCellChange={onCellChange}
                onReplaceCells={onReplaceCells}
                onMatrixGraphRequest={onMatrixGraphRequest}
                onVariableInspectRequest={onVariableInspectRequest}
                highlightedVariable={highlightedVariable}
                graphSliceHighlight={graphSliceHighlight}
              />
            ) : null}
            {cell.type === "sequence" ? (
              <SequenceCellView
                cell={cell}
                cells={cells}
                getModelCurrentValues={getModelCurrentValues}
                matrixSequenceViewState={matrixSequenceViewState}
                maxPeriodIndex={maxPeriodIndex}
                onCellChange={onCellChange}
                onMatrixSequenceViewStateChange={setMatrixSequenceViewState}
                onSelectedPeriodIndexChange={onSelectedPeriodIndexChange}
                onVariableInspectRequest={onVariableInspectRequest}
                highlightedVariable={highlightedVariable}
                runner={runner}
                selectedPeriodIndex={selectedPeriodIndex}
                variableDescriptions={variableDescriptions}
                viewportRoot={viewportRoot}
              />
            ) : null}
            {cell.type === "sankey" ? (
              <SankeyCellView
                cell={cell}
                cells={cells}
                runner={runner}
                selectedPeriodIndex={selectedPeriodIndex}
              />
            ) : null}
          </div>
        ) : null}
        </div>
        {!isCollapsed && cellNote ? (
          <div className="notebook-cell-note-footer">
            <AssistantMarkdown
              className="notebook-cell-note-markdown"
              currentValues={noteInspectionContext?.currentValues}
              highlightedVariable={highlightedVariable}
              onSelectVariable={
                noteInspectionContext == null
                  ? undefined
                  : (selectedVariable) =>
                      onVariableInspectRequest({
                        ...noteInspectionContext,
                        selectedVariable
                      })
              }
              text={cellNote}
              variableDescriptions={variableDescriptions}
              variableUnitMetadata={variableUnitMetadata}
            />
          </div>
        ) : null}
        {!isCollapsed && cellMore && !isEditingSource ? (
          <NotebookCellMore
            currentValues={noteInspectionContext?.currentValues}
            highlightedVariable={highlightedVariable}
            onSelectVariable={
              noteInspectionContext == null
                ? undefined
                : (selectedVariable) =>
                    onVariableInspectRequest({
                      ...noteInspectionContext,
                      selectedVariable
                    })
            }
            text={cellMore}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        ) : null}
        {cellContextMenu ? (
          <div
            ref={cellContextMenuRef}
            className="notebook-cell-context-menu"
            role="menu"
            aria-label={`Cell actions for ${cell.title}`}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              className="notebook-cell-context-menu-submenu-wrap"
              onMouseEnter={() => setIsCellInsertMenuOpen(true)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                onClick={() => setIsCellInsertMenuOpen((current) => !current)}
                onFocus={() => setIsCellInsertMenuOpen(true)}
                onMouseEnter={() => setIsCellInsertMenuOpen(true)}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span>Add cell</span>
                <span aria-hidden="true">›</span>
              </button>
              {isCellInsertMenuOpen ? (
                <div
                  className="notebook-cell-context-submenu"
                  role="menu"
                  aria-label="Add cell below options"
                >
                  {CELL_INSERT_TYPES.map((cellType) => {
                    const disabledReason = getInsertDisabledReason(cellType, {
                      hasModelSource: hasCellInsertModelSource,
                      hasRunSource: hasCellInsertRunSource
                    });
                    return (
                      <button
                        key={cellType}
                        type="button"
                        role="menuitem"
                        disabled={disabledReason != null}
                        title={disabledReason ?? undefined}
                        onClick={() => {
                          onInsertCell(cell.id, "below", cellType);
                          closeCellContextMenu();
                        }}
                      >
                        {formatCellInsertType(cellType)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="notebook-cell-context-menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              disabled={!canMoveCellUp}
              onClick={() => {
                onMoveCell(cell.id, -1);
                closeCellContextMenu();
              }}
            >
              Move up
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canMoveCellDown}
              onClick={() => {
                onMoveCell(cell.id, 1);
                closeCellContextMenu();
              }}
            >
              Move down
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setIsDeleteDialogOpen(true);
                closeCellContextMenu();
              }}
            >
              Delete
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSetCellUrl(cell.id);
                closeCellContextMenu();
              }}
            >
              URL
            </button>
            {onPinCellRequest ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPinCellRequest(cell.id);
                  closeCellContextMenu();
                }}
              >
                {isPinnedInPanel ? "Unpin floating panel" : "Pin in floating panel"}
              </button>
            ) : null}
          </div>
        ) : null}
        <MatrixUnitMetaDialog
          isOpen={isMatrixUnitMetaDialogOpen}
          matrixTitle={draftMatrixUnitMetaContext?.matrixTitle ?? cell.title}
          proposals={draftMatrixUnitMetaContext?.proposals ?? []}
          selectedVariables={matrixUnitMetaSelection}
          onApply={handleApplyMatrixUnitMetaUpdates}
          onCancel={() => setIsMatrixUnitMetaDialogOpen(false)}
          onSelectionChange={setMatrixUnitMetaSelection}
        />
        <MatrixEquationProposalDialog
          isOpen={isMatrixEquationProposalDialogOpen}
          matrixTitle={draftMatrixEquationContext?.matrixTitle ?? cell.title}
          proposals={draftMatrixEquationContext?.proposals ?? []}
          selectedVariables={matrixEquationProposalSelection}
          onApply={handleApplyMatrixEquationUpdates}
          onCancel={() => setIsMatrixEquationProposalDialogOpen(false)}
          onSelectionChange={setMatrixEquationProposalSelection}
        />
        {isDeleteDialogOpen ? (
          <div
            className="notebook-cell-delete-dialog-backdrop"
            onClick={() => setIsDeleteDialogOpen(false)}
          >
            <div
              className="notebook-cell-delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`Delete ${cell.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <h3>Delete cell?</h3>
              <p>
                Delete <strong>{cell.title}</strong> from this notebook?
              </p>
              <div className="notebook-cell-delete-dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsDeleteDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setIsDeleteDialogOpen(false);
                    onDeleteCell(cell.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </article>
    </NotebookRenderProfiler>
  );
}

export const NotebookCellView = memo(NotebookCellViewComponent, areNotebookCellViewPropsEqual);
NotebookCellView.displayName = "NotebookCellView";

function areNotebookCellViewPropsEqual(
  previousProps: NotebookCellViewProps,
  nextProps: NotebookCellViewProps
): boolean {
  if (previousProps.cell !== nextProps.cell || previousProps.cells !== nextProps.cells) {
    return false;
  }
  if (previousProps.notebookScopeId !== nextProps.notebookScopeId) {
    return false;
  }
  if (
    previousProps.runner.outputs !== nextProps.runner.outputs ||
    previousProps.runner.status !== nextProps.runner.status ||
    previousProps.runner.errors !== nextProps.runner.errors
  ) {
    return false;
  }

  if (previousProps.viewportRoot !== nextProps.viewportRoot) {
    return false;
  }

  if (previousProps.presentation !== nextProps.presentation) {
    return false;
  }

  if (previousProps.isPinnedInPanel !== nextProps.isPinnedInPanel) {
    return false;
  }

  if (
    isNotebookCellSelected(previousProps.cell.id, previousProps.selectedCellId) !==
    isNotebookCellSelected(nextProps.cell.id, nextProps.selectedCellId)
  ) {
    return false;
  }

  if (
    isNotebookCellActiveEditor(previousProps.cell.id, previousProps.activeEditorCellId) !==
    isNotebookCellActiveEditor(nextProps.cell.id, nextProps.activeEditorCellId)
  ) {
    return false;
  }

  if (
    usesSelectedPeriodIndex(nextProps.cell) &&
    previousProps.selectedPeriodIndex !== nextProps.selectedPeriodIndex
  ) {
    return false;
  }

  if (usesMaxPeriodIndex(nextProps.cell) && previousProps.maxPeriodIndex !== nextProps.maxPeriodIndex) {
    return false;
  }

  if (previousProps.timeAxisStartYear !== nextProps.timeAxisStartYear) {
    return false;
  }

  if (previousProps.highlightedVariable !== nextProps.highlightedVariable) {
    return false;
  }

  if (previousProps.graphSliceHighlight !== nextProps.graphSliceHighlight) {
    return false;
  }

  if (previousProps.blockConvergenceComputing !== nextProps.blockConvergenceComputing) {
    return false;
  }

  if (previousProps.onTestBlockConvergence !== nextProps.onTestBlockConvergence) {
    return false;
  }

  if (previousProps.onDiagnoseBlockConvergence !== nextProps.onDiagnoseBlockConvergence) {
    return false;
  }

  if (previousProps.onShowSolverBlockDag !== nextProps.onShowSolverBlockDag) {
    return false;
  }

  return true;
}

function resolveChartReferenceTrace(
  cell: ChartCell,
  cells: NotebookCell[]
): NonNullable<ChartCell["referenceTrace"]> {
  if (cell.referenceTrace) {
    return cell.referenceTrace;
  }

  return "previous-run";
}

function getNextChartReferenceTrace(
  current: NonNullable<ChartCell["referenceTrace"]>
): NonNullable<ChartCell["referenceTrace"]> {
  switch (current) {
    case "none":
      return "baseline";
    case "baseline":
      return "previous-run";
    case "previous-run":
      return "observed";
    case "observed":
      return "none";
  }
}

function formatChartReferenceTrace(trace: NonNullable<ChartCell["referenceTrace"]>): string {
  switch (trace) {
    case "none":
      return "None";
    case "baseline":
      return "Baseline";
    case "previous-run":
      return "Previous";
    case "observed":
      return "Observed";
  }
}

function isNotebookCellSelected(cellId: string, selectedCellId: string | null): boolean {
  return cellId === selectedCellId;
}

function isNotebookCellActiveEditor(cellId: string, activeEditorCellId: string | null): boolean {
  return cellId === activeEditorCellId;
}

function isViewportDeferredCellType(cellType: NotebookCell["type"]): boolean {
  return VIEWPORT_DEFERRED_CELL_TYPES.has(cellType);
}

function getNotebookCellNote(cell: NotebookCell): string {
  if (cell.note?.trim()) {
    return cell.note;
  }

  return "";
}

function getNotebookCellMore(cell: NotebookCell): string {
  if (cell.more?.trim()) {
    return cell.more;
  }

  return "";
}

function getNotebookCellDescription(cell: NotebookCell): string {
  if (cell.description?.trim()) {
    return cell.description;
  }

  return "";
}

function getViewportDeferredPlaceholderHeight(cell: NotebookCell): number {
  switch (cell.type) {
    case "chart":
      return 320;
    case "chart-grid":
      return 360;
    case "matrix":
      return 420;
    case "sequence":
      return 360;
    case "sankey":
      return 360;
    case "table":
      return 240;
    default:
      return 180;
  }
}

function shouldRenderViewportDeferredBody(
  cell: NotebookCell,
  isCollapsed: boolean,
  isEditingSource: boolean,
  shouldMountViewportDeferredBody: boolean
): boolean {
  return (
    !isCollapsed &&
    shouldMountViewportDeferredBody &&
    isViewportDeferredCellType(cell.type) &&
    !(cell.type === "matrix" && isEditingSource)
  );
}

function getViewportDeferredPlaceholderLabel(cell: NotebookCell): string {
  switch (cell.type) {
    case "chart":
      return "Chart";
    case "chart-grid":
      return "Chart grid";
    case "matrix":
      return "Matrix";
    case "sequence":
      return "Sequence diagram";
    case "sankey":
      return "Sankey diagram";
    case "table":
      return "Table";
    default:
      return "Cell";
  }
}

function DeferredNotebookCellPlaceholder({
  cell,
  measuredHeight
}: {
  cell: NotebookCell;
  measuredHeight: number | null;
}) {
  return (
    <div
      className="notebook-cell-viewport-placeholder"
      style={{ minHeight: `${measuredHeight ?? getViewportDeferredPlaceholderHeight(cell)}px` }}
    >
      <strong>{getViewportDeferredPlaceholderLabel(cell)} deferred</strong>
      <span>Scroll this cell near the viewport to mount its interactive content.</span>
    </div>
  );
}

function usesSelectedPeriodIndex(cell: NotebookCell): boolean {
  return (
    cell.type === "equations" ||
    cell.type === "model" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values" ||
    cell.type === "chart" ||
    cell.type === "table" ||
    cell.type === "matrix" ||
    (cell.type === "sequence" && cell.source.kind === "matrix")
  );
}

function usesMaxPeriodIndex(cell: NotebookCell): boolean {
  return cell.type === "sequence" && cell.source.kind === "matrix";
}


function isLinkedModelEditorCell(cell: NotebookCell): boolean {
  return (
    cell.type === "model" ||
    cell.type === "equations" ||
    cell.type === "solver" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values"
  );
}

function isCompactLinkedCellHeader(cell: NotebookCell): boolean {
  return (
    cell.type === "model" ||
    cell.type === "equations" ||
    cell.type === "solver" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values"
  );
}

function resolveCellVariableDescriptions(
  cells: NotebookCell[],
  cell: NotebookCell
): VariableDescriptions {
  if (cell.type === "markdown") {
    const contextCell = resolveNearestNotebookContextCell(cells, cell);
    return contextCell ? resolveCellVariableDescriptions(cells, contextCell) : new Map();
  }

  if (cell.type === "model") {
    return buildVariableDescriptions({
      equations: cell.editor.equations,
      externals: cell.editor.externals
    });
  }

  if (cell.type === "abm-model") {
    return buildAbmVariableDescriptions(cell);
  }

  if (
    cell.type === "equations" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values" ||
    cell.type === "solver"
  ) {
    return resolveModelVariableDescriptionsForModelId(cells, cell.modelId);
  }

  if (cell.type === "run") {
    return resolveModelVariableDescriptionsForRunCell(cells, cell);
  }

  if (cell.type === "chart" || cell.type === "table" || cell.type === "matrix") {
    const sourceRunCell = cells.find(
      (candidate): candidate is RunCell =>
        candidate.type === "run" && candidate.id === cell.sourceRunCellId
    );
    return sourceRunCell ? resolveModelVariableDescriptionsForRunCell(cells, sourceRunCell) : new Map();
  }

  if (cell.type === "sequence") {
    if (cell.source.kind !== "matrix") {
      return new Map();
    }

    const source = cell.source;
    const matrixCell = cells.find(
      (candidate): candidate is MatrixCell =>
        candidate.type === "matrix" && candidate.id === source.matrixCellId
    );
    const sourceRunCellId = source.sourceRunCellId ?? matrixCell?.sourceRunCellId;
    const sourceRunCell = sourceRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCellId
        ) ?? null
      : null;

    return sourceRunCell ? resolveModelVariableDescriptionsForRunCell(cells, sourceRunCell) : new Map();
  }

  return new Map();
}

function resolveCellVariableUnitMetadata(
  cells: NotebookCell[],
  cell: NotebookCell
): ReturnType<typeof buildVariableUnitMetadata> {
  if (cell.type === "markdown") {
    const contextCell = resolveNearestNotebookContextCell(cells, cell);
    return contextCell ? resolveCellVariableUnitMetadata(cells, contextCell) : new Map();
  }

  if (cell.type === "model") {
    return buildVariableUnitMetadata({
      equations: cell.editor.equations,
      externals: cell.editor.externals
    });
  }

  if (cell.type === "abm-model") {
    const editor = buildEditorStateForNotebookModel(
      {
        id: "notebook",
        title: "notebook",
        metadata: { version: 1 },
        cells
      },
      { modelId: cell.modelId }
    );
    return buildVariableUnitMetadata({
      equations: editor?.equations,
      externals: editor?.externals
    });
  }

  if (
    cell.type === "equations" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values" ||
    cell.type === "solver"
  ) {
    return resolveModelVariableUnitMetadataForModelId(cells, cell.modelId);
  }

  if (cell.type === "run") {
    return resolveModelVariableUnitMetadataForRunCell(cells, cell);
  }

  if (cell.type === "chart" || cell.type === "table" || cell.type === "matrix") {
    const sourceRunCell = cells.find(
      (candidate): candidate is RunCell =>
        candidate.type === "run" && candidate.id === cell.sourceRunCellId
    );
    return sourceRunCell ? resolveModelVariableUnitMetadataForRunCell(cells, sourceRunCell) : new Map();
  }

  if (cell.type === "sequence") {
    if (cell.source.kind !== "matrix") {
      return new Map();
    }

    const source = cell.source;
    const matrixCell = cells.find(
      (candidate): candidate is MatrixCell =>
        candidate.type === "matrix" && candidate.id === source.matrixCellId
    );
    const sourceRunCellId = source.sourceRunCellId ?? matrixCell?.sourceRunCellId;
    const sourceRunCell = sourceRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCellId
        ) ?? null
      : null;

    return sourceRunCell ? resolveModelVariableUnitMetadataForRunCell(cells, sourceRunCell) : new Map();
  }

  return new Map();
}

function resolveModelVariableDescriptionsForRunCell(
  cells: NotebookCell[],
  cell: RunCell
): VariableDescriptions {
  const editor = buildEditorStateForNotebookModel(
    {
      id: "notebook",
      title: "notebook",
      metadata: { version: 1 },
      cells
    },
    cell
  );

  return buildVariableDescriptions({
    equations: editor?.equations,
    externals: editor?.externals
  });
}

function resolveModelVariableUnitMetadataForRunCell(cells: NotebookCell[], cell: RunCell) {
  const editor = buildEditorStateForNotebookModel(
    {
      id: "notebook",
      title: "notebook",
      metadata: { version: 1 },
      cells
    },
    cell
  );

  return buildVariableUnitMetadata({
    equations: editor?.equations,
    externals: editor?.externals
  });
}

function resolveModelVariableDescriptionsForModelId(
  cells: NotebookCell[],
  modelId: string
): VariableDescriptions {
  return buildVariableDescriptions({
    equations: findEquationsCell(cells, modelId)?.equations,
    externals: collectModelExternals(cells, modelId)
  });
}

function resolveModelVariableUnitMetadataForModelId(cells: NotebookCell[], modelId: string) {
  return buildVariableUnitMetadata({
    equations: findEquationsCell(cells, modelId)?.equations,
    externals: collectModelExternals(cells, modelId)
  });
}

function resolveNotebookInspectionContext({
  cell,
  cells,
  getModelCurrentValues,
  runner,
  selectedPeriodIndex
}: {
  cell: NotebookCell;
  cells: NotebookCell[];
  getModelCurrentValues(ref: {
    modelId?: string;
    sourceModelId?: string;
    sourceModelCellId?: string;
  }): Record<string, number | undefined>;
  runner: ReturnType<typeof useNotebookRunner>;
  selectedPeriodIndex: number;
}): import("../lib/variableInspect").VariableInspectContext | null {
  if (cell.type === "markdown") {
    const contextCell = resolveNearestNotebookContextCell(cells, cell);
    return contextCell
      ? resolveNotebookInspectionContext({
          cell: contextCell,
          cells,
          getModelCurrentValues,
          runner,
          selectedPeriodIndex
        })
      : null;
  }

  if (cell.type === "model") {
    const modelSource = { sourceModelCellId: cell.id };
    return {
      currentValues: getModelCurrentValues({ sourceModelCellId: cell.id }),
      editor: cell.editor,
      modelSource,
      sourceRunCellId: findRunCellForInspectorModelSource(cells, modelSource)?.id ?? null,
      variableDescriptions: buildVariableDescriptions({
        equations: cell.editor.equations,
        externals: cell.editor.externals
      }),
      variableUnitMetadata: buildVariableUnitMetadata({
        equations: cell.editor.equations,
        externals: cell.editor.externals
      })
    };
  }

  if (cell.type === "abm-model") {
    const modelSource = { sourceModelId: cell.modelId };
    const editor = buildEditorStateForNotebookModel(
      {
        id: "notebook",
        title: "notebook",
        metadata: { version: 1 },
        cells
      },
      { modelId: cell.modelId }
    );
    if (!editor) {
      return null;
    }
    return {
      currentValues: getModelCurrentValues({ modelId: cell.modelId }),
      editor,
      modelSource,
      sourceRunCellId: findRunCellForInspectorModelSource(cells, modelSource)?.id ?? null,
      variableDescriptions: buildAbmVariableDescriptions(cell),
      variableUnitMetadata: buildVariableUnitMetadata({
        equations: editor.equations,
        externals: editor.externals
      })
    };
  }

  if (
    cell.type === "equations" ||
    cell.type === "externals" ||
    cell.type === "observed" ||
    cell.type === "initial-values" ||
    cell.type === "solver"
  ) {
    const modelSource = { sourceModelId: cell.modelId };
    return {
      currentValues: getModelCurrentValues({ modelId: cell.modelId }),
      editor: buildEditorStateForStandaloneModelSections(cells, cell.modelId),
      modelSource,
      sourceRunCellId: findRunCellForInspectorModelSource(cells, modelSource)?.id ?? null,
      variableDescriptions: resolveModelVariableDescriptionsForModelId(cells, cell.modelId),
      variableUnitMetadata: resolveModelVariableUnitMetadataForModelId(cells, cell.modelId)
    };
  }

  if (cell.type === "run") {
    const editor = buildEditorStateForNotebookModel(
      {
        id: "notebook",
        title: "notebook",
        metadata: { version: 1 },
        cells
      },
      cell
    );
    if (!editor) {
      return null;
    }

    const result = runner.getResult(cell.id);
    const currentValues = result
      ? Object.fromEntries(
          Object.entries(result.series).map(([name, values]) => [
            name,
            values[Math.min(selectedPeriodIndex, Math.max(values.length - 1, 0))]
          ])
        )
      : {};

    return {
      currentValues,
      editor,
      modelSource: resolveInspectorModelSource(cell),
      sourceRunCellId: cell.id,
      variableDescriptions: resolveModelVariableDescriptionsForRunCell(cells, cell),
      variableUnitMetadata: resolveModelVariableUnitMetadataForRunCell(cells, cell)
    };
  }

  if (cell.type === "chart" || cell.type === "table" || cell.type === "matrix") {
    const sourceRunCell = cells.find(
      (candidate): candidate is RunCell =>
        candidate.type === "run" && candidate.id === cell.sourceRunCellId
    );
    return sourceRunCell
      ? resolveNotebookInspectionContext({
          cell: sourceRunCell,
          cells,
          getModelCurrentValues,
          runner,
          selectedPeriodIndex
        })
      : null;
  }

  if (cell.type === "sequence" && cell.source.kind === "matrix") {
    const source = cell.source;
    const matrixCell = cells.find(
      (candidate): candidate is MatrixCell =>
        candidate.type === "matrix" && candidate.id === source.matrixCellId
    );
    const sourceRunCellId = source.sourceRunCellId ?? matrixCell?.sourceRunCellId;
    const sourceRunCell = sourceRunCellId
      ? cells.find(
          (candidate): candidate is RunCell =>
            candidate.type === "run" && candidate.id === sourceRunCellId
        )
      : null;
    return sourceRunCell
      ? resolveNotebookInspectionContext({
          cell: sourceRunCell,
          cells,
          getModelCurrentValues,
          runner,
          selectedPeriodIndex
        })
      : null;
  }

  return null;
}


