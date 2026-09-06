import { describe, expect, it } from "vitest";

import { runBaseline, runScenario } from "@sfcr/core";

import { buildRuntimeConfig } from "../src/lib/editorModel";
import { buildEditorStateForNotebookModel } from "../src/notebook/modelSections";
import { getNotebookTemplateDocument } from "../src/notebook/templates";

type TemplateId =
  | "define-simple"
  | "endogenous-money"
  | "interbank-liquidity-risk"
  | "opensimplest"
  | "opensimplest-levy"
  | "predator-prey";

interface TemplateSmokeCase {
  baselineExpectations(result: ReturnType<typeof runBaseline>): void;
  baselineRunCellId: string;
  scenarioExpectations(
    result: ReturnType<typeof runScenario>,
    baselineResult: ReturnType<typeof runBaseline>
  ): void;
  scenarioRunCellId: string;
  templateId: TemplateId;
}

const TEMPLATE_CASES: TemplateSmokeCase[] = [
  {
    templateId: "define-simple",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "scenario-1-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(78);
      expect(result.series.Y.length).toBe(78);
      expect(result.series.EMIS_F.length).toBe(78);
      expect(Number.isFinite(result.series.Y.at(-1) ?? NaN)).toBe(true);
      expect(result.series.Y[0] ?? NaN).toBeCloseTo(106.94, 4);
      expect(result.series.g_Y.at(-1) ?? NaN).toBeCloseTo(0.029, 5);
      expect(Math.abs((result.series.D.at(-1) ?? NaN) - (result.series.D_red.at(-1) ?? NaN))).toBeLessThan(
        1e-6
      );
    },
    scenarioExpectations(result, baselineResult) {
      expect(result.options.periods).toBe(78);
      expect(result.series.beta.at(-1) ?? NaN).toBeGreaterThan(baselineResult.series.beta.at(-1) ?? NaN);
      expect(result.series.CI.at(-1) ?? NaN).toBeLessThan(baselineResult.series.CI.at(-1) ?? NaN);
      expect(Number.isFinite(result.series.EMIS_F.at(-1) ?? NaN)).toBe(true);
    }
  },
  {
    templateId: "endogenous-money",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "higher-deficit-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(80);
      expect(result.series.GDP.length).toBe(80);
      expect(result.series.Govt_Debt_GDP.length).toBe(80);
      expect(result.series.Private_Debt_GDP.length).toBe(80);
      expect(result.series.Money.length).toBe(80);
      expect(Number.isFinite(result.series.GDP.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Govt_Debt_GDP.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Private_Debt_GDP.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Gov_Bonds.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Debt.at(-1) ?? NaN)).toBe(true);
      expect(result.series.GDP.at(-1) ?? NaN).toBeGreaterThan(0);
    },
    scenarioExpectations(result, baselineResult) {
      expect(result.options.periods).toBe(80);
      expect(result.series.GDP.length).toBe(80);
      expect(result.series.Govt_Debt_GDP.length).toBe(80);
      expect(Number.isFinite(result.series.GDP.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Govt_Debt_GDP.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Gov_Bonds.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.Debt.at(-1) ?? NaN)).toBe(true);
      expect(result.series.Gov_Bonds.at(-1) ?? NaN).toBeGreaterThan(
        baselineResult.series.Gov_Bonds.at(-1) ?? NaN
      );
    }
  },
  {
    templateId: "interbank-liquidity-risk",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "stress-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(38);
      expect(result.series.Y.length).toBe(38);
      expect(result.series.IBon.length).toBe(38);
      expect(result.series.IBterm.length).toBe(38);
      expect(Number.isFinite(result.series.Y.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.DSm.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.iterm_ib.at(-1) ?? NaN)).toBe(true);
    },
    scenarioExpectations(result, baselineResult) {
      expect(result.options.periods).toBe(38);
      expect(result.series.iterm_ib.length).toBe(38);
      expect(Number.isFinite(result.series.iterm_ib.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.theta.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(baselineResult.series.iterm_ib.at(-1) ?? NaN)).toBe(true);
    }
  },
  {
    templateId: "opensimplest",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "export-shock-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(40);
      expect(result.series.Y.length).toBe(40);
      expect(result.series.X.length).toBe(40);
      expect(result.series.CA.length).toBe(40);
      expect(result.series.XR.length).toBe(40);
      expect(Math.abs(result.series.sectoral_check[0] ?? NaN)).toBeLessThan(1e-6);
      expect(Number.isFinite(result.series.V.at(-1) ?? NaN)).toBe(true);
    },
    scenarioExpectations(result, baselineResult) {
      expect(result.options.periods).toBe(40);
      expect(result.series.X.length).toBe(40);
      expect(result.series.XR.length).toBe(40);
      expect(Number.isFinite(result.series.X.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.XR.at(-1) ?? NaN)).toBe(true);
      expect(result.series.X[5] ?? NaN).toBeLessThan(baselineResult.series.X[5] ?? NaN);
    }
  },
  {
    templateId: "opensimplest-levy",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "export-shock-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(150);
      expect(result.series.y.length).toBe(150);
      expect(result.series.x.length).toBe(150);
      expect(result.series.CA.length).toBe(150);
      expect(result.series.xr.length).toBe(150);
      expect(Math.abs(result.series.sectoral_check[0] ?? NaN)).toBeLessThan(1e-6);
      expect(Number.isFinite(result.series.v.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series["H^P"].at(-1) ?? NaN)).toBe(true);
    },
    scenarioExpectations(result, baselineResult) {
      expect(result.options.periods).toBe(150);
      expect(result.series.x.length).toBe(150);
      expect(result.series.xr.length).toBe(150);
      expect(Number.isFinite(result.series.x.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.xr.at(-1) ?? NaN)).toBe(true);
      expect(result.series.x[5] ?? NaN).toBeLessThan(baselineResult.series.x[5] ?? NaN);
    }
  },
  {
    templateId: "predator-prey",
    baselineRunCellId: "baseline-run",
    scenarioRunCellId: "scenario-run",
    baselineExpectations(result) {
      expect(result.options.periods).toBe(120);
      expect(result.series.prey.length).toBe(120);
      expect(result.series.predator.length).toBe(120);
      expect(result.series.prey.at(-1)).toBeTypeOf("number");
      expect(result.series.predator.at(-1)).toBeTypeOf("number");
      expect(Number.isFinite(result.series.prey.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.predator.at(-1) ?? NaN)).toBe(true);
    },
    scenarioExpectations(result) {
      expect(result.options.periods).toBe(50);
      expect(result.series.prey.length).toBe(50);
      expect(result.series.predator.length).toBe(50);
      expect(Number.isFinite(result.series.prey.at(-1) ?? NaN)).toBe(true);
      expect(Number.isFinite(result.series.predator.at(-1) ?? NaN)).toBe(true);
    }
  },
];

describe("notebook template smoke tests", () => {
  for (const templateCase of TEMPLATE_CASES) {
    it(`builds and runs ${templateCase.templateId}`, () => {
      const document = getNotebookTemplateDocument(templateCase.templateId);
      const baselineRunCell = document.cells.find(
        (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
          cell.type === "run" && cell.id === templateCase.baselineRunCellId
      );
      const scenarioRunCell = document.cells.find(
        (cell): cell is Extract<(typeof document.cells)[number], { type: "run" }> =>
          cell.type === "run" && cell.id === templateCase.scenarioRunCellId
      );

      expect(baselineRunCell).toBeDefined();
      expect(scenarioRunCell).toBeDefined();

      if (!baselineRunCell || !scenarioRunCell) {
        throw new Error(`Expected run cells to exist for ${templateCase.templateId}.`);
      }

      const baselineEditor = buildEditorStateForNotebookModel(document, baselineRunCell);
      expect(baselineEditor).not.toBeNull();
      if (!baselineEditor) {
        throw new Error(`Expected baseline editor state for ${templateCase.templateId}.`);
      }

      const baselineRuntime = buildRuntimeConfig(baselineEditor);
      const baselineResult = runBaseline(baselineRuntime.model, baselineRuntime.options);

      templateCase.baselineExpectations(baselineResult);

      const scenarioEditor = buildEditorStateForNotebookModel(document, scenarioRunCell);
      expect(scenarioEditor).not.toBeNull();
      if (!scenarioEditor) {
        throw new Error(`Expected scenario editor state for ${templateCase.templateId}.`);
      }

      const scenarioRuntime = buildRuntimeConfig(scenarioEditor);
      const scenarioOptions =
        scenarioRunCell.periods == null
          ? scenarioRuntime.options
          : { ...scenarioRuntime.options, periods: scenarioRunCell.periods };
      const scenarioResult = runScenario(
        baselineResult,
        scenarioRunCell.scenario ?? { shocks: [] },
        scenarioOptions
      );

      templateCase.scenarioExpectations(scenarioResult, baselineResult);
    });
  }
});
