// The fixes for rows errors on a row (spec §4b.6.6): the tree, title and cell cases, and the
// identity cases. Each fix is added to the diagnostic of the error it resolves.

import { applyEdits, formatValue, isWs, RECOVERED_CODES, removeCell, repairs, setCell } from 'rows';
import type { Cell, Row, RowsDocument, RowsError, TextEdit } from 'rows';
import type { Diagnostic, Fix } from './types';

const REPAIRED = new Set([...RECOVERED_CODES, 'heading-line', 'bad-indent']);
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

/** Where a position in the text ends up after the edits; a position inside a replaced span goes to its start. */
export function mapPos(pos: number, edits: TextEdit[]): number {
  let out = pos;
  for (const e of edits) {
    if (e.to <= pos) out += e.insert.length - (e.to - e.from);
    else if (e.from < pos) out -= pos - e.from;
  }
  return out;
}

/** A confirm fix: its preview is made from its edits. */
export function confirm(text: string, label: string, edits: TextEdit[], extra: Partial<Fix> = {}): Fix {
  return { label, tier: 'confirm', edits, preview: preview(text, edits), ...extra };
}

/**
 * The overflow fixes (spec §4b.6.6): the extra values are the overflow cells, other than a column's
 * repeat, and any cell whose name is no column's. "Rejoin into NOTES", when the last declared column
 * is text and the row has a cell in it: its value becomes the original text from that cell to the end
 * of the line, provided nothing but extra values comes after it. "Delete extra values".
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
  const start = notes && notes.kind === 'text' ? row.cells[notes.index] : null;
  if (start && cells.every((c) => c.from < start.from || c === start || extras.includes(c))) {
    let end = row.to;
    while (isWs(text[end - 1])) end--;
    if (text[end - 1] === schema.sep) end--; // a trailing delimiter is not part of the text
    while (isWs(text[end - 1])) end--;
    const edits = [{ from: start.valueFrom, to: end, insert: formatValue(doc, notes, text.slice(start.valueFrom, end)) }];
    fixes.push({ label: `Rejoin into ${notes.name}`, tier: 'click', edits });
  }

  const edits = extras
    .map((c) => {
      if (c.column === null) return [removeCell(doc, row, c)];
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
  const remove = removeCell(doc, row, repeat);
  const keep = (cell: Cell) => `Keep ${column.name}=${cell.text ?? ''}`;
  return [
    confirm(doc.text, keep(first), [remove]),
    confirm(doc.text, keep(repeat), [{ from: first.valueFrom, to: first.valueTo, insert: doc.text.slice(repeat.valueFrom, repeat.valueTo) }, remove]),
  ];
}

export function rowFixes(doc: RowsDocument, row: Row, diagnosticOf: (e: RowsError) => Diagnostic): void {
  const add = (e: RowsError, fix: Fix) => (diagnosticOf(e).fixes ??= []).push(fix);
  const cells: Cell[] = [...row.cells.filter((c): c is Cell => c !== null), ...row.overflow];
  const repaired = row.errors.some((e) => REPAIRED.has(e.code)) ? repairs(doc, row) : [];
  const indents = repaired.find((r) => r.kind === 'indent')?.edits ?? [];
  const overflow = row.errors.some((e) => OVERFLOW.has(e.code)) ? overflowFixes(doc, row) : [];

  for (const e of row.errors) {
    if (e.code === 'bad-indent' && indents.length > 0) {
      add(e, { label: doc.rows[0] === row ? 'Indent 0' : 'Rewrite the indent', tier: 'auto', edits: indents });
    } else if (e.code === 'heading-line') {
      // Quoted by the title repair, or by rewriting the lead when it is also broken.
      const quote = repaired.find((r) => r.kind === 'title' || (r.kind === 'cell' && r.cell === row.lead));
      if (quote) add(e, { label: 'Quote the title', tier: 'auto', edits: quote.edits });
    } else if (RECOVERED_CODES.has(e.code)) {
      const cell = cells.find((c) => e.from! >= c.from && e.to! <= c.to);
      const rewrite = repaired.find((r) => r.kind === 'cell' && r.cell === cell);
      if (rewrite) add(e, { label: 'Rewrite the cell', tier: 'auto', edits: rewrite.edits });
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

/**
 * A click fix that writes today's date as `key`'s value: in place of the value when the key is
 * written, else as a new line before the closing `---`. The date is left for the editor to fill in
 * (`resolveFix`); null when the file has no frontmatter to write it in.
 */
export function todayFix(doc: RowsDocument, key: string, label: string): Fix | null {
  const frontmatter = doc.frontmatter;
  if (!frontmatter) return null;
  const entry = frontmatter.entries.find((e) => e.key === key);
  const close = doc.lines.find((l) => l.from <= frontmatter.to && frontmatter.to <= l.to)!.from;
  const input: NonNullable<Fix['input']> = entry
    ? { span: { from: entry.valueFrom, to: entry.valueTo }, value: '', suggest: 'today' }
    : { span: { from: close, to: close }, value: '', suggest: 'today', before: `${key}: `, after: '\n' };
  return { label, tier: 'click', edits: [inputEdit(input, '')], input };
}

/** The edit that writes `value` in place of the input's span, between its `before` and `after`. */
export function inputEdit(input: NonNullable<Fix['input']>, value: string): TextEdit {
  return { ...input.span, insert: `${input.before ?? ''}${value}${input.after ?? ''}` };
}

/**
 * The fix with its edits complete: one whose input suggests today's date gets `date` in its edits,
 * its value and its label, and no longer suggests anything. Pure: the caller passes the date, so core stays clock-free. The editors
 * call it with today's date when they show a fix; any other fix comes back as it is.
 */
export function resolveFix(fix: Fix, date: string): Fix {
  if (fix.input?.suggest !== 'today') return fix;
  // Resolved, it suggests nothing more, so resolving it again changes nothing.
  const { suggest: _, ...input } = fix.input;
  return { ...fix, label: `${fix.label} (${date})`, edits: [inputEdit(input, date)], input: { ...input, value: date } };
}
