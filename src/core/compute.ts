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
import { formatDuration, parseDuration, parseNumber } from './duration';

export function compute(tree: Tree, columns: Column[], columnDiagnostics: Diagnostic[] = []): Model {
  const diagnostics: Diagnostic[] = [...tree.diagnostics, ...columnDiagnostics];

  const walk = (item: ItemNode, inheritedDone: boolean): ModelNode => {
    const done = inheritedDone || item.done;
    const children = item.children.map((c) => walk(c, done));

    if (item.fields.length > columns.length) {
      diagnostics.push({
        line: item.line,
        span: item.fields[columns.length].span,
        severity: 'warning',
        message: `more fields than declared columns; extra fields are ignored`,
      });
    }

    const cells: Cell[] = columns.map((col, i) => {
      const field = item.fields[i];
      if (col.type === 'text') {
        return { kind: 'text', value: field?.value ?? '', span: field?.span ?? null };
      }

      const childSum = children.reduce((sum, c) => sum + (c.cells[i] as SummableCell).effective, 0);
      const raw = field?.value ?? '';
      let mode: RollupMode = 'derived';
      let effective = childSum;
      if (raw !== '') {
        const parsed = col.type === 'duration' ? parseDuration(raw) : parseNumber(raw);
        if (parsed === null) {
          diagnostics.push({
            line: item.line,
            span: field.span,
            severity: 'warning',
            message: `unparseable ${col.type}: "${raw}"`,
          });
        } else if (parsed.additive) {
          mode = 'additive';
          effective = childSum + parsed.value;
        } else {
          mode = 'override';
          effective = parsed.value;
          if (children.length > 0 && parsed.value !== childSum) {
            const fmt = col.type === 'duration' ? formatDuration : String;
            diagnostics.push({
              line: item.line,
              span: field.span,
              severity: 'info',
              message: `override differs from children (${fmt(parsed.value)} vs ${fmt(childSum)})`,
            });
          }
        }
      }
      const doneSum = done
        ? effective
        : children.reduce((sum, c) => sum + (c.cells[i] as SummableCell).doneSum, 0);
      return { kind: col.type, effective, childSum, mode, doneSum, raw, span: field?.span ?? null };
    });

    return {
      line: item.line,
      span: item.span,
      indent: item.indent,
      title: item.title,
      titleSpan: item.titleSpan,
      done,
      cells,
      children,
      source: item,
    };
  };

  const roots = tree.items.map((item) => walk(item, false));

  const totals: (DocumentTotal | null)[] = columns.map((col, i) => {
    if (col.type === 'text') return null;
    return {
      effective: roots.reduce((sum, r) => sum + (r.cells[i] as SummableCell).effective, 0),
      doneSum: roots.reduce((sum, r) => sum + (r.cells[i] as SummableCell).doneSum, 0),
    };
  });

  diagnostics.sort((a, b) => a.line - b.line);
  return { columns, roots, totals, diagnostics };
}
