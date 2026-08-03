import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SimulationResult } from "@sfcr/core";

import { useInspectorVariableHistory } from "../hooks/useInspectorVariableHistory";
import { isSameInspectorContext, type VariableInspectRequest } from "../lib/variableInspect";
import {
  addMatrixGraphChartSeries,
  appendEmptyFreeformMatrixGraphChart,
  applyMatrixGraphRequest,
  createEmptyFreeformMatrixGraphChart,
  createFreeformMatrixGraphChart,
  moveMatrixGraphChartSeries,
  removeMatrixGraphChart,
  removeMatrixGraphChartSeries,
  resolveDefaultGraphSourceRunCellId,
  toggleMatrixGraphChartLegendMode,
  toggleMatrixGraphChartPin,
  type MatrixGraphChartEntry
} from "../notebook/matrixGraphRailState";
import {
  collectMatrixGraphSliceSeries,
  resolveMatrixGraphSeriesEntryToAdd,
  type MatrixGraphRequest
} from "../notebook/matrixSliceGraph";
import type { MatrixCell } from "../notebook/types";
import {
  buildNotebookVariableDescriptions,
  buildNotebookVariableUnitMetadata
} from "../notebook/notebookAppHelpers";
import { useNotebookRunner } from "../notebook/useNotebookRunner";
import { PeriodScrubber } from "../components/PeriodScrubber";
import { type MatrixEntryDisplayMode } from "../notebook/matrixEntryDisplay";
import {
  buildPublicationViewModel,
  buildPublicationContentsEntries,
  PUBLICATION_APPENDIX_ANCHOR_ID
} from "./buildPublicationViewModel";
import { PublicationCellView } from "./PublicationCellView";
import { PublicationContents } from "./PublicationContents";
import { PublicationActionLinks } from "./PublicationActionLinks";
import type { PublicationRouteLocation } from "./publicationRouteHelpers";
import {
  buildPublicationPathname,
  buildPublicationPathnameFromRoute,
  isBarePublishPathname,
  resolveInteractiveNotebookHref
} from "./publicationRouteHelpers";
import { PublicationNotebookPicker } from "./PublicationNotebookPicker";
import { DEFAULT_NOTEBOOK_TEMPLATE_ID } from "../notebook/templates";
import {
  buildPublicationInspectRequest,
  mergePublicationVariableInteraction,
  resolvePublicationInspectContext
} from "./publicationInspect";
import { buildPublicationVariableDescriptions } from "./publicationVariables";
import { PublicationVariableInspectorPopup } from "./PublicationVariableInspectorPopup";
import { PublicationMatrixGraphPopup } from "./PublicationMatrixGraphPopup";
import {
  hasNotebookShareInLocation,
  resolveNotebookShareLinkToCopy
} from "../notebook/notebookShareLink";
import {
  readPublicationLiveReturnUrl,
  readPublicationLiveSession
} from "./publicationLiveSession";
import { buildPublicationShareUrl } from "./publicationShareLink";
import type { PublicationShareResult } from "./PublicationActionLinks";
import {
  resolveInitialPublicationDocument,
  resolvePublicationTemplateId,
  subscribeLivePublicationDocument
} from "./resolvePublicationDocument";
import "../styles/partials/publication.css";

const PUBLICATION_WIDE_WIDTH_STORAGE_KEY = "sfcr.publication.wideWidth";

function readPublicationWideWidthPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PUBLICATION_WIDE_WIDTH_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePublicationWideWidthPreference(wideWidth: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PUBLICATION_WIDE_WIDTH_STORAGE_KEY, wideWidth ? "1" : "0");
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.closest("input, textarea, select, [contenteditable='true'], .cm-editor") != null;
}

function resolveMaxPeriodIndex(
  getResult: (cellId: string) => SimulationResult | null,
  runCellIds: string[]
): number {
  let max = 0;

  for (const cellId of runCellIds) {
    const result = getResult(cellId);
    if (!result) {
      continue;
    }

    const lengths = Object.values(result.series).map((values) => values.length);
    const periods = result.options.periods ?? (lengths.length > 0 ? Math.max(...lengths) : 0);
    max = Math.max(max, Math.max(periods - 1, 0));
  }

  return max;
}

export function PublicationNotebookApp({ route }: { route: PublicationRouteLocation }) {
  const initialPublication = useMemo(() => resolveInitialPublicationDocument(route), [route]);
  const [notebookDocument, setNotebookDocument] = useState(initialPublication.document);
  const [liveSessionMissing, setLiveSessionMissing] = useState(initialPublication.liveSessionMissing);
  const [documentRevision, setDocumentRevision] = useState<number | null>(null);
  const runner = useNotebookRunner(notebookDocument);
  const [runPhase, setRunPhase] = useState<"pending" | "running" | "done">("pending");
  const [inspectorContext, setInspectorContext] = useState<VariableInspectRequest | null>(null);
  const inspectorHistory = useInspectorVariableHistory();
  const [matrixGraphCharts, setMatrixGraphCharts] = useState<MatrixGraphChartEntry[]>([]);
  const [matrixGraphOpen, setMatrixGraphOpen] = useState(false);
  const matrixGraphChartIdRef = useRef(0);
  const [periodOverride, setPeriodOverride] = useState<number | null>(null);
  const [matrixEntryDisplayModes, setMatrixEntryDisplayModes] = useState<
    Record<string, MatrixEntryDisplayMode>
  >({});
  const [wideWidth, setWideWidth] = useState<boolean>(readPublicationWideWidthPreference);

  const publicationTemplateId = useMemo(
    () => resolvePublicationTemplateId(notebookDocument),
    [notebookDocument]
  );

  useEffect(() => {
    const next = resolveInitialPublicationDocument(route);
    setNotebookDocument(next.document);
    setLiveSessionMissing(next.liveSessionMissing);
    setDocumentRevision((previous) =>
      route.source === "live"
        ? (readPublicationLiveSession()?.revision ?? 0)
        : (previous ?? -1) + 1
    );
  }, [route]);

  useEffect(() => {
    if (route.mode !== "publish" || typeof window === "undefined") {
      return;
    }
    // Only canonicalize true bare landings — not Pages hash rewrites that still
    // carry `#/publish/<id>` before migration (or if migration was skipped).
    if (!isBarePublishPathname(window.location.pathname)) {
      return;
    }
    if (window.location.hash.startsWith("#/publish") || hasNotebookShareInLocation()) {
      return;
    }

    const canonical = buildPublicationPathname({
      mode: "publish",
      templateId: DEFAULT_NOTEBOOK_TEMPLATE_ID
    });
    window.history.replaceState(window.history.state, "", canonical);
  }, [route.mode]);

  useEffect(() => {
    if (route.source !== "live") {
      return;
    }

    // When the document came from a shared nbz link we are viewing a static
    // snapshot, so we must not let the local live session overwrite it.
    if (typeof window !== "undefined" && hasNotebookShareInLocation()) {
      return;
    }

    return subscribeLivePublicationDocument((document) => {
      setNotebookDocument(document);
      setLiveSessionMissing(false);
      setDocumentRevision((current) => (current ?? -1) + 1);
    });
  }, [route.source]);

  useEffect(() => {
    writePublicationWideWidthPreference(wideWidth);
  }, [wideWidth]);

  const viewModel = useMemo(
    () =>
      buildPublicationViewModel({
        document: notebookDocument,
        templateId: publicationTemplateId,
        mode: route.mode,
        embedCellId: route.embedCellId
      }),
    [notebookDocument, publicationTemplateId, route.embedCellId, route.mode]
  );

  const runCellIds = useMemo(
    () => notebookDocument.cells.filter((cell) => cell.type === "run").map((cell) => cell.id),
    [notebookDocument]
  );

  useEffect(() => {
    if (documentRevision === null) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setRunPhase("running");
      await runner.runAll();
      if (!cancelled) {
        setRunPhase("done");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentRevision]);

  useEffect(() => {
    function handleRunAllShortcut(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "r") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (runPhase === "running") {
        return;
      }

      event.preventDefault();
      setRunPhase("running");
      void (async () => {
        await runner.runAll();
        setRunPhase("done");
      })();
    }

    window.addEventListener("keydown", handleRunAllShortcut);
    return () => window.removeEventListener("keydown", handleRunAllShortcut);
  }, [runPhase, runner]);

  const maxPeriodIndex = useMemo(
    () => resolveMaxPeriodIndex(runner.getResult, runCellIds),
    [runCellIds, runner, runPhase]
  );

  // `periodOverride` of null means "follow the final period" (the historical default);
  // once the reader scrubs, we honour their choice clamped to the available range.
  const selectedPeriodIndex =
    periodOverride == null ? maxPeriodIndex : Math.min(periodOverride, maxPeriodIndex);

  const variableDescriptions = useMemo(
    () => buildPublicationVariableDescriptions(notebookDocument.cells),
    [notebookDocument]
  );

  const variableUnitMetadata = useMemo(
    () => buildNotebookVariableUnitMetadata(notebookDocument.cells),
    [notebookDocument]
  );

  const highlightedVariable = inspectorContext?.selectedVariable ?? null;

  const handleInspectRequest = useCallback(
    (request: VariableInspectRequest) => {
      if (inspectorContext && isSameInspectorContext(inspectorContext, request)) {
        inspectorHistory.push(request.selectedVariable);
      } else {
        inspectorHistory.reset(request.selectedVariable);
      }
      setInspectorContext(request);
    },
    [inspectorContext, inspectorHistory]
  );

  const buildCellInteraction = useCallback(
    (cell: (typeof notebookDocument.cells)[number]) => {
      const inspectContext =
        runPhase === "done"
          ? resolvePublicationInspectContext({
              cell,
              document: notebookDocument,
              getResult: runner.getResult,
              selectedPeriodIndex
            })
          : null;

      return mergePublicationVariableInteraction({
        descriptions: variableDescriptions,
        unitMetadata: variableUnitMetadata,
        inspectContext,
        highlightedVariable,
        onInspectVariable: inspectContext
          ? (selectedVariable) => {
              handleInspectRequest(
                buildPublicationInspectRequest({
                  context: inspectContext,
                  document: notebookDocument,
                  selectedVariable
                })
              );
            }
          : undefined
      });
    },
    [
      handleInspectRequest,
      highlightedVariable,
      notebookDocument,
      runPhase,
      runner.getResult,
      selectedPeriodIndex,
      variableDescriptions,
      variableUnitMetadata
    ]
  );

  const handleInspectorSelectVariable = useCallback(
    (selectedVariable: string) => {
      if (!inspectorContext) {
        return;
      }

      handleInspectRequest({ ...inspectorContext, selectedVariable });
    },
    [handleInspectRequest, inspectorContext]
  );

  const handleInspectorGoBack = useCallback(() => {
    const variableName = inspectorHistory.goBack();
    if (variableName && inspectorContext) {
      setInspectorContext({ ...inspectorContext, selectedVariable: variableName });
    }
  }, [inspectorContext, inspectorHistory]);

  const handleInspectorGoForward = useCallback(() => {
    const variableName = inspectorHistory.goForward();
    if (variableName && inspectorContext) {
      setInspectorContext({ ...inspectorContext, selectedVariable: variableName });
    }
  }, [inspectorContext, inspectorHistory]);

  const handleCloseInspector = useCallback(() => {
    setInspectorContext(null);
  }, []);

  const handleInspectorNavigateToVariable = useCallback(
    (cellId: string, variableName?: string | null) => {
      const trimmedVariable = variableName?.trim() ?? "";
      const escapeSelector =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape
          : (value: string) => value.replace(/["\\]/g, "\\$&");

      let attempts = 0;
      const tryScroll = () => {
        const cell = window.document.getElementById(cellId);
        if (cell) {
          const target =
            (trimmedVariable
              ? cell.querySelector<HTMLElement>(
                  `[data-variable="${escapeSelector(trimmedVariable)}"]`
                )
              : null) ?? cell.querySelector<HTMLElement>(".is-document-highlighted");
          if (target) {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
            target.classList.add("is-nav-flash");
            window.setTimeout(() => target.classList.remove("is-nav-flash"), 1400);
            return;
          }
          cell.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        if (attempts >= 16) {
          return;
        }
        attempts += 1;
        requestAnimationFrame(tryScroll);
      };

      requestAnimationFrame(tryScroll);
    },
    []
  );

  const handleMatrixGraphRequest = useCallback((request: MatrixGraphRequest) => {
    setMatrixGraphOpen(true);
    setMatrixGraphCharts((current) =>
      applyMatrixGraphRequest(current, request, () => {
        matrixGraphChartIdRef.current += 1;
        return `publication-matrix-graph-${matrixGraphChartIdRef.current}`;
      })
    );
  }, []);

  const handleOpenMatrixGraph = useCallback(() => {
    setMatrixGraphOpen(true);
  }, []);

  const handleToggleMatrixGraphChartPin = useCallback((chartId: string) => {
    setMatrixGraphCharts((current) => toggleMatrixGraphChartPin(current, chartId));
  }, []);

  const handleToggleMatrixGraphChartLegendMode = useCallback((chartId: string) => {
    setMatrixGraphCharts((current) => toggleMatrixGraphChartLegendMode(current, chartId));
  }, []);

  const handleDismissMatrixGraphChart = useCallback((chartId: string) => {
    setMatrixGraphCharts((current) => removeMatrixGraphChart(current, chartId));
  }, []);

  const handleAddMatrixGraphChartSeries = useCallback(
    (chartId: string, source: string) => {
      setMatrixGraphCharts((charts) => {
        const chart = charts.find((entry) => entry.id === chartId);
        if (!chart) {
          return charts;
        }

        const matrixCell = notebookDocument.cells.find(
          (cell): cell is MatrixCell => cell.type === "matrix" && cell.id === chart.matrixCellId
        );
        const result = runner.getResult(chart.sourceRunCellId);
        if (!result) {
          return charts;
        }

        const sliceSeries = matrixCell
          ? collectMatrixGraphSliceSeries(matrixCell, chart.kind, chart.index, result)
          : [];
        const entry = resolveMatrixGraphSeriesEntryToAdd(
          source,
          sliceSeries,
          result,
          chart.variableDescriptions
        );
        if (!entry) {
          return charts;
        }

        return addMatrixGraphChartSeries(charts, chartId, entry);
      });
    },
    [notebookDocument, runner]
  );

  const handleCreateMatrixGraphFromVariable = useCallback(
    (source: string) => {
      setMatrixGraphCharts((current) => {
        if (current.length > 0) {
          return current;
        }

        const sourceRunCellId = resolveDefaultGraphSourceRunCellId(
          notebookDocument.cells,
          (runCellId) => runner.getResult(runCellId)
        );
        if (!sourceRunCellId) {
          return current;
        }

        const result = runner.getResult(sourceRunCellId);
        if (!result) {
          return current;
        }

        const variableDescriptions = buildNotebookVariableDescriptions(notebookDocument.cells);
        const entry = resolveMatrixGraphSeriesEntryToAdd(source, [], result, variableDescriptions);
        if (!entry) {
          return current;
        }

        matrixGraphChartIdRef.current += 1;
        return [
          createFreeformMatrixGraphChart({
            createId: () => `publication-matrix-graph-${matrixGraphChartIdRef.current}`,
            seriesEntry: entry,
            sourceRunCellId,
            variableDescriptions,
            variableUnitMetadata: buildNotebookVariableUnitMetadata(notebookDocument.cells)
          })
        ];
      });
      setMatrixGraphOpen(true);
    },
    [notebookDocument, runner]
  );

  const handleCreateEmptyMatrixGraphChart = useCallback(() => {
    setMatrixGraphCharts((current) => {
      const sourceRunCellId = resolveDefaultGraphSourceRunCellId(
        notebookDocument.cells,
        (runCellId) => runner.getResult(runCellId)
      );
      if (!sourceRunCellId) {
        return current;
      }

      const result = runner.getResult(sourceRunCellId);
      if (!result) {
        return current;
      }

      return appendEmptyFreeformMatrixGraphChart(current, () => {
        matrixGraphChartIdRef.current += 1;
        return createEmptyFreeformMatrixGraphChart({
          createId: () => `publication-matrix-graph-${matrixGraphChartIdRef.current}`,
          sourceRunCellId,
          variableDescriptions: buildNotebookVariableDescriptions(notebookDocument.cells),
          variableUnitMetadata: buildNotebookVariableUnitMetadata(notebookDocument.cells)
        });
      });
    });
    setMatrixGraphOpen(true);
  }, [notebookDocument, runner]);

  const handleRemoveMatrixGraphChartSeries = useCallback((chartId: string, source: string) => {
    setMatrixGraphCharts((current) => removeMatrixGraphChartSeries(current, chartId, source));
  }, []);

  const handleMoveMatrixGraphChartSeries = useCallback(
    (chartId: string, source: string, direction: "left" | "right") => {
      setMatrixGraphCharts((current) =>
        moveMatrixGraphChartSeries(current, chartId, source, direction)
      );
    },
    []
  );

  const handleCloseMatrixGraph = useCallback(() => {
    setMatrixGraphOpen(false);
    setMatrixGraphCharts([]);
  }, []);

  const handleMatrixEntryDisplayModeChange = useCallback(
    (cellId: string, mode: MatrixEntryDisplayMode) => {
      setMatrixEntryDisplayModes((current) => ({ ...current, [cellId]: mode }));
    },
    []
  );

  const handleSharePublication = useCallback(async (): Promise<PublicationShareResult> => {
    const result = buildPublicationShareUrl({
      document: notebookDocument,
      origin: window.location.origin,
      cellId: route.cellId
    });
    if ("error" in result) {
      return { ok: false, message: result.error };
    }

    const shareLink = await resolveNotebookShareLinkToCopy(result.url);
    const linkLengthLabel = shareLink.url.length.toLocaleString();

    try {
      await navigator.clipboard.writeText(shareLink.url);
      return {
        ok: true,
        message: shareLink.shortened
          ? `Copied short publish share link (${linkLengthLabel} characters).`
          : `Copied publish share link (${linkLengthLabel} characters).`
      };
    } catch {
      return { ok: false, message: "Could not copy share link to the clipboard." };
    }
  }, [notebookDocument, route.cellId]);

  useEffect(() => {
    if (route.mode === "embed" || !route.cellId || runPhase !== "done") {
      return;
    }

    const target = window.document.getElementById(route.cellId);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [route.cellId, route.mode, runPhase]);

  const interactiveNotebookHref = resolveInteractiveNotebookHref({
    source: route.source,
    templateId: publicationTemplateId,
    liveReturnUrl: readPublicationLiveReturnUrl()
  });
  const printHref = buildPublicationPathnameFromRoute({
    route: { mode: "print", source: route.source, templateId: route.templateId },
    cellId: route.cellId ?? undefined
  });
  const isEmbed = route.mode === "embed";
  const isPrint = route.mode === "print";
  const embedMissingCell = isEmbed && !route.embedCellId;
  const embedUnknownCell = isEmbed && route.embedCellId && viewModel.bodySections.length === 0;

  useEffect(() => {
    if (isEmbed) {
      return;
    }

    function handleRunViewShortcut(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "p") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      window.location.assign(interactiveNotebookHref);
    }

    window.addEventListener("keydown", handleRunViewShortcut);
    return () => window.removeEventListener("keydown", handleRunViewShortcut);
  }, [interactiveNotebookHref, isEmbed]);

  const contentsEntries = useMemo(
    () =>
      buildPublicationContentsEntries(viewModel.bodySections, viewModel.appendixSections),
    [viewModel.appendixSections, viewModel.bodySections]
  );
  const showCatalog = route.mode === "publish";
  const showContents = !isEmbed && (contentsEntries.length > 1 || showCatalog);

  const showScrubber = maxPeriodIndex > 0;
  const showWidthToggle = !isEmbed && !isPrint;
  const showControls = runPhase === "done" && !isPrint && (showScrubber || showWidthToggle);

  const controlsBar = showControls ? (
    <div className="publication-controls publication-no-print">
      {showScrubber ? (
        <PeriodScrubber
          maxIndex={maxPeriodIndex}
          onChange={setPeriodOverride}
          selectedIndex={selectedPeriodIndex}
        />
      ) : null}
      {showWidthToggle ? (
        <button
          type="button"
          className="publication-width-toggle"
          aria-pressed={wideWidth}
          title={wideWidth ? "Switch to standard width" : "Switch to wide width"}
          onClick={() => setWideWidth((current) => !current)}
        >
          {wideWidth ? "Standard width" : "Wide width"}
        </button>
      ) : null}
    </div>
  ) : null;

  const mainContent = (
    <>
      {liveSessionMissing ? (
        <p className="publication-status-hint">
          Live publication snapshot is unavailable. Open publication view from the interactive notebook
          to mirror your current edits.
        </p>
      ) : null}
      {embedMissingCell ? (
        <p className="publication-status-hint">
          Embed URL requires a <code>?cell=</code> query parameter naming a notebook cell id.
        </p>
      ) : null}
      {embedUnknownCell ? (
        <p className="publication-status-hint">
          No embeddable cell found for id <code>{route.embedCellId}</code>.
        </p>
      ) : null}

      {controlsBar}

      {viewModel.bodySections.map((section) => (
        <PublicationCellView
          key={section.anchorId}
          cells={notebookDocument.cells}
          getResult={runner.getResult}
          interaction={buildCellInteraction(section.cell)}
          interactiveCharts={runPhase === "done" && !isPrint}
          matrixEntryDisplayMode={matrixEntryDisplayModes[section.cell.id] ?? "equation"}
          onMatrixEntryDisplayModeChange={(mode) =>
            handleMatrixEntryDisplayModeChange(section.cell.id, mode)
          }
          onRequestMatrixGraph={runPhase === "done" ? handleMatrixGraphRequest : undefined}
          originYear={notebookDocument.metadata.timeAxis?.startYear}
          section={section}
          selectedPeriodIndex={selectedPeriodIndex}
          showHeading={!isEmbed}
        />
      ))}

      {!isEmbed && viewModel.appendixSections.length > 0 ? (
        <section
          id={PUBLICATION_APPENDIX_ANCHOR_ID}
          className="publication-appendix publication-page-break-before"
        >
          <h2 className="publication-appendix-title">Appendix</h2>
          {viewModel.appendixSections.map((section) => (
            <PublicationCellView
              key={section.anchorId}
              cells={notebookDocument.cells}
              getResult={runner.getResult}
              interaction={buildCellInteraction(section.cell)}
              interactiveCharts={runPhase === "done" && !isPrint}
              matrixEntryDisplayMode={matrixEntryDisplayModes[section.cell.id] ?? "equation"}
              onMatrixEntryDisplayModeChange={(mode) =>
                handleMatrixEntryDisplayModeChange(section.cell.id, mode)
              }
              onRequestMatrixGraph={runPhase === "done" ? handleMatrixGraphRequest : undefined}
              originYear={notebookDocument.metadata.timeAxis?.startYear}
              section={section}
              selectedPeriodIndex={selectedPeriodIndex}
            />
          ))}
        </section>
      ) : null}
    </>
  );
  return (
    <div
      className={`publication-root publication-mode-${route.mode}${
        runPhase !== "done" ? " publication-is-loading" : ""
      }${wideWidth ? " publication-root-wide" : ""}`}
    >
      {!isEmbed ? (
        <header className="publication-header publication-no-print">
          <p className="publication-eyebrow">MoneyJS publication</p>
          <h1 className="publication-title">{viewModel.title}</h1>
          {showCatalog ? (
            <PublicationNotebookPicker id="publication-notebook-picker-header" route={route} />
          ) : null}
          {runPhase === "running" ? (
            <p className="publication-status">Running simulations…</p>
          ) : null}
        </header>
      ) : null}

      {isEmbed ? (
        <main className="publication-main publication-main-embed">{mainContent}</main>
      ) : (
        <div className="publication-page-shell">
          <div className={`publication-layout${showContents ? " publication-layout-with-contents" : ""}`}>
            <main className="publication-main">{mainContent}</main>
            {showContents ? (
              <PublicationContents
                activeAnchorId={route.cellId}
                entries={contentsEntries}
                interactiveNotebookHref={interactiveNotebookHref}
                isPrint={isPrint}
                onOpenGraph={runPhase === "done" && !isPrint ? handleOpenMatrixGraph : undefined}
                onShare={handleSharePublication}
                route={route}
                printHref={printHref}
                showCatalog={showCatalog}
              />
            ) : null}
          </div>
        </div>
      )}

      {!isEmbed ? (
        <footer className="publication-footer publication-no-print">
          <PublicationActionLinks
            interactiveNotebookHref={interactiveNotebookHref}
            isPrint={isPrint}
            onOpenGraph={runPhase === "done" && !isPrint ? handleOpenMatrixGraph : undefined}
            onShare={handleSharePublication}
            printHref={printHref}
            variant="footer"
          />
        </footer>
      ) : null}

      {inspectorContext ? (
        <PublicationVariableInspectorPopup
          canGoBack={inspectorHistory.canGoBack}
          canGoForward={inspectorHistory.canGoForward}
          getResult={runner.getResult}
          inspectorContext={inspectorContext}
          notebookDocument={notebookDocument}
          onClose={handleCloseInspector}
          onGoBack={handleInspectorGoBack}
          onGoForward={handleInspectorGoForward}
          onNavigateToVariable={handleInspectorNavigateToVariable}
          onSelectVariable={handleInspectorSelectVariable}
          selectedPeriodIndex={selectedPeriodIndex}
        />
      ) : null}

      {matrixGraphOpen ? (
        <PublicationMatrixGraphPopup
          cells={notebookDocument.cells}
          charts={matrixGraphCharts}
          getResult={runner.getResult}
          onAddChartSeries={handleAddMatrixGraphChartSeries}
          onClose={handleCloseMatrixGraph}
          onCreateChartFromVariable={handleCreateMatrixGraphFromVariable}
          onCreateEmptyChart={handleCreateEmptyMatrixGraphChart}
          onDismissChart={handleDismissMatrixGraphChart}
          onMoveChartSeries={handleMoveMatrixGraphChartSeries}
          onRemoveChartSeries={handleRemoveMatrixGraphChartSeries}
          onToggleChartLegendMode={handleToggleMatrixGraphChartLegendMode}
          onToggleChartPin={handleToggleMatrixGraphChartPin}
          selectedPeriodIndex={selectedPeriodIndex}
        />
      ) : null}
    </div>
  );
}
