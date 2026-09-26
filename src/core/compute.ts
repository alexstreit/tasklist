// Roll-up computation. Spec §2.7–2.8 and §3.2. Walks the tree bottom-up and
// attaches effective, childSum, mode, done, doneSum and diagnostics.

import type {
  Cell,
  Column,
  Diagnostic,
  DocumentTotal,
  ItemNode,
  Model,
  ModelNode,
  RollupMode,
  SummableCell,
  Tree,
} from './types';
import { formatDuration } from './duration';

export function compute(tree: Tree, columns: Column[]): Model {
  const diagnostics: Diagnostic[] = [...tree.diagnostics];

  const walk = (item: ItemNode, inheritedDone: boolean): ModelNode => {
    const done = inheritedDone || item.done;
    const children = item.children.map((c) => walk(c, done));

    const cells: Cell[] = columns.map((col, i) => {
      const field = item.fields[i];
      if (col.type !== 'duration' && col.type !== 'number') {
        return { kind: 'text', value: field?.text ?? '', span: field?.span ?? null };
      }

      const childSum = children.reduce((sum, c) => sum + (c.cells[i] as SummableCell).effective, 0);
      const childrenHaveValue = children.some((c) => (c.cells[i] as SummableCell).hasValue);
      const raw = field?.text ?? '';
      let mode: RollupMode = 'derived';
      let effective = childSum;
      // An unreadable value counts as empty; readPlan has already said why.
      if (field !== null && field.amount !== null) {
        if (field.additive) {
          mode = 'additive';
          effective = childSum + field.amount;
        } else {
          mode = 'override';
          effective = field.amount;
          if (childrenHaveValue && field.amount !== childSum) {
            const fmt = col.type === 'duration' ? formatDuration : String;
            diagnostics.push({
              line: item.line,
              span: field.span,
              severity: 'info',
              code: 'override-differs',
              message: `override differs from children (${fmt(field.amount)} vs ${fmt(childSum)})`,
            });
          }
        }
      }
      const doneSum = done
        ? effective
        : children.reduce((sum, c) => sum + (c.cells[i] as SummableCell).doneSum, 0);
      const hasValue = mode !== 'derived' || childrenHaveValue;
      return { kind: col.type, effective, childSum, mode, doneSum, hasValue, childrenHaveValue, raw, span: field?.span ?? null };
    });

    return {
      line: item.line,
      span: item.span,
      indent: item.indent,
      title: item.title,
      titleSpan: item.titleSpan,
      done,
      outlineNumber: item.outlineNumber,
      cells,
      children,
      source: item,
    };
  };

  const roots = tree.items.map((item) => walk(item, false));

  const totals: (DocumentTotal | null)[] = columns.map((col, i) => {
    if (col.type !== 'duration' && col.type !== 'number') return null;
    return {
      effective: roots.reduce((sum, r) => sum + (r.cells[i] as SummableCell).effective, 0),
      doneSum: roots.reduce((sum, r) => sum + (r.cells[i] as SummableCell).doneSum, 0),
    };
  });

  diagnostics.sort((a, b) => a.line - b.line);
  return { columns, roots, lines: tree.nodes, totals, diagnostics };
}
