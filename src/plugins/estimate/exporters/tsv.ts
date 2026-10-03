// TSV exporter: one header row, then one row per item in document order.
// Spec §3.6. Reads effective values off the model; never computes.

import type { Column, Exporter, ItemNode, Model } from '../../../core';
import { hasValue, rollup } from '../fields';

/** The format forbids tabs and newlines in fields, but never let one break a row. */
function clean(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ');
}

function header(column: Column): string {
  return column.type === 'duration' ? `${column.name} (h)` : column.name;
}

function row(model: Model, node: ItemNode, level: number): string {
  const values = model.columns.map((column, i) => {
    const cell = model.get(node, rollup)?.get(column.name);
    if (!cell) return clean(model.field(node, i)?.text ?? '');
    return model.get(node, hasValue)?.get(column.name) ? String(cell.effective) : '';
  });
  // A leading apostrophe makes spreadsheets keep the outline number as text; pasted bare, 1.10 becomes the number 1.1.
  return [`'${node.outlineNumber}`, String(level), clean(node.title), ...values, node.done ? 'TRUE' : 'FALSE'].join('\t');
}

export const tsvExporter: Exporter = {
  id: 'tsv',
  label: 'Copy for Excel',
  requires: [rollup, hasValue],

  export(model: Model): { mime: string; data: string } {
    const lines = [['#', 'level', 'title', ...model.columns.map(header), 'done'].join('\t')];
    const visit = (node: ItemNode, level: number): void => {
      lines.push(row(model, node, level));
      node.children.forEach((child) => visit(child, level + 1));
    };
    model.roots.forEach((root) => visit(root, 1));
    return { mime: 'text/tab-separated-values', data: lines.join('\n') };
  },
};
