// The fixes for rows errors on a row (spec §4b.6.6): the tree, title and cell cases, and the
// identity cases. Each fix is added to the diagnostic of the error it resolves.

import { applyEdits, formatValue, repairRow, setCell } from 'rows';
import type { Cell, Row, RowsDocument, RowsError, TextEdit } from 'rows';
import type { Diagnostic, Fix } from './types';

const RECOVERED = new Set(['unterminated-quote', 'text-after-quote', 'unknown-escape']);
const REPAIRED = new Set([...RECOVERED, 'heading-line', 'bad-indent']);
const OVERFLOW = new Set(['too-many-cells', 'unnamed-after-named', 'invalid-cell-name']);

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

/** A confirm fix: its preview is made from its edits. */
export function confirm(text: string, label: string, edits: TextEdit[], extra: Partial<Fix> = {}): Fix {
  return { label, tier: 'confirm', edits, preview: preview(text, edits), ...extra };
}

const isWs = (c: string | undefined) => c === ' ' || c === '\t';

/** Removes a cell that isn't the lead, together with the delimiter before it and the whitespace around that. */
function removeCell(text: string, cell: Cell): TextEdit {
  let d = cell.from - 1;
  while (isWs(text[d])) d--; // the delimiter
  while (isWs(text[d - 1])) d--;
  return { from: d, to: cell.to, insert: '' };
}

/**
 * The overflow fixes (spec §4b.6.6): the extra values are the overflow cells, other than a column's
 * repeat, and any cell whose name is no column's. "Rejoin into NOTES", when the last declared column
 * is text: its value becomes the original text from its cell (or from the first extra value, written
 * by name) to the end of the line, provided nothing but extra values comes after that. "Delete extra values".
 */
function overflowFixes(doc: RowsDocument, row: Row): Fix[] {
  const { text, schema } = doc;
  const named = new Set(row.errors.filter((e) => e.code === 'invalid-cell-name').map((e) => e.from));
  const repeats = new Set(row.errors.filter((e) => e.code === 'column-set-twice').map((e) => e.from));
  const cells = [...row.cells.slice(1), ...row.overflow].filter((c): c is Cell => c !== null).sort((a, b) => a.from - b.from);
  const inside = (c: Cell, set: Set<number | undefined>) => [...set].some((from) => from !== undefined && from >= c.from && from < c.to);
  const extras = cells.filter((c) => (c.column === null && !inside(c, repeats)) || inside(c, named));
  if (extras.length === 0) return [];
  const fixes: Fix[] = [];

  const declared = schema.columns.filter((c) => c.index > 0 && !c.implicit);
  const notes = declared[declared.length - 1];
  const notesCell = notes && notes.kind === 'text' ? row.cells[notes.index] : undefined;
  const start = notesCell ?? (notes?.kind === 'text' && notes.settable ? extras[0] : undefined);
  if (start && cells.every((c) => c.from < start.from || c === start || extras.includes(c))) {
    let end = row.to;
    while (isWs(text[end - 1])) end--;
    if (text[end - 1] === schema.sep) end--; // a trailing delimiter is not part of the text
    while (isWs(text[end - 1])) end--;
    const from = start === notesCell ? start.valueFrom : start.from;
    const value = formatValue(doc, notes, text.slice(from, end));
    const edits = [{ from, to: end, insert: start === notesCell ? value : `${notes.name}=${value}` }];
    fixes.push({ label: `Rejoin into ${notes.name}`, tier: 'click', edits });
  }

  const edits = extras
    .map((c) => {
      if (c.column === null) return [removeCell(text, c)];
      const result = setCell(doc, row, c.column, null);
      return 'edits' in result ? result.edits : [];
    })
    .flat();
  if (edits.length > 0) fixes.push(confirm(text, 'Delete extra values', edits));
  return fixes;
}

/** "Keep this value", for each of a column's two values (spec §4b.6.6). The repeat is overflow. */
function keepFixes(doc: RowsDocument, row: Row, e: RowsError): Fix[] {
  const repeat = row.overflow.find((c) => e.from! >= c.from && e.from! < c.to);
  const column = repeat?.name && doc.schema.columns.find((c) => c.name === repeat.name!.text && c.index > 0);
  const first = column ? row.cells[column.index] : null;
  if (!repeat || !column || !first) return [];
  const remove = removeCell(doc.text, repeat);
  const keep = (cell: Cell) => `Keep ${column.name}=${cell.text ?? ''}`;
  return [
    confirm(doc.text, keep(first), [remove]),
    confirm(doc.text, keep(repeat), [{ from: first.valueFrom, to: first.valueTo, insert: doc.text.slice(repeat.valueFrom, repeat.valueTo) }, remove]),
  ];
}

export function rowFixes(doc: RowsDocument, row: Row, diagnosticOf: (e: RowsError) => Diagnostic): void {
  const add = (e: RowsError, fix: Fix) => (diagnosticOf(e).fixes ??= []).push(fix);
  const cells: Cell[] = [...row.cells.filter((c): c is Cell => c !== null), ...row.overflow];
  const repairs = row.errors.some((e) => REPAIRED.has(e.code)) ? repairRow(doc, row) : [];
  // Indent repairs may move the rows after this one; cell repairs stay inside it.
  const inRow = (e: TextEdit) => e.from >= row.indent.to && e.to <= row.to;
  const indents = repairs.filter((e) => !inRow(e));
  const overflow = row.errors.some((e) => OVERFLOW.has(e.code)) ? overflowFixes(doc, row) : [];

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
    } else if (OVERFLOW.has(e.code)) {
      for (const fix of overflow) add(e, fix);
    } else if (e.code === 'column-set-twice') {
      for (const fix of keepFixes(doc, row, e)) add(e, fix);
    } else if (e.code === 'parent-mismatch' || e.code === 'parent-cycle') {
      const nest = doc.schema.nest!.column;
      const result = row.cells[nest.index]?.text != null ? setCell(doc, row, nest, null) : null;
      if (result && 'edits' in result) add(e, { label: 'Use indentation', tier: 'click', edits: result.edits });
    }
  }
}

/**
 * "Rename the later one" (spec §4b.6.6), on each row whose ID, or an alias, repeats one declared
 * earlier, or differs from it only by case. It mints `ID-2`, `ID-3`… unused in any case. The warning
 * says how many references to the ID there are, since it's unclear which row they meant.
 */
export function identityFixes(doc: RowsDocument, diagnosticOf: (e: RowsError) => Diagnostic): void {
  const key = doc.schema.key;
  if (!key) return;
  // Every declared ID in document order: the anchors, or the key cell of a row without one.
  type Declared = { row: Row; id: string; anchor: Row['anchors'][number] | null };
  const declared = doc.rows.flatMap((row): Declared[] => {
    if (row.anchors.length > 0) return row.anchors.map((a) => ({ row, id: a.id, anchor: a }));
    const cell = row.cells[key.index];
    return row.id !== null && cell ? [{ row, id: row.id, anchor: null }] : [];
  });
  const used = new Set(declared.map((d) => d.id.toLowerCase()));
  const refs = (id: string) =>
    doc.rows.flatMap((r) => r.cells).filter((c) => c?.value?.type === 'ref' && c.value.refs.some((ref) => ref.id.toLowerCase() === id.toLowerCase())).length;

  declared.forEach((d, i) => {
    const earlier = declared.slice(0, i).find((x) => x.id.toLowerCase() === d.id.toLowerCase());
    if (!earlier) return;
    const code = earlier.id === d.id ? 'duplicate-id' : 'id-case-conflict';
    const error = d.row.errors.find((e) => e.code === code);
    if (!error) return;
    let n = 2;
    while (used.has(`${d.id}-${n}`.toLowerCase())) n++;
    const minted = `${d.id}-${n}`;
    used.add(minted.toLowerCase());
    let edits: TextEdit[];
    if (d.anchor) edits = [{ from: d.anchor.from + 1, to: d.anchor.to, insert: minted }];
    else {
      const result = setCell(doc, d.row, key, minted);
      if (!('edits' in result)) return;
      edits = result.edits;
    }
    const count = refs(d.id);
    const warning =
      count === 0 ? undefined : `${count === 1 ? 'A row refers' : `${count} rows refer`} to #${d.id}. It isn't clear which task ${count === 1 ? 'it meant' : 'they meant'}, so check ${count === 1 ? 'it' : 'them'} after renaming.`;
    (diagnosticOf(error).fixes ??= []).push(confirm(doc.text, 'Rename the later one', edits, warning ? { warning } : {}));
  });
}
