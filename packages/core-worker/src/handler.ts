import {
  ConvergenceError,
  ModelValidationError,
  ParseError,
  analyzeAllBlockConvergence,
  computeStabilityMetrics,
  probeInitialValuesForPeriod1,
  runAbmSim,
  runBaseline,
  runScenario,
  runSegmentedExogenize,
  validateRunnable
} from "@sfcr/core";

import type { WorkerRequest, WorkerResponse } from "./protocol";

export function handleWorkerRequest(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.type) {
      case "runBaseline":
        return {
          id: request.id,
          type: "success",
          payload: runBaseline(request.payload.model, request.payload.options)
        };
      case "runScenario":
        return {
          id: request.id,
          type: "success",
          payload: runScenario(
            request.payload.baseline,
            request.payload.scenario,
            request.payload.options
          )
        };
      case "runSegmentedExogenize":
        return {
          id: request.id,
          type: "success",
          payload: runSegmentedExogenize(
            request.payload.model,
            request.payload.options,
            request.payload.segmentation
          )
        };
      case "runAbm": {
        const { modelId, config } = request.payload;
        if (modelId !== "abm-sim") {
          throw new Error(`Unknown ABM model id: ${modelId}`);
        }
        return {
          id: request.id,
          type: "success",
          payload: runAbmSim(config)
        };
      }
      case "validateRunnable":
        validateRunnable(request.payload.model, request.payload.options);
        return {
          id: request.id,
          type: "validationSuccess"
        };
      case "computeStabilityMetrics":
        return {
          id: request.id,
          type: "stabilitySuccess",
          payload: computeStabilityMetrics(request.payload.result, request.payload.period)
        };
      case "analyzeAllBlockConvergence":
        return {
          id: request.id,
          type: "blockConvergenceSuccess",
          payload: analyzeAllBlockConvergence(
            request.payload.model,
            request.payload.options,
            request.payload.period,
            request.payload.analysisOptions
          )
        };
      case "probeInitialValuesForPeriod1":
        return {
          id: request.id,
          type: "initialValueProbeSuccess",
          payload: probeInitialValuesForPeriod1(
            request.payload.model,
            request.payload.options,
            request.payload.candidates,
            request.payload.analysisOptions
          )
        };
    }
  } catch (error) {
    return toErrorResponse(request.id, error);
  }
}

function toErrorResponse(id: string, error: unknown): WorkerResponse {
  if (error instanceof ModelValidationError) {
    return {
      id,
      type: "error",
      payload: {
        name: error.name,
        message: error.message,
        ...(error.field ? { details: { field: error.field } } : {})
      }
    };
  }

  if (error instanceof ParseError) {
    const details: Record<string, unknown> = {};
    if (error.equationName) {
      details.equationName = error.equationName;
    }
    if (error.source) {
      details.source = error.source;
    }
    return {
      id,
      type: "error",
      payload: {
        name: error.name,
        message: error.message,
        ...(Object.keys(details).length > 0 ? { details } : {})
      }
    };
  }

  if (error instanceof ConvergenceError) {
    return {
      id,
      type: "error",
      payload: {
        name: error.name,
        message: error.message,
        details: error.details as unknown as Record<string, unknown>,
        ...(error.partialResult ? { partialResult: error.partialResult } : {})
      }
    };
  }

  if (error instanceof Error) {
    return {
      id,
      type: "error",
      payload: {
        name: error.name,
        message: error.message
      }
    };
  }

  return {
    id,
    type: "error",
    payload: {
      name: "UnknownError",
      message: "An unknown worker error occurred"
    }
  };
}
