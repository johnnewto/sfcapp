import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useFloatingPanelPosition } from "../../hooks/useFloatingPanelPosition";

const NOTEBOOK_COMMANDS_PANEL_POSITION_KEY = "sfcr:notebook-commands-panel-position";

export function NotebookCommandsPanel({
  buildDateLabel,
  children,
  notebookTitle,
  onClose
}: {
  buildDateLabel: string;
  children: ReactNode;
  notebookTitle: string;
  onClose(): void;
}) {
  const { position, dragHandleProps } = useFloatingPanelPosition(NOTEBOOK_COMMANDS_PANEL_POSITION_KEY);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const panel = (
    <div
      className="notebook-commands-panel"
      id="notebook-commands-panel"
      role="dialog"
      aria-label="Notebook commands"
      style={{
        left: position.x,
        top: position.y
      }}
    >
      <header className="notebook-commands-panel-header">
        <div className="notebook-commands-panel-header-draggable" {...dragHandleProps}>
          <p className="panel-subtitle">Notebook commands</p>
          <div className="notebook-commands-panel-meta">
            <span className="eyebrow">SFCApp</span>
            <span className="notebook-build-badge" title={buildDateLabel}>
              {buildDateLabel}
            </span>
          </div>
          <h3>{notebookTitle}</h3>
        </div>
        <button
          type="button"
          className="notebook-commands-panel-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close notebook commands"
        >
          ×
        </button>
      </header>

      <div className="notebook-commands-panel-body">{children}</div>
    </div>
  );

  return createPortal(panel, document.body);
}
