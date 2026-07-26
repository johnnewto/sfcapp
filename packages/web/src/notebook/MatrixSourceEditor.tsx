import { normalizeMatrixAccountBadgeRole, parseLenientJsonValue } from "@sfcr/notebook-core";
import { useMemo, type ChangeEvent } from "react";

import type { MatrixCell } from "./types";
import { formatCellBody } from "./sourceEditing";

interface MatrixSourceEditorProps {
  value: string;
  onChange(value: string): void;
}

export function MatrixSourceEditor({ value, onChange }: MatrixSourceEditorProps) {
  const parsed = useMemo(() => parseMatrixCell(value), [value]);

  if (!parsed.ok) {
    return <div className="notebook-source-validation">{parsed.error}</div>;
  }

  const matrix = parsed.value;
  const sumColumnIndex = matrix.columns.findIndex((column) => column.trim().toLowerCase() === "sum");

  function commitMatrix(update: (cell: MatrixCell) => MatrixCell): void {
    onChange(formatCellBody(update(matrix), "compact"));
  }

  function updateColumns(nextColumns: string[]): void {
    commitMatrix((cell) => {
      const nextColumnsLength = nextColumns.length;
      const nextRows = cell.rows.map((row) => ({
        ...row,
        values: adjustArrayLength(row.values, nextColumnsLength)
      }));

      return {
        ...cell,
        columns: nextColumns,
        rows: nextRows,
        sectors: cell.sectors == null ? undefined : adjustArrayLength(cell.sectors, nextColumnsLength),
        columnBadges:
          cell.columnBadges == null ? undefined : adjustArrayLength(cell.columnBadges, nextColumnsLength)
      };
    });
  }

  function updateSectors(nextSectors: string[] | undefined): void {
    commitMatrix((cell) => ({
      ...cell,
      sectors: nextSectors
    }));
  }

  function updateSectorValue(sectorIndex: number, nextValue: string): void {
    commitMatrix((cell) => {
      const nextSectors = adjustArrayLength(cell.sectors ?? [], cell.columns.length);
      nextSectors[sectorIndex] = nextValue;
      return {
        ...cell,
        sectors: nextSectors
      };
    });
  }

  function updateColumnBadgeValue(badgeIndex: number, nextValue: string): void {
    commitMatrix((cell) => {
      const nextBadges = adjustArrayLength(cell.columnBadges ?? [], cell.columns.length);
      nextBadges[badgeIndex] = nextValue;
      return {
        ...cell,
        columnBadges: finalizeColumnBadges(nextBadges)
      };
    });
  }

  function updateRow(rowIndex: number, patch: Partial<MatrixCell["rows"][number]>): void {
    commitMatrix((cell) => ({
      ...cell,
      rows: cell.rows.map((row, index) => (index === rowIndex ? { ...row, ...patch } : row))
    }));
  }

  function updateRowValue(rowIndex: number, valueIndex: number, nextValue: string): void {
    commitMatrix((cell) => ({
      ...cell,
      rows: cell.rows.map((row, index) => {
        if (index !== rowIndex) {
          return row;
        }

        const nextValues = row.values.slice();
        nextValues[valueIndex] = nextValue;
        return {
          ...row,
          values: nextValues
        };
      })
    }));
  }

  function insertColumnAfter(columnIndex: number): void {
    commitMatrix((cell) => {
      const nextIndex = columnIndex + 1;
      return {
        ...cell,
        columns: insertAt(cell.columns, nextIndex, `Column ${cell.columns.length + 1}`),
        rows: cell.rows.map((row) => ({
          ...row,
          values: insertAt(row.values, nextIndex, "")
        })),
        sectors:
          cell.sectors == null ? undefined : insertAt(adjustArrayLength(cell.sectors, cell.columns.length), nextIndex, ""),
        columnBadges:
          cell.columnBadges == null
            ? undefined
            : insertAt(adjustArrayLength(cell.columnBadges, cell.columns.length), nextIndex, "")
      };
    });
  }

  function addColumn(): void {
    commitMatrix((cell) => ({
      ...cell,
      columns: [...cell.columns, `Column ${cell.columns.length + 1}`],
      rows: cell.rows.map((row) => ({
        ...row,
        values: [...row.values, ""]
      })),
      sectors: cell.sectors == null ? undefined : [...cell.sectors, ""],
      columnBadges: cell.columnBadges == null ? undefined : [...cell.columnBadges, ""]
    }));
  }

  function removeColumn(columnIndex: number): void {
    commitMatrix((cell) => ({
      ...cell,
      columns: cell.columns.filter((_, index) => index !== columnIndex),
      rows: cell.rows.map((row) => ({
        ...row,
        values: row.values.filter((_, index) => index !== columnIndex)
      })),
      sectors: cell.sectors == null ? undefined : cell.sectors.filter((_, index) => index !== columnIndex),
      columnBadges:
        cell.columnBadges == null ? undefined : cell.columnBadges.filter((_, index) => index !== columnIndex)
    }));
  }

  function moveColumn(columnIndex: number, direction: -1 | 1): void {
    const targetIndex = columnIndex + direction;
    if (targetIndex < 0 || targetIndex >= matrix.columns.length) {
      return;
    }

    commitMatrix((cell) => ({
      ...cell,
      columns: moveArrayItem(cell.columns, columnIndex, targetIndex),
      rows: cell.rows.map((row) => ({
        ...row,
        values: moveArrayItem(adjustArrayLength(row.values, cell.columns.length), columnIndex, targetIndex)
      })),
      sectors:
        cell.sectors == null
          ? undefined
          : moveArrayItem(adjustArrayLength(cell.sectors, cell.columns.length), columnIndex, targetIndex),
      columnBadges:
        cell.columnBadges == null
          ? undefined
          : moveArrayItem(adjustArrayLength(cell.columnBadges, cell.columns.length), columnIndex, targetIndex)
    }));
  }

  function addRow(): void {
    commitMatrix((cell) => ({
      ...cell,
      rows: [
        ...cell.rows,
        {
          label: `Row ${cell.rows.length + 1}`,
          values: Array.from({ length: cell.columns.length }, () => "")
        }
      ]
    }));
  }

  function insertRowAfter(rowIndex: number): void {
    commitMatrix((cell) => ({
      ...cell,
      rows: insertAt(cell.rows, rowIndex + 1, {
        label: `Row ${cell.rows.length + 1}`,
        values: Array.from({ length: cell.columns.length }, () => "")
      })
    }));
  }

  function removeRow(rowIndex: number): void {
    commitMatrix((cell) => ({
      ...cell,
      rows: cell.rows.filter((_, index) => index !== rowIndex)
    }));
  }

  function moveRow(rowIndex: number, direction: -1 | 1): void {
    const targetIndex = rowIndex + direction;
    if (targetIndex < 0 || targetIndex >= matrix.rows.length) {
      return;
    }

    commitMatrix((cell) => ({
      ...cell,
      rows: moveArrayItem(cell.rows, rowIndex, targetIndex)
    }));
  }

  function addSectors(): void {
    commitMatrix((cell) => ({
      ...cell,
      sectors: Array.from({ length: cell.columns.length }, () => "")
    }));
  }

  function removeSectors(): void {
    updateSectors(undefined);
  }

  return (
    <section className="notebook-matrix-editor" aria-label="Matrix source editor">
      <div className="notebook-matrix-editor-fields notebook-matrix-editor-metadata-lines">
        <div className="notebook-matrix-editor-metadata-line">
          <span>Source run cell id</span>
          <MatrixEditorField
            value={matrix.sourceRunCellId ?? ""}
            onChange={(event) =>
              commitMatrix((cell) => ({
                ...cell,
                sourceRunCellId: normalizeOptionalText(event.target.value)
              }))
            }
            placeholder="baseline-run"
            aria-label="Matrix source run cell id"
          />
        </div>

        <div className="notebook-matrix-editor-metadata-line">
          <span>Description</span>
          <MatrixEditorField
            value={matrix.description ?? ""}
            onChange={(event) =>
              commitMatrix((cell) => ({
                ...cell,
                description: normalizeOptionalText(event.target.value)
              }))
            }
            placeholder="Balance-sheet matrix for the BMW model, following the sfcr article presentation."
            aria-label="Matrix description"
          />
        </div>

        <div className="notebook-matrix-editor-metadata-line">
          <span>Note</span>
          <MatrixEditorField
            value={matrix.note ?? ""}
            onChange={(event) =>
              commitMatrix((cell) => ({
                ...cell,
                note: normalizeOptionalText(event.target.value)
              }))
            }
            placeholder="Source structure adapted from the sfcr BMW article balance-sheet display."
            aria-label="Matrix note"
          />
        </div>
      </div>

      <section className="notebook-matrix-editor-section" aria-label="Matrix rows editor">
        <div className="notebook-matrix-table-shell">
          <table className="notebook-matrix-editor-table">
            <thead>
              <tr>
                <th scope="col" colSpan={2} className="notebook-matrix-editor-sidehead" />
                {matrix.columns.map((column, index) => (
                  <th
                    key={`column-controls-${index}`}
                    scope="col"
                    className={[
                      "notebook-matrix-editor-topcell",
                      "notebook-matrix-editor-controlcell",
                      index === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="grid-editor-row-controls">
                      <button
                        type="button"
                        className="secondary-button grid-editor-symbol-button"
                        onClick={() => insertColumnAfter(index)}
                        aria-label={`Insert matrix column after ${index + 1}`}
                        title="Insert column after"
                      >
                        ➕
                      </button>
                      <button
                        type="button"
                        className="secondary-button grid-editor-symbol-button"
                        onClick={() => removeColumn(index)}
                        disabled={matrix.columns.length <= 1}
                        aria-label={`Remove matrix column ${index + 1}`}
                        title="Remove column"
                      >
                        ➖
                      </button>
                      <button
                        type="button"
                        className="secondary-button grid-editor-symbol-button"
                        onClick={() => moveColumn(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move matrix column ${index + 1} left`}
                        title="Move column left"
                      >
                        ⇐
                      </button>
                      <button
                        type="button"
                        className="secondary-button grid-editor-symbol-button"
                        onClick={() => moveColumn(index, 1)}
                        disabled={index === matrix.columns.length - 1}
                        aria-label={`Move matrix column ${index + 1} right`}
                        title="Move column right"
                      >
                        ⇒
                      </button>
                    </div>
                  </th>
                ))}
                <th scope="col" className="notebook-matrix-editor-action-head" />
              </tr>
              <tr className="notebook-matrix-editor-dag-row">
                <th scope="col" colSpan={2} className="notebook-matrix-editor-sidehead">
                  Sectors
                </th>
                {matrix.columns.map((column, index) => (
                  <th
                    key={`column-sector-${index}`}
                    scope="col"
                    className={[
                      "notebook-matrix-editor-topcell",
                      index === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <MatrixEditorField
                      value={adjustArrayLength(matrix.sectors ?? [], matrix.columns.length)[index] ?? ""}
                      onChange={(event) => updateSectorValue(index, event.target.value)}
                      aria-label={`Matrix sector ${index + 1}`}
                      placeholder="---"
                    />
                  </th>
                ))}
                <th scope="col" className="notebook-matrix-editor-action-head" />
              </tr>
              <tr className="notebook-matrix-editor-columns-row">
                <th scope="col" colSpan={2} className="notebook-matrix-editor-sidehead">
                  Columns
                </th>
                {matrix.columns.map((column, index) => (
                  <th
                    key={`column-header-${index}`}
                    scope="col"
                    className={[
                      "notebook-matrix-editor-topcell",
                      index === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <MatrixEditorField
                      value={column}
                      onChange={(event) => {
                        const nextColumns = matrix.columns.slice();
                        nextColumns[index] = event.target.value;
                        updateColumns(nextColumns);
                      }}
                      aria-label={`Matrix column ${index + 1}`}
                      placeholder={`Column ${index + 1}`}
                    />
                  </th>
                ))}
                <th scope="col" className="notebook-matrix-editor-action-head" />
              </tr>
              <tr className="notebook-matrix-editor-badge-row">
                <th scope="col" colSpan={2} className="notebook-matrix-editor-sidehead">
                  A / L / E
                </th>
                {matrix.columns.map((column, index) => {
                  const badgeValue =
                    adjustArrayLength(matrix.columnBadges ?? [], matrix.columns.length)[index] ?? "";
                  return (
                  <th
                    key={`column-badge-${index}`}
                    scope="col"
                    className={[
                      "notebook-matrix-editor-topcell",
                      "notebook-matrix-editor-badge-cell",
                      matrixEditorBadgeCellClass(badgeValue),
                      index === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <MatrixBadgeSelect
                      value={badgeValue}
                      onChange={(nextValue) => updateColumnBadgeValue(index, nextValue)}
                      aria-label={`Matrix column ${index + 1} stock badge`}
                      disabled={index === sumColumnIndex}
                    />
                  </th>
                  );
                })}
                <th scope="col" className="notebook-matrix-editor-action-head" />
              </tr>
              <tr>
                <th scope="col">Band (DAG)</th>
                <th scope="col">Label</th>
                {matrix.columns.map((column, index) => (
                  <th
                    key={`column-value-head-${index}`}
                    scope="col"
                    className={index === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined}
                  >
                    {column || `Column ${index + 1}`}
                  </th>
                ))}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row, rowIndex) => {
                const rowValues = adjustArrayLength(row.values, matrix.columns.length);
                return (
                  <tr key={`row-${rowIndex}`}>
                    <td>
                      <MatrixEditorField
                        value={row.band ?? ""}
                        onChange={(event) =>
                          updateRow(rowIndex, { band: normalizeOptionalText(event.target.value) })
                        }
                        aria-label={`Matrix row ${rowIndex + 1} band`}
                      />
                    </td>
                    <td>
                      <MatrixEditorField
                        value={row.label}
                        onChange={(event) => updateRow(rowIndex, { label: event.target.value })}
                        aria-label={`Matrix row ${rowIndex + 1} label`}
                      />
                    </td>
                    {matrix.columns.map((column, columnIndex) => (
                      <td
                        key={`${rowIndex}-${columnIndex}`}
                        className={
                          columnIndex === sumColumnIndex ? "notebook-matrix-editor-sum-column" : undefined
                        }
                      >
                        <MatrixEditorField
                          value={rowValues[columnIndex] ?? ""}
                          onChange={(event) =>
                            updateRowValue(rowIndex, columnIndex, event.target.value)
                          }
                          aria-label={`Matrix row ${rowIndex + 1} value for ${column || `column ${columnIndex + 1}`}`}
                          minimum={3}
                        />
                      </td>
                    ))}
                    <td>
                      <div className="grid-editor-row-controls">
                        <button
                          type="button"
                          className="secondary-button grid-editor-symbol-button"
                          onClick={() => insertRowAfter(rowIndex)}
                          aria-label={`Insert matrix row after ${rowIndex + 1}`}
                          title="Insert row after"
                        >
                          ➕
                        </button>
                        <button
                          type="button"
                          className="secondary-button grid-editor-symbol-button"
                          onClick={() => removeRow(rowIndex)}
                          disabled={matrix.rows.length <= 1}
                          aria-label={`Remove matrix row ${rowIndex + 1}`}
                          title="Remove row"
                        >
                          ➖
                        </button>
                        <button
                          type="button"
                          className="secondary-button grid-editor-symbol-button"
                          onClick={() => moveRow(rowIndex, -1)}
                          disabled={rowIndex === 0}
                          aria-label={`Move matrix row ${rowIndex + 1} up`}
                          title="Move row up"
                        >
                          ⇑
                        </button>
                        <button
                          type="button"
                          className="secondary-button grid-editor-symbol-button"
                          onClick={() => moveRow(rowIndex, 1)}
                          disabled={rowIndex === matrix.rows.length - 1}
                          aria-label={`Move matrix row ${rowIndex + 1} down`}
                          title="Move row down"
                        >
                          ⇓
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function parseMatrixCell(value: string): { ok: true; value: MatrixCell } | { ok: false; error: string } {
  try {
    const parsed = parseLenientJsonValue(value) as MatrixCell;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "Matrix source must parse to an object." };
    }

    if (parsed.type !== "matrix") {
      return { ok: false, error: "Matrix source must remain type 'matrix'." };
    }

    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
      return { ok: false, error: "Matrix source requires columns and rows arrays." };
    }

    return {
      ok: true,
      value: {
        ...parsed,
        columns: parsed.columns.map((column) => String(column)),
        sectors: parsed.sectors?.map((sector) => String(sector)),
        columnBadges: parsed.columnBadges?.map((badge) => String(badge)),
        rows: parsed.rows.map((row, index) => ({
          ...row,
          band: row.band,
          label: String(row.label ?? `Row ${index + 1}`),
          values: Array.isArray(row.values) ? row.values.map((entry) => String(entry)) : []
        }))
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid matrix source."
    };
  }
}

function adjustArrayLength(values: string[], nextLength: number): string[] {
  const nextValues = values.slice(0, nextLength);
  while (nextValues.length < nextLength) {
    nextValues.push("");
  }

  return nextValues;
}

function insertAt<T>(values: T[], index: number, value: T): T[] {
  const nextValues = values.slice();
  nextValues.splice(index, 0, value);
  return nextValues;
}

function moveArrayItem<T>(values: T[], fromIndex: number, toIndex: number): T[] {
  const nextValues = values.slice();
  const [moved] = nextValues.splice(fromIndex, 1);
  if (moved !== undefined) {
    nextValues.splice(toIndex, 0, moved);
  }
  return nextValues;
}

function normalizeOptionalText(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

function finalizeColumnBadges(badges: string[]): string[] | undefined {
  if (!badges.some((badge) => badge.trim().length > 0)) {
    return undefined;
  }

  return badges;
}

function columnBadgeSelectValue(raw: string): "" | "asset" | "liability" | "equity" {
  return normalizeMatrixAccountBadgeRole(raw) ?? "";
}

function matrixEditorBadgeCellClass(raw: string): string | undefined {
  const role = columnBadgeSelectValue(raw);
  if (!role) {
    return undefined;
  }

  return `notebook-godley-role notebook-godley-role-${role}`;
}

const MATRIX_EDITOR_PLACEHOLDER_SIZE_CAP = 48;

function matrixEditorInputSize(value: string, placeholder = "", minimum = 4): number {
  const placeholderLength =
    value.length > 0 ? 0 : Math.min(placeholder.length, MATRIX_EDITOR_PLACEHOLDER_SIZE_CAP);
  return Math.max(minimum, value.length, placeholderLength) + 1;
}

function MatrixBadgeSelect({
  value,
  onChange,
  "aria-label": ariaLabel,
  disabled = false
}: {
  value: string;
  onChange(nextValue: string): void;
  "aria-label": string;
  disabled?: boolean;
}) {
  return (
    <select
      className="notebook-matrix-editor-badge-select"
      value={columnBadgeSelectValue(value)}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <option value="">—</option>
      <option value="asset">A</option>
      <option value="liability">L</option>
      <option value="equity">E</option>
    </select>
  );
}

function MatrixEditorField({
  value,
  onChange,
  "aria-label": ariaLabel,
  placeholder,
  minimum = 4
}: {
  value: string;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
  "aria-label": string;
  placeholder?: string;
  minimum?: number;
}) {
  return (
    <input
      type="text"
      className="notebook-matrix-editor-field"
      value={value}
      onChange={onChange}
      size={matrixEditorInputSize(value, placeholder, minimum)}
      aria-label={ariaLabel}
      placeholder={placeholder}
    />
  );
}