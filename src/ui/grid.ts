// The shared UI layer for renderers (PLUGINS.md §8): the row-per-item table, its cursor highlight
// and click-to-line, which go through RenderContext. It imports only core's types, and plugins and
// views may import it.

import type { ItemNode, RenderContext } from '../core';
import './grid.css';

export function muted(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

/** A table with a header row. */
export function createGrid(className: string, headers: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = `plan-grid ${className}`;
  const head = table.createTHead().insertRow();
  for (const name of headers) {
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

export function mount(host: HTMLElement, table: HTMLTableElement, ctx: RenderContext): void {
  host.replaceChildren(table);
  if (ctx.scrollToCursor) table.querySelector('.at-cursor, .near-cursor')?.scrollIntoView({ block: 'nearest' });
}
