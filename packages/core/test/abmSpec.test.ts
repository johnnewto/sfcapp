import { describe, expect, it } from "vitest";
import {
  ABM_SIM_SPEC,
  buildAbmSimSpec,
  normalizeAbmSpec,
  runAbmSim,
  runAbmSpec,
  validateAbmSpec,
  type AbmSpec
} from "../src/abm";
import golden from "./fixtures/abmSimGolden.json";

describe("runAbmSpec", () => {
  it("reproduces the ABM-SIM golden fixture exactly", () => {
    const { spec, overrides } = buildAbmSimSpec(golden.config);
    const result = runAbmSpec(spec, overrides);
    expect(Array.from(result.series.Y!)).toEqual(golden.Y);
    expect(Array.from(result.series.H_d!)).toEqual(golden.H_d);
    expect(Array.from(result.series.UR!)).toEqual(golden.UR);
    expect(Array.from(result.series.c_h1!)).toEqual(golden.c_h1);
    expect(Array.from(result.series.e_h1!)).toEqual(golden.e_h1);
  });

  it("matches runAbmSim for the same config", () => {
    const config = { periods: 20, households: 50, monteCarlo: 4, baseSeed: 7, s: 0.15 };
    const viaWrapper = runAbmSim(config);
    const { spec, overrides } = buildAbmSimSpec(config);
    const viaSpec = runAbmSpec(spec, overrides);
    expect(Array.from(viaSpec.series.Y!)).toEqual(Array.from(viaWrapper.series.Y!));
    expect(Array.from(viaSpec.series.H_d!)).toEqual(Array.from(viaWrapper.series.H_d!));
    expect(Array.from(viaSpec.series.e_hLast!)).toEqual(Array.from(viaWrapper.series.e_hLast!));
  });

  it("rejects specs that never assign a recorded series", () => {
    const bad: AbmSpec = {
      ...ABM_SIM_SPEC,
      record: { ...ABM_SIM_SPEC.record, series: ["Y", "MISSING"] }
    };
    expect(() => validateAbmSpec(bad)).toThrow(/MISSING/);
  });

  it("rejects ration-fcfs without a prior shuffle", () => {
    const bad: AbmSpec = {
      ...ABM_SIM_SPEC,
      ticks: ABM_SIM_SPEC.ticks.filter((t) => t.kind !== "shuffle")
    };
    expect(() => validateAbmSpec(bad)).toThrow(/shuffle/);
  });

  it("throws when the stock-flow check fails", () => {
    const broken: AbmSpec = {
      ...ABM_SIM_SPEC,
      ticks: ABM_SIM_SPEC.ticks.map((tick) => {
        if (tick.kind !== "aggregate") {
          return tick;
        }
        const eqs = tick.equations.map(([name, expr]) =>
          name === "H_s" ? ([name, "lag(H_s) + YG - TAX + 1"] as [string, string]) : [name, expr]
        );
        return { ...tick, equations: eqs };
      })
    };
    expect(() =>
      runAbmSpec(broken, {
        periods: 5,
        monteCarlo: 1,
        populationSizes: { households: 20 },
        params: { ...ABM_SIM_SPEC.params }
      })
    ).toThrow(/stock-flow check failed/);
  });

  it("defaults record to all macros and first/last micro when omitted", () => {
    const spec = normalizeAbmSpec({
      populations: [{ name: "households", size: 3, state: ["h", "cd", "c"] }],
      params: { G: 20 },
      ticks: [
        { do: [["AD", "sum(households.cd) + G"]] },
        { do: [["H_d", "sum(households.h)"]] }
      ]
    });
    expect(spec.record.series).toEqual(["AD", "H_d"]);
    expect(spec.record.bands).toEqual(["AD", "H_d"]);
    expect(spec.record.micro).toEqual([
      {
        population: "households",
        agents: ["first", "last"],
        variables: ["h", "cd", "c"]
      }
    ]);
  });

  it("normalizes record directive list to auto-all macros", () => {
    const spec = normalizeAbmSpec({
      populations: [{ name: "households", size: 3, state: ["h", "cd", "c"] }],
      params: { G: 20 },
      ticks: [
        { do: [["AD", "sum(households.cd) + G"]] },
        { do: [["H_d", "sum(households.h)"]] }
      ],
      record: [{ population: "households", variables: ["c"] }]
    });
    expect(spec.record.series).toEqual(["AD", "H_d"]);
    expect(spec.record.bands).toEqual(["AD", "H_d"]);
    expect(spec.record.micro).toEqual([
      {
        population: "households",
        agents: ["first", "last"],
        variables: ["c"]
      }
    ]);
  });

  it("normalizes do/for YAML wrappers", () => {
    const viaDo = normalizeAbmSpec({
      populations: [{ name: "households", size: 3, state: ["h", "cd"] }],
      params: { alpha1: 0.6 },
      ticks: [
        { do: [["G", "20"]] },
        { for: { households: [["cd", "alpha1 * lag(h)"]] } },
        { do: [["H_d", "sum(households.h)"]] }
      ],
      record: { series: ["G", "H_d"] }
    });
    expect(viaDo.ticks[0]).toEqual({ kind: "aggregate", equations: [["G", "20"]] });
    expect(viaDo.ticks[1]).toEqual({
      kind: "agent",
      population: "households",
      equations: [["cd", "alpha1 * lag(h)"]]
    });
    expect(viaDo.ticks[2]).toEqual({
      kind: "aggregate",
      equations: [["H_d", "sum(households.h)"]]
    });
  });

  it("keeps optional equation descriptions and harvests into record.descriptions", () => {
    const viaDo = normalizeAbmSpec({
      populations: [{ name: "households", size: 3, state: ["h"] }],
      ticks: [
        { do: [["Y", "pr * N", "Output / income (MC mean)"]] },
        { do: [["H_d", "sum(households.h)", "Total household money"]] }
      ],
      params: { pr: 1, N: 1 },
      record: {
        series: ["Y", "H_d"],
        descriptions: { H_d: "Explicit record label wins" }
      }
    });
    expect(viaDo.ticks[0]).toEqual({
      kind: "aggregate",
      equations: [["Y", "pr * N", "Output / income (MC mean)"]]
    });
    expect(viaDo.record.descriptions).toEqual({
      Y: "Output / income (MC mean)",
      H_d: "Explicit record label wins"
    });
  });

  it("exposes TAX and N for matrix views", () => {
    const result = runAbmSim({ periods: 10, households: 30, monteCarlo: 2 });
    expect(result.series.TAX?.length).toBe(10);
    expect(result.series.N?.length).toBe(10);
  });

  it("assigns employment from households.rank after shuffle", () => {
    const result = runAbmSim({ periods: 8, households: 20, monteCarlo: 1, baseSeed: 0 });
    for (let t = 0; t < 8; t++) {
      expect([0, 1]).toContain(result.series.e_h1![t]);
      expect([0, 1]).toContain(result.series.e_hLast![t]);
    }
  });

  it("records every household when micro agents is all", () => {
    const households = 8;
    const { spec, overrides } = buildAbmSimSpec({
      periods: 5,
      households,
      monteCarlo: 2,
      baseSeed: 3
    });
    const withAll: AbmSpec = {
      ...spec,
      record: {
        ...spec.record,
        micro: [
          {
            population: "households",
            agents: "all",
            variables: ["c", "e"],
            maxAgents: households
          }
        ]
      }
    };
    const result = runAbmSpec(withAll, overrides);
    expect(result.series.c_h1).toHaveLength(5);
    expect(result.series.c_h8).toHaveLength(5);
    expect(result.series.e_h4).toHaveLength(5);
    expect(result.series.c_hLast).toBeUndefined();
  });

  it("rejects agents all when population exceeds maxAgents", () => {
    const bad: AbmSpec = {
      ...ABM_SIM_SPEC,
      record: {
        ...ABM_SIM_SPEC.record,
        micro: [
          {
            population: "households",
            agents: "all",
            variables: ["c"],
            maxAgents: 10
          }
        ]
      }
    };
    expect(() => validateAbmSpec(bad)).toThrow(/maxAgents/);
  });

  it("keeps first/last aliases when mixed with all", () => {
    const households = 5;
    const { spec, overrides } = buildAbmSimSpec({
      periods: 4,
      households,
      monteCarlo: 1,
      baseSeed: 1
    });
    const mixed: AbmSpec = {
      ...spec,
      record: {
        ...spec.record,
        micro: [
          {
            population: "households",
            agents: ["all", "first", "last"],
            variables: ["h"],
            maxAgents: households
          }
        ]
      }
    };
    const result = runAbmSpec(mixed, overrides);
    expect(result.series.h_h1).toHaveLength(4);
    expect(result.series.h_hLast).toHaveLength(4);
    expect(result.series.h_h5).toBeUndefined();
  });
});
