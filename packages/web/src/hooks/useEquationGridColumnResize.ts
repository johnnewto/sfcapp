import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";

import {
  getEquationViewTrailingReservedWidthPx,
  type EquationViewColumnCollapseState
} from "./useEquationValueColumnsCollapse";

export const EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY = {
  embedded: "sfcr.equation-grid.variable-column-px.embedded",
  workspace: "sfcr.equation-grid.variable-column-px"
} as const;

export const EQUATION_GRID_EXPRESSION_WIDTH_STORAGE_KEY = {
  embedded: "sfcr.equation-grid.expression-column-px.embedded",
  workspace: "sfcr.equation-grid.expression-column-px"
} as const;

const DEFAULT_VARIABLE_WIDTH_PX = {
  embedded: 160,
  workspace: 140
} as const;

const DEFAULT_EXPRESSION_WIDTH_PX = {
  embedded: 280,
  workspace: 320
} as const;

const MIN_VARIABLE_WIDTH_PX = {
  embedded: 120,
  workspace: 110
} as const;

const MIN_EXPRESSION_WIDTH_PX = {
  embedded: 160,
  workspace: 160
} as const;

const MAX_VARIABLE_WIDTH_PX = {
  embedded: 280,
  workspace: 240
} as const;

const MAX_EXPRESSION_WIDTH_PX = {
  embedded: 560,
  workspace: 640
} as const;

const MIN_TRAILING_WIDTH_PX = 160;
const EQUATION_VIEW_ROLE_WIDTH_PX = 68;
const MODEL_VIEW_CURRENT_WIDTH_PX = 120;
const MODEL_VIEW_KIND_WIDTH_PX = 110;
const MODEL_VIEW_STATUS_WIDTH_PX = 110;
const KEYBOARD_STEP_PX = 8;
const RESIZE_HANDLE_HALF_WIDTH_PX = 6;

export type ModelViewTableLayout = "equation-grid" | "equation-view" | "external-view" | "initial-view";
type EquationColumnResizeLayout = ModelViewTableLayout;
type ResizableEquationColumn = "variable" | "expression";

interface UseEquationGridColumnResizeOptions {
  isEmbedded?: boolean;
  layout?: EquationColumnResizeLayout;
  /** When set, all hook instances with the same group share live column widths. */
  syncGroup?: string;
  /** Override space reserved after the expression column when computing max widths. */
  trailingReservedWidthPx?: number;
  /** Override the static max expression column width. */
  maxExpressionWidthPx?: number;
  valueColumnCollapse?: EquationViewColumnCollapseState;
}

const EQUATION_GRID_COLUMN_WIDTH_SYNC_EVENT = "sfcr:equation-grid-column-widths";

interface EquationGridColumnWidthSyncDetail {
  expressionWidthPx: number;
  sourceId: string;
  syncGroup: string;
  variableWidthPx: number;
}

function layoutStorageSuffix(layout: EquationColumnResizeLayout): string {
  switch (layout) {
    case "equation-grid":
    case "equation-view":
      return "equation";
    case "external-view":
      return "external";
    case "initial-view":
      return "initial";
  }
}

function variableStorageKeyForLayout(layout: EquationColumnResizeLayout, isEmbedded: boolean): string {
  const suffix = layoutStorageSuffix(layout);
  return isEmbedded
    ? `sfcr.model-view.name-column-px.${suffix}.embedded`
    : `sfcr.model-view.name-column-px.${suffix}`;
}

function expressionStorageKeyForLayout(layout: EquationColumnResizeLayout, isEmbedded: boolean): string {
  const suffix = layoutStorageSuffix(layout);
  return isEmbedded
    ? `sfcr.model-view.value-column-px.${suffix}.embedded`
    : `sfcr.model-view.value-column-px.${suffix}`;
}

function legacyVariableStorageKey(isEmbedded: boolean): string {
  return isEmbedded
    ? EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY.embedded
    : EQUATION_GRID_VARIABLE_WIDTH_STORAGE_KEY.workspace;
}

function legacyExpressionStorageKey(isEmbedded: boolean): string {
  return isEmbedded
    ? EQUATION_GRID_EXPRESSION_WIDTH_STORAGE_KEY.embedded
    : EQUATION_GRID_EXPRESSION_WIDTH_STORAGE_KEY.workspace;
}

function getStoredWidthPx(storageKey: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue == null) {
      return fallback;
    }

    const parsedValue = Number.parseFloat(storedValue);
    if (!Number.isFinite(parsedValue)) {
      return fallback;
    }

    return parsedValue;
  } catch {
    return fallback;
  }
}

function clampWidthPx(nextWidth: number, minWidthPx: number, maxWidthPx: number) {
  return Math.min(Math.max(nextWidth, minWidthPx), maxWidthPx);
}

function getTrailingReservedWidthPx(
  layout: EquationColumnResizeLayout,
  valueColumnCollapse?: EquationViewColumnCollapseState,
  trailingReservedWidthPx?: number
) {
  if (trailingReservedWidthPx != null) {
    return trailingReservedWidthPx;
  }

  if (layout === "equation-view") {
    return getEquationViewTrailingReservedWidthPx(
      valueColumnCollapse ?? {
        initialCollapsed: false,
        currentCollapsed: false,
        gainCollapsed: false,
        roleCollapsed: false
      }
    );
  }

  if (layout === "external-view" || layout === "initial-view") {
    return (
      MODEL_VIEW_CURRENT_WIDTH_PX +
      (layout === "external-view" ? MODEL_VIEW_KIND_WIDTH_PX : MODEL_VIEW_STATUS_WIDTH_PX) +
      0.6 * 2 * 16 +
      0.75 * 16 +
      0.35 * 16
    );
  }

  return (
    72 +
    120 +
    34 +
    28 +
    18 +
    0.32 * 6 * 16 +
    0.24 * 2 * 16 +
    MIN_TRAILING_WIDTH_PX
  );
}

function getMaxColumnWidthPx(
  shellWidth: number,
  minWidthPx: number,
  staticMaxWidthPx: number,
  otherColumnWidthPx: number,
  layout: EquationColumnResizeLayout,
  valueColumnCollapse?: EquationViewColumnCollapseState,
  trailingReservedWidthPx?: number
) {
  if (shellWidth < 320) {
    return staticMaxWidthPx;
  }

  return Math.max(
    minWidthPx,
    shellWidth -
      otherColumnWidthPx -
      getTrailingReservedWidthPx(layout, valueColumnCollapse, trailingReservedWidthPx)
  );
}

function buildResizeHandleStyle(leftPx: number): CSSProperties {
  return {
    left: `${leftPx}px`
  };
}

export function useEquationGridColumnResize({
  isEmbedded = false,
  layout = "equation-grid",
  syncGroup,
  trailingReservedWidthPx,
  maxExpressionWidthPx: maxExpressionWidthPxOption,
  valueColumnCollapse
}: UseEquationGridColumnResizeOptions = {}) {
  const variableStorageKey =
    layout === "equation-grid" || layout === "equation-view"
      ? legacyVariableStorageKey(isEmbedded)
      : variableStorageKeyForLayout(layout, isEmbedded);
  const expressionStorageKey =
    layout === "equation-grid" || layout === "equation-view"
      ? legacyExpressionStorageKey(isEmbedded)
      : expressionStorageKeyForLayout(layout, isEmbedded);
  const defaultVariableWidthPx = isEmbedded
    ? DEFAULT_VARIABLE_WIDTH_PX.embedded
    : DEFAULT_VARIABLE_WIDTH_PX.workspace;
  const defaultExpressionWidthPx = isEmbedded
    ? DEFAULT_EXPRESSION_WIDTH_PX.embedded
    : DEFAULT_EXPRESSION_WIDTH_PX.workspace;
  const minVariableWidthPx = isEmbedded
    ? MIN_VARIABLE_WIDTH_PX.embedded
    : MIN_VARIABLE_WIDTH_PX.workspace;
  const minExpressionWidthPx = isEmbedded
    ? MIN_EXPRESSION_WIDTH_PX.embedded
    : MIN_EXPRESSION_WIDTH_PX.workspace;
  const staticMaxVariableWidthPx = isEmbedded
    ? MAX_VARIABLE_WIDTH_PX.embedded
    : MAX_VARIABLE_WIDTH_PX.workspace;
  const staticMaxExpressionWidthPx =
    maxExpressionWidthPxOption ??
    (isEmbedded ? MAX_EXPRESSION_WIDTH_PX.embedded : MAX_EXPRESSION_WIDTH_PX.workspace);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const variableHeaderRef = useRef<HTMLSpanElement | null>(null);
  const expressionHeaderRef = useRef<HTMLSpanElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const syncSourceIdRef = useRef(`eq-col-resize-${Math.random().toString(36).slice(2)}`);
  const suppressSyncBroadcastRef = useRef(false);
  const dragStateRef = useRef<{
    column: ResizableEquationColumn;
    startClientX: number;
    startWidthPx: number;
  } | null>(null);
  const [variableWidthPx, setVariableWidthPx] = useState(() =>
    getStoredWidthPx(variableStorageKey, defaultVariableWidthPx)
  );
  const [expressionWidthPx, setExpressionWidthPx] = useState(() =>
    getStoredWidthPx(expressionStorageKey, defaultExpressionWidthPx)
  );
  const [variableHandleLeftPx, setVariableHandleLeftPx] = useState(0);
  const [expressionHandleLeftPx, setExpressionHandleLeftPx] = useState(0);
  const [draggingColumn, setDraggingColumn] = useState<ResizableEquationColumn | null>(null);
  const [maxVariableWidthPx, setMaxVariableWidthPx] = useState<number>(staticMaxVariableWidthPx);
  const [maxExpressionWidthPx, setMaxExpressionWidthPx] = useState<number>(staticMaxExpressionWidthPx);

  const updateHandlePositions = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const variableHeader = variableHeaderRef.current;
    const expressionHeader = expressionHeaderRef.current;

    if (variableHeader) {
      setVariableHandleLeftPx(
        variableHeader.getBoundingClientRect().right -
          shellRect.left -
          RESIZE_HANDLE_HALF_WIDTH_PX
      );
    }

    if (expressionHeader) {
      setExpressionHandleLeftPx(
        expressionHeader.getBoundingClientRect().right -
          shellRect.left -
          RESIZE_HANDLE_HALF_WIDTH_PX
      );
    }
  }, []);

  const updateMaxWidths = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) {
      setMaxVariableWidthPx(staticMaxVariableWidthPx);
      setMaxExpressionWidthPx(staticMaxExpressionWidthPx);
      return;
    }

    const shellWidth = shell.getBoundingClientRect().width;
    setMaxVariableWidthPx(
      Math.min(
        staticMaxVariableWidthPx,
        getMaxColumnWidthPx(
          shellWidth,
          minVariableWidthPx,
          staticMaxVariableWidthPx,
          expressionWidthPx,
          layout,
          valueColumnCollapse,
          trailingReservedWidthPx
        )
      )
    );
    setMaxExpressionWidthPx(
      Math.min(
        staticMaxExpressionWidthPx,
        getMaxColumnWidthPx(
          shellWidth,
          minExpressionWidthPx,
          staticMaxExpressionWidthPx,
          variableWidthPx,
          layout,
          valueColumnCollapse,
          trailingReservedWidthPx
        )
      )
    );
  }, [
    expressionWidthPx,
    layout,
    minExpressionWidthPx,
    minVariableWidthPx,
    staticMaxExpressionWidthPx,
    staticMaxVariableWidthPx,
    trailingReservedWidthPx,
    valueColumnCollapse,
    variableWidthPx
  ]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    shell.style.setProperty("--eq-col-variable-width", `${variableWidthPx}px`);
    shell.style.setProperty("--eq-col-expression-width", `${expressionWidthPx}px`);
    updateHandlePositions();
    updateMaxWidths();
  }, [
    expressionWidthPx,
    updateHandlePositions,
    updateMaxWidths,
    variableWidthPx
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(variableStorageKey, String(variableWidthPx));
    } catch {
      // Ignore storage failures so resizing still works in restricted environments.
    }
  }, [variableStorageKey, variableWidthPx]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(expressionStorageKey, String(expressionWidthPx));
    } catch {
      // Ignore storage failures so resizing still works in restricted environments.
    }
  }, [expressionStorageKey, expressionWidthPx]);

  useEffect(() => {
    if (!syncGroup || typeof window === "undefined") {
      return;
    }

    if (suppressSyncBroadcastRef.current) {
      suppressSyncBroadcastRef.current = false;
      return;
    }

    const detail: EquationGridColumnWidthSyncDetail = {
      expressionWidthPx,
      sourceId: syncSourceIdRef.current,
      syncGroup,
      variableWidthPx
    };
    window.dispatchEvent(
      new CustomEvent<EquationGridColumnWidthSyncDetail>(EQUATION_GRID_COLUMN_WIDTH_SYNC_EVENT, {
        detail
      })
    );
  }, [expressionWidthPx, syncGroup, variableWidthPx]);

  useEffect(() => {
    if (!syncGroup || typeof window === "undefined") {
      return undefined;
    }

    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<EquationGridColumnWidthSyncDetail>).detail;
      if (!detail || detail.syncGroup !== syncGroup || detail.sourceId === syncSourceIdRef.current) {
        return;
      }

      setVariableWidthPx((current) => {
        if (current === detail.variableWidthPx) {
          return current;
        }
        suppressSyncBroadcastRef.current = true;
        return detail.variableWidthPx;
      });
      setExpressionWidthPx((current) => {
        if (current === detail.expressionWidthPx) {
          return current;
        }
        suppressSyncBroadcastRef.current = true;
        return detail.expressionWidthPx;
      });
    };

    window.addEventListener(EQUATION_GRID_COLUMN_WIDTH_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(EQUATION_GRID_COLUMN_WIDTH_SYNC_EVENT, handleSync);
  }, [syncGroup]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateHandlePositions();
      updateMaxWidths();
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [updateHandlePositions, updateMaxWidths]);

  useEffect(() => {
    setVariableWidthPx((current) =>
      clampWidthPx(current, minVariableWidthPx, maxVariableWidthPx)
    );
  }, [maxVariableWidthPx, minVariableWidthPx]);

  useEffect(() => {
    setExpressionWidthPx((current) =>
      clampWidthPx(current, minExpressionWidthPx, maxExpressionWidthPx)
    );
  }, [maxExpressionWidthPx, minExpressionWidthPx]);

  const setClampedVariableWidth = useCallback(
    (nextWidth: number) => {
      setVariableWidthPx(clampWidthPx(nextWidth, minVariableWidthPx, maxVariableWidthPx));
    },
    [maxVariableWidthPx, minVariableWidthPx]
  );

  const setClampedExpressionWidth = useCallback(
    (nextWidth: number) => {
      setExpressionWidthPx(clampWidthPx(nextWidth, minExpressionWidthPx, maxExpressionWidthPx));
    },
    [maxExpressionWidthPx, minExpressionWidthPx]
  );

  const createMouseDownHandler = useCallback(
    (column: ResizableEquationColumn) => (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDraggingColumn(column);
      document.body.classList.add("panel-splitter-body-lock");
      dragStateRef.current = {
        column,
        startClientX: event.clientX,
        startWidthPx: column === "variable" ? variableWidthPx : expressionWidthPx
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const dragState = dragStateRef.current;
        if (!dragState) {
          return;
        }

        const nextWidth =
          dragState.startWidthPx + (moveEvent.clientX - dragState.startClientX);
        if (dragState.column === "variable") {
          setClampedVariableWidth(nextWidth);
          return;
        }

        setClampedExpressionWidth(nextWidth);
      };

      const finishDrag = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", finishDrag);
        document.body.classList.remove("panel-splitter-body-lock");
        cleanupRef.current = null;
        dragStateRef.current = null;
        setDraggingColumn(null);
      };

      cleanupRef.current = finishDrag;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", finishDrag);
    },
    [expressionWidthPx, setClampedExpressionWidth, setClampedVariableWidth, variableWidthPx]
  );

  const createKeyDownHandler = useCallback(
    (
      column: ResizableEquationColumn,
      widthPx: number,
      minWidthPx: number,
      maxWidthPx: number,
      setClampedWidth: (nextWidth: number) => void
    ) =>
      (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setClampedWidth(widthPx - KEYBOARD_STEP_PX);
          return;
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          setClampedWidth(widthPx + KEYBOARD_STEP_PX);
          return;
        }

        if (event.key === "Home") {
          event.preventDefault();
          setClampedWidth(minWidthPx);
          return;
        }

        if (event.key === "End") {
          event.preventDefault();
          setClampedWidth(maxWidthPx);
        }
      },
    []
  );

  const variableResizeLabel =
    layout === "external-view" || layout === "initial-view"
      ? "Resize name column"
      : "Resize variable column";
  const expressionResizeLabel =
    layout === "external-view"
      ? "Resize value column"
      : layout === "initial-view"
        ? "Resize initial column"
        : "Resize expression column";

  return {
    shellRef,
    variableHeaderRef,
    expressionHeaderRef,
    variableResizeHandleProps: {
      "aria-label": variableResizeLabel,
      "aria-orientation": "vertical" as const,
      "aria-valuemax": maxVariableWidthPx,
      "aria-valuemin": minVariableWidthPx,
      "aria-valuenow": Math.round(variableWidthPx),
      className: `equation-grid-column-resize${
        draggingColumn === "variable" ? " is-active" : ""
      }`,
      onKeyDown: createKeyDownHandler(
        "variable",
        variableWidthPx,
        minVariableWidthPx,
        maxVariableWidthPx,
        setClampedVariableWidth
      ),
      onMouseDown: createMouseDownHandler("variable"),
      role: "separator" as const,
      style: buildResizeHandleStyle(variableHandleLeftPx),
      tabIndex: 0
    },
    expressionResizeHandleProps: {
      "aria-label": expressionResizeLabel,
      "aria-orientation": "vertical" as const,
      "aria-valuemax": maxExpressionWidthPx,
      "aria-valuemin": minExpressionWidthPx,
      "aria-valuenow": Math.round(expressionWidthPx),
      className: `equation-grid-column-resize${
        draggingColumn === "expression" ? " is-active" : ""
      }`,
      onKeyDown: createKeyDownHandler(
        "expression",
        expressionWidthPx,
        minExpressionWidthPx,
        maxExpressionWidthPx,
        setClampedExpressionWidth
      ),
      onMouseDown: createMouseDownHandler("expression"),
      role: "separator" as const,
      style: buildResizeHandleStyle(expressionHandleLeftPx),
      tabIndex: 0
    },
    // Backward-compatible alias for callers that only expose one handle.
    resizeHandleProps: {
      "aria-label": variableResizeLabel,
      "aria-orientation": "vertical" as const,
      "aria-valuemax": maxVariableWidthPx,
      "aria-valuemin": minVariableWidthPx,
      "aria-valuenow": Math.round(variableWidthPx),
      className: `equation-grid-column-resize${
        draggingColumn === "variable" ? " is-active" : ""
      }`,
      onKeyDown: createKeyDownHandler(
        "variable",
        variableWidthPx,
        minVariableWidthPx,
        maxVariableWidthPx,
        setClampedVariableWidth
      ),
      onMouseDown: createMouseDownHandler("variable"),
      role: "separator" as const,
      style: buildResizeHandleStyle(variableHandleLeftPx),
      tabIndex: 0
    },
    shellClassName: draggingColumn ? "equation-grid-is-resizing-columns" : ""
  };
}
