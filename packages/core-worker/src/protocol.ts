import type {
  AbmSpec,
  AbmSpecOverrides,
  BlockConvergenceOptions,
  BlockConvergenceReport,
  InitialValueProbeCandidate,
  InitialValueProbeResult,
  ModelDefinition,
  ScenarioDefinition,
  SegmentedExogenizeOptions,
  SimulationOptions,
  SimulationResult,
  StabilityAnalysis
} from "@sfcr/core";

export type WorkerRequest =
  | {
      id: string;
      type: "runBaseline";
      payload: { model: ModelDefinition; options: SimulationOptions };
    }
  | {
      id: string;
      type: "runScenario";
      payload: {
        baseline: SimulationResult;
        scenario: ScenarioDefinition;
        options: SimulationOptions;
      };
    }
  | {
      id: string;
      type: "runSegmentedExogenize";
      payload: {
        model: ModelDefinition;
        options: SimulationOptions;
        segmentation: SegmentedExogenizeOptions;
      };
    }
  | {
      id: string;
      type: "runAbm";
      payload: {
        spec: AbmSpec | Record<string, unknown>;
        overrides?: AbmSpecOverrides;
      };
    }
  | {
      id: string;
      /** Shortened baseline via @sfcr/core validateRunnable (not a full simulation). */
      type: "validateRunnable";
      payload: { model: ModelDefinition; options: SimulationOptions };
    }
  | {
      id: string;
      type: "computeStabilityMetrics";
      payload: { result: SimulationResult; period: number };
    }
  | {
      id: string;
      type: "analyzeAllBlockConvergence";
      payload: {
        model: ModelDefinition;
        options: SimulationOptions;
        period: number;
        analysisOptions?: BlockConvergenceOptions;
      };
    }
  | {
      id: string;
      type: "probeInitialValuesForPeriod1";
      payload: {
        model: ModelDefinition;
        options: SimulationOptions;
        candidates: InitialValueProbeCandidate[];
        analysisOptions?: BlockConvergenceOptions;
      };
    };

export type WorkerResponse =
  | {
      id: string;
      type: "success";
      payload: SimulationResult;
    }
  | {
      id: string;
      type: "stabilitySuccess";
      payload: StabilityAnalysis;
    }
  | {
      id: string;
      type: "blockConvergenceSuccess";
      payload: BlockConvergenceReport;
    }
  | {
      id: string;
      type: "initialValueProbeSuccess";
      payload: InitialValueProbeResult[];
    }
  | {
      id: string;
      type: "validationSuccess";
    }
  | {
      id: string;
      type: "error";
      payload: {
        name: string;
        message: string;
        details?: Record<string, unknown>;
        partialResult?: SimulationResult;
      };
    };
