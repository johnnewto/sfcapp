import type { AbmSpec, AbmTickSpec, AbmEquationRow } from "./abmSpecTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asEquationRows(value: unknown): AbmEquationRow[] {
  if (!Array.isArray(value)) {
    throw new Error("ABM equations must be an array of [name, expression] rows.");
  }
  return value.map((row, index) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(`ABM equation row ${index} must be [name, expression].`);
    }
    return [String(row[0]), String(row[1])];
  });
}

/**
 * Normalize YAML-friendly tick wrappers into typed `{ kind: ... }` ticks.
 *
 * YAML shapes:
 * - `{ do: [[name, expr], ...] }`
 * - `{ for: { households: [[name, expr], ...] } }`
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
  if (!Array.isArray(raw.populations) || !Array.isArray(raw.ticks) || !isRecord(raw.record)) {
    throw new Error("ABM spec requires populations, ticks, and record.");
  }

  const ticks = raw.ticks.map((tick, index) => {
    try {
      return normalizeAbmTick(tick);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ABM tick[${index}]: ${message}`);
    }
  });

  return {
    ...(typeof raw.modelId === "string" ? { modelId: raw.modelId } : {}),
    populations: raw.populations as AbmSpec["populations"],
    ...(isRecord(raw.params) ? { params: raw.params as Record<string, number> } : {}),
    ticks,
    record: raw.record as unknown as AbmSpec["record"],
    ...(isRecord(raw.check) ? { check: raw.check as unknown as AbmSpec["check"] } : {})
  };
}
