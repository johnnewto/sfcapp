import type { AbmModelCell } from "../types";

function formatTick(tick: unknown, index: number): string {
  if (tick == null || typeof tick !== "object") {
    return `${index + 1}. (invalid tick)`;
  }
  const record = tick as Record<string, unknown>;
  if (typeof record.kind === "string") {
    switch (record.kind) {
      case "agent":
        return `${index + 1}. for ${String(record.population)} (${equationCount(record.equations)} eq)`;
      case "aggregate":
        return `${index + 1}. do (${equationCount(record.equations)} eq)`;
      case "hire-lottery":
        return `${index + 1}. hire-lottery → ${String(record.into)}`;
      case "shuffle":
        return `${index + 1}. shuffle ${String(record.population)}`;
      case "ration-fcfs":
        return `${index + 1}. ration-fcfs ${String(record.population)}.${String(record.into)}`;
      default:
        return `${index + 1}. ${record.kind}`;
    }
  }
  if ("for" in record) {
    const body = record.for;
    if (body != null && typeof body === "object" && !Array.isArray(body)) {
      const [population, equations] = Object.entries(body as Record<string, unknown>)[0] ?? [];
      return `${index + 1}. for ${String(population)} (${equationCount(equations)} eq)`;
    }
    return `${index + 1}. for ?`;
  }
  if ("do" in record) {
    return `${index + 1}. do (${equationCount(record.do)} eq)`;
  }
  if ("hire-lottery" in record) {
    const body = record["hire-lottery"] as { into?: unknown };
    return `${index + 1}. hire-lottery → ${String(body?.into ?? "?")}`;
  }
  if ("shuffle" in record) {
    const body = record.shuffle;
    const pop = typeof body === "string" ? body : (body as { population?: unknown })?.population;
    return `${index + 1}. shuffle ${String(pop ?? "?")}`;
  }
  if ("ration-fcfs" in record) {
    const body = record["ration-fcfs"] as { population?: unknown; into?: unknown };
    return `${index + 1}. ration-fcfs ${String(body?.population)}.${String(body?.into)}`;
  }
  return `${index + 1}. (unknown tick)`;
}

function equationCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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

export function AbmModelCellView({ cell }: { cell: AbmModelCell }) {
  const populations = Array.isArray(cell.populations) ? cell.populations : [];
  const params =
    cell.params && typeof cell.params === "object" ? (cell.params as Record<string, unknown>) : {};
  const ticks = Array.isArray(cell.ticks) ? cell.ticks : [];
  const record =
    cell.record && typeof cell.record === "object" && !Array.isArray(cell.record)
      ? (cell.record as Record<string, unknown>)
      : {};
  const series = Array.isArray(record.series) ? record.series.map(String) : [];
  const bands = Array.isArray(record.bands) ? record.bands.map(String) : [];
  const bandSet = new Set(bands);
  const descriptions =
    record.descriptions && typeof record.descriptions === "object"
      ? (record.descriptions as Record<string, unknown>)
      : {};
  const micro = Array.isArray(record.micro) ? record.micro : [];
  const check =
    cell.check && typeof cell.check === "object"
      ? (cell.check as { left?: unknown; right?: unknown; tolerance?: unknown })
      : null;

  return (
    <div className="notebook-abm-model-view">
      <p className="notebook-abm-model-meta">
        Model id <code>{cell.modelId}</code>
      </p>
      <p className="notebook-abm-model-convention">
        Convention (Leeds ABM_SIM.R): <strong>upper-case = MACRO</strong> totals (MC means);
        <strong> lower-case / <code>*_h*</code> = MICRO</strong> (one household, MC run 1).
      </p>

      <section className="notebook-abm-model-section">
        <h4>Populations</h4>
        <ul>
          {populations.map((pop, index) => {
            const entry = pop as { name?: unknown; size?: unknown; state?: unknown };
            const state = Array.isArray(entry.state) ? entry.state.map(String).join(", ") : "";
            return (
              <li key={`${String(entry.name)}-${index}`}>
                <code>{String(entry.name)}</code> × {String(entry.size)}
                {state ? <> — state: {state}</> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {Object.keys(params).length > 0 ? (
        <section className="notebook-abm-model-section">
          <h4>Params</h4>
          <ul className="notebook-abm-model-params">
            {Object.entries(params).map(([name, value]) => (
              <li key={name}>
                <code>{name}</code> = {String(value)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="notebook-abm-model-section">
        <h4>Ticks</h4>
        <ol className="notebook-abm-model-ticks">
          {ticks.map((tick, index) => (
            <li key={index}>{formatTick(tick, index)}</li>
          ))}
        </ol>
      </section>

      <section className="notebook-abm-model-section">
        <h4>Macro series</h4>
        <p className="notebook-abm-model-hint">Averaged across Monte Carlo runs (optional p10–p90 bands).</p>
        {series.length > 0 ? (
          <ul className="notebook-abm-model-series">
            {series.map((name) => {
              const desc = descriptions[name];
              return (
                <li key={name}>
                  <code>{name}</code>
                  {bandSet.has(name) ? " (banded)" : null}
                  {typeof desc === "string" && desc.trim() ? <> — {desc}</> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>—</p>
        )}
        {check ? (
          <p>
            Check <code>{String(check.left)}</code> = <code>{String(check.right)}</code> (tol{" "}
            {String(check.tolerance)})
          </p>
        ) : null}
      </section>

      <section className="notebook-abm-model-section">
        <h4>Micro series</h4>
        <p className="notebook-abm-model-hint">
          Household histories from Monte Carlo run 1 only (not averaged). Use{" "}
          <code>agents: [first, last]</code> or <code>agents: all</code> (with{" "}
          <code>maxAgents</code> for large populations).
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
              return (
                <li key={index}>
                  <code>{String(row.population ?? "?")}</code> agents [{formatAgents(row.agents)}]
                  {row.maxAgents != null ? <> (maxAgents={String(row.maxAgents)})</> : null}
                  <ul>
                    {variables.map((variable) => {
                      const desc = descriptions[variable];
                      return (
                        <li key={variable}>
                          <code>{variable}</code>
                          {typeof desc === "string" && desc.trim() ? <> — {desc}</> : null}
                        </li>
                      );
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
