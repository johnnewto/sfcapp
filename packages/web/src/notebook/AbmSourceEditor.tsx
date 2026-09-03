import { parseLenientJsonValue } from "@sfcr/notebook-core";
import { useId, useMemo } from "react";

import { HighlightedFormulaInput, highlightFormula } from "../components/EquationGridEditor";
import { GridRowControls } from "../components/GridRowControls";
import { useEquationGridColumnResize } from "../hooks/useEquationGridColumnResize";
import type { VariableDescriptions } from "../lib/variableDescriptions";
import type { VariableUnitMetadata } from "../lib/unitMeta";
import { formatCellBody } from "./sourceEditing";
import { abmTickKindLabel, type AbmTickKind } from "./abmTickLabels";

export interface AbmSourceEditorProps {
  value: string;
  onChange(next: string): void;
  currentValues?: Record<string, number | undefined>;
  parameterNames?: Set<string>;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
  documentHighlightedVariable?: string | null;
  onSelectVariable?(variableName: string): void;
}

type UnknownRecord = Record<string, unknown>;
type EquationRow = [string, string] | [string, string, string];
type TickKind = AbmTickKind;

interface AbmInspectContext {
  currentValues: Record<string, number | undefined>;
  parameterNames: Set<string>;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
  documentHighlightedVariable: string | null;
  onSelectVariable?: (variableName: string) => void;
}

interface AbmCellDraft extends UnknownRecord {
  modelId?: unknown;
  populations?: unknown;
  params?: unknown;
  state?: unknown;
  ticks?: unknown;
  record?: unknown;
  check?: unknown;
}

export function AbmSourceEditor({
  value,
  onChange,
  currentValues = {},
  parameterNames: parameterNamesProp,
  variableDescriptions,
  variableUnitMetadata,
  documentHighlightedVariable = null,
  onSelectVariable
}: AbmSourceEditorProps) {
  const parsed = useMemo(() => parseAbmCellSource(value), [value]);
  const draftParameterNames = useMemo(() => {
    if (!parsed) {
      return new Set<string>();
    }
    const names = new Set<string>();
    for (const name of Object.keys(asNumberRecord(parsed.params))) {
      names.add(name);
    }
    for (const population of asRecordArray(parsed.populations)) {
      const popParams = asRecord(population.params);
      if (!popParams) continue;
      for (const name of Object.keys(popParams)) {
        names.add(name);
      }
    }
    return names;
  }, [parsed]);
  const parameterNames = useMemo(() => {
    const names = new Set(parameterNamesProp ?? []);
    for (const name of draftParameterNames) {
      names.add(name);
    }
    return names;
  }, [draftParameterNames, parameterNamesProp]);

  if (!parsed) {
    return (
      <div className="abm-source-editor abm-source-editor-invalid" role="status">
        Visual editor needs valid ABM cell JSON. Switch to JSON to repair the source.
      </div>
    );
  }

  const cell = parsed;
  const populations = asRecordArray(cell.populations);
  const params = asNumberRecord(cell.params);
  const state = asRecord(cell.state);
  const aggregates = asNumberRecord(state?.aggregates);
  const ticks = Array.isArray(cell.ticks) ? cell.ticks : [];
  const record = asRecord(cell.record);
  const check = asRecord(cell.check);
  const populationNames = populations.map((population) => String(population.name ?? "")).filter(Boolean);
  const inspect: AbmInspectContext = {
    currentValues,
    parameterNames,
    variableDescriptions,
    variableUnitMetadata,
    documentHighlightedVariable,
    onSelectVariable
  };

  function commit(next: AbmCellDraft): void {
    onChange(formatCellBody(next, "compact"));
  }

  function updateCell(patch: Partial<AbmCellDraft>): void {
    commit({ ...cell, ...patch });
  }

  function updateOptionalObject(
    field: "params" | "state" | "record" | "check",
    next: UnknownRecord | undefined
  ): void {
    const updated = { ...cell };
    if (next == null || Object.keys(next).length === 0) {
      delete updated[field];
    } else {
      updated[field] = next;
    }
    commit(updated);
  }

  return (
    <div className="abm-source-editor grid-editor-embedded">
      <section className="abm-source-block">
        <h4 className="abm-source-heading">Setup</h4>
        <div className="abm-source-meta-row">
          <label className="abm-source-field">
            <span>Model ID</span>
            <input
              aria-label="ABM model ID"
              className="abm-source-input abm-source-input-mono"
              value={typeof cell.modelId === "string" ? cell.modelId : ""}
              onChange={(event) => updateCell({ modelId: event.target.value })}
            />
          </label>
        </div>
        <KeyValueTable
          title="Global parameters"
          ariaLabel="Global parameters"
          entries={Object.entries(params)}
          inspect={inspect}
          valueLabel="Value"
          onChange={(entries) => updateOptionalObject("params", entriesToNumberRecord(entries))}
        />
        <KeyValueTable
          title="Opening aggregates"
          ariaLabel="Opening aggregates"
          entries={Object.entries(aggregates)}
          inspect={inspect}
          valueLabel="Initial value"
          onChange={(entries) => {
            const nextAggregates = entriesToNumberRecord(entries);
            const nextState = { ...(state ?? {}) };
            if (Object.keys(nextAggregates).length === 0) {
              delete nextState.aggregates;
            } else {
              nextState.aggregates = nextAggregates;
            }
            updateOptionalObject("state", nextState);
          }}
        />
      </section>

      <section className="abm-source-block">
        <h4 className="abm-source-heading">Populations</h4>
        <PopulationTable
          inspect={inspect}
          populations={populations}
          onChange={(next) => updateCell({ populations: next })}
        />
      </section>

      <section className="abm-source-block">
        <h4 className="abm-source-heading">Tick schedule</h4>
        <p className="abm-source-hint">Ticks run from top to bottom during every simulated period.</p>
        <TickTable
          inspect={inspect}
          ticks={ticks}
          populations={populationNames}
          onChange={(next) => updateCell({ ticks: next })}
        />
      </section>

      <section className="abm-source-block">
        <h4 className="abm-source-heading">Outputs and checks</h4>
        <label className="abm-source-toggle">
          <input
            aria-label="Use default ABM recording"
            type="checkbox"
            checked={cell.record == null}
            onChange={(event) => {
              const next = { ...cell };
              if (event.target.checked) {
                delete next.record;
              } else {
                next.record = {};
              }
              commit(next);
            }}
          />
          <span>
            <strong>Record defaults</strong>
            <small>All macros and the first/last agent state for each population.</small>
          </span>
        </label>
        {cell.record != null && !record ? (
          <div className="abm-source-warning" role="status">
            This model uses legacy recording directives. Edit them in JSON, or enable recording defaults to
            replace them.
          </div>
        ) : record ? (
          <RecordEditor
            inspect={inspect}
            record={record}
            onChange={(next) => updateOptionalObject("record", next)}
          />
        ) : null}

        <label className="abm-source-toggle">
          <input
            aria-label="Enable stock-flow check"
            type="checkbox"
            checked={check != null}
            onChange={(event) =>
              event.target.checked
                ? updateOptionalObject("check", { left: "", right: "", tolerance: 1e-8 })
                : updateOptionalObject("check", undefined)
            }
          />
          <span>
            <strong>Stock-flow check</strong>
            <small>Compare two aggregate variables after every period.</small>
          </span>
        </label>
        {check ? (
          <div className="equation-grid-shell abm-source-check-shell">
            <div className="abm-source-grid-header abm-source-check-row" role="row">
              <span>Left</span>
              <span>Right</span>
              <span>Tolerance</span>
            </div>
            <div className="abm-source-grid-row abm-source-check-row" role="row">
              <AbmFormulaField
                ariaLabel="Stock-flow check left variable"
                inspect={inspect}
                placeholder="H_s"
                value={String(check.left ?? "")}
                onChange={(next) => updateOptionalObject("check", { ...check, left: next })}
              />
              <AbmFormulaField
                ariaLabel="Stock-flow check right variable"
                inspect={inspect}
                placeholder="H_h"
                value={String(check.right ?? "")}
                onChange={(next) => updateOptionalObject("check", { ...check, right: next })}
              />
              <input
                aria-label="Stock-flow check tolerance"
                className="abm-source-input abm-source-input-mono"
                value={String(check.tolerance ?? "")}
                onChange={(event) =>
                  updateOptionalObject("check", {
                    ...check,
                    tolerance: numericOrText(event.target.value)
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PopulationTable({
  populations,
  inspect,
  onChange
}: {
  populations: UnknownRecord[];
  inspect: AbmInspectContext;
  onChange(next: UnknownRecord[]): void;
}) {
  return (
    <div className="abm-source-table-stack">
      <div className="equation-grid-shell" role="table" aria-label="Populations">
        <div className="abm-source-grid-header abm-source-population-row" role="row">
          <span>#</span>
          <span>Name</span>
          <span>Size</span>
          <span>State variables</span>
          <span />
        </div>
        <div className="equation-grid-body">
          {populations.map((population, index) => {
            const states = Array.isArray(population.state) ? population.state.map(String) : [];
            const params = asRecord(population.params) ?? {};
            return (
              <div className="abm-source-row-group" key={index}>
                <div className="abm-source-grid-row abm-source-population-row" role="row">
                  <span className="equation-grid-index">{index + 1}</span>
                  <AbmFormulaField
                    ariaLabel={`Population ${index + 1} name`}
                    inspect={inspect}
                    placeholder="households"
                    value={String(population.name ?? "")}
                    onChange={(next) =>
                      onChange(
                        populations.map((row, position) =>
                          position === index ? { ...row, name: next } : row
                        )
                      )
                    }
                  />
                  <input
                    aria-label={`Population ${index + 1} size`}
                    className="abm-source-input"
                    min={1}
                    type="number"
                    value={numberInputValue(population.size)}
                    onChange={(event) =>
                      onChange(
                        populations.map((row, position) =>
                          position === index ? { ...row, size: Number(event.target.value) } : row
                        )
                      )
                    }
                  />
                  <AbmFormulaField
                    ariaLabel={`Population ${index + 1} state variables`}
                    inspect={inspect}
                    placeholder="income, wealth"
                    value={states.join(", ")}
                    onChange={(next) =>
                      onChange(
                        populations.map((row, position) =>
                          position === index ? { ...row, state: parseCommaList(next) } : row
                        )
                      )
                    }
                  />
                  <GridRowControls
                    canMoveDown={index < populations.length - 1}
                    canMoveUp={index > 0}
                    onInsertAfter={() =>
                      onChange(
                        insertAt(populations, index + 1, {
                          name: nextName(populations, "population"),
                          size: 1,
                          state: []
                        })
                      )
                    }
                    onMoveDown={() => onChange(moveItem(populations, index, index + 1))}
                    onMoveUp={() => onChange(moveItem(populations, index, index - 1))}
                    onRemove={() =>
                      onChange(populations.filter((_row, position) => position !== index))
                    }
                    rowIndex={index}
                    rowTypeLabel="population"
                  />
                </div>
                <PopulationParamsTable
                  inspect={inspect}
                  params={params}
                  populationIndex={index}
                  onChange={(next) =>
                    onChange(
                      populations.map((row, position) => {
                        if (position !== index) return row;
                        const updated = { ...row };
                        if (Object.keys(next).length === 0) {
                          delete updated.params;
                        } else {
                          updated.params = next;
                        }
                        return updated;
                      })
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      {populations.length === 0 ? (
        <div className="equation-grid-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onChange([
                ...populations,
                { name: nextName(populations, "population"), size: 1, state: [] }
              ])
            }
          >
            Add population
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PopulationParamsTable({
  params,
  populationIndex,
  inspect,
  onChange
}: {
  params: UnknownRecord;
  populationIndex: number;
  inspect: AbmInspectContext;
  onChange(next: UnknownRecord): void;
}) {
  const entries = Object.entries(params);

  return (
    <div className="abm-source-nested-table">
      <div className="abm-source-nested-caption">Population parameters</div>
      <div className="equation-grid-shell" role="table" aria-label={`Population ${populationIndex + 1} parameters`}>
        <div className="abm-source-grid-header abm-source-param-row" role="row">
          <span>#</span>
          <span>Name</span>
          <span>Type</span>
          <span>Value / lo</span>
          <span>hi</span>
          <span />
        </div>
        <div className="equation-grid-body">
          {entries.map(([name, raw], index) => {
            const param = asRecord(raw) ?? { value: 0 };
            const isUniform = param.draw === "uniform";
            return (
              <div className="abm-source-grid-row abm-source-param-row" role="row" key={`${name}-${index}`}>
                <span className="equation-grid-index">{index + 1}</span>
                <AbmFormulaField
                  ariaLabel={`Population ${populationIndex + 1} parameter ${index + 1} name`}
                  inspect={inspect}
                  placeholder="parameter"
                  value={name}
                  onChange={(next) => onChange(renameRecordKey(params, name, next))}
                />
                <select
                  aria-label={`Population parameter ${name} type`}
                  className="abm-source-input"
                  value={isUniform ? "uniform" : "constant"}
                  onChange={(event) =>
                    onChange({
                      ...params,
                      [name]:
                        event.target.value === "uniform"
                          ? { draw: "uniform", lo: 0, hi: 1 }
                          : { value: 0 }
                    })
                  }
                >
                  <option value="constant">constant</option>
                  <option value="uniform">uniform</option>
                </select>
                {isUniform ? (
                  <input
                    aria-label={`Population parameter ${name} minimum`}
                    className="abm-source-input"
                    type="number"
                    value={numberInputValue(param.lo)}
                    onChange={(event) =>
                      onChange({ ...params, [name]: { ...param, lo: Number(event.target.value) } })
                    }
                  />
                ) : (
                  <input
                    aria-label={`Population parameter ${name} value`}
                    className="abm-source-input"
                    type="number"
                    value={numberInputValue(param.value)}
                    onChange={(event) =>
                      onChange({ ...params, [name]: { ...param, value: Number(event.target.value) } })
                    }
                  />
                )}
                {isUniform ? (
                  <input
                    aria-label={`Population parameter ${name} maximum`}
                    className="abm-source-input"
                    type="number"
                    value={numberInputValue(param.hi)}
                    onChange={(event) =>
                      onChange({ ...params, [name]: { ...param, hi: Number(event.target.value) } })
                    }
                  />
                ) : (
                  <span className="abm-source-empty-cell" />
                )}
                <GridRowControls
                  canMoveDown={false}
                  canMoveUp={false}
                  onInsertAfter={() =>
                    onChange({ ...params, [nextRecordKey(params, "parameter")]: { value: 0 } })
                  }
                  onMoveDown={() => undefined}
                  onMoveUp={() => undefined}
                  onRemove={() => onChange(withoutKey(params, name))}
                  rowIndex={index}
                  rowTypeLabel="population parameter"
                />
              </div>
            );
          })}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="equation-grid-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange({ ...params, [nextRecordKey(params, "parameter")]: { value: 0 } })}
          >
            Add parameter
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TickTable({
  ticks,
  populations,
  inspect,
  onChange
}: {
  ticks: unknown[];
  populations: string[];
  inspect: AbmInspectContext;
  onChange(next: unknown[]): void;
}) {
  return (
    <div className="abm-source-table-stack">
      <div className="equation-grid-shell" role="table" aria-label="Tick schedule">
        <div className="abm-source-grid-header abm-source-tick-row" role="row">
          <span>#</span>
          <span>Operation</span>
          <span>Details</span>
          <span />
        </div>
        <div className="equation-grid-body">
          {ticks.map((tick, index) => {
            const kind = tickKind(tick);
            const tickRecord = asRecord(tick);
            return (
              <div className="abm-source-row-group" key={index}>
                <div className="abm-source-grid-row abm-source-tick-row" role="row">
                  <span className="equation-grid-index">{index + 1}</span>
                  <select
                    aria-label={`Tick ${index + 1} operation`}
                    className="abm-source-input abm-source-tick-operation"
                    value={kind ?? ""}
                    onChange={(event) =>
                      onChange(
                        ticks.map((row, position) =>
                          position === index
                            ? defaultTick(event.target.value as TickKind, populations[0])
                            : row
                        )
                      )
                    }
                  >
                    {kind == null ? <option value="">Unsupported</option> : null}
                    <option value="do">{abmTickKindLabel("do")}</option>
                    <option value="for">{abmTickKindLabel("for")}</option>
                    <option value="hire-lottery">{abmTickKindLabel("hire-lottery")}</option>
                    <option value="shuffle">{abmTickKindLabel("shuffle")}</option>
                    <option value="ration-fcfs">{abmTickKindLabel("ration-fcfs")}</option>
                  </select>
                  <div className="abm-source-tick-summary">
                    {kind === "for" ? (
                      <PopulationInput
                        ariaLabel={`Tick ${index + 1} agent population`}
                        inspect={inspect}
                        populations={populations}
                        value={agentPopulation(asRecord(tickRecord?.for))}
                        onChange={(next) => {
                          const forValue = asRecord(tickRecord?.for) ?? {};
                          const rows = Object.values(forValue)[0] ?? [];
                          onChange(
                            ticks.map((row, position) =>
                              position === index ? { for: { [next]: rows } } : row
                            )
                          );
                        }}
                      />
                    ) : kind === "shuffle" ? (
                      <PopulationInput
                        ariaLabel={`Tick ${index + 1} shuffle population`}
                        inspect={inspect}
                        populations={populations}
                        value={shufflePopulation(tickRecord?.shuffle)}
                        onChange={(next) =>
                          onChange(
                            ticks.map((row, position) =>
                              position === index ? { shuffle: next } : row
                            )
                          )
                        }
                      />
                    ) : kind === "hire-lottery" || kind === "ration-fcfs" ? (
                      <span className="abm-source-muted abm-source-tick-operation-label">
                        {abmTickKindLabel(kind)}
                      </span>
                    ) : kind === "do" ? (
                      <span className="abm-source-muted abm-source-tick-operation-label">
                        {abmTickKindLabel("do")}
                      </span>
                    ) : (
                      <span className="abm-source-muted">Unsupported</span>
                    )}
                  </div>
                  <GridRowControls
                    canMoveDown={index < ticks.length - 1}
                    canMoveUp={index > 0}
                    onInsertAfter={() => onChange(insertAt(ticks, index + 1, defaultTick("do")))}
                    onMoveDown={() => onChange(moveItem(ticks, index, index + 1))}
                    onMoveUp={() => onChange(moveItem(ticks, index, index - 1))}
                    onRemove={() => onChange(ticks.filter((_row, position) => position !== index))}
                    rowIndex={index}
                    rowTypeLabel="tick"
                  />
                </div>
                <div className="abm-source-tick-detail">
                  {kind === "do" ? (
                    <EquationRowsTable
                      inspect={inspect}
                      rows={equationRows(tickRecord?.do)}
                      label={`Tick ${index + 1} Do`}
                      onChange={(rows) =>
                        onChange(ticks.map((row, position) => (position === index ? { do: rows } : row)))
                      }
                    />
                  ) : kind === "for" ? (
                    <EquationRowsTable
                      inspect={inspect}
                      rows={equationRows(Object.values(asRecord(tickRecord?.for) ?? {})[0])}
                      label={`Tick ${index + 1} For`}
                      onChange={(rows) => {
                        const population =
                          agentPopulation(asRecord(tickRecord?.for)) || populations[0] || "population";
                        onChange(
                          ticks.map((row, position) =>
                            position === index ? { for: { [population]: rows } } : row
                          )
                        );
                      }}
                    />
                  ) : kind === "hire-lottery" ? (
                    <SpecialTickFields
                      inspect={inspect}
                      kind={kind}
                      value={asRecord(tickRecord?.[kind]) ?? {}}
                      fields={["demand", "spread", "cap", "into"]}
                      onChange={(next) =>
                        onChange(
                          ticks.map((row, position) =>
                            position === index ? { [kind]: next } : row
                          )
                        )
                      }
                    />
                  ) : kind === "ration-fcfs" ? (
                    <SpecialTickFields
                      inspect={inspect}
                      kind={kind}
                      value={asRecord(tickRecord?.[kind]) ?? {}}
                      fields={["population", "demand", "supply", "into"]}
                      populations={populations}
                      onChange={(next) =>
                        onChange(
                          ticks.map((row, position) =>
                            position === index ? { [kind]: next } : row
                          )
                        )
                      }
                    />
                  ) : kind == null ? (
                    <div className="abm-source-warning" role="status">
                      This tick shape is not supported by the Visual editor. Select an operation to replace it,
                      or edit it in JSON.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {ticks.length === 0 ? (
        <div className="equation-grid-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange([...ticks, defaultTick("do")])}
          >
            Add tick
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EquationRowsTable({
  rows,
  label,
  inspect,
  onChange
}: {
  rows: EquationRow[];
  label: string;
  inspect: AbmInspectContext;
  onChange(next: EquationRow[]): void;
}) {
  const columnResize = useEquationGridColumnResize({
    isEmbedded: true,
    // Description + row controls only — equation-grid trailing reserve includes Role/Units/Status.
    trailingReservedWidthPx: 56,
    maxExpressionWidthPx: 1400,
    syncGroup: "abm-equations"
  });

  return (
    <div className="abm-source-nested-table">
      <div
        ref={columnResize.shellRef}
        className={`equation-grid-shell${columnResize.shellClassName ? ` ${columnResize.shellClassName}` : ""}`.trim()}
        role="table"
        aria-label={label}
      >
        <div className="abm-source-grid-header abm-source-equation-row" role="row">
          <span>#</span>
          <span ref={columnResize.variableHeaderRef}>Target</span>
          <span ref={columnResize.expressionHeaderRef}>Expression</span>
          <span>Description</span>
          <span />
          <div {...columnResize.variableResizeHandleProps} />
          <div {...columnResize.expressionResizeHandleProps} />
        </div>
        <div className="equation-grid-body">
          {rows.map((row, index) => (
            <div className="abm-source-grid-row abm-source-equation-row" role="row" key={index}>
              <span className="equation-grid-index">{index + 1}</span>
              <AbmFormulaField
                ariaLabel={`${label} equation ${index + 1} target`}
                inspect={inspect}
                placeholder="Y"
                value={row[0]}
                onChange={(next) => onChange(replaceEquationPart(rows, index, 0, next))}
              />
              <AbmFormulaField
                ariaLabel={`${label} equation ${index + 1} expression`}
                inspect={inspect}
                placeholder="Cs + Gs"
                value={row[1]}
                onChange={(next) => onChange(replaceEquationPart(rows, index, 1, next))}
              />
              <input
                aria-label={`${label} equation ${index + 1} description`}
                className="abm-source-input"
                value={row[2] ?? ""}
                onChange={(event) => onChange(replaceEquationDescription(rows, index, event.target.value))}
              />
              <GridRowControls
                canMoveDown={index < rows.length - 1}
                canMoveUp={index > 0}
                onInsertAfter={() => onChange(insertAt(rows, index + 1, ["variable", "0"]))}
                onMoveDown={() => onChange(moveItem(rows, index, index + 1))}
                onMoveUp={() => onChange(moveItem(rows, index, index - 1))}
                onRemove={() => onChange(rows.filter((_row, position) => position !== index))}
                rowIndex={index}
                rowTypeLabel={`${label} equation`}
              />
            </div>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="equation-grid-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange([...rows, ["variable", "0"]])}
          >
            Add equation
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SpecialTickFields({
  kind,
  value,
  fields,
  inspect,
  populations = [],
  onChange
}: {
  kind: TickKind;
  value: UnknownRecord;
  fields: string[];
  inspect: AbmInspectContext;
  populations?: string[];
  onChange(next: UnknownRecord): void;
}) {
  return (
    <div className="equation-grid-shell abm-source-special-shell">
      <div
        className="abm-source-grid-header abm-source-special-row"
        role="row"
        style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}
      >
        {fields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      <div
        className="abm-source-grid-row abm-source-special-row"
        role="row"
        style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}
      >
        {fields.map((field) =>
          field === "population" ? (
            <PopulationInput
              key={field}
              ariaLabel={`${kind} ${field}`}
              inspect={inspect}
              populations={populations}
              value={String(value[field] ?? "")}
              onChange={(next) => onChange({ ...value, [field]: next })}
            />
          ) : (
            <AbmFormulaField
              key={field}
              ariaLabel={`${kind} ${field}`}
              inspect={inspect}
              placeholder={field}
              value={String(value[field] ?? "")}
              onChange={(next) =>
                onChange({
                  ...value,
                  [field]: field === "cap" ? numericOrText(next) : next
                })
              }
            />
          )
        )}
      </div>
    </div>
  );
}

function AbmFormulaField({
  ariaLabel,
  inspect,
  placeholder,
  value,
  onChange
}: {
  ariaLabel: string;
  inspect: AbmInspectContext;
  placeholder: string;
  value: string;
  onChange(next: string): void;
}) {
  return (
    <HighlightedFormulaInput
      ariaLabel={ariaLabel}
      className="abm-source-formula-input"
      currentValues={inspect.currentValues}
      documentHighlightedVariable={inspect.documentHighlightedVariable}
      inputRef={() => undefined}
      onChange={onChange}
      onEnter={() => undefined}
      onSelectVariable={inspect.onSelectVariable}
      parameterNames={inspect.parameterNames}
      placeholder={placeholder}
      value={value}
      variableDescriptions={inspect.variableDescriptions}
      variableUnitMetadata={inspect.variableUnitMetadata}
    />
  );
}

function RecordEditor({
  record,
  inspect,
  onChange
}: {
  record: UnknownRecord;
  inspect: AbmInspectContext;
  onChange(next: UnknownRecord): void;
}) {
  const micro = asRecordArray(record.micro);
  const descriptions = asStringRecord(record.descriptions);

  function setField(field: string, value: unknown): void {
    const next = { ...record };
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      delete next[field];
    } else {
      next[field] = value;
    }
    onChange(next);
  }

  return (
    <div className="abm-source-table-stack">
      <div className="abm-source-meta-row">
        <label className="abm-source-field">
          <span>Default Monte Carlo runs</span>
          <input
            aria-label="Default Monte Carlo runs"
            className="abm-source-input"
            min={1}
            type="number"
            value={numberInputValue(record.monteCarlo)}
            onChange={(event) =>
              setField("monteCarlo", event.target.value === "" ? undefined : Number(event.target.value))
            }
            placeholder="Set on run cell"
          />
        </label>
      </div>
      <StringListTable
        title="Macro series (empty means all)"
        values={stringArray(record.series)}
        itemLabel="Recorded macro series"
        inspect={inspect}
        onChange={(next) => setField("series", next)}
      />
      <StringListTable
        title="Monte Carlo bands"
        values={stringArray(record.bands)}
        itemLabel="Monte Carlo band series"
        inspect={inspect}
        onChange={(next) => setField("bands", next)}
      />
      <div className="abm-source-nested-table">
        <div className="abm-source-nested-caption">Micro probes</div>
        <div className="equation-grid-shell" role="table" aria-label="Micro probes">
          <div className="abm-source-grid-header abm-source-micro-row" role="row">
            <span>#</span>
            <span>Population</span>
            <span>Agents</span>
            <span>Variables</span>
            <span>Max agents</span>
            <span />
          </div>
          <div className="equation-grid-body">
            {micro.map((probe, index) => (
              <div className="abm-source-grid-row abm-source-micro-row" role="row" key={index}>
                <span className="equation-grid-index">{index + 1}</span>
                <AbmFormulaField
                  ariaLabel={`Micro probe ${index + 1} population`}
                  inspect={inspect}
                  placeholder="households"
                  value={String(probe.population ?? "")}
                  onChange={(next) =>
                    setField(
                      "micro",
                      micro.map((row, position) =>
                        position === index ? { ...row, population: next } : row
                      )
                    )
                  }
                />
                <input
                  aria-label={`Micro probe ${index + 1} agents`}
                  className="abm-source-input abm-source-input-mono"
                  value={formatAgents(probe.agents)}
                  onChange={(event) =>
                    setField(
                      "micro",
                      micro.map((row, position) =>
                        position === index ? { ...row, agents: parseAgents(event.target.value) } : row
                      )
                    )
                  }
                  placeholder="first, last"
                />
                <AbmFormulaField
                  ariaLabel={`Micro probe ${index + 1} variables`}
                  inspect={inspect}
                  placeholder="income, wealth"
                  value={stringArray(probe.variables).join(", ")}
                  onChange={(next) =>
                    setField(
                      "micro",
                      micro.map((row, position) =>
                        position === index ? { ...row, variables: parseCommaList(next) } : row
                      )
                    )
                  }
                />
                <input
                  aria-label={`Micro probe ${index + 1} maximum agents`}
                  className="abm-source-input"
                  type="number"
                  value={numberInputValue(probe.maxAgents)}
                  onChange={(event) =>
                    setField(
                      "micro",
                      micro.map((row, position) =>
                        position === index
                          ? {
                              ...row,
                              maxAgents: event.target.value === "" ? undefined : Number(event.target.value)
                            }
                          : row
                      )
                    )
                  }
                />
                <GridRowControls
                  canMoveDown={index < micro.length - 1}
                  canMoveUp={index > 0}
                  onInsertAfter={() =>
                    setField(
                      "micro",
                      insertAt(micro, index + 1, {
                        population: "",
                        agents: ["first", "last"],
                        variables: []
                      })
                    )
                  }
                  onMoveDown={() => setField("micro", moveItem(micro, index, index + 1))}
                  onMoveUp={() => setField("micro", moveItem(micro, index, index - 1))}
                  onRemove={() =>
                    setField(
                      "micro",
                      micro.filter((_row, position) => position !== index)
                    )
                  }
                  rowIndex={index}
                  rowTypeLabel="micro probe"
                />
              </div>
            ))}
          </div>
        </div>
        {micro.length === 0 ? (
          <div className="equation-grid-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setField("micro", [
                  ...micro,
                  { population: "", agents: ["first", "last"], variables: [] }
                ])
              }
            >
              Add micro probe
            </button>
          </div>
        ) : null}
      </div>
      <KeyValueTable
        title="Variable descriptions"
        ariaLabel="Variable descriptions"
        entries={Object.entries(descriptions)}
        inspect={inspect}
        valueLabel="Description"
        numeric={false}
        onChange={(entries) => setField("descriptions", entriesToStringRecord(entries))}
      />
    </div>
  );
}

function KeyValueTable({
  title,
  ariaLabel,
  entries,
  valueLabel,
  numeric = true,
  inspect,
  onChange
}: {
  title: string;
  ariaLabel: string;
  entries: Array<[string, number | string]>;
  valueLabel: string;
  numeric?: boolean;
  inspect?: AbmInspectContext;
  onChange(next: Array<[string, string]>): void;
}) {
  return (
    <div className="abm-source-nested-table">
      <div className="abm-source-nested-caption">{title}</div>
      <div className="equation-grid-shell" role="table" aria-label={ariaLabel}>
        <div className="abm-source-grid-header abm-source-key-value-row" role="row">
          <span>#</span>
          <span>Name</span>
          <span>{valueLabel}</span>
          <span />
        </div>
        <div className="equation-grid-body">
          {entries.map(([name, value], index) => (
            <div className="abm-source-grid-row abm-source-key-value-row" role="row" key={`${name}-${index}`}>
              <span className="equation-grid-index">{index + 1}</span>
              {inspect ? (
                <AbmFormulaField
                  ariaLabel={`${title} ${index + 1} name`}
                  inspect={inspect}
                  placeholder="name"
                  value={name}
                  onChange={(next) =>
                    onChange(
                      entries.map((entry, position) =>
                        position === index
                          ? [next, String(entry[1])]
                          : [entry[0], String(entry[1])]
                      )
                    )
                  }
                />
              ) : (
                <input
                  aria-label={`${title} ${index + 1} name`}
                  className="abm-source-input abm-source-input-mono"
                  value={name}
                  onChange={(event) =>
                    onChange(
                      entries.map((entry, position) =>
                        position === index
                          ? [event.target.value, String(entry[1])]
                          : [entry[0], String(entry[1])]
                      )
                    )
                  }
                />
              )}
              <input
                aria-label={`${title} ${name || index + 1} ${valueLabel}`}
                className="abm-source-input"
                type={numeric ? "number" : "text"}
                value={String(value)}
                onChange={(event) =>
                  onChange(
                    entries.map((entry, position) =>
                      position === index ? [entry[0], event.target.value] : [entry[0], String(entry[1])]
                    )
                  )
                }
              />
              <GridRowControls
                canMoveDown={index < entries.length - 1}
                canMoveUp={index > 0}
                onInsertAfter={() =>
                  onChange(
                    insertAt(
                      entries.map(([entryName, entryValue]) => [entryName, String(entryValue)] as [string, string]),
                      index + 1,
                      [nextEntryName(entries, "variable"), numeric ? "0" : ""]
                    )
                  )
                }
                onMoveDown={() =>
                  onChange(
                    moveItem(
                      entries.map(([entryName, entryValue]) => [entryName, String(entryValue)] as [string, string]),
                      index,
                      index + 1
                    )
                  )
                }
                onMoveUp={() =>
                  onChange(
                    moveItem(
                      entries.map(([entryName, entryValue]) => [entryName, String(entryValue)] as [string, string]),
                      index,
                      index - 1
                    )
                  )
                }
                onRemove={() =>
                  onChange(
                    entries
                      .filter((_entry, position) => position !== index)
                      .map(([entryName, entryValue]) => [entryName, String(entryValue)])
                  )
                }
                rowIndex={index}
                rowTypeLabel={title.toLowerCase()}
              />
            </div>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="equation-grid-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onChange([
                ...entries.map(([name, value]) => [name, String(value)] as [string, string]),
                [nextEntryName(entries, "variable"), numeric ? "0" : ""]
              ])
            }
          >
            Add row
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StringListTable({
  title,
  values,
  itemLabel,
  inspect,
  onChange
}: {
  title: string;
  values: string[];
  itemLabel: string;
  inspect?: AbmInspectContext;
  onChange(next: string[]): void;
}) {
  return (
    <div className="abm-source-nested-table">
      <div className="abm-source-nested-caption">{title}</div>
      <div className="equation-grid-shell" role="table" aria-label={title}>
        <div className="abm-source-grid-header abm-source-list-row" role="row">
          <span>#</span>
          <span>Name</span>
          <span />
        </div>
        <div className="equation-grid-body">
          {values.map((value, index) => (
            <div className="abm-source-grid-row abm-source-list-row" role="row" key={index}>
              <span className="equation-grid-index">{index + 1}</span>
              {inspect ? (
                <AbmFormulaField
                  ariaLabel={`${itemLabel} ${index + 1}`}
                  inspect={inspect}
                  placeholder="variable"
                  value={value}
                  onChange={(next) =>
                    onChange(values.map((entry, position) => (position === index ? next : entry)))
                  }
                />
              ) : (
                <input
                  aria-label={`${itemLabel} ${index + 1}`}
                  className="abm-source-input abm-source-input-mono"
                  value={value}
                  onChange={(event) =>
                    onChange(values.map((entry, position) => (position === index ? event.target.value : entry)))
                  }
                />
              )}
              <GridRowControls
                canMoveDown={index < values.length - 1}
                canMoveUp={index > 0}
                onInsertAfter={() => onChange(insertAt(values, index + 1, "variable"))}
                onMoveDown={() => onChange(moveItem(values, index, index + 1))}
                onMoveUp={() => onChange(moveItem(values, index, index - 1))}
                onRemove={() => onChange(values.filter((_entry, position) => position !== index))}
                rowIndex={index}
                rowTypeLabel={itemLabel.toLowerCase()}
              />
            </div>
          ))}
        </div>
      </div>
      {values.length === 0 ? (
        <div className="equation-grid-footer">
          <button type="button" className="secondary-button" onClick={() => onChange([...values, "variable"])}>
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PopulationInput({
  ariaLabel,
  inspect,
  populations,
  value,
  onChange
}: {
  ariaLabel: string;
  inspect: AbmInspectContext;
  populations: string[];
  value: string;
  onChange(next: string): void;
}) {
  const listId = useId();
  return (
    <label className="highlighted-formula-input abm-source-formula-input abm-source-population-input">
      <div
        aria-hidden="true"
        className={`highlighted-formula-preview${value ? "" : " is-placeholder"}`}
      >
        {value
          ? highlightFormula(
              value,
              inspect.parameterNames,
              undefined,
              inspect.variableDescriptions,
              inspect.variableUnitMetadata,
              inspect.onSelectVariable,
              undefined,
              inspect.currentValues,
              inspect.documentHighlightedVariable
            )
          : "population"}
      </div>
      <input
        aria-label={ariaLabel}
        className="highlighted-formula-control"
        list={listId}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {populations.map((population) => (
          <option value={population} key={population} />
        ))}
      </datalist>
    </label>
  );
}

function parseAbmCellSource(value: string): AbmCellDraft | null {
  try {
    const parsed = parseLenientJsonValue(value);
    const record = asRecord(parsed);
    if (!record || record.type !== "abm-model") {
      return null;
    }
    return record as AbmCellDraft;
  } catch {
    return null;
  }
}

function tickKind(tick: unknown): TickKind | null {
  const record = asRecord(tick);
  if (!record) return null;
  for (const kind of ["do", "for", "hire-lottery", "shuffle", "ration-fcfs"] as const) {
    if (kind in record) return kind;
  }
  return null;
}

function defaultTick(kind: TickKind, population = "population"): unknown {
  switch (kind) {
    case "do":
      return { do: [["variable", "0"]] };
    case "for":
      return { for: { [population]: [["state", "0"]] } };
    case "hire-lottery":
      return { "hire-lottery": { demand: "demand", spread: "spread", cap: population, into: "hired" } };
    case "shuffle":
      return { shuffle: population };
    case "ration-fcfs":
      return {
        "ration-fcfs": { population, demand: "demand", supply: "supply", into: "served" }
      };
  }
}

function equationRows(value: unknown): EquationRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const first = String(row[0] ?? "");
    const second = String(row[1] ?? "");
    const description = row[2] == null ? "" : String(row[2]);
    return [description ? [first, second, description] : [first, second]] as EquationRow[];
  });
}

function replaceEquationPart(
  rows: EquationRow[],
  rowIndex: number,
  partIndex: 0 | 1,
  value: string
): EquationRow[] {
  return rows.map((row, index) => {
    if (index !== rowIndex) return row;
    const next: EquationRow = row[2] == null ? [row[0], row[1]] : [row[0], row[1], row[2]];
    next[partIndex] = value;
    return next;
  });
}

function replaceEquationDescription(rows: EquationRow[], rowIndex: number, value: string): EquationRow[] {
  return rows.map((row, index) =>
    index === rowIndex ? (value ? [row[0], row[1], value] : [row[0], row[1]]) : row
  );
}

function shufflePopulation(value: unknown): string {
  if (typeof value === "string") return value;
  return String(asRecord(value)?.population ?? "");
}

function agentPopulation(value: UnknownRecord | null): string {
  if (!value) return "";
  return Object.keys(value)[0] ?? "";
}

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is UnknownRecord => row != null) : [];
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function entriesToNumberRecord(entries: Array<[string, string]>): Record<string, number> {
  return Object.fromEntries(
    entries.filter(([name]) => name.trim()).map(([name, value]) => [name, Number(value)])
  );
}

function entriesToStringRecord(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries.filter(([name]) => name.trim()));
}

function renameRecordKey(record: UnknownRecord, oldName: string, nextName: string): UnknownRecord {
  const entries = Object.entries(record).map(([name, value]) => [name === oldName ? nextName : name, value]);
  return Object.fromEntries(entries);
}

function withoutKey(record: UnknownRecord, name: string): UnknownRecord {
  const next = { ...record };
  delete next[name];
  return next;
}

function nextRecordKey(record: UnknownRecord, prefix: string): string {
  let index = Object.keys(record).length + 1;
  while (`${prefix}${index}` in record) index += 1;
  return `${prefix}${index}`;
}

function nextEntryName(entries: Array<[string, unknown]>, prefix: string): string {
  return nextRecordKey(Object.fromEntries(entries), prefix);
}

function nextName(rows: UnknownRecord[], prefix: string): string {
  const names = new Set(rows.map((row) => String(row.name ?? "")));
  let index = rows.length + 1;
  while (names.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function insertAt<T>(items: T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index)];
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function numberInputValue(value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function numericOrText(value: string): number | string {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseAgents(value: string): Array<string | number> | "all" {
  if (value.trim() === "all") return "all";
  return parseCommaList(value).map((entry) => {
    const numeric = Number(entry);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : entry;
  });
}

function formatAgents(value: unknown): string {
  return value === "all" ? "all" : Array.isArray(value) ? value.map(String).join(", ") : "";
}
