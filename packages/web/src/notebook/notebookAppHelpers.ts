import { buildVariableDescriptions, type VariableDescriptions } from "../lib/variableDescriptions";
import { buildVariableUnitMetadata } from "../lib/units";
import type { VariableUnitMetadata } from "../lib/unitMeta";
import {
  DEFAULT_NOTEBOOK_TEMPLATE_ID,
  isNotebookTemplateId,
  type NotebookTemplateId
} from "./templates";
import { hasNotebookShareInLocation } from "./notebookShareLink";
import type { NotebookCell } from "./types";
import { buildAbmVariableDescriptions, buildEditorStateFromAbmModelCell } from "./abmInspect";

const APP_BASE_URL = import.meta.env.BASE_URL;

export const NOTEBOOK_AI_LANDING_URL = resolveAppHref("ai/index.html");
export const NOTEBOOK_AI_GUIDE_URL = resolveAppHref("notebook-guide.md");

export interface NotebookRouteLocation {
  templateId: NotebookTemplateId | null;
  variantId: string | null;
  cellId: string | null;
}

export function buildNotebookVariableDescriptions(cells: NotebookCell[]): VariableDescriptions {
  const descriptions: VariableDescriptions = new Map();

  for (const cell of cells) {
    const nextDescriptions =
      cell.type === "model"
        ? buildVariableDescriptions({
            equations: cell.editor.equations,
            externals: cell.editor.externals
          })
        : cell.type === "equations"
          ? buildVariableDescriptions({ equations: cell.equations })
          : cell.type === "externals"
            ? buildVariableDescriptions({ externals: cell.externals })
            : cell.type === "abm-model"
              ? buildAbmVariableDescriptions(cell)
              : null;

    for (const [name, description] of nextDescriptions ?? []) {
      if (!descriptions.has(name)) {
        descriptions.set(name, description);
      }
    }
  }

  return descriptions;
}

export function buildNotebookVariableUnitMetadata(cells: NotebookCell[]): VariableUnitMetadata {
  const metadata: VariableUnitMetadata = new Map();

  for (const cell of cells) {
    const nextMetadata =
      cell.type === "model"
        ? buildVariableUnitMetadata({
            equations: cell.editor.equations,
            externals: cell.editor.externals
          })
        : cell.type === "equations"
          ? buildVariableUnitMetadata({ equations: cell.equations })
          : cell.type === "externals"
            ? buildVariableUnitMetadata({ externals: cell.externals })
            : cell.type === "abm-model"
              ? (() => {
                  const editor = buildEditorStateFromAbmModelCell(cell);
                  return buildVariableUnitMetadata({
                    equations: editor.equations,
                    externals: editor.externals
                  });
                })()
              : null;

    for (const [name, unitMeta] of nextMetadata ?? []) {
      if (!metadata.has(name)) {
        metadata.set(name, unitMeta);
      }
    }
  }

  return metadata;
}

export function formatElapsedTime(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}

function stripAppBasePath(pathname: string): string {
  const base = APP_BASE_URL.replace(/\/$/, "");
  if (!base || base === "/") {
    return pathname;
  }

  if (pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }

  return pathname;
}

export function parseNotebookPathname(pathname: string): NotebookRouteLocation | null {
  const path = stripAppBasePath(pathname);
  if (!path.startsWith("/notebook")) {
    return null;
  }

  const variantMatch = path.match(/^\/notebook\/variant\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (variantMatch) {
    return {
      templateId: null,
      variantId: variantMatch[1],
      cellId: variantMatch[2] ?? null
    };
  }

  if (path === "/notebook" || path === "/notebook/") {
    return {
      templateId: null,
      variantId: null,
      cellId: null
    };
  }

  const templateMatch = path.match(/^\/notebook\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!templateMatch) {
    return null;
  }

  const candidate = templateMatch[1].trim();
  if (!isNotebookTemplateId(candidate)) {
    return null;
  }

  return {
    templateId: candidate,
    variantId: null,
    cellId: templateMatch[2] ?? null
  };
}

export function readNotebookRouteLocation(): NotebookRouteLocation {
  const fromPath = parseNotebookPathname(window.location.pathname);
  if (fromPath) {
    return fromPath;
  }

  return {
    templateId: parseNotebookTemplateIdFromHash(window.location.hash),
    variantId: parseNotebookVariantIdFromHash(window.location.hash),
    cellId: parseNotebookCellIdFromHash(window.location.hash)
  };
}

export function resolveNotebookTemplateIdFromLocation(
  location: NotebookRouteLocation
): NotebookTemplateId {
  return location.templateId ?? DEFAULT_NOTEBOOK_TEMPLATE_ID;
}

export function parseNotebookTemplateIdFromHash(hash: string): NotebookTemplateId | null {
  const variantMatch = hash.match(/^#\/notebook\/variant\/([^/?#]+)/);
  if (variantMatch?.[1]) {
    return null;
  }

  const match = hash.match(/^#\/notebook\/([^/?#]+)/);
  const candidate = match?.[1]?.trim();
  return candidate && isNotebookTemplateId(candidate) ? candidate : null;
}

export function parseNotebookVariantIdFromHash(hash: string): string | null {
  const match = hash.match(/^#\/notebook\/variant\/([^/?#]+)/);
  const candidate = match?.[1]?.trim();
  return candidate || null;
}

export function parseNotebookCellIdFromHash(hash: string): string | null {
  const variantMatch = hash.match(/^#\/notebook\/variant\/[^/?#]+\/([^/?#]+)/);
  if (variantMatch?.[1]) {
    return variantMatch[1].trim() || null;
  }

  const templateMatch = hash.match(/^#\/notebook\/[^/?#]+\/([^/?#]+)/);
  if (templateMatch?.[1] && !hash.startsWith("#/notebook/variant/")) {
    return templateMatch[1].trim() || null;
  }

  // Legacy links used a second hash fragment: #/notebook/bmw#transaction-flow-sequence
  const fragments = hash.split("#").map((fragment) => fragment.trim());
  if (fragments.length < 3) {
    return null;
  }

  const cellId = fragments.at(-1);
  return cellId || null;
}

export function buildNotebookPathname(args: {
  templateId?: NotebookTemplateId;
  variantId?: string;
  cellId?: string;
}): string {
  const base = APP_BASE_URL.replace(/\/$/, "");
  const route = args.variantId
    ? `/notebook/variant/${args.variantId}`
    : args.templateId
      ? `/notebook/${args.templateId}`
      : "/notebook";
  const path = args.cellId ? `${route}/${args.cellId}` : route;
  return base ? `${base}${path}` : path;
}

/** Path (+ search) for returning from publish live view to the interactive editor. */
export function buildNotebookReturnUrl(args?: {
  templateId?: NotebookTemplateId | null;
  variantId?: string | null;
  cellId?: string | null;
}): string {
  const location = args ?? readNotebookRouteLocation();
  const pathname = buildNotebookPathname({
    templateId: location.templateId ?? undefined,
    variantId: location.variantId ?? undefined,
    cellId: location.cellId ?? undefined
  });
  return `${pathname}${window.location.search}`;
}

/** @deprecated Prefer buildNotebookPathname. Kept for tests comparing legacy hash URLs. */
export function buildNotebookHash(args: {
  templateId?: NotebookTemplateId;
  variantId?: string;
  cellId?: string;
}): string {
  const base = args.variantId
    ? `#/notebook/variant/${args.variantId}`
    : args.templateId
      ? `#/notebook/${args.templateId}`
      : "#/notebook";
  return args.cellId ? `${base}/${args.cellId}` : base;
}

export function writeNotebookLocation(args: {
  templateId?: NotebookTemplateId;
  variantId?: string;
  cellId?: string;
}): void {
  const nextPathname = buildNotebookPathname(args);
  const nextUrl = `${nextPathname}${window.location.search}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (currentUrl !== nextUrl || window.location.hash) {
    history.replaceState(history.state, "", nextUrl);
  }
}

export function migrateNotebookHashToPathname(): void {
  const hash = window.location.hash;
  if (
    !hash.startsWith("#/notebook") ||
    parseNotebookPathname(window.location.pathname) ||
    hasNotebookShareInLocation()
  ) {
    return;
  }

  writeNotebookLocation({
    templateId: parseNotebookTemplateIdFromHash(hash) ?? undefined,
    variantId: parseNotebookVariantIdFromHash(hash) ?? undefined,
    cellId: parseNotebookCellIdFromHash(hash) ?? undefined
  });
}

export function writeNotebookVariantHash(variantId: string, cellId?: string): void {
  writeNotebookLocation({ variantId, cellId });
}

export function restoreNotebookRouteLocation(location: NotebookRouteLocation): void {
  if (location.variantId) {
    writeNotebookLocation({
      variantId: location.variantId,
      cellId: location.cellId ?? undefined
    });
    return;
  }

  writeNotebookLocation({
    templateId: location.templateId ?? undefined,
    cellId: location.cellId ?? undefined
  });
}

const NOTEBOOK_NAVIGATION_LOAD_LABELS = new Set([
  "imported notebook load",
  "template load",
  "variant create",
  "variant load",
  "variant route load",
  "variant save"
]);

export function isNotebookNavigationLoadLabel(label: string): boolean {
  return NOTEBOOK_NAVIGATION_LOAD_LABELS.has(label);
}

export function notebookHasUnsavedChanges(args: {
  hasEditHistory: boolean;
  hasImportPreview: boolean;
  hasPendingImportTextChanges: boolean;
  isUnnamedNotebookSession: boolean;
  /** When true, journal edits are already persisted by version autosave. */
  hasAutosavedVersionSession?: boolean;
}): boolean {
  const hasUnsavedJournalEdits = args.hasEditHistory && !args.hasAutosavedVersionSession;
  return (
    args.isUnnamedNotebookSession ||
    args.hasPendingImportTextChanges ||
    args.hasImportPreview ||
    hasUnsavedJournalEdits
  );
}

function resolveAppHref(path: string): string {
  return `${APP_BASE_URL}${path.replace(/^\/+/, "")}`;
}
