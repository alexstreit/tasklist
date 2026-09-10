// Flat table renderer. One row per item with a level column, no nesting.

import type { Model, ModelNode, RenderContext, Renderer } from '../../core';
import { addItemRow, addTotalRow, addValueCells, createGrid, mount } from '../grid';

export const tableRenderer: Renderer = {
  id: 'table',
  label: 'Table',
  requires: [],

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const table = createGrid('plan-table', ['level', ''], model);
    const visit = (node: ModelNode, level: number): void => {
      const row = addItemRow(table, node, ctx);
      const levelCell = row.insertCell();
      levelCell.className = 'level';
      levelCell.textContent = String(level);
      row.insertCell().textContent = node.title;
      addValueCells(row, node, model);
      node.children.forEach((child) => visit(child, level + 1));
    };
    model.roots.forEach((root) => visit(root, 1));
    addTotalRow(table, ['', 'Total'], model);
    mount(host, table, ctx);
  },
};
