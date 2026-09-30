// Table building shared by the row-per-item renderers. Reads the model;
// never computes. Cursor highlight and click-to-line go through RenderContext.

import { formatDuration } from '../../../core';
import type { Column, ItemNode, Model, RenderContext } from '../../../core';
import { hasValue, rollup, totals } from '../fields';
import './shared.css';

/** What the row-per-item renderers read. */
export const requires = [rollup, hasValue, totals];

export function format(column: Column, value: number): string {
  return column.type === 'duration' ? formatDuration(value) : String(value);
}

function muted(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

/** A summable cell shows its roll-up; any other shows its text as written. */
export function fillCell(td: HTMLTableCellElement, model: Model, node: ItemNode, index: number): void {
  const column = model.columns[index];
  const cell = model.get(node, rollup)?.get(column.name);
  if (!cell) {
    td.textContent = node.fields[index]?.text ?? '';
    return;
  }
  // An unestimated subtree shows nothing rather than "0h".
  if (!model.get(node, hasValue)?.get(column.name)) return;
  td.textContent = format(column, cell.effective);
  // Derived parents render bare: effective already is the child sum.
  if (cell.derived !== undefined && cell.mode !== 'derived') td.append(muted(`⟨Σ ${format(column, cell.derived)}⟩`));
}

/** A grid with a header row; `leading` names the columns before the declared ones. */
export function createGrid(className: string, leading: string[], model: Model): HTMLTableElement {
  const table = document.createElement('table');
  table.className = `plan-grid ${className}`;
  const head = table.createTHead().insertRow();
  for (const name of [...leading, ...model.columns.map((c) => c.name)]) {
    const th = document.createElement('th');
    th.textContent = name;
    head.append(th);
  }
  table.createTBody();
  return table;
}

/** An item row: done and cursor classes, click-to-line, the outline number, then the caller adds the rest. */
export function addItemRow(table: HTMLTableElement, node: ItemNode, ctx: RenderContext): HTMLTableRowElement {
  const row = table.tBodies[0].insertRow();
  row.classList.toggle('done', node.done);
  if (node.line === ctx.cursorItem?.line) row.classList.add(ctx.cursorItem.exact ? 'at-cursor' : 'near-cursor');
  row.addEventListener('click', () => ctx.setCursorLine(node.line));
  const outline = row.insertCell();
  outline.className = 'outline';
  outline.textContent = node.outlineNumber;
  return row;
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

export function mount(host: HTMLElement, table: HTMLTableElement, ctx: RenderContext): void {
  host.replaceChildren(table);
  if (ctx.scrollToCursor) table.querySelector('.at-cursor, .near-cursor')?.scrollIntoView({ block: 'nearest' });
}
