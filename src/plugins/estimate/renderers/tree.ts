// Tree renderer. Spec §5. One row per item, nesting shown by indentation.

import type { ItemNode, Model, RenderContext, Renderer } from '../../../core';
import { addItemRow, addTitleCell, createGrid, mount } from '../../../ui/grid';
import { addTotalRow, addValueCells, requires } from './shared';

export const treeRenderer: Renderer = {
  id: 'tree',
  label: 'Tree',
  requires,

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const table = createGrid('plan-tree', ['#', '', ...model.columns.map((c) => c.name)]);
    const visit = (node: ItemNode, depth: number): void => {
      const row = addItemRow(table, node, ctx, model);
      addTitleCell(row, node, ctx, depth);
      addValueCells(row, node, model);
      node.children.forEach((child) => visit(child, depth + 1));
    };
    model.roots.forEach((root) => visit(root, 0));
    addTotalRow(table, ['', 'Total'], model);
    mount(host, table, ctx);
  },
};
