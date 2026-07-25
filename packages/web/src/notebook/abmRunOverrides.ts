import type { AbmSpecOverrides, AbmUniformDraw } from "@sfcr/core";

const TOP_LEVEL_KEYS = new Set([
  "periods",
  "monteCarlo",
  "baseSeed",
  "bandKind",
  "households",
  "alpha1m",
  "alpha1d",
  "homogeneousAlpha1"
]);

/**
 * Map a run cell's flat `abm:` block onto AbmSpecOverrides.
 *
 * Convenience keys for ABM-SIM-style notebooks:
 * - `households` → `populationSizes.households`
 * - `alpha1m` / `alpha1d` / `homogeneousAlpha1` → households.alpha1 draw/constant
 * - other numeric keys → `params`
 */
export function abmRunOverridesFromCell(
  abm: Record<string, number | boolean> | undefined,
  periods: number
): AbmSpecOverrides {
  const overrides: AbmSpecOverrides = { periods };
  if (!abm) {
    return overrides;
  }

  const params: Record<string, number> = {};
  const populationSizes: Record<string, number> = {};

  for (const [key, value] of Object.entries(abm)) {
    if (key === "monteCarlo" && typeof value === "number") {
      overrides.monteCarlo = value;
      continue;
    }
    if (key === "baseSeed" && typeof value === "number") {
      overrides.baseSeed = value;
      continue;
    }
    if (key === "periods" && typeof value === "number") {
      overrides.periods = value;
      continue;
    }
    if (key === "households" && typeof value === "number") {
      populationSizes.households = value;
      continue;
    }
    if (TOP_LEVEL_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "number") {
      params[key] = value;
    }
  }

  const alpha1m = typeof abm.alpha1m === "number" ? abm.alpha1m : undefined;
  const alpha1d = typeof abm.alpha1d === "number" ? abm.alpha1d : undefined;
  const homogeneous = abm.homogeneousAlpha1 === true;

  if (alpha1m != null || homogeneous) {
    const mean = alpha1m ?? 0.6;
    const half = alpha1d ?? 0.4;
    const alpha1: AbmUniformDraw | { value: number } = homogeneous
      ? { value: mean }
      : { draw: "uniform", lo: mean - half, hi: mean + half };
    overrides.populationParams = {
      households: { alpha1 }
    };
  }

  if (Object.keys(params).length > 0) {
    overrides.params = params;
  }
  if (Object.keys(populationSizes).length > 0) {
    overrides.populationSizes = populationSizes;
  }

  return overrides;
}
