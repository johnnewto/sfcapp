/** Seeded PRNG helpers for ABM Monte Carlo (population-agnostic). */

export type Rng = () => number;

/** Mulberry32: fast deterministic float in [0, 1). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform draw on [lo, hi). */
export function runif(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/**
 * Fisher–Yates shuffle of indices `0..n-1` into `out` (length n).
 * Reuses `out` to avoid allocations in the inner loop.
 */
export function shuffleIndices(rng: Rng, n: number, out: number[]): void {
  for (let i = 0; i < n; i++) {
    out[i] = i;
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
}

/**
 * Job-lottery hiring: noisy labour demand, capped by floor(Nd) and labour force.
 * Matches Leeds ABM_SIM.R: min(floor(Nd * U(1-s,1+s)), floor(Nd), nAgents).
 */
export function hireLottery(rng: Rng, labourDemand: number, spread: number, nAgents: number): number {
  const noisy = Math.floor(labourDemand * runif(rng, 1 - spread, 1 + spread));
  return Math.min(noisy, Math.floor(labourDemand), nAgents);
}

/**
 * First-come-first-served rationing along a queue order.
 * `planned[order[q]]` is demand in queue position q; `supply` is available units.
 * Writes served amounts into `served` (indexed by agent id, not queue order).
 */
export function rationFcfs(
  planned: Float64Array,
  order: number[],
  supply: number,
  served: Float64Array
): void {
  served.fill(0);
  let remaining = supply;
  for (let q = 0; q < order.length; q++) {
    const id = order[q]!;
    const want = planned[id]!;
    const got = Math.min(want, Math.max(0, remaining));
    served[id] = got;
    remaining -= got;
  }
}
