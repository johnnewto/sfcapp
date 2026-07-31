import { useEffect, useMemo, useRef, useState } from "react";

import { analyzeParsedEquation, parseEquation, type EquationRole } from "@sfcr/core";
import {
  countDataRows,
  externalRowsOnly,
  formatCompactRowCommentText,
  inferEquationSectionBoundaries,
  isRowComment,
  type EquationListItem
} from "@sfcr/notebook-core";

import { EquationGridEditor } from "../../components/EquationGridEditor";
import { buildActiveTrace, buildTraceModel, type PinnedTrace } from "../../components/EquationGridEditor";
import { newRowComment } from "../rowCommentHelpers";
import { useInlineCommentRowEdit } from "../useInlineCommentRowEdit";
import { useInlineEquationRowEdit } from "../useInlineEquationRowEdit";
import { CommentRowReadView } from "./CommentRowReadView";
import { ImplicitEquationsSection } from "./ImplicitEquationsSection";
import {
  canMoveRowDown,
  canMoveRowUp,
  GridRowContextMenu,
  GridRowDeleteDialog,
  useGridRowContextMenu
} from "../../components/GridRowContextMenu";
import {
  NotebookEquationReadRow,
  schedulePinnedTraceToggle,
  useDeferredAction,
  VariableRenameDialog
} from "./EquationRowInlineEditor";
import { EquationRowAskAiPanel } from "./EquationRowAskAiPanel";
import { EquationsCellAskAiPanel } from "./EquationsCellAskAiPanel";
import type { NotebookAssistantSnapshot } from "../notebookAssistantTools";
import type { NotebookPatch } from "../notebookPatch";
import { buildRuntimeConfig, diagnoseBuildRuntime, validateEditorState, type EditorState, type ExternalRow } from "../../lib/editorModel";
import { buildVariableDescriptions, type VariableDescriptions } from "../../lib/variableDescriptions";
import { buildVariableUnitMetadata } from "../../lib/units";
import { useDragScroll } from "../../hooks/useDragScroll";
import { useEquationValueColumnsCollapse } from "../../hooks/useEquationValueColumnsCollapse";
import { buildEditorStateFromSections, collectModelExternals, countModelSectionIssues, findEquationsCell, findExternalsCell, findInitialValuesCell, findSolverCell } from "../modelSections";
import { resolveImplicitMatrixAccumulationEntries, IMPLICIT_MATRIX_INTEGRATION_SECTION_ID } from "../implicitMatrixEquations";
import { collectMatrixInitialValueOverrideIssues } from "../matrixInitialRow";
import type { VariableInspectRequest } from "../../lib/variableInspect";
import type { EquationsCell, ExternalsCell, ModelCell, NotebookCell, NotebookDocument, SolverCell } from "../types";
import { NotebookLinkedEditorActions, NotebookLinkedEditorHeader } from "./NotebookCellHeader";
import { NotebookFloatingHeaderOverlay } from "./NotebookFloatingHeaderOverlay";
import { NotebookEquationViewTable } from "./NotebookEquationViewTable";
import { EquationsModelViewHeaderRowStatic } from "./notebookModelViewHeaderRows";
import { useNotebookFloatingHeaderRow } from "../useNotebookFloatingHeaderRow";
import {
  collectCollapsibleSectionCommentIds,
  isEquationRowHiddenBySectionCollapse,
  sectionCommentHasEquations,
  useEquationSectionCollapseState
} from "../equationSectionCollapse";
import { EquationSectionCollapseControls } from "./EquationSectionCollapseControls";
import { initialValueCellProps, useVariableInitialValueEdit } from "../useVariableInitialValueEdit";

export function ModelCellView({
  cell,
  cells,
  currentValues,
  laggedCurrentValues,
  laggedPeriodLabel,
  isPinnedInPanel = false,
  onEditingChange,
  onHelpRequest,
  onChange,
  onPinCellRequest,
  onReplaceCells,
  onToggleCollapsed,
  onVariableInspectRequest,
  highlightedVariable = null,
  title
}: {
  cell: ModelCell;
  cells: NotebookCell[];
  currentValues: Record<string, number | undefined>;
  laggedCurrentValues?: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  isPinnedInPanel?: boolean;
  highlightedVariable?: string | null;
  onEditingChange?(isEditing: boolean): void;
  onHelpRequest?: (() => void) | null;
  onChange(editor: EditorState): void;
  onPinCellRequest?: (() => void) | null;
  onReplaceCells(nextCells: NotebookCell[]): void;
  onToggleCollapsed(): void;
  onVariableInspectRequest(args: VariableInspectRequest): void;
  title: string;
}) {
  const modelSource = { sourceModelCellId: cell.id };
  const modelViewDragScroll = useDragScroll<HTMLElement>();
  const [draftEditor, setDraftEditor] = useState(cell.editor);
  const issues = validateEditorState(draftEditor);
  const buildDiagnostics = diagnoseBuildRuntime(draftEditor);
  const allIssues = [...issues, ...buildDiagnostics.issues];
  const issueMap = Object.fromEntries(allIssues.map((issue) => [issue.path, issue.message]));
  const equationIssueMap = Object.fromEntries(
    allIssues
      .filter((issue) => issue.path.startsWith("equations."))
      .map((issue) => [issue.path, issue])
  );
  const runtime = safeBuildRuntime(cell.editor);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [pinnedTrace, setPinnedTrace] = useState<PinnedTrace | null>(null);
  const parameterNameSet = useMemo(
    () => new Set(externalRowsOnly(draftEditor.externals).map((external) => external.name)),
    [draftEditor.externals]
  );
  const variableDescriptions = useMemo(
    () =>
      buildVariableDescriptions({
        equations: draftEditor.equations,
        externals: draftEditor.externals
      }),
    [draftEditor.equations, draftEditor.externals]
  );
  const variableUnitMetadata = useMemo(
    () =>
      buildVariableUnitMetadata({
        equations: draftEditor.equations,
        externals: draftEditor.externals
      }),
    [draftEditor.equations, draftEditor.externals]
  );
  const sectionBoundaries = useMemo(
    () =>
      inferEquationSectionBoundaries({
        equations: cell.editor.equations,
        externals: cell.editor.externals
      }),
    [cell.editor.equations, cell.editor.externals]
  );
  const collapsibleSectionIds = useMemo(
    () => collectCollapsibleSectionCommentIds(cell.editor.equations, sectionBoundaries),
    [cell.editor.equations, sectionBoundaries]
  );
  const traceModel = useMemo(() => buildTraceModel(draftEditor.equations), [draftEditor.equations]);
  const activeTrace = pinnedTrace
    ? buildActiveTrace(traceModel, pinnedTrace.rowId, pinnedTrace.mode)
    : hoveredRowId
      ? buildActiveTrace(traceModel, hoveredRowId, "both")
      : null;
  const [isEditingEquations, setIsEditingEquations] = useState(false);
  const hasDraftEdits = JSON.stringify(draftEditor) !== JSON.stringify(cell.editor);

  useEffect(() => {
    onEditingChange?.(isEditingEquations);
  }, [isEditingEquations, onEditingChange]);

  useEffect(() => {
    if (!isEditingEquations) {
      setDraftEditor(cell.editor);
    }
  }, [cell.editor, isEditingEquations]);

  function handleEditToggle(): void {
    setDraftEditor(cell.editor);
    setIsEditingEquations(true);
  }

  function handleApply(): void {
    onChange(draftEditor);
    setIsEditingEquations(false);
  }

  function handleCancel(): void {
    setDraftEditor(cell.editor);
    setIsEditingEquations(false);
  }

  const commentEdit = useInlineCommentRowEdit({
    onChangeRows: (equations) => onChange({ ...cell.editor, equations }),
    rows: cell.editor.equations
  });
  const inlineEdit = useInlineEquationRowEdit({
    cells,
    equations: cell.editor.equations,
    onChangeEquations: (equations) => onChange({ ...cell.editor, equations }),
    onReplaceCells,
    scope: { kind: "legacyModelCell", cellId: cell.id }
  });
  const equationRowMenu = useGridRowContextMenu({
    ignoredSelector: "select",
    onChangeRows: (equations) => {
      inlineEdit.cancelRowEdit();
      commentEdit.cancelRowEdit();
      initialValueEdit.cancelEdit();
      onChange({ ...cell.editor, equations });
    },
    rows: cell.editor.equations
  });
  const initialValueEdit = useVariableInitialValueEdit({
    initialValues: cell.editor.initialValues,
    onUpdateInitialValues: (nextInitialValues) =>
      onChange({ ...cell.editor, initialValues: nextInitialValues })
  });
  const { scheduleDeferredAction } = useDeferredAction();
  const sectionCollapse = useEquationSectionCollapseState(
    cell.id,
    cell.editor.equations,
    collapsibleSectionIds
  );

  return (
    <div className="notebook-model-stack">
      <NotebookLinkedEditorHeader
        actions={
          <NotebookLinkedEditorActions
            cell={cell}
            extraActions={
              !isEditingEquations && sectionCollapse.hasCollapsibleSections ? (
                <EquationSectionCollapseControls
                  onCollapseAll={sectionCollapse.collapseAllSections}
                  onExpandAll={sectionCollapse.expandAllSections}
                />
              ) : null
            }
            hasDraftEdits={hasDraftEdits}
            isEditing={isEditingEquations}
            isPinnedInPanel={isPinnedInPanel}
            onApply={handleApply}
            onCancel={handleCancel}
            onEditToggle={handleEditToggle}
            onHelpRequest={onHelpRequest}
            onPinCellRequest={onPinCellRequest}
            onToggleCollapsed={onToggleCollapsed}
            title={title}
          />
        }
        title={title}
        typeLabel={cell.type}
      >
        <div className="notebook-model-summary" aria-label="Model summary">
          <span className="notebook-model-chip">
            Eq <strong>{countDataRows(cell.editor.equations)}</strong>
          </span>
          <span className="notebook-model-chip">
            Ext <strong>{cell.editor.externals.length}</strong>
          </span>
          <span className="notebook-model-chip">
            Init <strong>{cell.editor.initialValues.length}</strong>
          </span>
          <span className="notebook-model-chip">
            Solver <strong>{cell.editor.options.solverMethod}</strong>
          </span>
          <span className="notebook-model-chip">
            Hidden <strong>{runtime?.options.hiddenEquation ? "on" : "off"}</strong>
          </span>
          <span className="notebook-model-chip">
            Shocks <strong>{runtime?.scenario?.shocks.length ?? 0}</strong>
          </span>
          <span className="notebook-model-chip">
            Issues <strong>{allIssues.length}</strong>
          </span>
        </div>
      </NotebookLinkedEditorHeader>

      {cell.collapsed ? null : isEditingEquations ? (
        <div className="notebook-model-editor-body">
          <EquationGridEditor
            buildError={buildDiagnostics.modelError}
            currentValues={currentValues}
            equations={draftEditor.equations}
            externals={draftEditor.externals}
            isEmbedded
            issues={equationIssueMap}
            onChange={(equations) => setDraftEditor((current) => ({ ...current, equations }))}
            onExternalsChange={(nextExternals) =>
              setDraftEditor((current) => ({ ...current, externals: nextExternals }))
            }
            onSelectVariable={(selectedVariable) =>
              onVariableInspectRequest({
                currentValues,
                editor: draftEditor,
                modelSource,
                selectedVariable,
                variableDescriptions,
                variableUnitMetadata
              })
            }
            documentHighlightedVariable={highlightedVariable}
            parameterNames={externalRowsOnly(draftEditor.externals).map((external) => external.name)}
            showHeading={false}
            showTraceHelp={false}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        </div>
      ) : (
        <section
          ref={modelViewDragScroll.dragScrollRef}
          className={`notebook-model-view notebook-oversize-scroll ${modelViewDragScroll.dragScrollProps.className}`}
          aria-label="Model view"
          data-drag-scroll-ignore="true"
          onClickCapture={modelViewDragScroll.dragScrollProps.onClickCapture}
          onMouseDown={modelViewDragScroll.dragScrollProps.onMouseDown}
        >
          <NotebookEquationViewTable ariaLabel="Model equations">
            {cell.editor.equations.map((row, index) => {
              if (isRowComment(row)) {
                const inferredBoundary = sectionBoundaries.get(row.id) ?? null;
                return (
                  <CommentRowReadView
                    key={row.id}
                    commentEdit={commentEdit}
                    currentValues={currentValues}
                    equations={cell.editor.equations}
                    externals={cell.editor.externals}
                    highlightedVariable={highlightedVariable}
                    index={index}
                    inferredBoundary={inferredBoundary}
                    parameterNames={parameterNameSet}
                    row={row}
                    sectionCollapsible={Boolean(
                      inferredBoundary && sectionCommentHasEquations(cell.editor.equations, index)
                    )}
                    sectionCollapsed={sectionCollapse.isSectionCollapsed(row.id)}
                    variableDescriptions={variableDescriptions}
                    variableUnitMetadata={variableUnitMetadata}
                    onCancelDataRowEdit={inlineEdit.cancelRowEdit}
                    onContextMenu={equationRowMenu.handleRowContextMenu}
                    onInspectVariable={(selectedVariable) =>
                      onVariableInspectRequest({
                        currentValues,
                        editor: cell.editor,
                        modelSource,
                        selectedVariable,
                        variableDescriptions,
                        variableUnitMetadata
                      })
                    }
                    onToggleSectionCollapse={() => sectionCollapse.toggleSectionCollapse(row.id)}
                  />
                );
              }

              if (
                isEquationRowHiddenBySectionCollapse(
                  cell.editor.equations,
                  sectionCollapse.collapsedSectionIds,
                  index
                )
              ) {
                return null;
              }

              const equation = row;
              const issue =
                issueMap[`equations.${index}.name`] ?? issueMap[`equations.${index}.expression`];

              return (
                <NotebookEquationReadRow
                  key={equation.id}
                  activeTraceTokenStates={activeTrace?.tokenStates}
                  currentValues={currentValues}
                  laggedCurrentValues={laggedCurrentValues}
                  laggedPeriodLabel={laggedPeriodLabel}
                  equation={equation}
                  equationIndex={index}
                  formatRoleLabel={formatEquationRoleLabel}
                  highlightedVariable={highlightedVariable}
                  hoveredRowId={hoveredRowId}
                  isEditing={inlineEdit.editingEquationId === equation.id}
                  issueMessage={issue}
                  onContextMenu={(event) => {
                    if (inlineEdit.editingEquationId === equation.id) {
                      return;
                    }
                    equationRowMenu.handleRowContextMenu(event, index);
                  }}
                  parameterNames={parameterNameSet}
                  rowDraft={{
                    expression: inlineEdit.draftExpression,
                    name: inlineEdit.draftName
                  }}
                  rowEditFocus={inlineEdit.editFocus}
                  rowValidationError={inlineEdit.validationError}
                  rowValidationWarning={inlineEdit.validationWarning}
                  traceRole={activeTrace?.rowStates.get(equation.id) ?? null}
                  variableDescriptions={variableDescriptions}
                  variableUnitMetadata={variableUnitMetadata}
                  onApplyRow={inlineEdit.applyRowEdit}
                  onBeginRowEdit={(equationId, focus) => {
                    commentEdit.cancelRowEdit();
                    initialValueEdit.cancelEdit();
                    inlineEdit.beginRowEdit(equationId, focus);
                  }}
                  onCancelRow={inlineEdit.cancelRowEdit}
                  onDraftExpressionChange={inlineEdit.setDraftExpression}
                  onDraftNameChange={inlineEdit.setDraftName}
                  {...initialValueCellProps(
                    equation.name,
                    cell.editor.initialValues,
                    initialValueEdit
                  )}
                  onInspectVariable={(selectedVariable) =>
                    onVariableInspectRequest({
                      currentValues,
                      editor: cell.editor,
                      modelSource,
                      selectedVariable,
                      variableDescriptions,
                      variableUnitMetadata
                    })
                  }
                  onRowClick={(event) =>
                    schedulePinnedTraceToggle(scheduleDeferredAction, setPinnedTrace, equation.id, event)
                  }
                  onRowMouseEnter={() => setHoveredRowId(equation.id)}
                  onRowMouseLeave={() =>
                    setHoveredRowId((current) => (current === equation.id ? null : current))
                  }
                  onSelectVariableInExpression={(selectedVariable) =>
                    scheduleDeferredAction(() =>
                      onVariableInspectRequest({
                        currentValues,
                        editor: cell.editor,
                        modelSource,
                        selectedVariable,
                        variableDescriptions,
                        variableUnitMetadata
                      })
                    )
                  }
                />
              );
            })}
          </NotebookEquationViewTable>
          {equationRowMenu.rowContextMenu ? (
            <GridRowContextMenu
              addCommentLabel="Add section comment"
              addItemLabel="Add equation"
              canMoveDown={canMoveRowDown(cell.editor.equations, equationRowMenu.rowContextMenu.rowIndex)}
              canMoveUp={canMoveRowUp(cell.editor.equations, equationRowMenu.rowContextMenu.rowIndex)}
              menuRef={equationRowMenu.rowContextMenuRef}
              menuTypeLabel="Equation"
              onAdd={() =>
                equationRowMenu.insertRowBelow(equationRowMenu.rowContextMenu!.rowIndex, newEquationRow())
              }
              onAddComment={() =>
                equationRowMenu.insertRowBelow(equationRowMenu.rowContextMenu!.rowIndex, newRowComment())
              }
              onDelete={() => equationRowMenu.requestDelete(equationRowMenu.rowContextMenu!.rowIndex)}
              onMoveDown={() => equationRowMenu.moveRowAt(equationRowMenu.rowContextMenu!.rowIndex, 1)}
              onMoveUp={() => equationRowMenu.moveRowAt(equationRowMenu.rowContextMenu!.rowIndex, -1)}
              rowIndex={equationRowMenu.rowContextMenu.rowIndex}
            />
          ) : null}
          {equationRowMenu.deleteDialogRowIndex != null ? (
            <GridRowDeleteDialog
              deleteTitle={
                isRowComment(cell.editor.equations[equationRowMenu.deleteDialogRowIndex])
                  ? "Delete section comment?"
                  : "Delete equation?"
              }
              itemLabel={formatEquationDeleteLabel(
                cell.editor.equations[equationRowMenu.deleteDialogRowIndex],
                equationRowMenu.deleteDialogRowIndex
              )}
              onCancel={equationRowMenu.cancelDelete}
              onConfirm={equationRowMenu.confirmDelete}
            />
          ) : null}
        </section>
      )}
      <VariableRenameDialog
        impact={inlineEdit.renameReferenceCount}
        isOpen={inlineEdit.renameDialog != null}
        newName={inlineEdit.renameDialog?.newName ?? ""}
        oldName={inlineEdit.renameDialog?.oldName ?? ""}
        onCancel={inlineEdit.cancelRowEdit}
        onConfirmNo={inlineEdit.confirmRenameNo}
        onConfirmYes={inlineEdit.confirmRenameYes}
      />
    </div>
  );
}

export interface EquationsCellAiProps {
  betaPassword: string;
  document: NotebookDocument;
  enabled: boolean;
  model: string;
  onApplyPatch(args: {
    document: NotebookDocument;
    patch: NotebookPatch;
    proposalId: string;
  }): void;
  onUndoPatch(proposalId: string): void;
  resultCount: number;
  selectedPeriodIndex: number;
  snapshot: NotebookAssistantSnapshot;
  uiMessage?: string | null;
  undoProposalId: string | null;
}

export function EquationsCellView({
  cell,
  cells,
  currentValues,
  laggedCurrentValues,
  laggedPeriodLabel,
  equationAi = null,
  externals,
  initialValuesCount,
  isPinnedInPanel = false,
  onEditingChange,
  onHelpRequest,
  onVariableInspectRequest,
  highlightedVariable = null,
  onPinCellRequest,
  onReplaceCells,
  selectedPeriodIndex,
  solverCell,
  title,
  onChange,
  onToggleCollapsed,
  viewportRoot = null
}: {
  cell: EquationsCell;
  cells: NotebookCell[];
  currentValues: Record<string, number | undefined>;
  laggedCurrentValues?: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  equationAi?: EquationsCellAiProps | null;
  externals: ExternalsCell["externals"];
  initialValuesCount: number;
  isPinnedInPanel?: boolean;
  onEditingChange?(isEditing: boolean): void;
  onHelpRequest?: (() => void) | null;
  highlightedVariable?: string | null;
  onVariableInspectRequest(args: VariableInspectRequest): void;
  onPinCellRequest?: (() => void) | null;
  onReplaceCells(nextCells: NotebookCell[]): void;
  selectedPeriodIndex: number;
  solverCell: SolverCell | null;
  title: string;
  viewportRoot?: Element | null;
  onChange(equations: EquationsCell["equations"]): void;
  onToggleCollapsed(): void;
}) {
  const modelSource = { sourceModelId: cell.modelId };
  const equationsViewDragScroll = useDragScroll<HTMLElement>();
  const cellRootRef = useRef<HTMLDivElement | null>(null);
  const sectionWrapRef = useRef<HTMLElement | null>(null);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const valueColumnsCollapse = useEquationValueColumnsCollapse(tableShellRef);
  const [draftEquations, setDraftEquations] = useState(cell.equations);
  const editor = buildEditorStateFromSections({
    equations: draftEquations,
    externals,
    initialValues: [],
    options:
      solverCell?.options ?? {
        periods: 100,
        solverMethod: "GAUSS_SEIDEL",
        toleranceText: "1e-15",
        maxIterations: 200,
        defaultInitialValueText: "1e-15",
        hiddenLeftVariable: "",
        hiddenRightVariable: "",
        hiddenToleranceText: "0.00001",
        relativeHiddenTolerance: false
      }
  });
  const issues = validateEditorState(editor);
  const buildDiagnostics = diagnoseBuildRuntime(editor);
  const allIssues = [...issues, ...buildDiagnostics.issues];
  const issueMap = Object.fromEntries(allIssues.map((issue) => [issue.path, issue.message]));
  const equationIssueMap = Object.fromEntries(
    allIssues
      .filter((issue) => issue.path.startsWith("equations."))
      .map((issue) => [issue.path, issue])
  );
  const runtime = safeBuildRuntime(editor);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [pinnedTrace, setPinnedTrace] = useState<PinnedTrace | null>(null);
  const parameterNameSet = useMemo(() => new Set(externalRowsOnly(externals).map((external) => external.name)), [externals]);
  const variableDescriptions = useMemo(
    () =>
      buildVariableDescriptions({
        equations: draftEquations,
        externals
      }),
    [draftEquations, externals]
  );
  const variableUnitMetadata = useMemo(
    () =>
      buildVariableUnitMetadata({
        equations: draftEquations,
        externals
      }),
    [draftEquations, externals]
  );
  const sectionBoundaries = useMemo(
    () => inferEquationSectionBoundaries({ equations: cell.equations, externals }),
    [cell.equations, externals]
  );
  const implicitEquationContext = useMemo(
    () =>
      resolveImplicitMatrixAccumulationEntries({
        cells,
        modelId: cell.modelId,
        equations: cell.equations
      }),
    [cells, cell.modelId, cell.equations]
  );
  const collapsibleSectionIds = useMemo(() => {
    const ids = collectCollapsibleSectionCommentIds(cell.equations, sectionBoundaries);
    if (implicitEquationContext.boundary && implicitEquationContext.entries.length > 0) {
      ids.push(IMPLICIT_MATRIX_INTEGRATION_SECTION_ID);
    }
    return ids;
  }, [cell.equations, implicitEquationContext.boundary, implicitEquationContext.entries.length, sectionBoundaries]);
  const traceModel = useMemo(() => buildTraceModel(draftEquations), [draftEquations]);
  const activeTrace = pinnedTrace
    ? buildActiveTrace(traceModel, pinnedTrace.rowId, pinnedTrace.mode)
    : hoveredRowId
      ? buildActiveTrace(traceModel, hoveredRowId, "both")
      : null;
  const [isEditingEquations, setIsEditingEquations] = useState(false);
  const [showExternalValues, setShowExternalValues] = useState(true);
  const [askAiVariable, setAskAiVariable] = useState<string | null>(null);
  const [isEquationsCellAskAiOpen, setIsEquationsCellAskAiOpen] = useState(false);
  const floatingEnabled = cell.collapsed !== true && !isEditingEquations && viewportRoot != null;
  const { visible: floatingHeaderVisible, anchor: floatingHeaderAnchor } =
    useNotebookFloatingHeaderRow({
      scrollRoot: viewportRoot,
      headerRowRef,
      tableWrapRef: sectionWrapRef,
      cellRootRef,
      enabled: floatingEnabled
    });
  const hasDraftEdits = JSON.stringify(draftEquations) !== JSON.stringify(cell.equations);
  const externalDisplayValues = useMemo(
    () => buildExternalDisplayValues(externals, selectedPeriodIndex),
    [externals, selectedPeriodIndex]
  );

  useEffect(() => {
    onEditingChange?.(isEditingEquations);
  }, [isEditingEquations, onEditingChange]);

  useEffect(() => {
    if (!isEditingEquations) {
      setDraftEquations(cell.equations);
    }
  }, [cell.equations, isEditingEquations]);

  function handleEditToggle(): void {
    setDraftEquations(cell.equations);
    setIsEditingEquations(true);
  }

  function handleApply(): void {
    onChange(draftEquations);
    setIsEditingEquations(false);
  }

  function handleCancel(): void {
    setDraftEquations(cell.equations);
    setIsEditingEquations(false);
  }

  const commentEdit = useInlineCommentRowEdit({
    onChangeRows: onChange,
    rows: cell.equations
  });
  const inlineEdit = useInlineEquationRowEdit({
    cells,
    equations: cell.equations,
    onChangeEquations: onChange,
    onReplaceCells,
    scope: { kind: "modelId", modelId: cell.modelId }
  });
  const initialValuesCell = useMemo(
    () => findInitialValuesCell(cells, cell.modelId),
    [cells, cell.modelId]
  );
  const inspectEditor = useMemo(
    () => ({
      ...editor,
      externals: collectModelExternals(cells, cell.modelId),
      initialValues: initialValuesCell?.initialValues ?? []
    }),
    [editor, cells, cell.modelId, initialValuesCell]
  );
  const initialValueEdit = useVariableInitialValueEdit({
    initialValues: initialValuesCell?.initialValues ?? [],
    onUpdateInitialValues: (nextInitialValues) => {
      if (!initialValuesCell) {
        return;
      }
      onReplaceCells(
        cells.map((entry) =>
          entry.id === initialValuesCell.id && entry.type === "initial-values"
            ? { ...entry, initialValues: nextInitialValues }
            : entry
        )
      );
    }
  });
  const equationRowMenu = useGridRowContextMenu({
    ignoredSelector: "select",
    onChangeRows: (equations) => {
      inlineEdit.cancelRowEdit();
      commentEdit.cancelRowEdit();
      initialValueEdit.cancelEdit();
      onChange(equations);
    },
    rows: cell.equations
  });
  const { scheduleDeferredAction } = useDeferredAction();
  const sectionCollapse = useEquationSectionCollapseState(cell.id, cell.equations, collapsibleSectionIds);

  return (
    <div ref={cellRootRef} className="notebook-model-stack">
      <NotebookLinkedEditorHeader
        actions={
          <NotebookLinkedEditorActions
            cell={cell}
            extraActions={
              !isEditingEquations && cell.collapsed !== true ? (
                <>
                  {sectionCollapse.hasCollapsibleSections ? (
                    <EquationSectionCollapseControls
                      onCollapseAll={sectionCollapse.collapseAllSections}
                      onExpandAll={sectionCollapse.expandAllSections}
                    />
                  ) : null}
                  {equationAi?.enabled ? (
                    <button
                      type="button"
                      className={`notebook-run-button notebook-equation-ask-ai-toggle${
                        isEquationsCellAskAiOpen ? " is-active" : ""
                      }`}
                      aria-pressed={isEquationsCellAskAiOpen}
                      onClick={() => {
                        setAskAiVariable(null);
                        setIsEquationsCellAskAiOpen((current) => !current);
                      }}
                    >
                      Ask AI
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="notebook-run-button"
                    aria-pressed={showExternalValues ? "true" : "false"}
                    onClick={() => setShowExternalValues((current) => !current)}
                  >
                    {showExternalValues ? "Show external names" : "Show external values"}
                  </button>
                </>
              ) : null
            }
            hasDraftEdits={hasDraftEdits}
            isEditing={isEditingEquations}
            isPinnedInPanel={isPinnedInPanel}
            onApply={handleApply}
            onCancel={handleCancel}
            onEditToggle={handleEditToggle}
            onHelpRequest={onHelpRequest}
            onPinCellRequest={onPinCellRequest}
            onToggleCollapsed={onToggleCollapsed}
            title={title}
          />
        }
        title={title}
        typeLabel={cell.type}
      >
        <div className="notebook-model-summary" aria-label="Equations summary">
          <span className="notebook-model-chip">
            Eq <strong>{countDataRows(cell.equations)}</strong>
          </span>
          <span className="notebook-model-chip">
            Ext <strong>{externals.length}</strong>
          </span>
          <span className="notebook-model-chip">
            Init <strong>{initialValuesCount}</strong>
          </span>
          <span className="notebook-model-chip">
            Solver <strong>{solverCell?.options.solverMethod ?? "missing"}</strong>
          </span>
          <span className="notebook-model-chip">
            Hidden <strong>{runtime?.options.hiddenEquation ? "on" : "off"}</strong>
          </span>
          <span className="notebook-model-chip">
            Issues{" "}
            <strong>
              {countModelSectionIssues(allIssues.map((issue) => issue.path), "equations.")}
            </strong>
          </span>
        </div>
      </NotebookLinkedEditorHeader>
      {cell.collapsed ? null : isEditingEquations ? (
        <div className="notebook-model-editor-body">
          <EquationGridEditor
            buildError={buildDiagnostics.modelError}
            currentValues={currentValues}
            equations={draftEquations}
            externals={externals}
            isEmbedded
            issues={equationIssueMap}
            onChange={setDraftEquations}
            onExternalsChange={(nextExternals) => {
              const externalsCell = findExternalsCell(cells, cell.modelId);
              if (!externalsCell) {
                return;
              }
              onReplaceCells(
                cells.map((entry) =>
                  entry.id === externalsCell.id && entry.type === "externals"
                    ? { ...entry, externals: nextExternals }
                    : entry
                )
              );
            }}
            onSelectVariable={(selectedVariable) =>
              onVariableInspectRequest({
                currentValues,
                editor: inspectEditor,
                modelSource,
                selectedVariable,
                variableDescriptions,
                variableUnitMetadata
              })
            }
            documentHighlightedVariable={highlightedVariable}
            parameterNames={externalRowsOnly(externals).map((external) => external.name)}
            showHeading={false}
            showTraceHelp={false}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
          />
        </div>
      ) : (
        <section
          ref={(node) => {
            equationsViewDragScroll.dragScrollRef.current = node;
            sectionWrapRef.current = node;
          }}
          className={`notebook-model-view notebook-oversize-scroll ${equationsViewDragScroll.dragScrollProps.className}`}
          aria-label="Model view"
          data-drag-scroll-ignore="true"
          onClickCapture={equationsViewDragScroll.dragScrollProps.onClickCapture}
          onMouseDown={equationsViewDragScroll.dragScrollProps.onMouseDown}
        >
          <NotebookEquationViewTable
            ariaLabel="Model equations"
            headerRowRef={headerRowRef}
            tableShellRef={tableShellRef}
            valueColumnsCollapse={valueColumnsCollapse}
          >
            {cell.equations.map((row, index) => {
              if (isRowComment(row)) {
                const inferredBoundary = sectionBoundaries.get(row.id) ?? null;
                return (
                  <CommentRowReadView
                    key={row.id}
                    commentEdit={commentEdit}
                    currentValues={currentValues}
                    equations={cell.equations}
                    externals={externals}
                    highlightedVariable={highlightedVariable}
                    index={index}
                    inferredBoundary={inferredBoundary}
                    parameterNames={parameterNameSet}
                    row={row}
                    sectionCollapsible={Boolean(
                      inferredBoundary && sectionCommentHasEquations(cell.equations, index)
                    )}
                    sectionCollapsed={sectionCollapse.isSectionCollapsed(row.id)}
                    variableDescriptions={variableDescriptions}
                    variableUnitMetadata={variableUnitMetadata}
                    onCancelDataRowEdit={inlineEdit.cancelRowEdit}
                    onContextMenu={equationRowMenu.handleRowContextMenu}
                    onInspectVariable={(selectedVariable) =>
                      onVariableInspectRequest({
                        currentValues,
                        editor: inspectEditor,
                        modelSource,
                        selectedVariable,
                        variableDescriptions,
                        variableUnitMetadata
                      })
                    }
                    onToggleSectionCollapse={() => sectionCollapse.toggleSectionCollapse(row.id)}
                  />
                );
              }

              if (
                isEquationRowHiddenBySectionCollapse(cell.equations, sectionCollapse.collapsedSectionIds, index)
              ) {
                return null;
              }

              const equation = row;
              const issue =
                issueMap[`equations.${index}.name`] ?? issueMap[`equations.${index}.expression`];

              return (
                <NotebookEquationReadRow
                  key={equation.id}
                  activeTraceTokenStates={activeTrace?.tokenStates}
                  currentValues={currentValues}
                  laggedCurrentValues={laggedCurrentValues}
                  laggedPeriodLabel={laggedPeriodLabel}
                  displayTokens={showExternalValues ? externalDisplayValues : undefined}
                  equation={equation}
                  equationIndex={index}
                  formatRoleLabel={formatEquationRoleLabel}
                  highlightedVariable={highlightedVariable}
                  hoveredRowId={hoveredRowId}
                  isEditing={inlineEdit.editingEquationId === equation.id}
                  issueMessage={issue}
                  onContextMenu={(event) => {
                    if (inlineEdit.editingEquationId === equation.id) {
                      return;
                    }
                    equationRowMenu.handleRowContextMenu(event, index);
                  }}
                  parameterNames={parameterNameSet}
                  rowDraft={{
                    expression: inlineEdit.draftExpression,
                    name: inlineEdit.draftName
                  }}
                  rowEditFocus={inlineEdit.editFocus}
                  rowValidationError={inlineEdit.validationError}
                  rowValidationWarning={inlineEdit.validationWarning}
                  traceRole={activeTrace?.rowStates.get(equation.id) ?? null}
                  variableDescriptions={variableDescriptions}
                  variableUnitMetadata={variableUnitMetadata}
                  onApplyRow={inlineEdit.applyRowEdit}
                  onBeginRowEdit={(equationId, focus) => {
                    commentEdit.cancelRowEdit();
                    initialValueEdit.cancelEdit();
                    inlineEdit.beginRowEdit(equationId, focus);
                  }}
                  onCancelRow={inlineEdit.cancelRowEdit}
                  onDraftExpressionChange={inlineEdit.setDraftExpression}
                  onDraftNameChange={inlineEdit.setDraftName}
                  {...initialValueCellProps(
                    equation.name,
                    initialValuesCell?.initialValues ?? [],
                    initialValueEdit
                  )}
                  onInspectVariable={(selectedVariable) =>
                    onVariableInspectRequest({
                      currentValues,
                      editor: inspectEditor,
                      modelSource,
                      selectedVariable,
                      variableDescriptions,
                      variableUnitMetadata
                    })
                  }
                  onRowClick={(event) =>
                    schedulePinnedTraceToggle(scheduleDeferredAction, setPinnedTrace, equation.id, event)
                  }
                  onRowMouseEnter={() => setHoveredRowId(equation.id)}
                  onRowMouseLeave={() =>
                    setHoveredRowId((current) => (current === equation.id ? null : current))
                  }
                  onSelectVariableInExpression={(selectedVariable) =>
                    scheduleDeferredAction(() =>
                      onVariableInspectRequest({
                        currentValues,
                        editor: inspectEditor,
                        modelSource,
                        selectedVariable,
                        variableDescriptions,
                        variableUnitMetadata
                      })
                    )
                  }
                  askAiActive={askAiVariable === equation.name}
                  onAskAi={
                    equationAi?.enabled && !isEditingEquations
                      ? () => {
                          setIsEquationsCellAskAiOpen(false);
                          setAskAiVariable((current) =>
                            current === equation.name ? null : equation.name
                          );
                        }
                      : undefined
                  }
                />
              );
            })}
            <ImplicitEquationsSection
              boundary={implicitEquationContext.boundary}
              currentValues={currentValues}
              entries={implicitEquationContext.entries}
              highlightedVariable={highlightedVariable}
              laggedCurrentValues={laggedCurrentValues}
              laggedPeriodLabel={laggedPeriodLabel}
              parameterNames={parameterNameSet}
              preferredRun={implicitEquationContext.preferredRun}
              sectionCollapsible={implicitEquationContext.entries.length > 0}
              sectionCollapsed={sectionCollapse.isSectionCollapsed(IMPLICIT_MATRIX_INTEGRATION_SECTION_ID)}
              variableDescriptions={variableDescriptions}
              variableUnitMetadata={variableUnitMetadata}
              onInspectVariable={(selectedVariable) =>
                onVariableInspectRequest({
                  currentValues,
                  editor: inspectEditor,
                  modelSource,
                  sourceRunCellId: implicitEquationContext.preferredRun?.id ?? null,
                  selectedVariable,
                  variableDescriptions,
                  variableUnitMetadata
                })
              }
              onToggleSectionCollapse={() =>
                sectionCollapse.toggleSectionCollapse(IMPLICIT_MATRIX_INTEGRATION_SECTION_ID)
              }
            />
          </NotebookEquationViewTable>
          {equationRowMenu.rowContextMenu ? (
            <GridRowContextMenu
              addCommentLabel="Add section comment"
              addItemLabel="Add equation"
              askAiLabel={
                equationAi?.enabled &&
                !isRowComment(cell.equations[equationRowMenu.rowContextMenu.rowIndex])
                  ? "Ask AI"
                  : undefined
              }
              canMoveDown={canMoveRowDown(cell.equations, equationRowMenu.rowContextMenu.rowIndex)}
              canMoveUp={canMoveRowUp(cell.equations, equationRowMenu.rowContextMenu.rowIndex)}
              menuRef={equationRowMenu.rowContextMenuRef}
              menuTypeLabel="Equation"
              onAdd={() =>
                equationRowMenu.insertRowBelow(equationRowMenu.rowContextMenu!.rowIndex, newEquationRow())
              }
              onAddComment={() =>
                equationRowMenu.insertRowBelow(equationRowMenu.rowContextMenu!.rowIndex, newRowComment())
              }
              onAskAi={
                equationAi?.enabled &&
                !isRowComment(cell.equations[equationRowMenu.rowContextMenu.rowIndex])
                  ? () => {
                      const row = cell.equations[equationRowMenu.rowContextMenu!.rowIndex];
                      if (!isRowComment(row)) {
                        setIsEquationsCellAskAiOpen(false);
                        setAskAiVariable(row.name);
                      }
                      equationRowMenu.closeRowContextMenu();
                    }
                  : undefined
              }
              onDelete={() => equationRowMenu.requestDelete(equationRowMenu.rowContextMenu!.rowIndex)}
              onMoveDown={() => equationRowMenu.moveRowAt(equationRowMenu.rowContextMenu!.rowIndex, 1)}
              onMoveUp={() => equationRowMenu.moveRowAt(equationRowMenu.rowContextMenu!.rowIndex, -1)}
              rowIndex={equationRowMenu.rowContextMenu.rowIndex}
            />
          ) : null}
          {equationRowMenu.deleteDialogRowIndex != null ? (
            <GridRowDeleteDialog
              deleteTitle={
                isRowComment(cell.equations[equationRowMenu.deleteDialogRowIndex])
                  ? "Delete section comment?"
                  : "Delete equation?"
              }
              itemLabel={formatEquationDeleteLabel(
                cell.equations[equationRowMenu.deleteDialogRowIndex],
                equationRowMenu.deleteDialogRowIndex
              )}
              onCancel={equationRowMenu.cancelDelete}
              onConfirm={equationRowMenu.confirmDelete}
            />
          ) : null}
        </section>
      )}
      {equationAi?.enabled && isEquationsCellAskAiOpen && !isEditingEquations && cell.collapsed !== true ? (
        <EquationsCellAskAiPanel
          betaPassword={equationAi.betaPassword}
          cell={cell}
          document={equationAi.document}
          model={equationAi.model}
          resultCount={equationAi.resultCount}
          selectedPeriodIndex={equationAi.selectedPeriodIndex}
          snapshot={equationAi.snapshot}
          uiMessage={equationAi.uiMessage}
          onClose={() => setIsEquationsCellAskAiOpen(false)}
        />
      ) : null}
      {equationAi?.enabled && askAiVariable && !isEditingEquations && cell.collapsed !== true
        ? (() => {
            const equationRow = cell.equations.find(
              (row) => !isRowComment(row) && row.name === askAiVariable
            );
            if (!equationRow || isRowComment(equationRow)) {
              return null;
            }
            return (
              <EquationRowAskAiPanel
                betaPassword={equationAi.betaPassword}
                cell={cell}
                document={equationAi.document}
                expression={equationRow.expression}
                model={equationAi.model}
                resultCount={equationAi.resultCount}
                selectedPeriodIndex={equationAi.selectedPeriodIndex}
                snapshot={equationAi.snapshot}
                uiMessage={equationAi.uiMessage}
                undoAvailable={equationAi.undoProposalId != null}
                variable={askAiVariable}
                onApplied={equationAi.onApplyPatch}
                onClose={() => setAskAiVariable(null)}
                onUndoApplied={equationAi.onUndoPatch}
              />
            );
          })()
        : null}
      <NotebookFloatingHeaderOverlay
        visible={floatingHeaderVisible}
        anchor={floatingHeaderAnchor}
        horizontalScrollSourceRef={sectionWrapRef}
        resizableTableSourceRef={tableShellRef}
        tableSyncKey={[
          valueColumnsCollapse.initialColumnCollapsed,
          valueColumnsCollapse.currentColumnCollapsed,
          valueColumnsCollapse.gainColumnCollapsed,
          valueColumnsCollapse.roleColumnCollapsed
        ]
          .map(String)
          .join(":")}
        interactive
      >
        <EquationsModelViewHeaderRowStatic
          initialColumnCollapsed={valueColumnsCollapse.initialColumnCollapsed}
          currentColumnCollapsed={valueColumnsCollapse.currentColumnCollapsed}
          gainColumnCollapsed={valueColumnsCollapse.gainColumnCollapsed}
          roleColumnCollapsed={valueColumnsCollapse.roleColumnCollapsed}
          onToggleInitialColumn={valueColumnsCollapse.toggleInitialColumn}
          onToggleCurrentColumn={valueColumnsCollapse.toggleCurrentColumn}
          onToggleGainColumn={valueColumnsCollapse.toggleGainColumn}
          onToggleRoleColumn={valueColumnsCollapse.toggleRoleColumn}
        />
      </NotebookFloatingHeaderOverlay>
      <VariableRenameDialog
        impact={inlineEdit.renameReferenceCount}
        isOpen={inlineEdit.renameDialog != null}
        newName={inlineEdit.renameDialog?.newName ?? ""}
        oldName={inlineEdit.renameDialog?.oldName ?? ""}
        onCancel={inlineEdit.cancelRowEdit}
        onConfirmNo={inlineEdit.confirmRenameNo}
        onConfirmYes={inlineEdit.confirmRenameYes}
      />
    </div>
  );
}

function formatEquationRoleLabel(equation: {
  name: string;
  expression: string;
  desc?: string;
  role?: EquationRole;
}): string {
  const name = equation.name.trim();
  const expression = equation.expression.trim();
  if (!name || !expression) {
    return equation.role ? formatEquationRole(equation.role) : "Auto";
  }

  try {
    return formatEquationRole(
      analyzeParsedEquation(parseEquation(name, expression), {
        description: equation.desc?.trim(),
        explicitRole: equation.role
      }).role
    );
  } catch {
    return equation.role ? formatEquationRole(equation.role) : "Auto";
  }
}

function formatEquationRole(role: EquationRole): string {
  switch (role) {
    case "accumulation":
      return "Accumulation";
    case "identity":
      return "Identity";
    case "target":
      return "Target";
    case "definition":
      return "Definition";
    case "behavioral":
      return "Behavioral";
  }
}

function buildExternalDisplayValues(
  externals: ExternalsCell["externals"],
  selectedPeriodIndex: number
): Map<string, string> {
  return new Map(
    externals.flatMap((external) =>
      isRowComment(external)
        ? []
        : [[external.name, formatExternalValueLabel(external, selectedPeriodIndex)] as const]
    )
  );
}

function formatExternalValueLabel(
  external: ExternalRow,
  selectedPeriodIndex: number
): string {
  if (external.kind === "constant") {
    const constantValue = Number(external.valueText.trim());
    return Number.isFinite(constantValue)
      ? constantValue.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : external.valueText;
  }

  const values = external.valueText
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  const value = values[Math.min(selectedPeriodIndex, Math.max(values.length - 1, 0))];
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "--";
}

function safeBuildRuntime(editor: EditorState) {
  try {
    return buildRuntimeConfig(editor);
  } catch {
    return null;
  }
}

function defaultNotebookEditorOptions(): EditorState["options"] {
  return {
    periods: 100,
    solverMethod: "GAUSS_SEIDEL",
    toleranceText: "1e-15",
    maxIterations: 200,
    defaultInitialValueText: "1e-15",
    hiddenLeftVariable: "",
    hiddenRightVariable: "",
    hiddenToleranceText: "0.00001",
    relativeHiddenTolerance: false
  };
}

function newEquationRow() {
  return {
    id: `eq-${crypto.randomUUID()}`,
    name: "",
    desc: "",
    expression: ""
  };
}

function formatEquationDeleteLabel(row: EquationListItem | undefined, rowIndex: number): string {
  if (!row) {
    return `Row ${rowIndex + 1}`;
  }
  if (isRowComment(row)) {
    return formatCompactRowCommentText(row.text);
  }
  const name = row.name.trim();
  return name ? name : `Equation ${rowIndex + 1}`;
}

export function buildEditorStateForStandaloneModelSections(cells: NotebookCell[], modelId: string): EditorState {
  return buildEditorStateFromSections({
    equations: findEquationsCell(cells, modelId)?.equations ?? [],
    externals: collectModelExternals(cells, modelId),
    initialValues: findInitialValuesCell(cells, modelId)?.initialValues ?? [],
    options: findSolverCell(cells, modelId)?.options ?? defaultNotebookEditorOptions()
  });
}

export function buildIssueMapForStandaloneModelSections(
  cells: NotebookCell[],
  modelId: string
): Record<string, string | undefined> {
  if (!findEquationsCell(cells, modelId)) {
    return {};
  }

  const editor = buildEditorStateForStandaloneModelSections(cells, modelId);
  const matrixInitialIssues = collectMatrixInitialValueOverrideIssues({
    cells,
    modelId,
    cellInitialValues: findInitialValuesCell(cells, modelId)?.initialValues ?? []
  });

  return Object.fromEntries(
    [
      ...validateEditorState(editor),
      ...diagnoseBuildRuntime(editor).issues,
      ...matrixInitialIssues
    ].map((issue) => [issue.path, issue.message])
  );
}
