import type {
  AbmMicroAgentRef,
  AbmMicroRecord,
  AbmPopulationSpec,
  AbmRecordSpec,
  AbmSpec,
  AbmTickSpec,
  AbmEquationRow
} from "./abmSpecTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asEquationRows(value: unknown): AbmEquationRow[] {
  if (!Array.isArray(value)) {
    throw new Error("ABM equations must be an array of [name, expression] rows.");
  }
  return value.map((row, index) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(
        `ABM equation row ${index} must be [name, expression] or [name, expression, description].`
      );
    }
    const name = String(row[0]);
    const expression = String(row[1]);
    const description =
      row.length >= 3 && row[2] != null && String(row[2]).trim() !== "" ? String(row[2]) : undefined;
    return description != null ? [name, expression, description] : [name, expression];
  });
}

/** Aggregate (macro) names assigned by ticks — valid `record.series` targets. */
export function aggregateAssignedNames(ticks: AbmTickSpec[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tick of ticks) {
    switch (tick.kind) {
      case "aggregate":
        for (const [name] of tick.equations) {
          if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        }
        break;
      case "hire-lottery":
        if (!seen.has(tick.into)) {
          seen.add(tick.into);
          names.push(tick.into);
        }
        break;
      default:
        break;
    }
  }
  return names;
}

/** Fill `record.descriptions` from equation third slots when a name is missing. */
function harvestEquationDescriptions(
  ticks: AbmTickSpec[],
  record: AbmRecordSpec
): AbmRecordSpec {
  const descriptions: Record<string, string> = { ...(record.descriptions ?? {}) };
  let added = false;
  for (const tick of ticks) {
    if (tick.kind !== "agent" && tick.kind !== "aggregate") {
      continue;
    }
    for (const row of tick.equations) {
      const [name, , description] = row;
      if (description == null || description.trim() === "" || descriptions[name]) {
        continue;
      }
      descriptions[name] = description;
      added = true;
    }
  }
  if (!added && record.descriptions != null) {
    return record;
  }
  if (!added && Object.keys(descriptions).length === 0) {
    return record;
  }
  return { ...record, descriptions };
}

/**
 * Default recording when `record` is omitted:
 * - all aggregate macros as MC means (banded)
 * - every population: first + last agent, all state vars, from MC run 1
 */
export function defaultAbmRecord(
  populations: AbmPopulationSpec[],
  ticks: AbmTickSpec[]
): AbmRecordSpec {
  const macros = aggregateAssignedNames(ticks);
  if (macros.length === 0) {
    throw new Error("ABM auto-record needs at least one aggregate tick assignment.");
  }
  return {
    series: macros,
    bands: [...macros],
    micro: populations.map((pop) => ({
      population: pop.name,
      agents: ["first", "last"] as AbmMicroAgentRef[],
      variables: [...pop.state]
    }))
  };
}

function defaultMicroForPopulations(populations: AbmPopulationSpec[]): AbmMicroRecord[] {
  return populations.map((pop) => ({
    population: pop.name,
    agents: ["first", "last"] as AbmMicroAgentRef[],
    variables: [...pop.state]
  }));
}

function parseMonteCarloRun(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error(`ABM monte-carlo-run must be an integer >= 1 (got ${String(value)}).`);
  }
  return n;
}

/**
 * Normalize authoring `record` into a typed AbmRecordSpec.
 * `null` / `undefined` / `{}` / `[]` → {@link defaultAbmRecord}.
 * Legacy explicit `series` / `micro` still work; omitted pieces fill from defaults.
 */
export function normalizeAbmRecord(
  raw: unknown,
  populations: AbmPopulationSpec[],
  ticks: AbmTickSpec[]
): AbmRecordSpec {
  if (raw == null || (Array.isArray(raw) && raw.length === 0) || (isRecord(raw) && Object.keys(raw).length === 0)) {
    return defaultAbmRecord(populations, ticks);
  }

  const macros = aggregateAssignedNames(ticks);
  const popByName = new Map(populations.map((p) => [p.name, p]));
  const defaults = defaultAbmRecord(populations, ticks);

  let series: string[] | undefined;
  let bands: string[] | undefined;
  let bandsMode: "explicit" | "all" | "none" | undefined;
  let monteCarlo: number | undefined;
  let micro: AbmMicroRecord[] = [];
  let descriptions: Record<string, string> | undefined;
  let autoMacros = false;

  if (Array.isArray(raw)) {
    autoMacros = true;
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!isRecord(item)) {
        throw new Error(`ABM record[${i}] must be an object directive.`);
      }
      if ("population" in item) {
        const name = String(item.population).trim();
        const pop = popByName.get(name);
        if (!pop) {
          throw new Error(`ABM record population "${name}" is not defined in populations.`);
        }
        const resolvedAgents: AbmMicroAgentRef[] | "all" =
          item.agents === undefined
            ? ["first", "last"]
            : (item.agents as AbmMicroAgentRef[] | "all");
        if (item.variables !== undefined && !Array.isArray(item.variables)) {
          throw new Error(`ABM record[${i}] variables must be an array.`);
        }
        const variables =
          item.variables === undefined ? [...pop.state] : item.variables.map(String);
        const entry: AbmMicroRecord = {
          population: name,
          agents: resolvedAgents,
          variables
        };
        if (typeof item.maxAgents === "number") {
          entry.maxAgents = item.maxAgents;
        }
        micro.push(entry);
        continue;
      }
      if ("monte-carlo-run" in item || "monteCarlo" in item) {
        monteCarlo = parseMonteCarloRun(item["monte-carlo-run"] ?? item.monteCarlo);
        continue;
      }
      if ("bands" in item) {
        const b = item.bands;
        if (b === "all" || b === "none") {
          bandsMode = b;
        } else if (Array.isArray(b)) {
          bandsMode = "explicit";
          bands = b.map(String);
        } else {
          throw new Error(`ABM record[${i}] bands must be an array, "all", or "none".`);
        }
        continue;
      }
      if ("descriptions" in item && isRecord(item.descriptions)) {
        descriptions = Object.fromEntries(
          Object.entries(item.descriptions).map(([k, v]) => [k, String(v)])
        );
        continue;
      }
      throw new Error(
        `ABM record[${i}] unknown directive (expected population, monte-carlo-run, bands, or descriptions).`
      );
    }
  } else if (isRecord(raw)) {
    if (Array.isArray(raw.series)) {
      series = raw.series.map(String);
      if (series.length === 0) {
        autoMacros = true;
        series = undefined;
      }
    } else if (raw.series == null) {
      autoMacros = true;
    } else {
      throw new Error("ABM record.series must be an array of names when present.");
    }
    if (Array.isArray(raw.bands)) {
      bandsMode = "explicit";
      bands = raw.bands.map(String);
    }
    if (Array.isArray(raw.micro)) {
      micro = raw.micro as AbmMicroRecord[];
    }
    if (isRecord(raw.descriptions)) {
      descriptions = Object.fromEntries(
        Object.entries(raw.descriptions).map(([k, v]) => [k, String(v)])
      );
    }
    if (raw.monteCarlo != null || raw["monte-carlo-run"] != null) {
      monteCarlo = parseMonteCarloRun(raw.monteCarlo ?? raw["monte-carlo-run"]);
    }
  } else {
    throw new Error("ABM record must be omitted, an object, or a list of directives.");
  }

  if (autoMacros) {
    if (macros.length === 0) {
      throw new Error("ABM record auto-macros needs at least one aggregate tick assignment.");
    }
    series = macros;
    if (bandsMode === undefined) {
      bands = macros;
    } else if (bandsMode === "all") {
      bands = macros;
    } else if (bandsMode === "none") {
      bands = [];
    }
  } else if (series == null || series.length === 0) {
    series = defaults.series;
    if (bandsMode === undefined) {
      bands = defaults.bands;
    }
  } else if (bandsMode === "all") {
    bands = [...series];
  } else if (bandsMode === "none") {
    bands = [];
  }

  if (micro.length === 0) {
    micro = defaultMicroForPopulations(populations);
  }

  return {
    series,
    ...(bands !== undefined ? { bands } : {}),
    ...(monteCarlo !== undefined ? { monteCarlo } : {}),
    micro,
    ...(descriptions != null ? { descriptions } : {})
  };
}

/**
 * Normalize YAML-friendly tick wrappers into typed `{ kind: ... }` ticks.
 *
 * YAML shapes:
 * - `{ do: [[name, expr] | [name, expr, description], ...] }`
 * - `{ for: { households: [[name, expr] | [name, expr, description], ...] } }`
 * - hire-lottery / shuffle / ration-fcfs wrappers
 *
 * Typed `{ kind: "aggregate"|"agent"|... }` ticks pass through unchanged.
 */
export function normalizeAbmTick(raw: unknown): AbmTickSpec {
  if (!isRecord(raw)) {
    throw new Error("ABM tick must be an object.");
  }

  if (typeof raw.kind === "string") {
    return raw as unknown as AbmTickSpec;
  }

  if ("for" in raw) {
    const body = raw.for;
    if (!isRecord(body)) {
      throw new Error('ABM for tick needs `for: { <population>: [[name, expr], ...] }`.');
    }
    const entries = Object.entries(body);
    if (entries.length !== 1) {
      throw new Error('ABM for tick needs exactly one population, e.g. `for: { households: [...] }`.');
    }
    const [population, equations] = entries[0]!;
    return {
      kind: "agent",
      population,
      equations: asEquationRows(equations)
    };
  }

  if ("do" in raw) {
    return { kind: "aggregate", equations: asEquationRows(raw.do) };
  }

  if ("hire-lottery" in raw) {
    const body = raw["hire-lottery"];
    if (!isRecord(body)) {
      throw new Error("ABM hire-lottery tick needs an object body.");
    }
    return {
      kind: "hire-lottery",
      demand: String(body.demand),
      spread: String(body.spread),
      cap: typeof body.cap === "number" ? body.cap : String(body.cap),
      into: String(body.into)
    };
  }

  if ("shuffle" in raw) {
    const body = raw.shuffle;
    if (typeof body === "string") {
      return { kind: "shuffle", population: body };
    }
    if (isRecord(body) && typeof body.population === "string") {
      return { kind: "shuffle", population: body.population };
    }
    throw new Error('ABM shuffle tick needs `shuffle: "<population>"` or `{ population }`.');
  }

  if ("ration-fcfs" in raw) {
    const body = raw["ration-fcfs"];
    if (!isRecord(body)) {
      throw new Error("ABM ration-fcfs tick needs an object body.");
    }
    return {
      kind: "ration-fcfs",
      population: String(body.population),
      demand: String(body.demand),
      supply: String(body.supply),
      into: String(body.into)
    };
  }

  throw new Error(
    `ABM tick has unknown shape (expected do/for/hire-lottery/shuffle/ration-fcfs).`
  );
}

/** Normalize a raw (possibly YAML-shaped) spec into a typed AbmSpec. */
export function normalizeAbmSpec(raw: unknown): AbmSpec {
  if (!isRecord(raw)) {
    throw new Error("ABM spec must be an object.");
  }
  if (!Array.isArray(raw.populations) || !Array.isArray(raw.ticks)) {
    throw new Error("ABM spec requires populations and ticks.");
  }

  const ticks = raw.ticks.map((tick, index) => {
    try {
      return normalizeAbmTick(tick);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ABM tick[${index}]: ${message}`);
    }
  });

  const populations = raw.populations as AbmPopulationSpec[];
  let record: AbmRecordSpec;
  try {
    record = normalizeAbmRecord(raw.record, populations, ticks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
  record = harvestEquationDescriptions(ticks, record);

  return {
    ...(typeof raw.modelId === "string" ? { modelId: raw.modelId } : {}),
    populations,
    ...(isRecord(raw.params) ? { params: raw.params as Record<string, number> } : {}),
    ticks,
    record,
    ...(isRecord(raw.check) ? { check: raw.check as unknown as AbmSpec["check"] } : {})
  };
}
