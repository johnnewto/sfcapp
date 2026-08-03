import {
  abmMicroSeriesName,
  expandAbmMicroAgents,
  normalizeAbmSpec,
  type AbmSpec
} from "@sfcr/core";
import { abmSpecFromCell } from "@sfcr/notebook-core";

import type { EditorState, EquationRow, ExternalRow } from "../lib/editorModel";
import type { VariableDescriptions } from "../lib/variableDescriptions";
import type { AbmModelCell, NotebookCell } from "./types";

const ABM_INSPECT_OPTIONS: EditorState["options"] = {
  periods: 100,
  solverMethod: "GAUSS_SEIDEL",
  toleranceText: "1e-10",
  maxIterations: 100,
  defaultInitialValueText: "0",
  hiddenLeftVariable: "",
  hiddenRightVariable: "",
  hiddenToleranceText: "0.00001",
  relativeHiddenTolerance: false
};

export function findAbmModelCell(cells: NotebookCell[], modelId: string): AbmModelCell | null {
  return (
    cells.find(
      (cell): cell is AbmModelCell => cell.type === "abm-model" && cell.modelId === modelId
    ) ?? null
  );
}

/** Normalize YAML or typed ticks from an abm-model cell into a typed AbmSpec. */
export function resolveAbmSpecFromCell(cell: AbmModelCell): AbmSpec {
  return normalizeAbmSpec(abmSpecFromCell(cell));
}

type TickEquation = { name: string; expression: string; description?: string; scope: "aggregate" | "agent" };

function collectTickEquations(spec: AbmSpec): TickEquation[] {
  const rows: TickEquation[] = [];
  for (const tick of spec.ticks) {
    switch (tick.kind) {
      case "aggregate":
        for (const row of tick.equations) {
          const [name, expression, description] = row;
          rows.push({
            name,
            expression,
            ...(description ? { description } : {}),
            scope: "aggregate"
          });
        }
        break;
      case "agent":
        for (const row of tick.equations) {
          const [name, expression, description] = row;
          rows.push({
            name,
            expression,
            ...(description
              ? { description: `${description} (agent state)` }
              : { description: `Agent state on ${tick.population}` }),
            scope: "agent"
          });
        }
        break;
      case "hire-lottery":
        rows.push({
          name: tick.into,
          expression: `hire_lottery(${tick.demand}, ${tick.spread}, ${tick.cap})`,
          description: "Job lottery hired count",
          scope: "aggregate"
        });
        break;
      case "ration-fcfs":
        rows.push({
          name: tick.into,
          expression: `ration_fcfs(${tick.demand}, ${tick.supply})`,
          description: "FCFS rationing into agent state (micro, MC run 1)",
          scope: "agent"
        });
        break;
      case "shuffle":
        break;
    }
  }
  return rows;
}

function microAgentLabel(agent: "first" | "last" | number): string {
  if (agent === "first") {
    return "first household";
  }
  if (agent === "last") {
    return "last household";
  }
  return `household ${agent}`;
}

function collectMicroSeriesEquations(spec: AbmSpec): EquationRow[] {
  const equations: EquationRow[] = [];
  const seen = new Set<string>();
  for (const entry of spec.record?.micro ?? []) {
    const pop = spec.populations.find((p) => p.name === entry.population);
    const size = pop?.size ?? 0;
    if (size < 1) {
      continue;
    }
    for (const { agent } of expandAbmMicroAgents(entry, size)) {
      for (const variable of entry.variables) {
        const seriesName = abmMicroSeriesName(variable, agent);
        if (seen.has(seriesName)) {
          continue;
        }
        seen.add(seriesName);
        const baseDesc = spec.record?.descriptions?.[variable];
        const agentDesc = `MICRO ${microAgentLabel(agent)} (MC run 1)`;
        equations.push({
          id: `abm-micro-${seriesName}`,
          name: seriesName,
          expression: variable,
          desc: baseDesc ? `${baseDesc} — ${agentDesc}` : agentDesc,
          role: "definition"
        });
      }
    }
  }
  return equations;
}

/**
 * Flatten an ABM model into a synthetic EditorState so the existing inspector /
 * catalog can treat tick LHS, params, and micro probes like equation variables.
 */
export function buildEditorStateFromAbmModelCell(
  cell: AbmModelCell,
  periods?: number
): EditorState {
  const spec = resolveAbmSpecFromCell(cell);
  const tickEquations = collectTickEquations(spec);
  const seenEquationNames = new Set<string>();
  const equations: EquationRow[] = [];

  for (const row of tickEquations) {
    if (seenEquationNames.has(row.name)) {
      continue;
    }
    seenEquationNames.add(row.name);
    equations.push({
      id: `abm-eq-${row.name}`,
      name: row.name,
      expression: row.expression,
      desc: (spec.record ?? {}).descriptions?.[row.name] ?? row.description,
      role: row.scope === "agent" ? "behavioral" : "definition"
    });
  }

  for (const micro of collectMicroSeriesEquations(spec)) {
    if (seenEquationNames.has(micro.name)) {
      continue;
    }
    seenEquationNames.add(micro.name);
    equations.push(micro);
  }

  const externals: ExternalRow[] = Object.entries(spec.params ?? {}).map(([name, value], index) => ({
    id: `abm-ext-${index}-${name}`,
    name,
    desc: spec.record?.descriptions?.[name],
    kind: "constant" as const,
    valueText: String(value)
  }));

  let popParamIndex = 0;
  for (const pop of spec.populations) {
    for (const [name, value] of Object.entries(pop.params ?? {})) {
      if (externals.some((row) => row.name === name)) {
        continue;
      }
      const valueText =
        value && typeof value === "object" && "draw" in value && value.draw === "uniform"
          ? `uniform(${value.lo}, ${value.hi})`
          : value && typeof value === "object" && "value" in value
            ? String(value.value)
            : String(value);
      externals.push({
        id: `abm-ext-pop-${popParamIndex}-${name}`,
        name,
        desc: spec.record?.descriptions?.[name],
        kind: "constant",
        valueText
      });
      popParamIndex += 1;
    }
    const sizeName = `${pop.name}_size`;
    if (externals.some((row) => row.name === sizeName)) {
      continue;
    }
    externals.push({
      id: `abm-ext-size-${pop.name}`,
      name: sizeName,
      desc: spec.record?.descriptions?.[sizeName] ?? `Population size (${pop.name})`,
      kind: "constant",
      valueText: String(pop.size)
    });
  }

  return {
    equations,
    externals,
    initialValues: Object.entries(spec.state?.aggregates ?? {}).map(([name, value], index) => ({
      id: `abm-init-${index}-${name}`,
      name,
      valueText: String(value)
    })),
    options: {
      ...ABM_INSPECT_OPTIONS,
      periods: periods ?? ABM_INSPECT_OPTIONS.periods
    },
    scenario: { shocks: [] }
  };
}

export function buildAbmVariableDescriptions(cell: AbmModelCell): VariableDescriptions {
  const editor = buildEditorStateFromAbmModelCell(cell);
  const descriptions: VariableDescriptions = new Map();
  for (const row of editor.equations) {
    if (!("name" in row)) {
      continue;
    }
    const desc = row.desc?.trim();
    if (row.name.trim() && desc && !descriptions.has(row.name.trim())) {
      descriptions.set(row.name.trim(), desc);
    }
  }
  for (const row of editor.externals) {
    if (!("name" in row)) {
      continue;
    }
    const desc = row.desc?.trim();
    if (row.name.trim() && desc && !descriptions.has(row.name.trim())) {
      descriptions.set(row.name.trim(), desc);
    }
  }
  const spec = resolveAbmSpecFromCell(cell);
  for (const [name, description] of Object.entries((spec.record ?? {}).descriptions ?? {})) {
    const trimmed = description.trim();
    if (name.trim() && trimmed && !descriptions.has(name.trim())) {
      descriptions.set(name.trim(), trimmed);
    }
  }
  return descriptions;
}
