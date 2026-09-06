import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import {
  derivativeBalanceStockName,
  isDerivativeBalanceTarget,
  type EquationRole
} from "@sfcr/core";
import {
  isRowComment,
  normalizeRowCommentText,
  resolveInferredSectionBoundary,
  type EquationListItem,
  type ExternalListItem
} from "@sfcr/notebook-core";

import type { EquationRow, ValidationIssue } from "../lib/editorModel";
import { NotebookRowComment } from "../notebook/components/NotebookRowComment";
import { newRowComment, patchCommentInRows } from "../notebook/rowCommentHelpers";
import type { VariableDescriptions } from "../lib/variableDescriptions";
import {
  coerceUnitMeta,
  resolveVariableTooltip,
  type UnitMeta,
  type VariableUnitMetadata
} from "../lib/unitMeta";
import {
  applyMirroredEquationUnitSuggestions,
  buildVariableUnitMetadata,
  getEquationRowUnitLabel,
  type MirroredEquationUnitChange
} from "../lib/units";
import {
  buildActiveTrace,
  buildTraceModel,
  togglePinnedTrace,
  type PinnedTrace,
  type TraceTokenRole
} from "./EquationTrace";
import { useEquationGridColumnResize } from "../hooks/useEquationGridColumnResize";
import { FORMULA_TOOLTIP_ATTR } from "./InstantTooltip";
import { MirroredEquationUnitSummaryDialog } from "./MirroredEquationUnitSummaryDialog";
import { EquationUnitPickerPanel } from "./EquationUnitPickerPanel";
import { VariableUnitStatusDialog } from "./VariableUnitStatusDialog";
import {
  canMoveRowDown,
  canMoveRowUp,
  GridRowContextMenu,
  GridRowDeleteDialog,
  insertRowAt,
  moveRow,
  removeRow,
  useGridRowContextMenu
} from "./GridRowContextMenu";
import { GridRowControls } from "./GridRowControls";
import { renderVariableMathLabel } from "./VariableMathLabel";
import { classifyVariableToken } from "../lib/formulaTokenClass";
import { documentHighlightClassName } from "../lib/variableHighlight";
import {
  collectEquationDenominatorVariables,
  formatZeroDenominatorWarning,
  isZeroDenominatorVariable
} from "../lib/equationDivisionAnalysis";

export {
  buildActiveTrace,
  buildTraceModel,
  togglePinnedTrace,
  
  type PinnedTrace,
  
  type TraceTokenRole
} from "./EquationTrace";

interface EquationGridEditorProps {
  buildError?: string | null;
  currentValues?: Record<string, number | undefined>;
  laggedCurrentValues?: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  equations: EquationListItem[];
  externals?: ExternalListItem[];
  issues: Record<string, string | ValidationIssue | undefined>;
  isEmbedded?: boolean;
  onChange(next: EquationListItem[]): void;
  onSelectVariable?(variableName: string): void;
  documentHighlightedVariable?: string | null;
  parameterNames?: string[];
  showHeading?: boolean;
  showTraceHelp?: boolean;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
  onExternalsChange?(externals: ExternalListItem[]): void;
}

export function EquationGridEditor({
  buildError = null,
  currentValues = {},
  laggedCurrentValues = {},
  laggedPeriodLabel,
  equations,
  externals = [],
  issues,
  isEmbedded = false,
  onChange,
  onSelectVariable,
  documentHighlightedVariable = null,
  parameterNames = [],
  showHeading = true,
  showTraceHelp = true,
  variableDescriptions,
  variableUnitMetadata,
  onExternalsChange
}: EquationGridEditorProps) {
  const parameterNameSet = useMemo(() => new Set(parameterNames), [parameterNames]);
  const resolvedUnitMetadata = useMemo(
    () => variableUnitMetadata ?? buildVariableUnitMetadata({ equations, externals }),
    [variableUnitMetadata, equations, externals]
  );
  const traceModel = useMemo(() => buildTraceModel(equations), [equations]);
  const variableRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const descRefs = useRef<Array<HTMLInputElement | null>>([]);
  const expressionRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [pinnedTrace, setPinnedTrace] = useState<PinnedTrace | null>(null);
  const [openPopover, setOpenPopover] = useState<{ kind: "unit" | "role"; rowId: string } | null>(
    null
  );
  const [unitSuggestionSummary, setUnitSuggestionSummary] = useState<MirroredEquationUnitChange[] | null>(
    null
  );
  const [isUnitStatusDialogOpen, setIsUnitStatusDialogOpen] = useState(false);
  const rowContextMenu = useGridRowContextMenu({
    ignoredSelector:
      "button, select, .equation-grid-unit-cell, .equation-grid-role-cell, .equation-badge-popover-panel",
    onChangeRows: onChange,
    rows: equations
  });
  const columnResize = useEquationGridColumnResize({ isEmbedded });

  const activeTrace = pinnedTrace
    ? buildActiveTrace(traceModel, pinnedTrace.rowId, pinnedTrace.mode)
    : hoveredRowId
      ? buildActiveTrace(traceModel, hoveredRowId, "both")
      : null;
  const showHeader = showHeading || showTraceHelp;

  useEffect(() => {
    if (!openPopover) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        setOpenPopover(null);
        return;
      }

      if (event.target.closest(".equation-grid-unit-cell, .equation-grid-role-cell")) {
        return;
      }

      setOpenPopover(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openPopover]);

  function handleRowContextMenu(event: MouseEvent<HTMLDivElement>, rowIndex: number): void {
    setOpenPopover(null);
    rowContextMenu.handleRowContextMenu(event, rowIndex);
  }

  return (
    <section className={isEmbedded ? "equation-grid-editor-embedded" : "editor-panel"}>
      {showHeader ? (
        <div className="panel-header">
          <div>
            {showHeading ? <h2>Equations</h2> : null}
            {showTraceHelp ? (
              <p className="panel-subtitle">
                Hover previews inputs and outputs. Click pins the link; click again returns to hover.
                Shift+click pins outputs, Ctrl/Cmd+click pins inputs.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {buildError ? <div className="error-text equation-grid-banner">{buildError}</div> : null}

      <div
        ref={columnResize.shellRef}
        className={`equation-grid-shell${columnResize.shellClassName ? ` ${columnResize.shellClassName}` : ""}`.trim()}
      >
        <div className="equation-grid-header" role="row">
          <span>#</span>
          <span ref={columnResize.variableHeaderRef}>Variable</span>
          <span ref={columnResize.expressionHeaderRef}>Expression</span>
          <span>Role</span>
          <span>Units</span>
          <span>Description</span>
          <span>Status</span>
          <span />
          <div {...columnResize.variableResizeHandleProps} />
          <div {...columnResize.expressionResizeHandleProps} />
        </div>

        <div className="equation-grid-body">
          {equations.map((row, index) => {
            if (isRowComment(row)) {
              return (
                <NotebookRowComment
                  key={row.id}
                  currentValues={currentValues}
                  highlightedVariable={documentHighlightedVariable}
                  inferredBoundary={resolveInferredSectionBoundary({
                    comment: row,
                    equations,
                    externals
                  })}
                  mode="grid"
                  parameterNames={parameterNameSet}
                  text={row.text}
                  variableDescriptions={variableDescriptions}
                  variableUnitMetadata={variableUnitMetadata}
                  onContextMenu={(event) => handleRowContextMenu(event, index)}
                  onInspectVariable={onSelectVariable}
                  onTextChange={(text) => onChange(patchCommentInRows(equations, row.id, text))}
                  rowControls={
                    <GridRowControls
                      canMoveDown={canMoveRowDown(equations, index)}
                      canMoveUp={canMoveRowUp(equations, index)}
                      onInsertAfter={() =>
                        onChange(insertRowAt(equations, index + 1, newRowComment()))
                      }
                      onMoveDown={() => onChange(moveRow(equations, index, 1))}
                      onMoveUp={() => onChange(moveRow(equations, index, -1))}
                      onRemove={() => onChange(removeRow(equations, index))}
                      rowIndex={index}
                      rowTypeLabel="section comment"
                    />
                  }
                />
              );
            }

            const equation = row;
            const issue = resolveEquationIssue(index, issues);
            const issueMessage = issue?.message ?? null;
            const traceRole = activeTrace?.rowStates.get(equation.id) ?? null;
            const rowClassName = [
              "equation-grid-row",
              issueMessage ? "has-issue" : "",
              hoveredRowId === equation.id ? "is-hovered" : "",
              traceRole ? `trace-${traceRole}` : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={equation.id} className="equation-grid-row-group">
                <div
                  className={rowClassName}
                  onContextMenu={(event) => handleRowContextMenu(event, index)}
                  onClick={(event) => {
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("textarea,input,button,select")
                    ) {
                      return;
                    }
                    setPinnedTrace((current) =>
                      togglePinnedTrace(current, equation.id, event)
                    );
                  }}
                  onMouseEnter={() => setHoveredRowId(equation.id)}
                  onMouseLeave={() => setHoveredRowId((current) => (current === equation.id ? null : current))}
                  role="row"
                >
                  <span className="equation-grid-index">{index + 1}</span>
                  <HighlightedFormulaInput
                    ariaLabel={`Equation ${index + 1} variable`}
                    className={issues[`equations.${index}.name`] ? "input-error" : ""}
                    highlightedTokens={traceRole ? activeTrace?.tokenStates : undefined}
                    inputRef={(node) => {
                      variableRefs.current[index] = node;
                    }}
                    onChange={(value) =>
                      updateRow(equations, index, { name: value }, onChange)
                    }
                    onEnter={() => descRefs.current[index]?.focus()}
                    parameterNames={parameterNameSet}
                    placeholder="Y"
                    value={equation.name}
                    currentValues={currentValues}
                    laggedCurrentValues={laggedCurrentValues}
                    laggedPeriodLabel={laggedPeriodLabel}
                    onSelectVariable={onSelectVariable}
                    documentHighlightedVariable={documentHighlightedVariable}
                    variableDescriptions={variableDescriptions}
                    variableUnitMetadata={variableUnitMetadata}
                  />
                  <HighlightedFormulaInput
                    ariaLabel={`Equation ${index + 1} expression`}
                    className={issues[`equations.${index}.expression`] ? "input-error" : ""}
                    highlightedTokens={traceRole ? activeTrace?.tokenStates : undefined}
                    inputRef={(node) => {
                      expressionRefs.current[index] = node;
                    }}
                    onChange={(value) =>
                      updateRow(equations, index, { expression: value }, onChange)
                    }
                    onEnter={() => descRefs.current[index]?.focus()}
                    parameterNames={parameterNameSet}
                    placeholder="Cs + Gs"
                    value={equation.expression}
                    currentValues={currentValues}
                    laggedCurrentValues={laggedCurrentValues}
                    laggedPeriodLabel={laggedPeriodLabel}
                    denominatorVariableNames={collectEquationDenominatorVariables(equation.expression)}
                    onSelectVariable={onSelectVariable}
                    documentHighlightedVariable={documentHighlightedVariable}
                    variableDescriptions={variableDescriptions}
                    variableUnitMetadata={variableUnitMetadata}
                  />
                  <EquationRolePopover
                    isOpen={openPopover?.kind === "role" && openPopover.rowId === equation.id}
                    onChange={(role) => updateRow(equations, index, { role }, onChange)}
                    onToggle={() =>
                      setOpenPopover((current) =>
                        current?.kind === "role" && current.rowId === equation.id
                          ? null
                          : { kind: "role", rowId: equation.id }
                      )
                    }
                    role={equation.role}
                  />
                  <EquationUnitsPopover
                    expression={equation.expression}
                    isOpen={openPopover?.kind === "unit" && openPopover.rowId === equation.id}
                    onChange={(unitMeta) => updateRow(equations, index, { unitMeta }, onChange)}
                    onToggle={() =>
                      setOpenPopover((current) =>
                        current?.kind === "unit" && current.rowId === equation.id
                          ? null
                          : { kind: "unit", rowId: equation.id }
                      )
                    }
                    unitMeta={equation.unitMeta ?? variableUnitMetadata?.get(equation.name.trim())}
                    variableName={equation.name}
                    variableUnitMetadata={variableUnitMetadata}
                  />
                  <input
                    aria-label={`Equation ${index + 1} description`}
                    className="equation-grid-description"
                    onChange={(event) =>
                      updateRow(equations, index, { desc: event.target.value }, onChange)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        variableRefs.current[index + 1]?.focus();
                      }
                    }}
                    placeholder="Income = GDP"
                    ref={(node) => {
                      descRefs.current[index] = node;
                    }}
                    spellCheck={false}
                    type="text"
                    value={equation.desc ?? ""}
                  />
                  <span
                    className={`equation-grid-status${issueMessage ? " has-issue" : ""}${
                      issue?.severity === "warning" ? " is-warning" : ""
                    }`}
                  >
                    {issue == null ? "OK" : issue.severity === "warning" ? "Warning" : "Error"}
                  </span>
                  <GridRowControls
                    canMoveDown={canMoveRowDown(equations, index)}
                    canMoveUp={canMoveRowUp(equations, index)}
                    onInsertAfter={() =>
                      onChange(insertRowAt(equations, index + 1, newEquationRow()))
                    }
                    onMoveDown={() => onChange(moveRow(equations, index, 1))}
                    onMoveUp={() => onChange(moveRow(equations, index, -1))}
                    onRemove={() => onChange(removeRow(equations, index))}
                    rowIndex={index}
                    rowTypeLabel="equation"
                  />
                </div>
                {issue != null ? (
                  <div
                    className={`equation-grid-warning-row${
                      issue.severity === "warning" ? " is-warning" : " is-error"
                    }`}
                    role="note"
                  >
                    {issue.message}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="equation-grid-footer">
        <button
          aria-label="Check variable unit status"
          className="secondary-button"
          onClick={() => setIsUnitStatusDialogOpen(true)}
          type="button"
        >
          Check units
        </button>
        <button
          aria-label="Suggest units from additive or subtractive RHS operands"
          className="secondary-button"
          onClick={() => {
            const result = applyMirroredEquationUnitSuggestions({
              equations,
              variableUnitMetadata: resolvedUnitMetadata
            });
            onChange(result.equations);
            setUnitSuggestionSummary(result.changes);
          }}
          type="button"
        >
          Suggest units
        </button>
        <button type="button" onClick={() => onChange([...equations, newEquationRow()])}>
          Add equation
        </button>
        <button type="button" className="secondary-button" onClick={() => onChange([...equations, newRowComment()])}>
          Add section comment
        </button>
      </div>

      {unitSuggestionSummary != null ? (
        <MirroredEquationUnitSummaryDialog
          changes={unitSuggestionSummary}
          isOpen
          onClose={() => setUnitSuggestionSummary(null)}
        />
      ) : null}

      <VariableUnitStatusDialog
        equations={equations}
        externals={externals}
        isOpen={isUnitStatusDialogOpen}
        onApply={({ equations: nextEquations, externals: nextExternals }) => {
          onChange(nextEquations);
          onExternalsChange?.(nextExternals);
        }}
        canEditExternals={onExternalsChange != null}
        onClose={() => setIsUnitStatusDialogOpen(false)}
        onSelectVariable={onSelectVariable}
        variableUnitMetadata={resolvedUnitMetadata}
      />

      {rowContextMenu.rowContextMenu ? (
        <GridRowContextMenu
          addCommentLabel="Add section comment"
          addItemLabel="Add equation"
          canMoveDown={canMoveRowDown(equations, rowContextMenu.rowContextMenu.rowIndex)}
          canMoveUp={canMoveRowUp(equations, rowContextMenu.rowContextMenu.rowIndex)}
          menuRef={rowContextMenu.rowContextMenuRef}
          menuTypeLabel="Equation"
          onAdd={() =>
            rowContextMenu.insertRowBelow(rowContextMenu.rowContextMenu!.rowIndex, newEquationRow())
          }
          onAddComment={() =>
            rowContextMenu.insertRowBelow(rowContextMenu.rowContextMenu!.rowIndex, newRowComment())
          }
          onDelete={() => rowContextMenu.requestDelete(rowContextMenu.rowContextMenu!.rowIndex)}
          onMoveDown={() => rowContextMenu.moveRowAt(rowContextMenu.rowContextMenu!.rowIndex, 1)}
          onMoveUp={() => rowContextMenu.moveRowAt(rowContextMenu.rowContextMenu!.rowIndex, -1)}
          rowIndex={rowContextMenu.rowContextMenu.rowIndex}
        />
      ) : null}

      {rowContextMenu.deleteDialogRowIndex != null ? (
        <GridRowDeleteDialog
          deleteTitle={
            isRowComment(equations[rowContextMenu.deleteDialogRowIndex])
              ? "Delete section comment?"
              : "Delete equation?"
          }
          itemLabel={formatEquationDeleteLabel(
            equations[rowContextMenu.deleteDialogRowIndex],
            rowContextMenu.deleteDialogRowIndex
          )}
          onCancel={rowContextMenu.cancelDelete}
          onConfirm={rowContextMenu.confirmDelete}
        />
      ) : null}
    </section>
  );
}

const EQUATION_ROLE_OPTIONS: Array<{ value: EquationRole; label: string }> = [
  { value: "accumulation", label: "Accumulation" },
  { value: "identity", label: "Identity" },
  { value: "target", label: "Target" },
  { value: "definition", label: "Definition" },
  { value: "behavioral", label: "Behavioral" }
];

export interface HighlightedFormulaInputProps {
  ariaLabel: string;
  className?: string;
  currentValues?: Record<string, number | undefined>;
  laggedCurrentValues?: Record<string, number | undefined>;
  laggedPeriodLabel?: string;
  denominatorVariableNames?: Set<string>;
  displayTokens?: Map<string, string>;
  footer?: ReactNode;
  highlightedTokens?: Map<string, TraceTokenRole>;
  inputRef(node: HTMLTextAreaElement | null): void;
  onBlur?(): void;
  onChange(value: string): void;
  onEnter(): void;
  onSelectVariable?(variableName: string): void;
  documentHighlightedVariable?: string | null;
  parameterNames: Set<string>;
  placeholder: string;
  value: string;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
}

export function EquationUnitsPopover({
  expression,
  isOpen,
  onChange,
  onToggle,
  unitMeta,
  variableName,
  variableUnitMetadata
}: {
  expression: string;
  isOpen: boolean;
  onChange: (unitMeta: UnitMeta | undefined) => void;
  onToggle: () => void;
  unitMeta?: UnitMeta;
  variableName: string;
  variableUnitMetadata?: VariableUnitMetadata;
}) {
  const normalized = coerceUnitMeta(unitMeta);
  const unitLabel = getEquationRowUnitLabel(variableName, normalized) ?? "Set units";

  return (
    <div className={`equation-grid-unit-cell${isOpen ? " is-open" : ""}`.trim()}>
      <button
        aria-expanded={isOpen ? "true" : "false"}
        aria-haspopup="dialog"
        aria-label={`Edit units for ${variableName.trim() || "equation variable"}`}
        className="equation-badge-button unit-badge"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        title="Click to edit units"
        type="button"
      >
        {unitLabel}
      </button>
      {isOpen ? (
        <div
          aria-label={`Unit options for ${variableName.trim() || "equation variable"}`}
          className="equation-badge-popover-panel"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <EquationUnitPickerPanel
            expression={expression}
            onChange={(nextUnitMeta) => {
              onChange(nextUnitMeta);
              onToggle();
            }}
            unitMeta={unitMeta}
            variableName={variableName}
            variableUnitMetadata={variableUnitMetadata}
          />
        </div>
      ) : null}
    </div>
  );
}

function EquationRolePopover({
  isOpen,
  onChange,
  onToggle,
  role
}: {
  isOpen: boolean;
  onChange: (role: EquationRole | undefined) => void;
  onToggle: () => void;
  role?: EquationRole;
}) {
  return (
    <div className={`equation-grid-role-cell${isOpen ? " is-open" : ""}`.trim()}>
      <button
        aria-expanded={isOpen ? "true" : "false"}
        aria-label="Edit equation role"
        className="equation-badge-button equation-grid-role-select"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        type="button"
      >
        {getEquationRoleLabel(role)}
      </button>
      {isOpen ? (
        <div
          className="equation-badge-popover-panel equation-role-popover-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="equation-role-popover-options" role="listbox" aria-label="Equation role options">
            <button
              className={`equation-role-option${role == null ? " is-active" : ""}`.trim()}
              onClick={() => onChange(undefined)}
              type="button"
            >
              Auto
            </button>
            {EQUATION_ROLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`equation-role-option${role === option.value ? " is-active" : ""}`.trim()}
                onClick={() => onChange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function HighlightedFormulaInput({
  ariaLabel,
  className = "",
  currentValues,
  laggedCurrentValues,
  laggedPeriodLabel,
  denominatorVariableNames,
  displayTokens,
  footer,
  highlightedTokens,
  inputRef,
  onBlur,
  onChange,
  onEnter,
  onSelectVariable,
  documentHighlightedVariable = null,
  parameterNames,
  placeholder,
  value,
  variableDescriptions,
  variableUnitMetadata
}: HighlightedFormulaInputProps) {
  return (
    <label className={`highlighted-formula-input ${className}`.trim()}>
      <div
        aria-hidden="true"
        className={`highlighted-formula-preview${value ? "" : " is-placeholder"}`}
      >
        {value
          ? highlightFormula(
              value,
              parameterNames,
              highlightedTokens,
              variableDescriptions,
              variableUnitMetadata,
              onSelectVariable,
              displayTokens,
              currentValues,
              documentHighlightedVariable,
              false,
              laggedCurrentValues,
              laggedPeriodLabel,
              denominatorVariableNames
            )
          : placeholder}
      </div>
      <textarea
        aria-label={ariaLabel}
        className="highlighted-formula-control"
        onBlur={() => onBlur?.()}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        rows={1}
        spellCheck={false}
        value={value}
      />
      {footer}
    </label>
  );
}

function getEquationRoleLabel(role?: EquationRole): string {
  return EQUATION_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Auto";
}

/** Display-only: ASCII multiplication in stored expressions → bullet operator. */
export function formatEquationOperatorDisplay(text: string): string {
  return text.replace(/\*/g, "•");
}

export function highlightFormula(
  source: string,
  parameterNames: Set<string>,
  highlightedTokens?: Map<string, TraceTokenRole>,
  variableDescriptions?: VariableDescriptions,
  variableUnitMetadata?: VariableUnitMetadata,
  onSelectVariable?: (variableName: string) => void,
  displayTokens?: Map<string, string>,
  currentValues?: Record<string, number | undefined>,
  documentHighlightedVariable?: string | null,
  variableSelectOnClick = false,
  laggedCurrentValues?: Record<string, number | undefined>,
  laggedPeriodLabel?: string,
  denominatorVariableNames?: Set<string>
): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokenPattern =
    /(lag\(\s*([A-Za-z_][A-Za-z0-9_.^{}]*)\s*\))|(([A-Za-z_][A-Za-z0-9_.^{}]*)\s*\[\s*-1\s*\])|(([A-Za-z_][A-Za-z0-9_.^{}]*)')|([A-Za-z_][A-Za-z0-9_.^{}]*|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    const laggedVariable = match[2] ?? match[4] ?? match[6];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push(formatEquationOperatorDisplay(source.slice(lastIndex, index)));
    }

    const normalizedToken = (laggedVariable ?? token).trim();
    const tokenClass = laggedVariable
      ? classifyVariableToken(normalizedToken, parameterNames)
      : classifyToken(token, parameterNames, source, index + token.length);
    const renderedToken =
      laggedVariable
        ? displayTokens?.get(normalizedToken) ?? normalizedToken
        : tokenClass === "formula-parameter"
          ? displayTokens?.get(normalizedToken) ?? token
          : token;
    const renderedTokenNode =
      tokenClass === "formula-function" ||
      tokenClass === "formula-number" ||
      tokenClass === "formula-default"
        ? renderedToken
        : laggedVariable
          ? renderLaggedVariableMathLabel(String(renderedToken))
          : renderVariableMathLabel(String(renderedToken));
    const traceClass = highlightedTokens?.get(normalizedToken) ?? null;
    const isLaggedToken = Boolean(laggedVariable);
    const isZeroDenominator =
      tokenClass !== "formula-function" &&
      tokenClass !== "formula-number" &&
      tokenClass !== "formula-default" &&
      isZeroDenominatorVariable({
        name: normalizedToken,
        isLagged: isLaggedToken,
        denominatorVariableNames,
        currentValues,
        laggedCurrentValues
      });
    const hasVariableMetadata =
      variableDescriptions?.has(normalizedToken) || variableUnitMetadata?.has(normalizedToken);
    const baseTokenDescription =
      tokenClass !== "formula-function" &&
      tokenClass !== "formula-number" &&
      tokenClass !== "formula-default" &&
      hasVariableMetadata
        ? resolveVariableTooltip({
            name: normalizedToken,
            variableDescriptions,
            variableUnitMetadata,
            valueReference: isLaggedToken ? "lagged" : "current",
            laggedCurrentValues,
            laggedPeriodLabel,
            currentValues
          })
        : undefined;
    const zeroDenominatorValue = isZeroDenominator
      ? isLaggedToken
        ? laggedCurrentValues?.[normalizedToken]
        : currentValues?.[normalizedToken]
      : undefined;
    const tokenDescription =
      isZeroDenominator && typeof zeroDenominatorValue === "number"
        ? [baseTokenDescription, formatZeroDenominatorWarning({
            name: normalizedToken,
            isLagged: isLaggedToken,
            value: zeroDenominatorValue,
            laggedPeriodLabel
          })].filter(Boolean).join("\n")
        : baseTokenDescription;
    const isInspectableVariable =
      Boolean(onSelectVariable) &&
      tokenClass !== "formula-function" &&
      tokenClass !== "formula-number" &&
      tokenClass !== "formula-default";
    const tokenClassName = documentHighlightClassName(
      normalizedToken,
      documentHighlightedVariable,
      `formula-token ${tokenClass}${traceClass ? ` trace-token-${traceClass}` : ""}${
        isZeroDenominator ? " is-zero-denominator" : ""
      }${isInspectableVariable ? " is-clickable" : ""}`
    );
    const selectVariableOnClick = variableSelectOnClick
      ? (event: MouseEvent<HTMLElement>) => {
          if (!isInspectableVariable || !onSelectVariable) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onSelectVariable(normalizedToken);
        }
      : undefined;
    const selectVariableOnMouseDown =
      !variableSelectOnClick && isInspectableVariable
        ? (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectVariable?.(normalizedToken);
          }
        : undefined;
    parts.push(
      <span
        key={`${token}-${index}`}
        className={tokenClassName}
        {...(tokenDescription ? { [FORMULA_TOOLTIP_ATTR]: tokenDescription } : {})}
        onClick={selectVariableOnClick}
        onMouseDown={selectVariableOnMouseDown}
      >
        {renderedTokenNode}
      </span>
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    parts.push(formatEquationOperatorDisplay(source.slice(lastIndex)));
  }

  return parts;
}

function renderLaggedVariableMathLabel(name: string): ReactNode[] {
  return [
    ...renderVariableMathLabel(name),
    <sup key={`lag-${name}`} className="lag-prime" aria-hidden="true">
      '
    </sup>
  ];
}

function classifyToken(
  token: string,
  parameterNames: Set<string>,
  source: string,
  nextIndex: number
): string {
  if (token === "gnd") {
    return "formula-default";
  }
  if (/^\d/.test(token)) {
    return "formula-number";
  }
  if (isFunctionCall(source, nextIndex)) {
    return "formula-function";
  }
  if (parameterNames.has(token)) {
    return "formula-parameter";
  }
  if (/^[A-Z]/.test(token)) {
    return "formula-uppercase";
  }
  if (/^[a-z]/.test(token)) {
    return "formula-lowercase";
  }
  return "formula-default";
}

function isFunctionCall(source: string, nextIndex: number): boolean {
  for (let index = nextIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character.trim() === "") {
      continue;
    }
    return character === "(";
  }
  return false;
}

function newEquationRow(): EquationRow {
  return {
    id: `eq-${crypto.randomUUID()}`,
    name: "",
    desc: "",
    expression: ""
  };
}

function updateRow(
  rows: EquationListItem[],
  index: number,
  patch: Partial<EquationRow>,
  onChange: (next: EquationListItem[]) => void
): void {
  onChange(
    rows.map((row, rowIndex) =>
      rowIndex === index && !isRowComment(row) ? { ...row, ...patch } : row
    )
  );
}

function formatEquationDeleteLabel(row: EquationListItem | undefined, rowIndex: number): string {
  if (!row) {
    return `Row ${rowIndex + 1}`;
  }
  if (isRowComment(row)) {
    return normalizeRowCommentText(row.text) || `Section ${rowIndex + 1}`;
  }
  const name = row.name.trim();
  return name ? name : `Equation ${rowIndex + 1}`;
}

function normalizeEquationRole(value: string): EquationRole | undefined {
  switch (value) {
    case "accumulation":
    case "identity":
    case "target":
    case "definition":
    case "behavioral":
      return value;
    default:
      return undefined;
  }
}

function resolveEquationIssue(
  index: number,
  issues: Record<string, string | ValidationIssue | undefined>
): ValidationIssue | null {
  const nameIssue = issues[`equations.${index}.name`];
  if (typeof nameIssue === "string") {
    return { path: `equations.${index}.name`, message: nameIssue, severity: "error" };
  }
  if (nameIssue) {
    return nameIssue;
  }

  const expressionIssue = issues[`equations.${index}.expression`];
  if (typeof expressionIssue === "string") {
    return {
      path: `equations.${index}.expression`,
      message: expressionIssue,
      severity: "error"
    };
  }
  return expressionIssue ?? null;
}
