// The estimate cells shared by the tree and the table. Reads the model; never computes. The table,
// its rows, the cursor highlight and click-to-line are the shared UI layer's (src/ui/).

import { formatDuration } from '../../../core';
import type { Column, ItemNode, Model } from '../../../core';
import { muted } from '../../../ui/grid';
import { hasValue, rollup, totals } from '../fields';
import './shared.css';

/** What the row-per-item renderers read. */
export const requires = [rollup, hasValue, totals];

export function format(column: Column, value: number): string {
  return column.type === 'duration' ? formatDuration(value) : String(value);
}

/** A summable cell shows its roll-up; any other shows its text as written. */
export function fillCell(td: HTMLTableCellElement, model: Model, node: ItemNode, index: number): void {
  const column = model.columns[index];
  const cell = model.get(node, rollup)?.get(column.name);
  if (!cell) {
    td.textContent = model.field(node, index)?.text ?? '';
    return;
  }
  // An unestimated subtree shows nothing rather than "0h".
  if (!model.get(node, hasValue)?.get(column.name)) return;
  td.textContent = format(column, cell.effective);
  // Derived parents render bare: effective already is the child sum.
  if (cell.derived !== undefined && cell.mode !== 'derived') td.append(muted(`⟨Σ ${format(column, cell.derived)}⟩`));
}

export function addValueCells(row: HTMLTableRowElement, node: ItemNode, model: Model): void {
  model.columns.forEach((_, i) => fillCell(row.insertCell(), model, node, i));
}

/** The document total row; `leading` fills the cells before the declared columns. */
export function addTotalRow(table: HTMLTableElement, leading: string[], model: Model): void {
  const foot = table.createTFoot().insertRow();
  foot.className = 'total';
  leading.forEach((text) => (foot.insertCell().textContent = text));
  const sums = model.value(totals);
  model.columns.forEach((column) => {
    const td = foot.insertCell();
    const total = sums?.get(column.name);
    if (!total) return;
    td.textContent = format(column, total.effective);
    td.append(muted(`done ${format(column, total.doneSum)}`));
  });
}
