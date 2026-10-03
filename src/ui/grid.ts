// The shared UI layer for renderers (PLUGINS.md §8): the row-per-item table, its cursor highlight
// and click-to-line, which go through RenderContext. It imports only core's types, and plugins and
// views may import it.

import type { ItemNode, Model, RenderContext } from '../core';
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

/** Whether the filter shows the row (spec §5.7); with none, every row shows. Hidden rows aren't drawn. */
export function shows(ctx: RenderContext, node: ItemNode): boolean {
  return !ctx.filter || ctx.filter.shows(node);
}

/**
 * An item row: done and cursor classes, click-to-line, the outline number, then the caller adds the
 * rest. A mounted row is shaded; its line is in its own file, which the cursor and hover name. An
 * ancestor the filter shows only for context is dimmed.
 */
export function addItemRow(table: HTMLTableElement, node: ItemNode, ctx: RenderContext, model: Model): HTMLTableRowElement {
  const row = table.tBodies[0].insertRow();
  row.classList.toggle('done', node.done);
  if (node.file !== model.file) row.classList.add('mounted');
  if (ctx.filter?.dims(node)) row.classList.add('filter-context');
  row.dataset.file = node.file;
  row.dataset.line = String(node.line);
  const cursor = ctx.cursorItem;
  if (cursor && node.file === cursor.file && node.line === cursor.line) row.classList.add(cursor.exact ? 'at-cursor' : 'near-cursor');
  row.addEventListener('click', () => ctx.setCursorLine({ file: node.file, line: node.line }));
  const outline = row.insertCell();
  outline.className = 'outline';
  outline.textContent = node.outlineNumber;
  return row;
}

/** The title cell, indented by `depth` when given; a mount row's has its file badge, which opens the file. */
export function addTitleCell(row: HTMLTableRowElement, node: ItemNode, ctx: RenderContext, depth?: number): HTMLTableCellElement {
  const cell = row.insertCell();
  cell.textContent = node.title;
  if (depth !== undefined) cell.style.paddingLeft = `${0.5 + depth * 1.25}em`;
  if (node.mount !== undefined) {
    const path = node.mount;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'file-badge';
    badge.textContent = path.split('/').pop()!;
    badge.title = `Open ${path}`;
    badge.disabled = !ctx.openFile;
    badge.addEventListener('click', (event) => {
      // Opening the file is all it does; the row's own click would move the cursor.
      event.stopPropagation();
      ctx.openFile?.(path);
    });
    cell.append(badge);
  }
  return cell;
}

export function mount(host: HTMLElement, table: HTMLTableElement, ctx: RenderContext): void {
  host.replaceChildren(table);
  if (ctx.scrollToCursor) table.querySelector('.at-cursor, .near-cursor')?.scrollIntoView({ block: 'nearest' });
  // The line hovered in the editor bands the item row on exactly that line of that file, if there is one.
  ctx.onHoverLine?.((at) => {
    for (const row of table.tBodies[0].rows) row.classList.toggle('hover', at !== null && row.dataset.file === at.file && row.dataset.line === String(at.line));
  });
}
