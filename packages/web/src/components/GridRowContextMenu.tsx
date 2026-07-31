import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { applyFixedMenuPosition } from "../lib/clampFixedMenuPosition";

export function insertRowAt<T>(rows: T[], index: number, row: T): T[] {
  const next = rows.slice();
  next.splice(index, 0, row);
  return next;
}

export function moveRow<T>(rows: T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return rows;
  }

  const next = rows.slice();
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function removeRow<T>(rows: T[], index: number): T[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

export function canMoveRowUp(rows: unknown[], index: number): boolean {
  return index > 0 && index < rows.length;
}

export function canMoveRowDown(rows: unknown[], index: number): boolean {
  return index >= 0 && index < rows.length - 1;
}

export function useGridRowContextMenu<T>({
  ignoredSelector = "textarea, input, button, select",
  onChangeRows,
  rows
}: {
  ignoredSelector?: string;
  onChangeRows(next: T[]): void;
  rows: T[];
}) {
  const [rowContextMenu, setRowContextMenu] = useState<{ rowIndex: number; x: number; y: number } | null>(
    null
  );
  const [deleteDialogRowIndex, setDeleteDialogRowIndex] = useState<number | null>(null);
  const rowContextMenuRef = useRef<HTMLDivElement | null>(null);

  function closeRowContextMenu(): void {
    setRowContextMenu(null);
  }

  function handleRowContextMenu(event: MouseEvent<HTMLElement>, rowIndex: number): void {
    if (event.target instanceof Element && event.target.closest(ignoredSelector)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setRowContextMenu({ rowIndex, x: event.clientX, y: event.clientY });
  }

  function insertRowBelow(rowIndex: number, row: T): void {
    onChangeRows(insertRowAt(rows, rowIndex + 1, row));
    closeRowContextMenu();
  }

  function moveRowAt(rowIndex: number, direction: -1 | 1): void {
    onChangeRows(moveRow(rows, rowIndex, direction));
    closeRowContextMenu();
  }

  function requestDelete(rowIndex: number): void {
    closeRowContextMenu();
    setDeleteDialogRowIndex(rowIndex);
  }

  function confirmDelete(): void {
    if (deleteDialogRowIndex == null) {
      return;
    }

    onChangeRows(removeRow(rows, deleteDialogRowIndex));
    setDeleteDialogRowIndex(null);
  }

  useLayoutEffect(() => {
    if (rowContextMenu && rowContextMenuRef.current) {
      applyFixedMenuPosition(rowContextMenuRef.current, rowContextMenu.x, rowContextMenu.y);
    }
  }, [rowContextMenu]);

  useEffect(() => {
    if (rowContextMenu == null) {
      return;
    }

    function handlePointerDown(): void {
      closeRowContextMenu();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeRowContextMenu();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rowContextMenu]);

  return {
    cancelDelete: () => setDeleteDialogRowIndex(null),
    closeRowContextMenu,
    confirmDelete,
    deleteDialogRowIndex,
    handleRowContextMenu,
    insertRowBelow,
    moveRowAt,
    requestDelete,
    rowContextMenu,
    rowContextMenuRef
  };
}

export function GridRowContextMenu({
  addCommentLabel,
  addItemLabel,
  askAiLabel,
  canMoveDown,
  canMoveUp,
  menuRef,
  menuTypeLabel,
  onAdd,
  onAddComment,
  onAskAi,
  onDelete,
  onMoveDown,
  onMoveUp,
  rowIndex
}: {
  addCommentLabel?: string;
  addItemLabel: string;
  askAiLabel?: string;
  canMoveDown: boolean;
  canMoveUp: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  menuTypeLabel: string;
  onAdd(): void;
  onAddComment?(): void;
  onAskAi?(): void;
  onDelete(): void;
  onMoveDown(): void;
  onMoveUp(): void;
  rowIndex: number;
}) {
  return (
    <div
      ref={menuRef}
      className="notebook-cell-context-menu"
      role="menu"
      aria-label={`${menuTypeLabel} actions for row ${rowIndex + 1}`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {askAiLabel && onAskAi ? (
        <>
          <button type="button" role="menuitem" onClick={onAskAi}>
            {askAiLabel}
          </button>
          <div className="notebook-cell-context-menu-separator" role="separator" />
        </>
      ) : null}
      <button type="button" role="menuitem" onClick={onAdd}>
        {addItemLabel}
      </button>
      {addCommentLabel && onAddComment ? (
        <button type="button" role="menuitem" onClick={onAddComment}>
          {addCommentLabel}
        </button>
      ) : null}
      <div className="notebook-cell-context-menu-separator" role="separator" />
      <button type="button" role="menuitem" disabled={!canMoveUp} onClick={onMoveUp}>
        Move up
      </button>
      <button type="button" role="menuitem" disabled={!canMoveDown} onClick={onMoveDown}>
        Move down
      </button>
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

export function GridRowDeleteDialog({
  deleteTitle,
  itemLabel,
  onCancel,
  onConfirm
}: {
  deleteTitle: string;
  itemLabel: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div className="notebook-cell-delete-dialog-backdrop" onClick={onCancel}>
      <div
        className="notebook-cell-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${itemLabel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{deleteTitle}</h3>
        <p>
          Delete <strong>{itemLabel}</strong> from this model?
        </p>
        <div className="notebook-cell-delete-dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="is-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
