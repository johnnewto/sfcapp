import type { AbmSpec } from "@sfcr/core";

import type { AbmModelCell } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Build the runnable AbmSpec payload from a flattened abm-model cell.
 * Cell-level `modelId` is the registry key; it is not copied into the spec.
 */
export function abmSpecFromCell(cell: AbmModelCell): AbmSpec | Record<string, unknown> {
  return {
    populations: cell.populations as AbmSpec["populations"],
    ...(cell.params != null ? { params: cell.params as AbmSpec["params"] } : {}),
    ...(cell.state != null ? { state: cell.state as AbmSpec["state"] } : {}),
    ticks: cell.ticks as AbmSpec["ticks"],
    ...(cell.record != null ? { record: cell.record as AbmSpec["record"] } : {}),
    ...(cell.check != null ? { check: cell.check as AbmSpec["check"] } : {})
  };
}

/**
 * Lift legacy `{ spec: { populations, ticks, … } }` onto the cell and drop a
 * redundant nested `modelId` when present.
 */
export function normalizeAbmModelCell(cell: AbmModelCell): AbmModelCell {
  const maybeLegacy = cell as AbmModelCell & { spec?: unknown };
  const nested = maybeLegacy.spec;
  if (!isRecord(nested)) {
    return cell;
  }

  const { modelId: _nestedModelId, ...specBody } = nested;
  const { spec: _spec, ...rest } = maybeLegacy;
  return {
    ...rest,
    ...specBody
  } as AbmModelCell;
}
