// The fixes for rows errors on a row (spec §4b.6.6): the tree and title cases, and the cells
// repairRow rewrites. Each fix is added to the diagnostic of the error it resolves.

import { applyEdits, repairRow, setCell } from 'rows';
import type { Cell, Row, RowsDocument, RowsError, TextEdit } from 'rows';
import type { Diagnostic, Fix } from './types';

const RECOVERED = new Set(['unterminated-quote', 'text-after-quote', 'unknown-escape']);
const REPAIRED = new Set([...RECOVERED, 'heading-line', 'bad-indent']);

/** The lines the edits touch, before (`- `) and after (`+ `). Spec §4b.6.2. */
export function preview(text: string, edits: TextEdit[]): string {
  const from = text.lastIndexOf('\n', Math.min(...edits.map((e) => e.from)) - 1) + 1;
  const end = text.indexOf('\n', Math.max(...edits.map((e) => e.to)));
  const to = end === -1 ? text.length : end;
  const before = text.slice(from, to);
  const after = applyEdits(before, edits.map((e) => ({ ...e, from: e.from - from, to: e.to - from })));
  const mark = (prefix: string, lines: string) => lines.split('\n').map((line) => `${prefix}${line}`);
  return [...mark('- ', before), ...mark('+ ', after)].join('\n');
}

export function rowFixes(doc: RowsDocument, row: Row, diagnosticOf: (e: RowsError) => Diagnostic): void {
  const add = (e: RowsError, fix: Fix) => (diagnosticOf(e).fixes ??= []).push(fix);
  const cells: Cell[] = [...row.cells.filter((c): c is Cell => c !== null), ...row.overflow];
  const repairs = row.errors.some((e) => REPAIRED.has(e.code)) ? repairRow(doc, row) : [];
  // Indent repairs may move the rows after this one; cell repairs stay inside it.
  const inRow = (e: TextEdit) => e.from >= row.indent.to && e.to <= row.to;
  const indents = repairs.filter((e) => !inRow(e));

  for (const e of row.errors) {
    if (e.code === 'bad-indent' && indents.length > 0) {
      add(e, { label: doc.rows[0] === row ? 'Indent 0' : 'Rewrite the indent', tier: 'auto', edits: indents });
    } else if (e.code === 'heading-line') {
      const quote = repairs.find((r) => inRow(r) && r.from === row.lead.valueFrom);
      if (quote) add(e, { label: 'Quote the title', tier: 'auto', edits: [quote] });
    } else if (RECOVERED.has(e.code)) {
      const cell = cells.find((c) => e.from! >= c.from && e.to! <= c.to);
      const rewrite = cell && repairs.find((r) => inRow(r) && r.from === cell.valueFrom);
      if (rewrite) add(e, { label: 'Rewrite the cell', tier: 'auto', edits: [rewrite] });
    } else if (e.code === 'repeated-marker') {
      add(e, { label: 'Remove extra marker', tier: 'click', edits: [{ from: e.from!, to: e.to!, insert: '' }] });
    } else if (e.code === 'parent-mismatch' || e.code === 'parent-cycle') {
      const nest = doc.schema.nest!.column;
      const result = row.cells[nest.index]?.text != null ? setCell(doc, row, nest, null) : null;
      if (result && 'edits' in result) add(e, { label: 'Use indentation', tier: 'click', edits: result.edits });
    }
  }
}
