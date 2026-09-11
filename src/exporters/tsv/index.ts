// TSV exporter: one header row, then one row per item in document order.
// Spec §3.6. Reads effective values off the model; never computes.

import type { Column, Exporter, Model, ModelNode } from '../../core';

/** The format forbids tabs and newlines in fields, but never let one break a row. */
function clean(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ');
}

function header(column: Column): string {
  return column.type === 'duration' ? `${column.name} (h)` : column.name;
}

function row(node: ModelNode, level: number): string {
  const values = node.cells.map((cell) => {
    if (cell.kind === 'text') return clean(cell.value);
    return cell.hasValue ? String(cell.effective) : '';
  });
  // A leading apostrophe makes spreadsheets keep the outline number as text; pasted bare, 1.10 becomes the number 1.1.
  return [`'${node.outlineNumber}`, String(level), clean(node.title), ...values, node.done ? 'TRUE' : 'FALSE'].join('\t');
}

export const tsvExporter: Exporter = {
  id: 'tsv',
  label: 'Copy for Excel',

  export(model: Model): { mime: string; data: string } {
    const lines = [['#', 'level', 'title', ...model.columns.map(header), 'done'].join('\t')];
    const visit = (node: ModelNode, level: number): void => {
      lines.push(row(node, level));
      node.children.forEach((child) => visit(child, level + 1));
    };
    model.roots.forEach((root) => visit(root, 1));
    return { mime: 'text/tab-separated-values', data: lines.join('\n') };
  },
};
