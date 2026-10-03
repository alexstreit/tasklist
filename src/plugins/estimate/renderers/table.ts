// Flat table renderer. One row per item with a level column, no nesting.

import type { ItemNode, Model, RenderContext, Renderer } from '../../../core';
import { addItemRow, addTitleCell, createGrid, mount, shows } from '../../../ui/grid';
import { addTotalRow, addValueCells, requires } from './shared';

export const tableRenderer: Renderer = {
  id: 'table',
  label: 'Table',
  requires,

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const table = createGrid('plan-table', ['#', 'level', '', ...model.columns.map((c) => c.name)]);
    const visit = (node: ItemNode, level: number): void => {
      if (shows(ctx, node)) {
        const row = addItemRow(table, node, ctx, model);
        const levelCell = row.insertCell();
        levelCell.className = 'level';
        levelCell.textContent = String(level);
        addTitleCell(row, node, ctx);
        addValueCells(row, node, model);
      }
      node.children.forEach((child) => visit(child, level + 1));
    };
    model.roots.forEach((root) => visit(root, 1));
    addTotalRow(table, ['', '', 'Total'], model);
    mount(host, table, ctx);
  },
};
