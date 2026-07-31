import { NOTEBOOK_ASSISTANT_API_URL } from "./notebookAssistantRuntime";

export function isNotebookCellAiEnabled(): boolean {
  if (!NOTEBOOK_ASSISTANT_API_URL) {
    return false;
  }

  const flag = (import.meta.env.VITE_NOTEBOOK_CELL_AI ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false") {
    return false;
  }
  if (flag === "1" || flag === "true") {
    return true;
  }

  return Boolean(import.meta.env.DEV);
}

let globalEditEnabledOverride: boolean | null = null;

/** Test-only override for legacy global Edit. Pass `null` to clear. */
export function setNotebookAssistantGlobalEditEnabledForTests(value: boolean | null): void {
  globalEditEnabledOverride = value;
}

/**
 * Legacy global Edit mode in the sidebar assistant.
 * Off by default — chart/equation Ask AI is the supported edit path.
 * Enable only with VITE_NOTEBOOK_ASSISTANT_EDIT=1 (or true) for internal/dev use.
 */
export function isNotebookAssistantGlobalEditEnabled(): boolean {
  if (globalEditEnabledOverride != null) {
    return globalEditEnabledOverride;
  }
  const flag = (import.meta.env.VITE_NOTEBOOK_ASSISTANT_EDIT ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}
