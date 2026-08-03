import { abmMicroSeriesName, expandAbmMicroAgents, normalizeAbmSpec } from "@sfcr/core";
import { abmSpecFromCell } from "@sfcr/notebook-core";

import { highlightFormula } from "../../components/EquationGridEditor";
import { VariableLabel } from "../../components/VariableLabel";
import { classifyVariableToken } from "../../lib/formulaTokenClass";
import { documentHighlightClassName } from "../../lib/variableHighlight";
import type { VariableDescriptions } from "../../lib/variableDescriptions";
import type { VariableInspectRequest } from "../../lib/variableInspect";
import type { VariableUnitMetadata } from "../../lib/unitMeta";
import type { AbmModelCell } from "../types";
import { formatNotebookCurrentValue } from "./NotebookCurrentValue";

type EquationRow = [string, string] | [string, string, string];

function asEquationRows(value: unknown): EquationRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) {
      return [];
    }
    const name = String(row[0]);
    const expression = String(row[1]);
    const description =
      row.length >= 3 && row[2] != null && String(row[2]).trim() !== "" ? String(row[2]) : undefined;
    return [description != null ? ([name, expression, description] as EquationRow) : ([name, expression] as EquationRow)];
  });
}

function tickEquations(tick: Record<string, unknown>): EquationRow[] {
  if (typeof tick.kind === "string") {
    if (tick.kind === "agent" || tick.kind === "aggregate") {
      return asEquationRows(tick.equations);
    }
    return [];
  }
  if ("do" in tick) {
    return asEquationRows(tick.do);
  }
  if ("for" in tick) {
    const body = tick.for;
    if (body != null && typeof body === "object" && !Array.isArray(body)) {
      const [, equations] = Object.entries(body as Record<string, unknown>)[0] ?? [];
      return asEquationRows(equations);
    }
  }
  return [];
}

function formatTickLabel(tick: unknown): string {
  if (tick == null || typeof tick !== "object") {
    return "(invalid tick)";
  }
  const record = tick as Record<string, unknown>;
  if (typeof record.kind === "string") {
    switch (record.kind) {
      case "agent":
        return `for ${String(record.population)}`;
      case "aggregate":
        return "do";
      case "hire-lottery":
        return `hire-lottery → ${String(record.into)}`;
      case "shuffle":
        return `shuffle ${String(record.population)}`;
      case "ration-fcfs":
        return `ration-fcfs ${String(record.population)}.${String(record.into)}`;
      default:
        return String(record.kind);
    }
  }
  if ("for" in record) {
    const body = record.for;
    if (body != null && typeof body === "object" && !Array.isArray(body)) {
      const [population] = Object.entries(body as Record<string, unknown>)[0] ?? [];
      return `for ${String(population)}`;
    }
    return "for ?";
  }
  if ("do" in record) {
    return "do";
  }
  if ("hire-lottery" in record) {
    const body = record["hire-lottery"] as { into?: unknown };
    return `hire-lottery → ${String(body?.into ?? "?")}`;
  }
  if ("shuffle" in record) {
    const body = record.shuffle;
    const pop = typeof body === "string" ? body : (body as { population?: unknown })?.population;
    return `shuffle ${String(pop ?? "?")}`;
  }
  if ("ration-fcfs" in record) {
    const body = record["ration-fcfs"] as { population?: unknown; into?: unknown };
    return `ration-fcfs ${String(body?.population)}.${String(body?.into)}`;
  }
  return "(unknown tick)";
}

function formatAgents(agents: unknown): string {
  if (agents === "all") {
    return "all";
  }
  if (Array.isArray(agents)) {
    return agents.map(String).join(", ");
  }
  return "—";
}

function formatAbmParamValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return String(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.draw === "uniform") {
      return `uniform(${String(record.lo)}, ${String(record.hi)})`;
    }
    if ("value" in record) {
      return String(record.value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function populationParamEntries(pop: unknown): Array<[string, unknown]> {
  if (pop == null || typeof pop !== "object" || Array.isArray(pop)) {
    return [];
  }
  const params = (pop as { params?: unknown }).params;
  if (params == null || typeof params !== "object" || Array.isArray(params)) {
    return [];
  }
  return Object.entries(params as Record<string, unknown>);
}

function descriptionsFromTicks(ticks: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tick of ticks) {
    if (tick == null || typeof tick !== "object") {
      continue;
    }
    for (const row of tickEquations(tick as Record<string, unknown>)) {
      const [name, , description] = row;
      if (description && !out[name]) {
        out[name] = description;
      }
    }
  }
  return out;
}

function CurrentValueCell({
  currentValues,
  name,
  variableDescriptions,
  variableUnitMetadata
}: {
  currentValues: Record<string, number | undefined>;
  name: string;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
}) {
  const value = currentValues[name.trim()];
  return (
    <span className="notebook-abm-model-series-value">
      {formatNotebookCurrentValue(
        name,
        value,
        variableDescriptions,
        variableUnitMetadata,
        false,
        2,
        true
      )}
    </span>
  );
}

function SeriesRow({
  currentValues,
  description,
  name,
  nameProps,
  variableDescriptions,
  variableUnitMetadata
}: {
  currentValues: Record<string, number | undefined>;
  description?: string;
  name: string;
  nameProps: {
    currentValues?: Record<string, number | undefined>;
    highlightedVariable?: string | null;
    onInspect?: (variableName: string) => void;
    parameterNames: Set<string>;
    variableDescriptions: VariableDescriptions;
    variableUnitMetadata: VariableUnitMetadata;
  };
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
}) {
  return (
    <li className="notebook-abm-model-series-row">
      <span className="notebook-abm-model-series-name">
        <InspectableName {...nameProps} name={name} />
      </span>
      <CurrentValueCell
        currentValues={currentValues}
        name={name}
        variableDescriptions={variableDescriptions}
        variableUnitMetadata={variableUnitMetadata}
      />
      <span className="notebook-abm-model-series-desc">{description ?? ""}</span>
    </li>
  );
}

function InspectableName({
  currentValues,
  highlightedVariable,
  name,
  onInspect,
  parameterNames,
  variableDescriptions,
  variableUnitMetadata
}: {
  currentValues?: Record<string, number | undefined>;
  highlightedVariable?: string | null;
  name: string;
  onInspect?: (variableName: string) => void;
  parameterNames: Set<string>;
  variableDescriptions: VariableDescriptions;
  variableUnitMetadata: VariableUnitMetadata;
}) {
  const tokenClass = classifyVariableToken(name.trim(), parameterNames);
  const label = (
    <VariableLabel
      className={`formula-token ${tokenClass}`}
      currentValues={currentValues}
      name={name}
      variableDescriptions={variableDescriptions}
      variableUnitMetadata={variableUnitMetadata}
    />
  );

  if (!onInspect) {
    return label;
  }

  return (
    <button
      type="button"
      className={documentHighlightClassName(name, highlightedVariable, "result-variable-button")}
      onClick={() => onInspect(name)}
    >
      {label}
    </button>
  );
}

export function AbmModelCellView({
  cell,
  currentValues = {},
  highlightedVariable = null,
  onVariableInspectRequest,
  variableDescriptions,
  variableUnitMetadata
}: {
  cell: AbmModelCell;
  currentValues?: Record<string, number | undefined>;
  highlightedVariable?: string | null;
  onVariableInspectRequest?: (
    args: Pick<VariableInspectRequest, "selectedVariable"> & Partial<VariableInspectRequest>
  ) => void;
  variableDescriptions?: VariableDescriptions;
  variableUnitMetadata?: VariableUnitMetadata;
}) {
  const populations = Array.isArray(cell.populations) ? cell.populations : [];
  const params =
    cell.params && typeof cell.params === "object" ? (cell.params as Record<string, unknown>) : {};
  const openingAggregates = (() => {
    const state = cell.state;
    if (state == null || typeof state !== "object" || Array.isArray(state)) {
      return {} as Record<string, number>;
    }
    const aggregates = (state as { aggregates?: unknown }).aggregates;
    if (aggregates == null || typeof aggregates !== "object" || Array.isArray(aggregates)) {
      return {} as Record<string, number>;
    }
    const out: Record<string, number> = {};
    for (const [name, value] of Object.entries(aggregates as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[name] = value;
      }
    }
    return out;
  })();
  const ticks = Array.isArray(cell.ticks) ? cell.ticks : [];
  const normalizedRecord = (() => {
    try {
      return normalizeAbmSpec(abmSpecFromCell(cell)).record;
    } catch {
      return null;
    }
  })();
  const series = (normalizedRecord?.series ?? []).map(String);
  const bands = (normalizedRecord?.bands ?? []).map(String);
  const monteCarlo = normalizedRecord?.monteCarlo;
  const recordDescriptions = normalizedRecord?.descriptions ?? {};
  const mergedDescriptions: VariableDescriptions = new Map(variableDescriptions ?? []);
  for (const [name, description] of Object.entries(descriptionsFromTicks(ticks))) {
    if (description.trim() && !mergedDescriptions.has(name)) {
      mergedDescriptions.set(name, description.trim());
    }
  }
  for (const [name, description] of Object.entries(recordDescriptions)) {
    if (typeof description === "string" && description.trim() && !mergedDescriptions.has(name)) {
      mergedDescriptions.set(name, description.trim());
    }
  }
  const micro = normalizedRecord?.micro ?? [];
  for (const entry of micro) {
    const variables = Array.isArray(entry.variables) ? entry.variables.map(String) : [];
    const pop = populations.find(
      (row) =>
        row != null &&
        typeof row === "object" &&
        String((row as { name?: unknown }).name) === String(entry.population)
    ) as { size?: unknown } | undefined;
    const size = typeof pop?.size === "number" ? pop.size : 0;
    if (size < 1) {
      continue;
    }
    try {
      for (const { agent } of expandAbmMicroAgents(entry, size)) {
        for (const variable of variables) {
          const seriesName = abmMicroSeriesName(variable, agent);
          const baseDesc = mergedDescriptions.get(variable);
          if (baseDesc && !mergedDescriptions.has(seriesName)) {
            mergedDescriptions.set(seriesName, baseDesc);
          }
        }
      }
    } catch {
      // Invalid micro agent refs — skip description expansion.
    }
  }
  const check =
    cell.check && typeof cell.check === "object"
      ? (cell.check as { left?: unknown; right?: unknown; tolerance?: unknown })
      : null;

  const units = variableUnitMetadata ?? new Map();
  const parameterNames = new Set(Object.keys(params));
  for (const pop of populations) {
    for (const [name] of populationParamEntries(pop)) {
      parameterNames.add(name);
    }
  }

  const handleInspect = onVariableInspectRequest
    ? (selectedVariable: string) => onVariableInspectRequest({ selectedVariable })
    : undefined;

  const nameProps = {
    currentValues,
    highlightedVariable,
    onInspect: handleInspect,
    parameterNames,
    variableDescriptions: mergedDescriptions,
    variableUnitMetadata: units
  };

  return (
    <div className="notebook-abm-model-view">
      <p className="notebook-abm-model-meta">
        Model id <code>{cell.modelId}</code>
      </p>
      <p className="notebook-abm-model-convention">
        Convention (Leeds ABM_SIM.R): <strong>upper-case = MACRO</strong> totals (MC means);
        <strong> lower-case / <code>*_h*</code> = MICRO</strong> (first and last household, MC
        run 1). Hover a name for its description; click to inspect.
      </p>

      <section className="notebook-abm-model-section">
        <h4>Populations</h4>
        <ul className="notebook-abm-model-populations">
          {populations.map((pop, index) => {
            const entry = pop as {
              name?: unknown;
              size?: unknown;
              state?: unknown;
              params?: unknown;
            };
            const stateNames = Array.isArray(entry.state) ? entry.state.map(String) : [];
            const popParams = populationParamEntries(pop);
            return (
              <li key={`${String(entry.name)}-${index}`}>
                <div>
                  <code>{String(entry.name)}</code> × {String(entry.size)}
                </div>
                {stateNames.length > 0 ? (
                  <div className="notebook-abm-model-population-row">
                    state:{" "}
                    {stateNames.map((name, stateIndex) => (
                      <span key={name}>
                        {stateIndex > 0 ? ", " : null}
                        <InspectableName {...nameProps} name={name} />
                      </span>
                    ))}
                  </div>
                ) : null}
                {popParams.length > 0 ? (
                  <ul className="notebook-abm-model-params">
                    {popParams.map(([name, value]) => {
                      const desc = mergedDescriptions.get(name);
                      return (
                        <li key={name}>
                          <InspectableName {...nameProps} name={name} /> ={" "}
                          {formatAbmParamValue(value)}
                          {desc ? <> — {desc}</> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {Object.keys(params).length > 0 ? (
        <section className="notebook-abm-model-section">
          <h4>Params</h4>
          <ul className="notebook-abm-model-params">
            {Object.entries(params).map(([name, value]) => {
              const desc = mergedDescriptions.get(name);
              return (
                <li key={name}>
                  <InspectableName {...nameProps} name={name} /> = {String(value)}
                  {desc ? <> — {desc}</> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {Object.keys(openingAggregates).length > 0 ? (
        <section className="notebook-abm-model-section">
          <h4>Opening aggregates</h4>
          <p className="notebook-abm-model-hint">
            Declared stocks start each Monte Carlo run at these values. Bare reads before a
            same-period assignment use the carried value; <code>lag(name)</code> always uses
            the period-opening snapshot.
          </p>
          <ul className="notebook-abm-model-params">
            {Object.entries(openingAggregates).map(([name, value]) => {
              const desc = mergedDescriptions.get(name);
              return (
                <li key={name}>
                  <InspectableName {...nameProps} name={name} /> = {String(value)}
                  {desc ? <> — {desc}</> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="notebook-abm-model-section">
        <h4>Ticks</h4>
        <ol className="notebook-abm-model-ticks">
          {ticks.map((tick, index) => {
            const equations =
              tick != null && typeof tick === "object" ? tickEquations(tick as Record<string, unknown>) : [];
            const rationInto =
              tick != null &&
              typeof tick === "object" &&
              "ration-fcfs" in (tick as Record<string, unknown>)
                ? String(((tick as Record<string, unknown>)["ration-fcfs"] as { into?: unknown })?.into ?? "")
                : "";
            return (
              <li key={index}>
                <div>{formatTickLabel(tick)}</div>
                {equations.length > 0 ? (
                  <ul className="notebook-abm-model-equations">
                    {equations.map((row) => {
                      const [name, expression, description] = row;
                      return (
                        <li key={`${name}-${expression}`}>
                          <InspectableName {...nameProps} name={name} />
                          <span className="notebook-abm-model-expression">
                            {" "}
                            ={" "}
                            {highlightFormula(
                              expression,
                              parameterNames,
                              undefined,
                              mergedDescriptions,
                              units,
                              handleInspect,
                              undefined,
                              currentValues,
                              highlightedVariable,
                              true
                            )}
                          </span>
                          {description ? <> — {description}</> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {rationInto ? (
                  <ul className="notebook-abm-model-equations">
                    <li>
                      <InspectableName {...nameProps} name={rationInto} />
                      <code> ← ration-fcfs</code>
                    </li>
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="notebook-abm-model-section">
        <h4>Macro series</h4>
        <p className="notebook-abm-model-hint">
          All aggregate macros, averaged across Monte Carlo runs
          {monteCarlo != null ? <> (default MC={monteCarlo})</> : null}
          {bands.length > 0 ? "; optional p10–p90 bands" : null}.
        </p>
        {series.length > 0 ? (
          <ul className="notebook-abm-model-series notebook-abm-model-series-grid">
            {series.map((name) => (
              <SeriesRow
                key={name}
                currentValues={currentValues}
                description={mergedDescriptions.get(name)}
                name={name}
                nameProps={nameProps}
                variableDescriptions={mergedDescriptions}
                variableUnitMetadata={units}
              />
            ))}
          </ul>
        ) : (
          <p>—</p>
        )}
        {check ? (
          <p className="notebook-abm-model-check">
            Check <InspectableName {...nameProps} name={String(check.left)} />{" "}
            <CurrentValueCell
              currentValues={currentValues}
              name={String(check.left)}
              variableDescriptions={mergedDescriptions}
              variableUnitMetadata={units}
            />{" "}
            = <InspectableName {...nameProps} name={String(check.right)} />{" "}
            <CurrentValueCell
              currentValues={currentValues}
              name={String(check.right)}
              variableDescriptions={mergedDescriptions}
              variableUnitMetadata={units}
            />{" "}
            (tol {String(check.tolerance)})
          </p>
        ) : null}
      </section>

      <section className="notebook-abm-model-section">
        <h4>Micro series</h4>
        <p className="notebook-abm-model-hint">
          Household histories from Monte Carlo run 1 only (not averaged). Defaults to
          first and last agents for every state variable.
        </p>
        {micro.length > 0 ? (
          <ul className="notebook-abm-model-series">
            {micro.map((entry, index) => {
              const row = entry as {
                population?: unknown;
                agents?: unknown;
                variables?: unknown;
                maxAgents?: unknown;
              };
              const variables = Array.isArray(row.variables) ? row.variables.map(String) : [];
              const populationName = String(row.population ?? "?");
              const popSize =
                populations.find(
                  (pop) =>
                    pop != null &&
                    typeof pop === "object" &&
                    String((pop as { name?: unknown }).name) === populationName
                ) as { size?: unknown } | undefined;
              const size = typeof popSize?.size === "number" ? popSize.size : 0;
              const agentRefs =
                size > 0
                  ? expandAbmMicroAgents(
                      {
                        agents: (row.agents as "all" | Array<"first" | "last" | number>) ?? [
                          "first",
                          "last"
                        ],
                        ...(typeof row.maxAgents === "number" ? { maxAgents: row.maxAgents } : {})
                      },
                      size
                    )
                  : [];
              return (
                <li key={index}>
                  <code>{populationName}</code> agents [{formatAgents(row.agents)}]
                  {row.maxAgents != null ? <> (maxAgents={String(row.maxAgents)})</> : null}
                  <ul className="notebook-abm-model-series notebook-abm-model-series-grid">
                    {variables.flatMap((variable) => {
                      const desc = mergedDescriptions.get(variable);
                      if (agentRefs.length === 0) {
                        return [
                          <SeriesRow
                            key={variable}
                            currentValues={currentValues}
                            description={desc}
                            name={variable}
                            nameProps={nameProps}
                            variableDescriptions={mergedDescriptions}
                            variableUnitMetadata={units}
                          />
                        ];
                      }
                      return agentRefs.map(({ agent }) => {
                        const seriesName = abmMicroSeriesName(variable, agent);
                        return (
                          <SeriesRow
                            key={seriesName}
                            currentValues={currentValues}
                            description={desc}
                            name={seriesName}
                            nameProps={nameProps}
                            variableDescriptions={mergedDescriptions}
                            variableUnitMetadata={units}
                          />
                        );
                      });
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No micro probes recorded.</p>
        )}
      </section>
    </div>
  );
}
