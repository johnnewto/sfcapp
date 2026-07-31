import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { equationOutputVariable, type EquationRole } from "@sfcr/core";

import {
  HighlightedFormulaInput,
  highlightFormula,
  togglePinnedTrace,
  type PinnedTrace,
  type TraceTokenRole
} from "../../components/EquationGridEditor";
import { InstantTooltip } from "../../components/InstantTooltip";
import { VariableLabel } from "../../components/VariableLabel";
import { renderVariableMathLabel } from "../../components/VariableMathLabel";
import { formatNotebookCurrentValue } from "./NotebookCurrentValue";
import {
  computeEquationVariableGain,
  formatEquationVariableGain
} from "../../lib/equationVariableGain";
import type { EquationRow } from "../../lib/editorModel";
import { collectEquationDenominatorVariables } from "../../lib/equationDivisionAnalysis";
import type { VariableDescriptions } from "../../lib/variableDescriptions";
import { resolveVariableTooltip, type VariableUnitMetadata } from "../../lib/unitMeta";
import { documentHighlightClassName } from "../../lib/variableHighlight";

import type { VariableReferenceCount } from "../renameVariable";
import { ModelInitialValueCell } from "./ModelInitialValueCell";

const DEFERRED_ACTION_DELAY_MS = 400;

export type EquationRowEditFocus = "name" | "expression";

/**
 * Equation names can be function-call forms such as `d(Mp)`, `TSDELTALOG(lh,1)`,
 * or `TSDELTA(lh,1)`. For those we tokenize the name so individual variable
 * arguments (e.g. `Mp`, `lh`) participate in document highlighting, instead of
 * highlighting the whole cell. Plain variable names keep their simpler rendering.
 */
function isFunctionCallEquationName(name: string): boolean {
  return name.includes("(");
}

function nextNonSpaceIsOpenParen(source: string, fromIndex: number): boolean {
  for (let index = fromIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character.trim() === "") {
      continue;
    }
    return character === "(";
  }
  return false;
}

function renderHighlightedEquationName(
  name: string,
  highlightedVariable: string | null | undefined,
  currentValues?: Record<string, number | undefined>,
  variableDescriptions?: VariableDescriptions,
  variableUnitMetadata?: VariableUnitMetadata
): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokenPattern = /([A-Za-z_][A-Za-z0-9_.^{}]*)|(\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;
  let lastIndex = 0;

  for (const match of name.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push(name.slice(lastIndex, index));
    }

    const isIdentifier = Boolean(match[1]);
    const afterIndex = index + token.length;
    const isFunctionToken = isIdentifier && nextNonSpaceIsOpenParen(name, afterIndex);

    if (isIdentifier && !isFunctionToken) {
      const tokenClassName = documentHighlightClassName(
        token,
        highlightedVariable,
        "formula-token"
      );
      const tooltip = resolveVariableTooltip({
        name: token,
        variableDescriptions,
        variableUnitMetadata,
        currentValues
      });
      parts.push(
        <InstantTooltip key={`name-token-${index}`} className={tokenClassName} tooltip={tooltip}>
          {renderVariableMathLabel(token)}
        </InstantTooltip>
      );
    } else {
      parts.push(token);
    }

    lastIndex = afterIndex;
  }

  if (lastIndex < name.length) {
    parts.push(name.slice(lastIndex));
  }

  return parts;
}

export function useDeferredAction(delayMs = DEFERRED_ACTION_DELAY_MS) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDeferredAction = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearDeferredAction(), [clearDeferredAction]);

  const scheduleDeferredAction = useCallback(
    (action: () => void) => {
      clearDeferredAction();
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        action();
      }, delayMs);
    },
    [clearDeferredAction, delayMs]
  );

  return { clearDeferredAction, scheduleDeferredAction };
}

export function VariableRenameDialog({
  impact,
  isOpen,
  newName,
  oldName,
  onCancel,
  onConfirmNo,
  onConfirmYes
}: {
  impact: VariableReferenceCount;
  isOpen: boolean;
  newName: string;
  oldName: string;
  onCancel(): void;
  onConfirmNo(): void;
  onConfirmYes(): void;
}) {
  const noButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      noButtonRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const { affectedCells, cellCount, referenceCount } = impact;
  const impactSummary =
    referenceCount > 0
      ? `${referenceCount} reference${referenceCount === 1 ? "" : "s"} in ${cellCount} cell${cellCount === 1 ? "" : "s"}.`
      : "No other references were found.";

  return (
    <div className="notebook-cell-delete-dialog-backdrop" onClick={onCancel}>
      <div
        className="notebook-cell-delete-dialog notebook-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Rename variable across notebook"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Rename variable across notebook?</h3>
        <p>
          Rename <strong>{oldName}</strong> to <strong>{newName}</strong> everywhere it appears in this
          model&apos;s equations, externals, initial values, matrices, tables, charts, and runs?
        </p>
        <p className="notebook-confirm-dialog-summary">{impactSummary}</p>
        {affectedCells.length > 0 ? (
          <ul className="notebook-rename-impact-list" aria-label="Affected cells">
            {affectedCells.map((entry) => (
              <li key={entry.cellId} className="notebook-rename-impact-item">
                <span className="notebook-rename-impact-type">{entry.cellType}</span>
                <span className="notebook-rename-impact-title">{entry.cellTitle}</span>
                <span className="notebook-rename-impact-count">
                  {entry.referenceCount} reference{entry.referenceCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="notebook-cell-delete-dialog-actions notebook-confirm-dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button ref={noButtonRef} className="secondary-button" onClick={onConfirmNo} type="button">
            No
          </button>
          <button onClick={onConfirmYes} type="button">
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

function EquationRowInlineEditor({
  currentValues,
  draftExpression,
  draftName,
  editFocus,
  equationIndex,
  hasDraftChanges,
  parameterNames,
  validationError,
  validationWarning,
  variableDescriptions,
  variableUnitMetadata,
  onApply,
  onCancel,
  onDraftExpressionChange,
  onDraftNameChange,
  onSelectVariable
}: {
  currentValues: Record<string, number | undefined>;
  draftExpression: string;
  draftName: string;
  editFocus: EquationRowEditFocus;
  equationIndex: number;
  hasDraftChanges: boolean;
  parameterNames: Set<string>;
  validationError: string | null;
  validationWarning?: string | null;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
  onApply(): void;
  onCancel(): void;
  onDraftExpressionChange(value: string): void;
  onDraftNameChange(value: string): void;
  onSelectVariable?(variableName: string): void;
}) {
  const nameInputRef = useRef<HTMLTextAreaElement | null>(null);
  const expressionInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const target = editFocus === "name" ? nameInputRef.current : expressionInputRef.current;
    target?.focus();
    target?.select();
  }, [editFocus]);

  return (
    <div
      className="notebook-equation-row-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <HighlightedFormulaInput
        ariaLabel={`Equation ${equationIndex + 1} variable`}
        className="notebook-equation-row-name-input"
        currentValues={currentValues}
        inputRef={(node) => {
          nameInputRef.current = node;
        }}
        onChange={onDraftNameChange}
        onEnter={() => expressionInputRef.current?.focus()}
        onSelectVariable={onSelectVariable}
        parameterNames={parameterNames}
        placeholder="Variable"
        value={draftName}
        variableDescriptions={variableDescriptions}
        variableUnitMetadata={variableUnitMetadata}
      />
      <HighlightedFormulaInput
        ariaLabel={`Equation ${equationIndex + 1} expression`}
        className="notebook-equation-row-expression-input"
        currentValues={currentValues}
        inputRef={(node) => {
          expressionInputRef.current = node;
        }}
        onChange={onDraftExpressionChange}
        onEnter={onApply}
        onSelectVariable={onSelectVariable}
        parameterNames={parameterNames}
        placeholder="Expression"
        value={draftExpression}
        variableDescriptions={variableDescriptions}
        variableUnitMetadata={variableUnitMetadata}
      />
      {validationError ? <div className="error-text">{validationError}</div> : null}
      {!validationError && validationWarning ? (
        <div className="warning-text">{validationWarning}</div>
      ) : null}
      <div className="notebook-equation-row-editor-actions">
        <button disabled={!hasDraftChanges} onClick={onApply} type="button">
          Apply
        </button>
        <button className="secondary-button" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function NotebookEquationReadRow({
  activeTraceTokenStates,
  currentValues,
  laggedCurrentValues,
  laggedPeriodLabel,
  displayTokens,
  equation,
  equationIndex,
  formatRoleLabel,
  highlightedVariable = null,
  hoveredRowId,
  isEditing,
  issueMessage,
  onContextMenu,
  rowDraft,
  rowEditFocus,
  rowValidationError,
  rowValidationWarning = null,
  parameterNames,
  traceRole,
  variableDescriptions,
  variableUnitMetadata,
  onApplyRow,
  onBeginRowEdit,
  onCancelRow,
  onDraftExpressionChange,
  onDraftNameChange,
  onInspectVariable,
  onRowClick,
  onRowMouseEnter,
  onRowMouseLeave,
  onSelectVariableInExpression,
  onAskAi,
  askAiActive = false,
  initialValueText = null,
  isEditingInitialValue = false,
  draftInitialValueText = "",
  initialValueValidationError = null,
  onApplyInitialValue,
  onBeginInitialValueEdit,
  onCancelInitialValueEdit,
  onDraftInitialValueTextChange
}: {
  activeTraceTokenStates?: Map<string, TraceTokenRole>;
  currentValues: Record<string, number | undefined>;
  laggedCurrentValues?: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  displayTokens?: Map<string, string>;
  equation: EquationRow;
  equationIndex: number;
  formatRoleLabel(equation: EquationRow): string;
  highlightedVariable?: string | null;
  hoveredRowId: string | null;
  isEditing: boolean;
  issueMessage?: string;
  onContextMenu?(event: React.MouseEvent<HTMLDivElement>): void;
  rowDraft: { expression: string; name: string };
  rowEditFocus: EquationRowEditFocus;
  rowValidationError: string | null;
  rowValidationWarning?: string | null;
  parameterNames: Set<string>;
  traceRole: TraceTokenRole | null;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
  onApplyRow(): void;
  onBeginRowEdit(equationId: string, focus: EquationRowEditFocus): void;
  onCancelRow(): void;
  onDraftExpressionChange(value: string): void;
  onDraftNameChange(value: string): void;
  onInspectVariable(variableName: string): void;
  onRowClick(event: React.MouseEvent<HTMLDivElement>): void;
  onRowMouseEnter(): void;
  onRowMouseLeave(): void;
  onSelectVariableInExpression?(variableName: string): void;
  onAskAi?(): void;
  askAiActive?: boolean;
  initialValueText?: string | null;
  isEditingInitialValue?: boolean;
  draftInitialValueText?: string;
  initialValueValidationError?: string | null;
  onApplyInitialValue?(): void;
  onBeginInitialValueEdit?(): void;
  onCancelInitialValueEdit?(): void;
  onDraftInitialValueTextChange?(value: string): void;
}) {
  const { clearDeferredAction, scheduleDeferredAction } = useDeferredAction();
  const hasDraftChanges =
    rowDraft.name.trim() !== equation.name.trim() ||
    rowDraft.expression.trim() !== equation.expression.trim();
  const denominatorVariableNames = useMemo(
    () => collectEquationDenominatorVariables(equation.expression),
    [equation.expression]
  );

  const handleBeginEdit = (focus: EquationRowEditFocus, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    clearDeferredAction();
    onCancelInitialValueEdit?.();
    onBeginRowEdit(equation.id, focus);
  };

  const handleBeginInitialValueEdit = () => {
    clearDeferredAction();
    onCancelRow();
    onBeginInitialValueEdit?.();
  };

  if (isEditing) {
    return (
      <div
        className={[
          "notebook-model-view-row",
          "notebook-model-view-row-editing",
          issueMessage ? "has-issue" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        role="row"
      >
        <div className="notebook-model-view-row-editor-cell" role="cell">
          <EquationRowInlineEditor
            currentValues={currentValues}
            draftExpression={rowDraft.expression}
            draftName={rowDraft.name}
            editFocus={rowEditFocus}
            equationIndex={equationIndex}
            hasDraftChanges={hasDraftChanges}
            parameterNames={parameterNames}
            validationError={rowValidationError}
            validationWarning={rowValidationWarning}
            variableDescriptions={variableDescriptions}
            variableUnitMetadata={variableUnitMetadata}
            onApply={onApplyRow}
            onCancel={onCancelRow}
            onDraftExpressionChange={onDraftExpressionChange}
            onDraftNameChange={onDraftNameChange}
            onSelectVariable={onSelectVariableInExpression}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "notebook-model-view-row",
        issueMessage ? "has-issue" : "",
        hoveredRowId === equation.id ? "is-hovered" : "",
        traceRole ? `trace-${traceRole}` : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-variable={equationOutputVariable(equation.name) ?? equation.name.trim()}
      onClick={(event) => {
        clearDeferredAction();
        onRowClick(event);
      }}
      onDoubleClick={(event) => handleBeginEdit("expression", event)}
      onContextMenu={onContextMenu}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
      role="row"
    >
      <span
        className="notebook-model-view-name is-editable"
        role="cell"
        title="Double-click to edit"
        onDoubleClick={(event) => handleBeginEdit("name", event)}
      >
        {equation.name ? (
          (() => {
            const traceClassName =
              traceRole && equation.name.trim()
                ? `formula-token trace-token-${
                    activeTraceTokenStates?.get(equation.name.trim()) ?? "root"
                  }`
                : undefined;
            const isFunctionCallName = isFunctionCallEquationName(equation.name);
            const inspectTarget = equationOutputVariable(equation.name);
            return (
              <button
                type="button"
                className={
                  isFunctionCallName
                    ? "result-variable-button"
                    : documentHighlightClassName(
                        equation.name.trim(),
                        highlightedVariable,
                        "result-variable-button"
                      )
                }
                onClick={(event) => {
                  event.stopPropagation();
                  clearDeferredAction();
                  onInspectVariable(inspectTarget);
                }}
              >
                {isFunctionCallName ? (
                  <span className={traceClassName}>
                    {renderHighlightedEquationName(
                      equation.name,
                      highlightedVariable,
                      currentValues,
                      variableDescriptions,
                      variableUnitMetadata
                    )}
                  </span>
                ) : (
                  <VariableLabel
                    className={traceClassName}
                    currentValues={currentValues}
                    name={equation.name}
                    variableDescriptions={variableDescriptions}
                    variableUnitMetadata={variableUnitMetadata}
                  />
                )}
              </button>
            );
          })()
        ) : (
          "?"
        )}
      </span>
      <span
        className="notebook-model-view-expression is-editable"
        role="cell"
        title="Double-click to edit"
        onDoubleClick={(event) => handleBeginEdit("expression", event)}
      >
        {equation.expression
          ? highlightFormula(
              equation.expression,
              parameterNames,
              traceRole ? activeTraceTokenStates : undefined,
              variableDescriptions,
              variableUnitMetadata,
              onSelectVariableInExpression,
              displayTokens,
              currentValues,
              highlightedVariable,
              true,
              laggedCurrentValues,
              laggedPeriodLabel,
              denominatorVariableNames
            )
          : " "}
      </span>
      <span className="notebook-model-view-description" role="cell">
        {equation.desc?.trim() || " "}
      </span>
      <ModelInitialValueCell
        draftValueText={draftInitialValueText}
        initialValueText={initialValueText}
        isEditing={isEditingInitialValue}
        validationError={initialValueValidationError}
        variableName={equation.name}
        onApply={() => onApplyInitialValue?.()}
        onBeginEdit={handleBeginInitialValueEdit}
        onCancel={() => onCancelInitialValueEdit?.()}
        onDraftValueTextChange={(value) => onDraftInitialValueTextChange?.(value)}
      />
      <span className="notebook-model-view-current" role="cell">
        <VariableLabel
          className="notebook-current-value-tooltip-anchor"
          currentValue={currentValues[equation.name.trim()]}
          name={equation.name}
          variableDescriptions={variableDescriptions}
          variableUnitMetadata={variableUnitMetadata}
        >
          {formatNotebookCurrentValue(
            equation.name,
            currentValues[equation.name.trim()],
            variableDescriptions,
            variableUnitMetadata,
            false,
            2,
            true
          )}
        </VariableLabel>
      </span>
      <span className="notebook-model-view-gain" role="cell">
        {formatEquationVariableGain(
          computeEquationVariableGain(
            currentValues[equation.name.trim()],
            laggedCurrentValues?.[equation.name.trim()]
          )
        )}
      </span>
      <span className="notebook-model-view-kind" role="cell">
        <span className="notebook-model-view-kind-content">
          <span className="notebook-model-view-kind-label">{formatRoleLabel(equation)}</span>
          {onAskAi ? (
            <button
              type="button"
              className={`notebook-run-button notebook-equation-ask-ai-toggle${askAiActive ? " is-active" : ""}`}
              aria-pressed={askAiActive}
              onClick={(event) => {
                event.stopPropagation();
                clearDeferredAction();
                onAskAi();
              }}
            >
              Ask AI
            </button>
          ) : null}
        </span>
      </span>
    </div>
  );
}

export function schedulePinnedTraceToggle(
  scheduleDeferredAction: (action: () => void) => void,
  setPinnedTrace: (updater: (current: PinnedTrace | null) => PinnedTrace | null) => void,
  equationId: string,
  event: React.MouseEvent<HTMLDivElement>
): void {
  scheduleDeferredAction(() => {
    setPinnedTrace((current) => togglePinnedTrace(current, equationId, event));
  });
}
