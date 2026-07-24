import { describe, expect, it } from "vitest";

import {
  ModelValidationError,
  runBaseline,
  type ModelDefinition,
  type SimulationOptions
} from "@sfcr/core";
import { handleWorkerRequest } from "@sfcr/core-worker";

const options: SimulationOptions = {
  periods: 5,
  solverMethod: "GAUSS_SEIDEL",
  tolerance: 1e-8,
  maxIterations: 50
};

describe("core worker handler", () => {
  it("validates by running the model enough to catch solver-time errors", () => {
    const model: ModelDefinition = {
      equations: [{ name: "Y", expression: "missingExternal" }],
      externals: {},
      initialValues: {}
    };

    const response = handleWorkerRequest({
      id: "validate-1",
      type: "validateRunnable",
      payload: { model, options }
    });

    expect(response).toMatchObject({
      id: "validate-1",
      type: "error",
      payload: {
        message: "Unknown variable: missingExternal"
      }
    });
  });

  it("includes structured details for ModelValidationError", () => {
    const model: ModelDefinition = {
      equations: [],
      externals: {},
      initialValues: {}
    };

    const response = handleWorkerRequest({
      id: "validate-3",
      type: "validateRunnable",
      payload: { model, options }
    });

    expect(response).toMatchObject({
      id: "validate-3",
      type: "error",
      payload: {
        name: ModelValidationError.name,
        message: "Model must contain at least one equation",
        details: { field: "equations" }
      }
    });
  });

  it("returns validationSuccess for runnable models", () => {
    const model: ModelDefinition = {
      equations: [{ name: "Y", expression: "Gd" }],
      externals: { Gd: { kind: "constant", value: 20 } },
      initialValues: {}
    };

    expect(
      handleWorkerRequest({
        id: "validate-2",
        type: "validateRunnable",
        payload: { model, options }
      })
    ).toEqual({
      id: "validate-2",
      type: "validationSuccess"
    });
  });

  it("returns stabilitySuccess for computeStabilityMetrics", () => {
    const model: ModelDefinition = {
      equations: [{ name: "y", expression: "a * lag(y) + g" }],
      externals: {
        a: { kind: "constant", value: 0.8 },
        g: { kind: "constant", value: 10 }
      },
      initialValues: { y: 100 }
    };

    const result = runBaseline(model, options);
    const response = handleWorkerRequest({
      id: "stability-1",
      type: "computeStabilityMetrics",
      payload: { result, period: 2 }
    });

    expect(response.type).toBe("stabilitySuccess");
    if (response.type !== "stabilitySuccess") {
      return;
    }

    expect(response.id).toBe("stability-1");
    expect(response.payload.spectralRadius).toBeCloseTo(0.8, 5);
    expect(response.payload.classification).toBe("stable");
  });

  it("includes structured details for ConvergenceError", () => {
    const model = {
      equations: [
        { name: "x", expression: "y + 1" },
        { name: "y", expression: "x + 1" }
      ],
      externals: {},
      initialValues: { x: 1, y: 1 }
    };

    const response = handleWorkerRequest({
      id: "run-1",
      type: "runBaseline",
      payload: {
        model,
        options: {
          periods: 2,
          solverMethod: "GAUSS_SEIDEL",
          tolerance: 1e-8,
          maxIterations: 3
        }
      }
    });

    expect(response).toMatchObject({
      id: "run-1",
      type: "error",
      payload: {
        name: "ConvergenceError",
        details: {
          period: 1,
          iterationsUsed: 3,
          blockVariables: ["x", "y"]
        }
      }
    });
    if (response.type !== "error") {
      return;
    }
    expect(response.payload.message).toContain("Slowest to converge:");
    expect(response.payload.partialResult).toBeDefined();
    expect(response.payload.partialResult?.runMetadata?.partial).toBe(true);
    expect(response.payload.partialResult?.series.x?.length).toBe(2);
  });

  it("runs a windowed segmented run via runSegmentedExogenize", () => {
    const model: ModelDefinition = {
      equations: [
        { name: "x", expression: "rho * TSLAG(x, 1)" },
        { name: "y", expression: "e" }
      ],
      externals: {
        x: { kind: "series", values: [1, 5, 9] },
        e: { kind: "series", values: [1, 2, 3] }
      },
      coefficients: { rho: 2 },
      initialValues: { x: 1, y: 1 }
    };

    const response = handleWorkerRequest({
      id: "segmented-1",
      type: "runSegmentedExogenize",
      payload: {
        model,
        options: { ...options, simType: "DYNAMIC" },
        segmentation: { splitPeriod: 3, segment1ExogenizedEquationNames: ["x"] }
      }
    });

    expect(response.type).toBe("success");
    if (response.type !== "success") {
      return;
    }
    expect(response.id).toBe("segmented-1");
    expect(Array.from(response.payload.series.x ?? [])).toEqual([1, 5, 9, 18, 36]);
    expect(Array.from(response.payload.series.y ?? [])).toEqual([1, 2, 3, 3, 3]);
  });

  it("returns blockConvergenceSuccess for analyzeAllBlockConvergence", () => {
    const model: ModelDefinition = {
      equations: [{ name: "Y", expression: "Gd" }],
      externals: { Gd: { kind: "constant", value: 20 } },
      initialValues: {}
    };

    const response = handleWorkerRequest({
      id: "block-convergence-1",
      type: "analyzeAllBlockConvergence",
      payload: { model, options, period: 1 }
    });

    expect(response).toMatchObject({
      id: "block-convergence-1",
      type: "blockConvergenceSuccess"
    });
    if (response.type !== "blockConvergenceSuccess") {
      return;
    }

    expect(response.payload.period).toBe(1);
    expect(response.payload.blocks.length).toBeGreaterThan(0);
  });

  it("returns initialValueProbeSuccess for probeInitialValuesForPeriod1", () => {
    const model: ModelDefinition = {
      equations: [{ name: "Y", expression: "Gd" }],
      externals: { Gd: { kind: "constant", value: 20 } },
      initialValues: {}
    };

    const response = handleWorkerRequest({
      id: "initial-value-probe-1",
      type: "probeInitialValuesForPeriod1",
      payload: {
        model,
        options,
        candidates: [{ label: "empty", initialValues: {} }]
      }
    });

    expect(response).toMatchObject({
      id: "initial-value-probe-1",
      type: "initialValueProbeSuccess"
    });
    if (response.type !== "initialValueProbeSuccess") {
      return;
    }

    expect(response.payload).toHaveLength(1);
    expect(response.payload[0]?.label).toBe("empty");
    expect(response.payload[0]?.report.period).toBe(1);
  });

  it("runs ABM-SIM via runAbm", () => {
    const response = handleWorkerRequest({
      id: "abm-1",
      type: "runAbm",
      payload: {
        modelId: "abm-sim",
        config: {
          periods: 20,
          households: 40,
          monteCarlo: 4,
          s: 0.1
        }
      }
    });

    expect(response).toMatchObject({
      id: "abm-1",
      type: "success"
    });
    if (response.type !== "success") {
      return;
    }

    expect(response.payload.series.Y).toHaveLength(20);
    expect(response.payload.series.H_d).toHaveLength(20);
    expect(response.payload.series.c_h1).toHaveLength(20);
  });

  it("rejects unknown ABM model ids", () => {
    const response = handleWorkerRequest({
      id: "abm-bad",
      type: "runAbm",
      payload: { modelId: "abm-pc", config: { periods: 5 } }
    });

    expect(response).toMatchObject({
      id: "abm-bad",
      type: "error",
      payload: { message: "Unknown ABM model id: abm-pc" }
    });
  });
});
