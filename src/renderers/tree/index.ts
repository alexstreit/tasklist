// Tree renderer. Spec §5. One row per item, nesting shown by indentation.

import type { Model, ModelNode, RenderContext, Renderer } from '../../core';
import { addItemRow, addTotalRow, addValueCells, createGrid, mount } from '../grid';

export const treeRenderer: Renderer = {
  id: 'tree',
  label: 'Tree',
  requires: [],

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const table = createGrid('plan-tree', [''], model);
    const visit = (node: ModelNode, depth: number): void => {
      const row = addItemRow(table, node, ctx);
      const title = row.insertCell();
      title.textContent = node.title;
      title.style.paddingLeft = `${0.5 + depth * 1.25}em`;
      addValueCells(row, node, model);
      node.children.forEach((child) => visit(child, depth + 1));
    };
    model.roots.forEach((root) => visit(root, 0));
    addTotalRow(table, ['Total'], model);
    mount(host, table, ctx);
  },
};
