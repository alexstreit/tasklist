// Table building shared by the row-per-item renderers. Reads the model;
// never computes. Cursor highlight and click-to-line go through RenderContext.

import { formatDuration } from '../core';
import type { Cell, Column, Model, ModelNode, RenderContext } from '../core';
import './grid.css';

export function format(column: Column, value: number): string {
  return column.type === 'duration' ? formatDuration(value) : String(value);
}

function muted(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

export function fillCell(td: HTMLTableCellElement, column: Column, cell: Cell): void {
  if (cell.kind === 'text') {
    td.textContent = cell.value;
    return;
  }
  // An unestimated subtree shows nothing rather than "0h".
  if (!cell.hasValue) return;
  td.textContent = format(column, cell.effective);
  // Derived parents render bare: effective already is the child sum.
  if (cell.childrenHaveValue && cell.mode !== 'derived') td.append(muted(`⟨Σ ${format(column, cell.childSum)}⟩`));
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
export function addItemRow(table: HTMLTableElement, node: ModelNode, ctx: RenderContext): HTMLTableRowElement {
  const row = table.tBodies[0].insertRow();
  row.classList.toggle('done', node.done);
  if (node.line === ctx.cursorItem?.line) row.classList.add(ctx.cursorItem.exact ? 'at-cursor' : 'near-cursor');
  row.addEventListener('click', () => ctx.setCursorLine(node.line));
  const outline = row.insertCell();
  outline.className = 'outline';
  outline.textContent = node.outlineNumber;
  return row;
}

export function addValueCells(row: HTMLTableRowElement, node: ModelNode, model: Model): void {
  node.cells.forEach((cell, i) => fillCell(row.insertCell(), model.columns[i], cell));
}

/** The document total row; `leading` fills the cells before the declared columns. */
export function addTotalRow(table: HTMLTableElement, leading: string[], model: Model): void {
  const foot = table.createTFoot().insertRow();
  foot.className = 'total';
  leading.forEach((text) => (foot.insertCell().textContent = text));
  model.columns.forEach((column, i) => {
    const td = foot.insertCell();
    const total = model.totals[i];
    if (!total) return;
    td.textContent = format(column, total.effective);
    td.append(muted(`done ${format(column, total.doneSum)}`));
  });
}

export function mount(host: HTMLElement, table: HTMLTableElement, ctx: RenderContext): void {
  host.replaceChildren(table);
  if (ctx.scrollToCursor) table.querySelector('.at-cursor, .near-cursor')?.scrollIntoView({ block: 'nearest' });
}
