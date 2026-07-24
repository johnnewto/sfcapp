import { useEffect, useMemo, useRef, useState } from "react";

import type { AbmSimConfig, ModelDefinition, SimulationOptions, SimulationResult } from "@sfcr/core";

import {
  applyConstantExternalOverrides,
  resolveModelOverrides,
  type ConstantExternalOverrides
} from "../lib/externalParameterControls";
import { buildRuntimeConfig } from "../lib/editorModel";
import { createWorkerClient } from "../lib/workerClient";
import { extractPartialRunResult } from "../lib/partialRunResult";
import { normalizeScenarioFromNotebook } from "./document";
import { buildEditorStateForNotebookModel, resolveRunCellModelKey } from "./modelSections";
import type { NotebookCellOutput, NotebookDocument, NotebookRuntimeState, RunCell } from "./types";

export interface NotebookRunnerApi extends NotebookRuntimeState {
  getPreviousResult(cellId: string): SimulationResult | null;
  getResult(cellId: string): SimulationResult | null;
  runCell(cellId: string): Promise<boolean>;
  runAll(): Promise<void>;
}

export function buildNotebookRunnerResetKey(document: NotebookDocument): string {
  const resetState = [];

  for (const cell of document.cells) {
    switch (cell.type) {
      case "model":
        resetState.push({ id: cell.id, type: cell.type, editor: cell.editor });
        break;
      case "equations":
        resetState.push({
          id: cell.id,
          type: cell.type,
          modelId: cell.modelId,
          equations: cell.equations
        });
        break;
      case "solver":
        resetState.push({ id: cell.id, type: cell.type, modelId: cell.modelId, options: cell.options });
        break;
      case "externals":
        resetState.push({
          id: cell.id,
          type: cell.type,
          modelId: cell.modelId,
          externals: cell.externals
        });
        break;
      case "initial-values":
        resetState.push({
          id: cell.id,
          type: cell.type,
          modelId: cell.modelId,
          initialValues: cell.initialValues
        });
        break;
      case "run":
        resetState.push({
          abm: cell.abm ?? null,
          abmModel: cell.abmModel ?? null,
          baselineRunCellId: cell.baselineRunCellId,
          baselineStartPeriod: cell.baselineStartPeriod,
          engine: cell.engine ?? "equation",
          exogenize: cell.exogenize ?? null,
          id: cell.id,
          mode: cell.mode,
          periods: cell.periods,
          resultKey: cell.resultKey,
          scenario: cell.scenario ?? null,
          simType: cell.simType,
          sourceModelCellId: cell.sourceModelCellId,
          sourceModelId: cell.sourceModelId,
          type: cell.type
        });
        break;
      default:
        break;
    }
  }

  return JSON.stringify(resetState);
}

export function resolvePreviousRunResult(
  currentOutput: NotebookCellOutput | undefined,
  lastSuccessfulResult: SimulationResult | undefined,
  shouldCapturePrevious: boolean
): SimulationResult | undefined {
  if (currentOutput?.type === "result") {
    return currentOutput.previousResult;
  }

  return shouldCapturePrevious ? lastSuccessfulResult : undefined;
}

export function resolveRunCellOptions(options: SimulationOptions, cell: RunCell): SimulationOptions {
  return {
    ...options,
    periods: cell.periods,
    simType: cell.simType ?? options.simType
  };
}

export function createScenarioBaselineSnapshot(
  baseline: SimulationResult,
  baselineStartPeriod?: number,
  modelOverride?: ModelDefinition
): SimulationResult {
  const snapshot =
    baselineStartPeriod == null
      ? baseline
      : (() => {
          if (!Number.isInteger(baselineStartPeriod) || baselineStartPeriod < 1) {
            throw new Error("baselineStartPeriod must be an integer >= 1.");
          }

          const availablePeriods = baseline.options.periods;
          if (baselineStartPeriod > availablePeriods) {
            throw new Error(
              `baselineStartPeriod ${baselineStartPeriod} exceeds baseline length ${availablePeriods}.`
            );
          }

          return {
            ...baseline,
            options: {
              ...baseline.options,
              periods: baselineStartPeriod
            },
            series: Object.fromEntries(
              Object.entries(baseline.series).map(([name, values]) => [
                name,
                values.slice(0, baselineStartPeriod)
              ])
            )
          };
        })();

  return modelOverride ? { ...snapshot, model: modelOverride } : snapshot;
}

export function resolveModelIdFromRunCellKey(modelKey: string | null): string | null {
  if (!modelKey) {
    return null;
  }

  return modelKey.replace(/^model:/, "").replace(/^cell:/, "") || null;
}

export function buildRunHistorySignatures(document: NotebookDocument): Record<string, string> {
  return Object.fromEntries(
    document.cells
      .filter((cell): cell is RunCell => cell.type === "run")
      .map((cell) => {
        if (cell.engine === "abm") {
          return [
            cell.id,
            JSON.stringify({
              engine: "abm",
              abmModel: cell.abmModel ?? "abm-sim",
              abm: cell.abm ?? null,
              periods: cell.periods,
              mode: cell.mode
            })
          ];
        }
        const editor = buildEditorStateForNotebookModel(document, cell);
        return [
          cell.id,
          JSON.stringify({
            equations: editor?.equations ?? [],
            externals: editor?.externals ?? [],
            initialValues: editor?.initialValues ?? [],
            mode: cell.mode,
            scenario: cell.scenario ?? null,
            simType: cell.simType,
            exogenize: cell.exogenize ?? null
          })
        ];
      })
  );
}

export function shouldStopRunAllAfterCell(
  cell: Pick<RunCell, "id" | "mode">,
  status: Record<string, string | undefined>,
  baselineRunCellId: string | null
): boolean {
  if (cell.mode === "baseline" && status[cell.id] === "error") {
    return true;
  }
  if (cell.mode === "scenario" && baselineRunCellId && status[baselineRunCellId] === "error") {
    return true;
  }
  return false;
}

export function resolveRunErrorPinCellId(
  cell: Pick<RunCell, "id" | "mode">,
  status: Record<string, string | undefined>,
  baselineRunCellId: string | null
): string {
  if (cell.mode === "scenario" && baselineRunCellId && status[baselineRunCellId] === "error") {
    return baselineRunCellId;
  }
  return cell.id;
}

export interface UseNotebookRunnerOptions {
  constantExternalOverrides?: ConstantExternalOverrides;
  onRunError?: (cellId: string, context?: { failurePeriodIndex?: number }) => void;
}

export function useNotebookRunner(
  document: NotebookDocument,
  options: UseNotebookRunnerOptions = {}
): NotebookRunnerApi {
  const [client] = useState(() => createWorkerClient());
  const [state, setState] = useState<NotebookRuntimeState>({ outputs: {}, status: {}, errors: {} });
  const stateRef = useRef(state);
  const lastSuccessfulResultsRef = useRef<Record<string, SimulationResult | undefined>>({});
  const historyCapturePendingRef = useRef<Record<string, boolean | undefined>>({});
  const historyUpdateSequenceRef = useRef(0);
  const constantExternalOverridesRef = useRef<ConstantExternalOverrides>({});
  constantExternalOverridesRef.current = options.constantExternalOverrides ?? {};
  const onRunErrorRef = useRef(options.onRunError);
  onRunErrorRef.current = options.onRunError;
  const resetKey = useMemo(() => buildNotebookRunnerResetKey(document), [document]);
  const runHistorySignatures = useMemo(() => buildRunHistorySignatures(document), [document]);
  const previousRunHistorySignaturesRef = useRef<Record<string, string> | null>(null);

  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    const previousSignatures = previousRunHistorySignaturesRef.current;
    if (previousSignatures) {
      for (const [cellId, signature] of Object.entries(runHistorySignatures)) {
        if (
          previousSignatures[cellId] != null &&
          previousSignatures[cellId] !== signature &&
          lastSuccessfulResultsRef.current[cellId]
        ) {
          historyCapturePendingRef.current[cellId] = true;
        }
      }
    }
    previousRunHistorySignaturesRef.current = runHistorySignatures;

    const next = { outputs: {}, status: {}, errors: {} };
    stateRef.current = next;
    setState(next);
  }, [resetKey]);

  const runCells = useMemo(
    () => document.cells.filter((cell): cell is RunCell => cell.type === "run"),
    [document.cells]
  );

  function buildEditorForRunCell(cell: RunCell) {
    const editor = buildEditorStateForNotebookModel(document, cell);
    const modelKey = resolveRunCellModelKey(document.cells, cell);
    const modelId = resolveModelIdFromRunCellKey(modelKey);
    if (!editor || !modelId) {
      return null;
    }

    return applyConstantExternalOverrides(
      editor,
      resolveModelOverrides(constantExternalOverridesRef.current, modelId)
    );
  }

  function buildRunOptions(cell: RunCell): ReturnType<typeof buildRuntimeConfig>["options"] | null {
    const editor = buildEditorForRunCell(cell);
    if (!editor) {
      return null;
    }

    const modelKey = resolveRunCellModelKey(document.cells, cell);
    const modelId = resolveModelIdFromRunCellKey(modelKey);
    const runtime = buildRuntimeConfig(editor, {
      notebookCells: document.cells,
      modelId: modelId ?? undefined,
      runCellId: cell.id
    });
    return resolveRunCellOptions(runtime.options, cell);
  }

  async function runAbmCell(cell: RunCell): Promise<boolean> {
    const cellId = cell.id;
    setState((current) => {
      const next: NotebookRuntimeState = {
        ...current,
        status: { ...current.status, [cellId]: "running" },
        errors: { ...current.errors, [cellId]: undefined }
      };
      stateRef.current = next;
      return next;
    });

    try {
      if (cell.mode !== "baseline") {
        throw new Error("ABM runs currently support baseline mode only.");
      }
      const modelId = cell.abmModel?.trim() || "abm-sim";
      const config: AbmSimConfig = {
        ...(cell.abm as AbmSimConfig | undefined),
        periods: cell.periods
      };
      const result = await client.runAbm(modelId, config);

      setState((current) => {
        const shouldCapturePrevious = historyCapturePendingRef.current[cellId] === true;
        const previousResult = resolvePreviousRunResult(
          current.outputs[cellId],
          lastSuccessfulResultsRef.current[cellId],
          shouldCapturePrevious
        );
        const didCapturePrevious = current.outputs[cellId]?.type !== "result" && previousResult != null;
        const next: NotebookRuntimeState = {
          ...current,
          outputs: {
            ...current.outputs,
            [cellId]: {
              type: "result",
              previousResult,
              result
            }
          },
          historyUpdates: didCapturePrevious
            ? {
                ...current.historyUpdates,
                [cellId]: (historyUpdateSequenceRef.current += 1)
              }
            : current.historyUpdates,
          status: { ...current.status, [cellId]: "success" }
        };
        historyCapturePendingRef.current[cellId] = false;
        lastSuccessfulResultsRef.current[cellId] = result;
        stateRef.current = next;
        return next;
      });
      return true;
    } catch (error) {
      setState((current) => {
        const next: NotebookRuntimeState = {
          ...current,
          status: { ...current.status, [cellId]: "error" },
          errors: {
            ...current.errors,
            [cellId]: error instanceof Error ? error.message : "Unknown notebook error"
          }
        };
        stateRef.current = next;
        return next;
      });
      onRunErrorRef.current?.(cellId);
      return false;
    }
  }

  function resolveBaselineRunCell(cell: RunCell): RunCell | null {
    if (cell.mode !== "scenario") {
      return null;
    }

    if (cell.baselineRunCellId) {
      return (
        document.cells.find(
          (entry): entry is RunCell =>
            entry.type === "run" && entry.mode === "baseline" && entry.id === cell.baselineRunCellId
        ) ?? null
      );
    }

    const scenarioModelKey = resolveRunCellModelKey(document.cells, cell);
    if (!scenarioModelKey) {
      return null;
    }

    return (
      document.cells.find(
        (entry): entry is RunCell =>
          entry.type === "run" &&
          entry.mode === "baseline" &&
          resolveRunCellModelKey(document.cells, entry) === scenarioModelKey
      ) ?? null
    );
  }

  async function runCell(cellId: string): Promise<boolean> {
    const cell = document.cells.find((entry) => entry.id === cellId);
    if (!cell || cell.type !== "run") {
      return true;
    }

    if (cell.engine === "abm") {
      return runAbmCell(cell);
    }

    const editor = buildEditorForRunCell(cell);
    const modelOutputKey = resolveRunCellModelKey(document.cells, cell);
    if (!editor || !modelOutputKey) {
      setState((current) => {
        const next: NotebookRuntimeState = {
          ...current,
          status: { ...current.status, [cellId]: "error" },
          errors: { ...current.errors, [cellId]: "Source model sections not found." }
        };
        stateRef.current = next;
        return next;
      });
      onRunErrorRef.current?.(cellId);
      return false;
    }

    setState((current) => {
      const next: NotebookRuntimeState = {
        ...current,
        status: { ...current.status, [cellId]: "running" },
        errors: { ...current.errors, [cellId]: undefined }
      };
      stateRef.current = next;
      return next;
    });

    let runContext: {
      runtime: ReturnType<typeof buildRuntimeConfig>;
      runOptions: SimulationOptions;
    } | null = null;

    try {
      const runtime = buildRuntimeConfig(editor, {
        notebookCells: document.cells,
        modelId: resolveModelIdFromRunCellKey(modelOutputKey) ?? undefined,
        runCellId: cell.id
      });
      const runOptions = resolveRunCellOptions(runtime.options, cell);
      runContext = { runtime, runOptions };
      let result: SimulationResult;

      if (cell.mode === "baseline") {
        result = runtime.segmentation
          ? await client.runSegmentedExogenize(runtime.model, runOptions, runtime.segmentation)
          : await client.runBaseline(runtime.model, runOptions);
      } else {
        if (runtime.segmentation) {
          throw new Error(
            "Windowed exogenize (throughPeriod) is only supported on baseline-mode runs."
          );
        }
        let baseline: SimulationResult | null = null;
        const baselineCell = resolveBaselineRunCell(cell);

        if (baselineCell) {
          let baselineResult = stateRef.current.outputs[baselineCell.id];
          if (baselineResult?.type !== "result") {
            await runCell(baselineCell.id);
            baselineResult = stateRef.current.outputs[baselineCell.id];
          }
          if (baselineResult?.type !== "result") {
            throw new Error(`Baseline run '${baselineCell.id}' did not produce a result.`);
          }
          baseline = createScenarioBaselineSnapshot(
            baselineResult.result,
            cell.baselineStartPeriod,
            runtime.model
          );
        } else {
          const baselineOptions = buildRunOptions({
            ...cell,
            mode: "baseline"
          });
          if (!baselineOptions) {
            throw new Error("Source model sections not found.");
          }
          baseline = createScenarioBaselineSnapshot(await client.runBaseline(runtime.model, baselineOptions), cell.baselineStartPeriod);
        }

        if (!cell.scenario) {
          throw new Error("Scenario cell is missing its scenario definition.");
        }
        result = await client.runScenario(
          baseline,
          normalizeScenarioFromNotebook(cell.scenario),
          runOptions
        );
      }

      setState((current) => {
        const shouldCapturePrevious = historyCapturePendingRef.current[cellId] === true;
        const previousResult = resolvePreviousRunResult(
          current.outputs[cellId],
          lastSuccessfulResultsRef.current[cellId],
          shouldCapturePrevious
        );
        const didCapturePrevious = current.outputs[cellId]?.type !== "result" && previousResult != null;
        const next: NotebookRuntimeState = {
          ...current,
          outputs: {
            ...current.outputs,
            [modelOutputKey]: {
              type: "model",
              runtime: {
                ...runtime,
                options: runOptions
              }
            },
            [cellId]: {
              type: "result",
              previousResult,
              result
            }
          },
          historyUpdates: didCapturePrevious
            ? {
                ...current.historyUpdates,
                [cellId]: (historyUpdateSequenceRef.current += 1)
              }
            : current.historyUpdates,
          status: { ...current.status, [cellId]: "success" }
        };
        historyCapturePendingRef.current[cellId] = false;
        lastSuccessfulResultsRef.current[cellId] = result;
        stateRef.current = next;
        return next;
      });
      return true;
    } catch (error) {
      const partialResult = extractPartialRunResult(error);
      const failurePeriodIndex = partialResult?.runMetadata?.convergenceFailure?.period;
      setState((current) => {
        const shouldCapturePrevious = historyCapturePendingRef.current[cellId] === true;
        const previousResult = resolvePreviousRunResult(
          current.outputs[cellId],
          lastSuccessfulResultsRef.current[cellId],
          shouldCapturePrevious
        );
        const outputs: NotebookRuntimeState["outputs"] =
          partialResult && runContext
            ? {
                ...current.outputs,
                [modelOutputKey]: {
                  type: "model",
                  runtime: {
                    ...runContext.runtime,
                    options: runContext.runOptions
                  }
                },
                [cellId]: {
                  type: "result",
                  previousResult,
                  result: partialResult
                }
              }
            : current.outputs;
        const next: NotebookRuntimeState = {
          ...current,
          outputs,
          status: { ...current.status, [cellId]: "error" },
          errors: {
            ...current.errors,
            [cellId]: error instanceof Error ? error.message : "Unknown notebook error"
          }
        };
        stateRef.current = next;
        return next;
      });
      const baselineCell = cell.mode === "scenario" ? resolveBaselineRunCell(cell) : null;
      onRunErrorRef.current?.(
        resolveRunErrorPinCellId(cell, stateRef.current.status, baselineCell?.id ?? null),
        failurePeriodIndex == null ? undefined : { failurePeriodIndex }
      );
      return false;
    }
  }

  async function runAll(): Promise<void> {
    for (const cell of runCells) {
      await runCell(cell.id);
      const baselineCell = cell.mode === "scenario" ? resolveBaselineRunCell(cell) : null;
      if (shouldStopRunAllAfterCell(cell, stateRef.current.status, baselineCell?.id ?? null)) {
        break;
      }
    }
  }

  function getResult(cellId: string): SimulationResult | null {
    const output = state.outputs[cellId];
    return output?.type === "result" ? output.result : null;
  }

  function getPreviousResult(cellId: string): SimulationResult | null {
    const output = state.outputs[cellId];
    return output?.type === "result" ? output.previousResult ?? null : null;
  }

  return {
    ...state,
    getPreviousResult,
    runCell,
    runAll,
    getResult
  };
}
