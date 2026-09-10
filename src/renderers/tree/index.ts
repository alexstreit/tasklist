// Tree renderer. Spec §5. Reads the model; never computes.

import { formatDuration } from '../../core';
import type { Column, Model, ModelNode, RenderContext, Renderer, SummableCell } from '../../core';
import './tree.css';

function format(column: Column, value: number): string {
  return column.type === 'duration' ? formatDuration(value) : String(value);
}

function muted(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

function fillSummable(td: HTMLTableCellElement, column: Column, cell: SummableCell): void {
  // An unestimated subtree shows nothing rather than "0h".
  if (!cell.hasValue) return;
  td.textContent = format(column, cell.effective);
  if (cell.childrenHaveValue) td.append(muted(`⟨Σ ${format(column, cell.childSum)}⟩`));
}

export const treeRenderer: Renderer = {
  id: 'tree',
  label: 'Tree',
  requires: [],

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const table = document.createElement('table');
    table.className = 'plan-tree';

    const head = table.createTHead().insertRow();
    for (const name of ['', ...model.columns.map((c) => c.name)]) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }

    const body = table.createTBody();
    const visit = (node: ModelNode, depth: number): void => {
      const row = body.insertRow();
      row.classList.toggle('done', node.done);
      if (node.line === ctx.cursorItem?.line) row.classList.add(ctx.cursorItem.exact ? 'at-cursor' : 'near-cursor');
      row.addEventListener('click', () => ctx.setCursorLine(node.line));
      const title = row.insertCell();
      title.textContent = node.title;
      title.style.paddingLeft = `${0.5 + depth * 1.25}em`;
      node.cells.forEach((cell, i) => {
        const td = row.insertCell();
        if (cell.kind === 'text') td.textContent = cell.value;
        else fillSummable(td, model.columns[i], cell);
      });
      node.children.forEach((child) => visit(child, depth + 1));
    };
    model.roots.forEach((root) => visit(root, 0));

    const foot = table.createTFoot().insertRow();
    foot.className = 'total';
    foot.insertCell().textContent = 'Total';
    model.columns.forEach((column, i) => {
      const td = foot.insertCell();
      const total = model.totals[i];
      if (!total) return;
      td.textContent = format(column, total.effective);
      td.append(muted(`done ${format(column, total.doneSum)}`));
    });

    host.replaceChildren(table);
    if (ctx.scrollToCursor) table.querySelector('.at-cursor, .near-cursor')?.scrollIntoView({ block: 'nearest' });
  },
};
