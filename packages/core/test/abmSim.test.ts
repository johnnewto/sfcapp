import { describe, expect, it } from "vitest";

import { runAbmSim } from "../src/abm/abmSim";

function mean(series: Float64Array, from: number, toExclusive: number): number {
  let sum = 0;
  for (let i = from; i < toExclusive; i++) {
    sum += series[i]!;
  }
  return sum / (toExclusive - from);
}

describe("runAbmSim", () => {
  it("keeps household money and money supply aligned (SFC)", () => {
    const result = runAbmSim({
      periods: 40,
      households: 80,
      monteCarlo: 8,
      s: 0.2
    });

    const Hd = result.series.H_d!;
    const Hs = result.series.H_s!;
    let maxGap = 0;
    for (let t = 0; t < Hd.length; t++) {
      maxGap = Math.max(maxGap, Math.abs(Hd[t]! - Hs[t]!));
    }
    expect(maxGap).toBeLessThan(1e-6);
  });

  it("converges pre-shock mean output toward G / theta", () => {
    const g0 = 20;
    const theta = 0.2;
    const result = runAbmSim({
      periods: 80,
      households: 200,
      monteCarlo: 30,
      g0,
      g1: 30,
      shockPeriod: 60,
      theta,
      s: 0.15
    });

    // Periods 29..59 in R (1-based) → indices 28..58
    const yBar = mean(result.series.Y!, 28, 59);
    expect(yBar).toBeGreaterThan(g0 / theta - 8);
    expect(yBar).toBeLessThan(g0 / theta + 8);
  });

  it("recovers near-textbook H when s = 0 and alpha1 is homogeneous", () => {
    const g0 = 20;
    const theta = 0.2;
    const alpha1m = 0.6;
    const alpha2 = 0.4;
    const textbookH = ((1 - theta) * (g0 / theta) * (1 - alpha1m)) / alpha2;

    const result = runAbmSim({
      periods: 80,
      households: 100,
      monteCarlo: 5,
      s: 0,
      alpha1m,
      alpha1d: 0,
      alpha2,
      theta,
      g0,
      g1: 20,
      shockPeriod: 200,
      homogeneousAlpha1: true,
      pr: 1
    });

    // Discrete hire floor leaves a small wealth buffer vs continuous SIM.
    const hBar = mean(result.series.H_d!, 50, 80);
    expect(Math.abs(hBar - textbookH) / textbookH).toBeLessThan(0.05);

    const withFriction = runAbmSim({
      periods: 80,
      households: 100,
      monteCarlo: 8,
      s: 0.25,
      alpha1m,
      alpha1d: 0,
      alpha2,
      theta,
      g0,
      g1: 20,
      shockPeriod: 200,
      homogeneousAlpha1: true,
      pr: 1
    });
    const hFriction = mean(withFriction.series.H_d!, 50, 80);
    expect(hFriction).toBeGreaterThan(hBar);
  });

  it("raises output after the government spending shock", () => {
    const result = runAbmSim({
      periods: 100,
      households: 150,
      monteCarlo: 20,
      g0: 20,
      g1: 30,
      shockPeriod: 60
    });

    const pre = mean(result.series.Y!, 40, 59);
    const post = mean(result.series.Y!, 80, 100);
    expect(post).toBeGreaterThan(pre + 5);
  });

  it("records micro series from the first MC run", () => {
    const result = runAbmSim({ periods: 10, households: 50, monteCarlo: 3 });
    expect(result.series.c_h1).toHaveLength(10);
    expect(result.series.h_h1).toHaveLength(10);
    expect(result.series.e_h1).toHaveLength(10);
    for (let t = 0; t < 10; t++) {
      expect([0, 1]).toContain(result.series.e_h1![t]);
    }
  });

  it("emits p10–p90 summary bands for macro series", () => {
    const result = runAbmSim({
      periods: 30,
      households: 100,
      monteCarlo: 20,
      s: 0.25
    });

    expect(result.series.Y_p10).toHaveLength(30);
    expect(result.series.Y_p90).toHaveLength(30);
    expect(result.series.UR_p10).toHaveLength(30);
    expect(result.series.UR_p90).toHaveLength(30);

    for (let t = 10; t < 30; t++) {
      expect(result.series.Y_p10![t]!).toBeLessThanOrEqual(result.series.Y![t]! + 1e-9);
      expect(result.series.Y_p90![t]!).toBeGreaterThanOrEqual(result.series.Y![t]! - 1e-9);
      expect(result.series.Y_p10![t]!).toBeLessThanOrEqual(result.series.Y_p90![t]!);
    }
  });

  it("can emit min–max bands instead of percentiles", () => {
    const result = runAbmSim({
      periods: 20,
      households: 80,
      monteCarlo: 12,
      bandKind: "minmax",
      s: 0.3
    });

    expect(result.series.Y_min).toHaveLength(20);
    expect(result.series.Y_max).toHaveLength(20);
    expect(result.series.Y_p10).toBeUndefined();
    for (let t = 0; t < 20; t++) {
      expect(result.series.Y_min![t]!).toBeLessThanOrEqual(result.series.Y_max![t]!);
    }
  });
});
