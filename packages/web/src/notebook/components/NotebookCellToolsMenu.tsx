import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import { useDragScroll } from "../../hooks/useDragScroll";
import { applyFixedMenuPosition } from "../../lib/clampFixedMenuPosition";
import type { NotebookCellInsertType } from "../types";

export const CELL_INSERT_TYPES: NotebookCellInsertType[] = [
  "markdown",
  "run",
  "chart",
  "chart-grid",
  "table",
  "matrix",
  "sequence",
  "sankey",
  "diagram"
];

export function formatCellInsertType(type: NotebookCellInsertType): string {
  switch (type) {
    case "markdown":
      return "Markdown";
    case "run":
      return "Run";
    case "chart":
      return "Chart";
    case "chart-grid":
      return "Chart grid";
    case "table":
      return "Table";
    case "matrix":
      return "Matrix";
    case "sequence":
      return "Sequence";
    case "sankey":
      return "Sankey";
    case "diagram":
      return "Stock-flow diagram";
  }
}

export function getInsertDisabledReason(
  type: NotebookCellInsertType,
  context: { hasModelSource: boolean; hasRunSource: boolean }
): string | null {
  if (type === "run" && !context.hasModelSource) {
    return "Requires a model cell.";
  }
  if ((type === "chart" || type === "chart-grid" || type === "table") && !context.hasRunSource) {
    return "Requires a run cell.";
  }
  return null;
}

export interface NotebookCellStructureTools {
  canMoveDown: boolean;
  canMoveUp: boolean;
  hasModelSource: boolean;
  hasRunSource: boolean;
  onDelete(): void;
  onInsert(type: NotebookCellInsertType): void;
  onMove(direction: -1 | 1): void;
  onSetUrl(): void;
}

const NotebookCellStructureToolsContext = createContext<NotebookCellStructureTools | null>(null);

export function NotebookCellStructureToolsProvider({
  children,
  value
}: {
  children: ReactNode;
  value: NotebookCellStructureTools;
}) {
  return (
    <NotebookCellStructureToolsContext.Provider value={value}>
      {children}
    </NotebookCellStructureToolsContext.Provider>
  );
}

export function NotebookCellToolsButton({
  helpDialogContent,
  helpDialogTitle,
  helpText,
  isCollapsed,
  isEditing,
  onEditToggle,
  onHelpRequest,
  onToggleCollapsed,
  title
}: {
  helpDialogContent?: ReactNode;
  helpDialogTitle?: string;
  helpText: string | null;
  isCollapsed: boolean;
  isEditing: boolean;
  onEditToggle?: (() => void) | null;
  onHelpRequest?: (() => void) | null;
  onToggleCollapsed?: (() => void) | null;
  title: string;
}) {
  const structureTools = useContext(NotebookCellStructureToolsContext);
  const [isOpen, setIsOpen] = useState(false);
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const helpDialogRef = useRef<HTMLDivElement | null>(null);
  const helpDialogDragScroll = useDragScroll<HTMLDivElement>();

  const canEdit = Boolean(!isCollapsed && onEditToggle && !isEditing);
  const canToggleCollapsed = Boolean(onToggleCollapsed);
  const canOpenHelp = Boolean(helpText);
  const hasContentActions = canEdit || canToggleCollapsed || canOpenHelp;
  const hasStructureActions = structureTools != null;

  function closeMenu(): void {
    setIsOpen(false);
    setIsInsertMenuOpen(false);
  }

  function handleHelp(): void {
    closeMenu();
    if (helpDialogContent) {
      setIsHelpDialogOpen(true);
      return;
    }
    onHelpRequest?.();
  }

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current || !buttonRef.current) {
      return;
    }

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth;
    applyFixedMenuPosition(menuRef.current, buttonRect.right - menuWidth, buttonRect.bottom + 4);
  }, [isOpen, isInsertMenuOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (wrapRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isHelpDialogOpen || !helpDialogContent) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (helpDialogRef.current?.contains(target)) {
        return;
      }
      setIsHelpDialogOpen(false);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsHelpDialogOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [helpDialogContent, isHelpDialogOpen]);

  if (!hasContentActions && !hasStructureActions) {
    return null;
  }

  return (
    <div className="notebook-cell-tools" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="notebook-run-button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => {
          setIsOpen((current) => !current);
          setIsInsertMenuOpen(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        Tools
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          className="notebook-cell-context-menu"
          role="menu"
          aria-label={`Cell actions for ${title}`}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {canEdit ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onEditToggle?.();
              }}
            >
              Edit
            </button>
          ) : null}
          {canToggleCollapsed ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onToggleCollapsed?.();
              }}
            >
              {isCollapsed ? "Show" : "Hide"}
            </button>
          ) : null}
          {canOpenHelp ? (
            <button type="button" role="menuitem" onClick={handleHelp}>
              Help
            </button>
          ) : null}
          {hasContentActions && hasStructureActions ? (
            <div className="notebook-cell-context-menu-separator" role="separator" />
          ) : null}
          {structureTools ? (
            <>
              <div
                className="notebook-cell-context-menu-submenu-wrap"
                onMouseEnter={() => setIsInsertMenuOpen(true)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  onClick={() => setIsInsertMenuOpen((current) => !current)}
                  onFocus={() => setIsInsertMenuOpen(true)}
                  onMouseEnter={() => setIsInsertMenuOpen(true)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span>Add cell</span>
                  <span aria-hidden="true">›</span>
                </button>
                {isInsertMenuOpen ? (
                  <div
                    className="notebook-cell-context-submenu"
                    role="menu"
                    aria-label="Add cell below options"
                  >
                    {CELL_INSERT_TYPES.map((cellType) => {
                      const disabledReason = getInsertDisabledReason(cellType, {
                        hasModelSource: structureTools.hasModelSource,
                        hasRunSource: structureTools.hasRunSource
                      });
                      return (
                        <button
                          key={cellType}
                          type="button"
                          role="menuitem"
                          disabled={disabledReason != null}
                          title={disabledReason ?? undefined}
                          onClick={() => {
                            structureTools.onInsert(cellType);
                            closeMenu();
                          }}
                        >
                          {formatCellInsertType(cellType)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="notebook-cell-context-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!structureTools.canMoveUp}
                onClick={() => {
                  structureTools.onMove(-1);
                  closeMenu();
                }}
              >
                Move up
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!structureTools.canMoveDown}
                onClick={() => {
                  structureTools.onMove(1);
                  closeMenu();
                }}
              >
                Move down
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  structureTools.onDelete();
                  closeMenu();
                }}
              >
                Delete
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  structureTools.onSetUrl();
                  closeMenu();
                }}
              >
                URL
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {isHelpDialogOpen && helpDialogContent ? (
        <div
          className="notebook-help-dialog-backdrop"
          onClick={() => setIsHelpDialogOpen(false)}
          role="presentation"
        >
          <div
            aria-label={helpDialogTitle ?? `Help for ${title}`}
            aria-modal="true"
            className="notebook-help-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={helpDialogRef}
            role="dialog"
          >
            <div className="notebook-help-dialog-header">
              <div>
                <p className="panel-subtitle">{title}</p>
                <h3>{helpDialogTitle ?? "Help"}</h3>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsHelpDialogOpen(false)}
              >
                Close
              </button>
            </div>
            <div
              ref={helpDialogDragScroll.dragScrollRef}
              className={`notebook-help-dialog-body ${helpDialogDragScroll.dragScrollProps.className}`}
              onClickCapture={helpDialogDragScroll.dragScrollProps.onClickCapture}
              onMouseDown={helpDialogDragScroll.dragScrollProps.onMouseDown}
            >
              {helpDialogContent}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
