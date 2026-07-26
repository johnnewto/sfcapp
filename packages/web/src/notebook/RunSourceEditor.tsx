import type { ScenarioDefinition, ShockVariableDef } from "@sfcr/core";
import { parseLenientJsonValue } from "@sfcr/notebook-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { formatCellBody } from "./sourceEditing";
import type { ExogenizeEntry, NotebookCell, RunCell } from "./types";
import {
  applyShockVariableRenameToRunCell,
  resolveRunCellRenameScope,
  useRunShockVariableRename
} from "./useRunShockVariableRename";
import { VariableRenameDialog } from "./components/EquationRowInlineEditor";

/** Wildcard token mirroring `EXOGENIZE_ALL_TOKEN` in the editor-model transform. */
const EXOGENIZE_ALL_TOKEN = "*";

type ScenarioShockDraft = ScenarioDefinition["shocks"][number] & {
  rangeInclusive?: [number, number];
};

type RunCellSourceDraft = Omit<RunCell, "scenario"> & {
  scenario?: { shocks: ScenarioShockDraft[] } | null;
};

interface RunSourceEditorProps {
  cells?: NotebookCell[];
  runCellId?: string;
  value: string;
  onChange(next: string): void;
  onReplaceCells?(nextCells: NotebookCell[]): void;
}

export function RunSourceEditor({
  cells = [],
  runCellId,
  value,
  onChange,
  onReplaceCells
}: RunSourceEditorProps) {
  const parsed = useMemo(() => parseRunCellSource(value), [value]);
  const scope = useMemo(
    () => (parsed ? resolveRunCellRenameScope(parsed) : null),
    [parsed]
  );
  const shockRename = useRunShockVariableRename({
    cells,
    onReplaceCells,
    runCellId: runCellId ?? parsed?.id,
    scope,
    value
  });
  const [exogenizeDraft, setExogenizeDraft] = useState("");
  const exogenizeScrollRef = useRef<HTMLDivElement | null>(null);
  const exogenizeScrollLeftRef = useRef(0);

  // Editing a cell round-trips the run JSON through the parent, which can re-render
  // (or remount) this table and reset its horizontal scroll. Restore the last
  // user scroll position after every render so edits don't snap the table back to 0.
  useLayoutEffect(() => {
    const node = exogenizeScrollRef.current;
    if (node && node.scrollLeft !== exogenizeScrollLeftRef.current) {
      node.scrollLeft = exogenizeScrollLeftRef.current;
    }
  });

  if (!parsed) {
    return (
      <div className="scenario-source-editor scenario-source-editor-invalid" role="status">
        Run editor needs valid run-cell JSON. Switch to Pretty or Compact to repair the source.
      </div>
    );
  }

  const runCell = parsed;
  const scenario = runCell.scenario ?? { shocks: [] };
  const exogenizeEntries = runCell.exogenize ?? [];
  const baselineStartPeriodMax = resolveBaselineStartPeriodMax(cells, runCell);

  function commit(next: RunCellSourceDraft): void {
    onChange(formatCellBody(next, "compact"));
  }

  function updateCell(patch: Partial<RunCellSourceDraft>): void {
    commit({ ...runCell, ...patch } as RunCellSourceDraft);
  }

  function updateMode(nextMode: RunCellSourceDraft["mode"]): void {
    if (nextMode === "baseline") {
      if (runCell.mode === "scenario" && hasScenarioOnlyData(runCell) && !confirmScenarioModeLoss()) {
        return;
      }

      const baselineCell = { ...runCell };
      delete baselineCell.baselineRunCellId;
      delete baselineCell.baselineStartPeriod;
      delete baselineCell.scenario;
      commit({ ...baselineCell, mode: "baseline" } as RunCellSourceDraft);
      return;
    }

    commit({
      ...runCell,
      mode: "scenario",
      scenario: runCell.scenario ?? { shocks: [] }
    } as RunCellSourceDraft);
  }

  function updateShock(shockIndex: number, patch: Partial<ScenarioShockDraft>): void {
    commit({
      ...runCell,
      scenario: {
        shocks: scenario.shocks.map((shock, index) =>
          index === shockIndex ? { ...shock, ...patch } : shock
        )
      }
    } as RunCellSourceDraft);
  }

  function updateShockVariable(
    shockIndex: number,
    variableName: string,
    nextName: string,
    nextValue: ShockVariableDef
  ): void {
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      return;
    }

    const shock = scenario.shocks[shockIndex];
    if (!shock) {
      return;
    }

    shockRename.requestShockVariableRename(
      shockIndex,
      variableName,
      trimmedName,
      nextValue,
      () => {
        commit(
          applyShockVariableRenameToRunCell(
            runCell,
            shockIndex,
            variableName,
            trimmedName,
            nextValue
          ) as RunCellSourceDraft
        );
      }
    );
  }

  function updateBaselineStartPeriod(nextValueText: string): void {
    if (nextValueText === "") {
      updateCell({ baselineStartPeriod: undefined });
      return;
    }

    const nextValue = Number(nextValueText);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    updateCell({ baselineStartPeriod: clampBaselineStartPeriod(nextValue, baselineStartPeriodMax) });
  }

  function setExogenizeEntries(next: ExogenizeEntry[]): void {
    updateCell({ exogenize: next.length > 0 ? next : undefined });
  }

  function updateExogenizeName(index: number, nextName: string): void {
    setExogenizeEntries(
      exogenizeEntries.map((entry, position) =>
        position === index ? buildExogenizeEntry(nextName, exogenizeEntryWindow(entry)) : entry
      )
    );
  }

  function updateExogenizeWindow(index: number, nextWindowText: string): void {
    const trimmed = nextWindowText.trim();
    const window = trimmed === "" ? undefined : Number(trimmed);
    setExogenizeEntries(
      exogenizeEntries.map((entry, position) =>
        position === index ? buildExogenizeEntry(exogenizeEntryName(entry), window) : entry
      )
    );
  }

  function removeExogenizeEntry(index: number): void {
    setExogenizeEntries(exogenizeEntries.filter((_entry, position) => position !== index));
  }

  function commitExogenizeDraft(): void {
    const added = exogenizeDraft
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    setExogenizeDraft("");
    if (added.length > 0) {
      setExogenizeEntries([...exogenizeEntries, ...added]);
    }
  }

  return (
    <div className="scenario-source-editor">
      <div className="scenario-source-meta-grid" aria-label="Run settings">
        <RunField label="Mode">
          <select
            className="scenario-pill-input"
            aria-label="Run mode"
            value={runCell.mode}
            onChange={(event) => updateMode(event.target.value as RunCellSourceDraft["mode"])}
          >
            <option value="baseline">baseline</option>
            <option value="scenario">scenario</option>
          </select>
        </RunField>
        <RunField label={runCell.mode === "scenario" ? "Scenario periods" : "Periods"}>
          <input
            className="scenario-pill-input scenario-pill-input-number"
            type="number"
            value={runCell.periods ?? ""}
            onChange={(event) =>
              updateCell({ periods: event.target.value === "" ? undefined : Number(event.target.value) })
            }
            placeholder="100"
          />
        </RunField>
        <RunField label="Simulation">
          <select
            className="scenario-pill-input"
            aria-label="Simulation type"
            value={runCell.simType ?? "DYNAMIC"}
            onChange={(event) =>
              updateCell({ simType: event.target.value as RunCellSourceDraft["simType"] })
            }
          >
            <option value="DYNAMIC">DYNAMIC</option>
            <option value="STATIC">STATIC</option>
          </select>
        </RunField>
        {runCell.mode === "scenario" ? (
          <>
            <RunField label="Baseline">
              <input
                className="scenario-pill-input scenario-pill-input-mono"
                value={runCell.baselineRunCellId ?? ""}
                onChange={(event) => updateCell({ baselineRunCellId: event.target.value })}
                placeholder="baseline-run"
              />
            </RunField>
            <RunField
              label={
                baselineStartPeriodMax == null
                  ? "Start period"
                  : `Start period (<=${baselineStartPeriodMax})`
              }
            >
              <input
                className="scenario-pill-input scenario-pill-input-number"
                type="number"
                max={baselineStartPeriodMax}
                min={1}
                value={runCell.baselineStartPeriod ?? ""}
                onChange={(event) => updateBaselineStartPeriod(event.target.value)}
                placeholder={baselineStartPeriodMax == null ? "55" : String(baselineStartPeriodMax)}
              />
            </RunField>
          </>
        ) : null}
      </div>

      <RunField label="Exogenize">
        <div className="scenario-source-exogenize-table">
          <div
            className="scenario-source-exogenize-scroll"
            ref={exogenizeScrollRef}
            onScroll={(event) => {
              exogenizeScrollLeftRef.current = event.currentTarget.scrollLeft;
            }}
          >
            <table className="scenario-source-exogenize-grid">
              <tbody>
                <tr className="scenario-source-exogenize-grid-remove-row">
                  <th scope="row" aria-hidden="true" />
                  {exogenizeEntries.map((entry, index) => (
                    <td key={`remove-${index}`}>
                      <button
                        type="button"
                        className="scenario-source-exogenize-remove"
                        aria-label={`Remove ${exogenizeEntryName(entry) || `variable ${index + 1}`}`}
                        title="Remove variable"
                        onClick={() => removeExogenizeEntry(index)}
                      >
                        ×
                      </button>
                    </td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <th scope="row">exogenize</th>
                  {exogenizeEntries.map((entry, index) => (
                    <td key={`name-${index}`}>
                      <input
                        className="scenario-pill-input scenario-pill-input-mono scenario-source-exogenize-cell"
                        aria-label={`Exogenize variable ${index + 1}`}
                        value={exogenizeEntryName(entry)}
                        onChange={(event) => updateExogenizeName(index, event.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      className="scenario-pill-input scenario-pill-input-mono scenario-source-exogenize-cell scenario-source-exogenize-add"
                      aria-label="Add exogenize variable"
                      value={exogenizeDraft}
                      onChange={(event) => setExogenizeDraft(event.target.value)}
                      onBlur={commitExogenizeDraft}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitExogenizeDraft();
                        }
                      }}
                      placeholder={`add… (${EXOGENIZE_ALL_TOKEN} = all)`}
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">throughPeriod</th>
                  {exogenizeEntries.map((entry, index) => (
                    <td key={`window-${index}`}>
                      <input
                        className="scenario-pill-input scenario-pill-input-mono scenario-source-exogenize-cell"
                        inputMode="numeric"
                        aria-label={`throughPeriod for ${exogenizeEntryName(entry) || `variable ${index + 1}`}`}
                        value={exogenizeEntryWindowText(entry)}
                        onChange={(event) => updateExogenizeWindow(index, event.target.value)}
                        placeholder="∞"
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </RunField>

      {runCell.mode === "scenario" ? (
        <>
          <div className="scenario-source-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                updateCell({
                  scenario: {
                    shocks: [
                      ...scenario.shocks,
                      {
                        rangeInclusive: [1, 4],
                        variables: {
                          Gd: { kind: "constant", value: 25 }
                        }
                      } as unknown as ScenarioShockDraft
                    ]
                  }
                })
              }
            >
              Add shock
            </button>
          </div>

          <div className="scenario-source-shocks">
            {scenario.shocks.length === 0 ? (
              <div className="scenario-source-empty">No shocks defined.</div>
            ) : null}
            {scenario.shocks.map((shock, shockIndex) => {
              const [startPeriod, endPeriod] = getShockRange(shock);
              const variableEntries = Object.entries(shock.variables);
              return (
                <section className="scenario-source-shock" key={`shock-${shockIndex}`}>
                  <div className="scenario-source-shock-header">
                    <span>Shock {shockIndex + 1}</span>
                    <div className="scenario-source-range" aria-label={`Shock ${shockIndex + 1} range`}>
                      <span>Start</span>
                      <input
                        className="scenario-pill-input scenario-pill-input-number"
                        type="number"
                        value={startPeriod}
                        onChange={(event) =>
                          updateShock(shockIndex, {
                            rangeInclusive: [Number(event.target.value), endPeriod]
                          })
                        }
                        aria-label={`Shock ${shockIndex + 1} start period`}
                      />
                      <span>:</span>
                      <span>Stop</span>
                      <input
                        className="scenario-pill-input scenario-pill-input-number"
                        type="number"
                        value={endPeriod}
                        onChange={(event) =>
                          updateShock(shockIndex, {
                            rangeInclusive: [startPeriod, Number(event.target.value)]
                          })
                        }
                        aria-label={`Shock ${shockIndex + 1} end period`}
                      />
                    </div>
                    <button
                      type="button"
                      className="scenario-source-remove"
                      onClick={() =>
                        updateCell({
                          scenario: {
                            shocks: scenario.shocks.filter((_, index) => index !== shockIndex)
                          }
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>

                  <div className="scenario-source-variable-table">
                    {variableEntries.map(([name, variable]) => (
                      <ScenarioVariableRow
                        key={name}
                        name={name}
                        renameDialogOldName={shockRename.renameDialog?.oldName ?? null}
                        renameDialogOpen={shockRename.renameDialog != null}
                        variable={variable}
                        onChange={(nextName, nextValue) =>
                          updateShockVariable(shockIndex, name, nextName, nextValue)
                        }
                        onRemove={() => {
                          const nextVariables = { ...shock.variables };
                          delete nextVariables[name];
                          updateShock(shockIndex, { variables: nextVariables });
                        }}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    className="secondary-button scenario-source-add-variable"
                    onClick={() => {
                      const nextName = nextVariableName(shock.variables);
                      updateShock(shockIndex, {
                        variables: {
                          ...shock.variables,
                          [nextName]: { kind: "constant", value: 0 }
                        }
                      });
                    }}
                  >
                    Add variable
                  </button>
                </section>
              );
            })}
          </div>
        </>
      ) : null}
      <VariableRenameDialog
        impact={shockRename.renameReferenceCount}
        isOpen={shockRename.renameDialog != null}
        newName={shockRename.renameDialog?.newName ?? ""}
        oldName={shockRename.renameDialog?.oldName ?? ""}
        onCancel={shockRename.cancelRename}
        onConfirmNo={shockRename.confirmRenameNo}
        onConfirmYes={shockRename.confirmRenameYes}
      />
    </div>
  );
}

function RunField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="scenario-source-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ScenarioVariableRow({
  name,
  renameDialogOldName,
  renameDialogOpen,
  variable,
  onChange,
  onRemove
}: {
  name: string;
  renameDialogOldName: string | null;
  renameDialogOpen: boolean;
  variable: ShockVariableDef;
  onChange(nextName: string, nextValue: ShockVariableDef): void;
  onRemove(): void;
}) {
  const valueText = variable.kind === "constant" ? String(variable.value) : variable.values.join(", ");
  const [nameDraft, setNameDraft] = useState(name);
  const [valueDraft, setValueDraft] = useState(valueText);
  const [isValueFocused, setIsValueFocused] = useState(false);
  const wasRenameDialogOpen = useRef(false);

  useEffect(() => {
    if (!renameDialogOpen && wasRenameDialogOpen.current && renameDialogOldName === name) {
      setNameDraft(name);
    }
    wasRenameDialogOpen.current = renameDialogOpen;
  }, [name, renameDialogOldName, renameDialogOpen]);

  useEffect(() => {
    if (nameDraft.trim() === name.trim()) {
      setNameDraft(name);
    }
  }, [name, nameDraft]);

  useEffect(() => {
    if (!isValueFocused) {
      setValueDraft(valueText);
    }
  }, [isValueFocused, valueText]);

  function commitName(): void {
    const trimmedName = nameDraft.trim();
    if (!trimmedName || trimmedName === name.trim()) {
      setNameDraft(name);
      return;
    }

    onChange(trimmedName, variable);
  }

  function updateKind(nextKind: ShockVariableDef["kind"]): void {
    if (nextKind === variable.kind) {
      return;
    }

    onChange(
      name,
      nextKind === "constant" ? { kind: "constant", value: 0 } : { kind: "series", values: [] }
    );
  }

  function updateValue(nextValueText: string): void {
    setValueDraft(nextValueText);

    if (variable.kind === "constant") {
      if (nextValueText.trim() === "") {
        return;
      }
      const nextValue = Number(nextValueText);
      if (Number.isFinite(nextValue)) {
        onChange(name, { kind: "constant", value: nextValue });
      }
      return;
    }

    const parts = nextValueText.split(",").map((item) => item.trim());
    if (parts.some((item) => item === "")) {
      return;
    }

    const values = parts.map((item) => Number(item));
    if (values.some((item) => !Number.isFinite(item))) {
      return;
    }
    onChange(name, { kind: "series", values });
  }

  return (
    <div className="scenario-source-variable-row">
      <input
        className="scenario-pill-input scenario-pill-input-mono"
        value={nameDraft}
        onBlur={commitName}
        onChange={(event) => setNameDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label={`Shock variable ${name}`}
      />
      <select
        className="scenario-pill-input"
        value={variable.kind}
        onChange={(event) => updateKind(event.target.value as ShockVariableDef["kind"])}
        aria-label={`Value kind for ${name}`}
      >
        <option value="constant">constant</option>
        <option value="series">series</option>
      </select>
      <input
        className="scenario-pill-input scenario-pill-input-mono scenario-source-value-input"
        inputMode="decimal"
        value={valueDraft}
        onChange={(event) => updateValue(event.target.value)}
        onBlur={() => setIsValueFocused(false)}
        onFocus={() => setIsValueFocused(true)}
        aria-label={`Value for ${name}`}
      />
      <button type="button" className="scenario-source-remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function parseRunCellSource(source: string): RunCellSourceDraft | null {
  try {
    const parsed = parseLenientJsonValue(source) as NotebookCell;
    return parsed.type === "run" ? (parsed as RunCellSourceDraft) : null;
  } catch {
    return null;
  }
}

function exogenizeEntryName(entry: ExogenizeEntry): string {
  return typeof entry === "string" ? entry : entry.name;
}

function exogenizeEntryWindow(entry: ExogenizeEntry): number | undefined {
  return typeof entry === "string" ? undefined : entry.throughPeriod;
}

function exogenizeEntryWindowText(entry: ExogenizeEntry): string {
  const window = exogenizeEntryWindow(entry);
  return window == null ? "" : String(window);
}

/**
 * Build a canonical `ExogenizeEntry` from an editable cell pair. A finite numeric
 * window pins the variable through that period; anything else leaves it pinned for
 * the whole run (a bare string).
 */
function buildExogenizeEntry(name: string, window: number | undefined): ExogenizeEntry {
  const trimmedName = name.trim();
  return window != null && Number.isFinite(window)
    ? { name: trimmedName, throughPeriod: window }
    : trimmedName;
}

function getShockRange(shock: ScenarioShockDraft): [number, number] {
  return [
    shock.rangeInclusive?.[0] ?? shock.startPeriodInclusive ?? 1,
    shock.rangeInclusive?.[1] ?? shock.endPeriodInclusive ?? 1
  ];
}

function hasScenarioOnlyData(cell: RunCellSourceDraft): boolean {
  return (
    cell.baselineRunCellId != null ||
    cell.baselineStartPeriod != null ||
    (cell.scenario?.shocks.length ?? 0) > 0
  );
}

function confirmScenarioModeLoss(): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }

  return window.confirm(
    "Switching this run to baseline will remove its scenario shocks, baseline link, and start period. Continue?"
  );
}

function resolveBaselineStartPeriodMax(
  cells: NotebookCell[],
  cell: RunCellSourceDraft
): number | undefined {
  if (cell.mode !== "scenario" || !cell.baselineRunCellId) {
    return undefined;
  }

  const baselineRunCell = cells.find(
    (candidate): candidate is RunCell =>
      candidate.type === "run" && candidate.id === cell.baselineRunCellId
  );
  if (!baselineRunCell) {
    return undefined;
  }

  return baselineRunCell.periods;
}

function clampBaselineStartPeriod(value: number, max: number | undefined): number {
  const lowerBounded = Math.max(value, 1);
  return max == null ? lowerBounded : Math.min(lowerBounded, max);
}

function nextVariableName(variables: Record<string, ShockVariableDef>): string {
  let index = 1;
  let name = "variable";
  while (Object.prototype.hasOwnProperty.call(variables, name)) {
    index += 1;
    name = `variable${index}`;
  }
  return name;
}
