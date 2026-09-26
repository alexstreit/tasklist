// Format-preserving edits (DESIGN §6). Hosts never re-serialise a document: they ask for TextEdit[]
// against the text the library parsed, apply them, and parse again. Edits write any value; whether
// it is valid is the parser's business.
import { isWs } from './text';
import { HEADING, isDelimiterLine, NAMED, TRAILING_ANCHORS } from './tokenize';
import type { Cell, Column, Row, RowsDocument } from './types';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Applies non-overlapping edits to the text they were made against. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  return [...edits].sort((a, b) => b.from - a.from).reduce((t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to), text);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * A value as it must be written to read back as `text`: quoted exactly when base §3 requires, or
 * when the value would otherwise be misread (base §7), as a lead that reads as a marker, an anchor,
 * a heading, a comment or a frontmatter delimiter.
 */
export function formatValue(doc: RowsDocument, column: Column | 'lead', text: string): string {
  const { sep, comment, markers, extensions } = doc.schema;
  const lead = column === 'lead' || column.index === 0;
  const needsQuotes =
    text === '' ||
    text.includes(sep) ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.startsWith('"') ||
    isWs(text[0]) ||
    isWs(text[text.length - 1]) ||
    (!lead && NAMED.test(text)) ||
    (lead &&
      (HEADING.test(text) ||
        text.startsWith(comment) ||
        isDelimiterLine(text) ||
        (extensions && (markers.some((m) => text.startsWith(m.char)) || TRAILING_ANCHORS.test(text)))));
  if (!needsQuotes) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

// ---------- helpers ----------

/** The lead and every other cell, in source order. */
function sourceCells(row: Row): Cell[] {
  const others = [...row.cells.slice(1).filter((c): c is Cell => c !== null), ...row.overflow];
  return [row.lead, ...others.sort((a, b) => a.from - b.from)];
}

function isUnterminated(row: Row, cell: Cell): boolean {
  return row.errors.some((e) => e.code === 'unterminated-quote' && e.from === cell.valueFrom);
}

/** Replaces a value span, keeping a space between it and a neighbouring delimiter or anchor. */
function replaceValue(doc: RowsDocument, cell: Cell, value: string): TextEdit {
  const { sep } = doc.schema;
  let insert = value;
  if (cell.valueFrom === cell.valueTo && value !== '') {
    if (doc.text[cell.valueFrom - 1] === sep) insert = ' ' + insert;
    if (doc.text[cell.valueTo] === sep || doc.text[cell.valueTo] === '{') insert += ' ';
  }
  return { from: cell.valueFrom, to: cell.valueTo, insert };
}

/** Appends a cell at the end of the row, after any trailing delimiter. */
function appendCell(doc: RowsDocument, row: Row, cellText: string): TextEdit[] {
  const { sep } = doc.schema;
  const cells = sourceCells(row);
  const last = cells[cells.length - 1];
  let prefix = '';
  if (isUnterminated(row, last)) {
    // Close the quote where its text ends, so the text is unchanged and the new cell isn't inside it.
    const backslashes = /\\*$/.exec(doc.text.slice(last.valueFrom + 1, last.valueTo))![0].length;
    prefix = backslashes % 2 === 1 ? '\\"' : '"';
  }
  const rest = doc.text.slice(last.to, row.to);
  const trailing = rest.indexOf(sep);
  if (trailing !== -1 && prefix === '') return [{ from: last.to + trailing + 1, to: last.to + trailing + 1, insert: ` ${cellText}` }];
  return [{ from: last.to, to: last.to, insert: `${prefix} ${sep} ${cellText}` }];
}

/**
 * Removes a cell together with the delimiter before it and the whitespace around that. A row must
 * keep something on its line, so a delimiter that begins the row stays.
 */
function removeCell(doc: RowsDocument, row: Row, cell: Cell): TextEdit {
  let d = cell.from - 1;
  while (d >= 0 && isWs(doc.text[d])) d--; // d is now the delimiter
  if (d === row.indent.to && row.markers.length === 0) return { from: d + 1, to: cell.to, insert: '' };
  let from = d;
  while (from > row.from && isWs(doc.text[from - 1])) from--;
  return { from, to: cell.to, insert: '' };
}

// ---------- the edit functions ----------

/** Replaces the lead value only, so the indent, markers and anchors survive (DESIGN §6). */
export function setLead(doc: RowsDocument, row: Row, text: string): TextEdit[] {
  return [replaceValue(doc, row.lead, formatValue(doc, 'lead', text))];
}

/**
 * Sets one cell (DESIGN §6). Returns no edits when the value can't be written: the key of a row
 * whose ID is in an anchor, set to null or to text that isn't an ID; or a column that can't be
 * named, when it isn't set and isn't the next positional slot.
 */
export function setCell(doc: RowsDocument, row: Row, column: Column, text: string | null): TextEdit[] {
  if (column.index === 0) return setLead(doc, row, text ?? '');
  const cell = row.cells[column.index];

  // The ID of an anchored row lives in the anchor: rename it there, and in the key cell if written.
  if (column === doc.schema.key && row.anchors.length > 0) {
    if (text === null || !ID.test(text)) return [];
    const anchor = row.anchors[0];
    const edits: TextEdit[] = [{ from: anchor.from + 1, to: anchor.to, insert: text }];
    if (cell && cell.text !== null) edits.push(replaceValue(doc, cell, formatValue(doc, column, text)));
    return edits;
  }

  if (cell) {
    if (text !== null) return [replaceValue(doc, cell, formatValue(doc, column, text))];
    if (cell.text === null) return [];
    const cells = sourceCells(row);
    const later = cells.slice(cells.indexOf(cell) + 1);
    // Removing a named cell must not turn later unnamed (overflow) cells positional.
    if (later.length === 0 || (cell.name && later.every((c) => c.name))) return [removeCell(doc, row, cell)];
    return [{ from: cell.valueFrom, to: cell.valueTo, insert: '' }];
  }

  if (text === null) return [];
  const value = formatValue(doc, column, text);
  const positional = row.cells.filter((c, i) => i > 0 && c && !c.name).length;
  const named = [...row.cells.slice(1), ...row.overflow].some((c) => c?.name);
  if (!column.implicit && column.index === positional + 1 && !named && row.overflow.length === 0) return appendCell(doc, row, value);
  if (column.settable) return appendCell(doc, row, `${column.name}=${value}`);
  return [];
}

/** The value a bool column has for a row: its marker, its cell, or its default. */
function flag(doc: RowsDocument, row: Row, column: Column): boolean | null {
  const marker = doc.schema.markers.find((m) => m.column === column);
  if (marker && row.markers.some((m) => m.name === marker.name)) return true;
  const value = row.cells[column.index]?.value;
  if (value?.type === 'bool') return value.value;
  return column.default?.type === 'bool' ? column.default.value : null;
}

/**
 * Turns a flag on or off (DESIGN §6): the marker character straight after the indent when the
 * column has one, otherwise the value by name. A cell that contradicts the result is corrected.
 */
export function setMarker(doc: RowsDocument, row: Row, name: string, on: boolean): TextEdit[] {
  const marker = doc.schema.markers.find((m) => m.name === name);
  const column = marker?.column ?? doc.schema.columns.find((c) => c.name === name && c.index > 0);
  if (!column) return [];
  const cell = row.cells[column.index];
  const cellValue = cell?.value?.type === 'bool' ? cell.value.value : null;

  if (!marker) {
    if (flag(doc, row, column) === on) return [];
    const removes = !on && column.default?.type === 'bool' && !column.default.value && cell?.text != null;
    return setCell(doc, row, column, removes ? null : String(on));
  }

  const edits: TextEdit[] = [];
  const present = row.markers.find((m) => m.name === name);
  if (on) {
    if (!present) edits.push({ from: row.indent.to, to: row.indent.to, insert: marker.char });
    if (cellValue === false) edits.push(...setCell(doc, row, column, null));
    return edits;
  }
  if (present) {
    let to = present.to;
    while (isWs(doc.text[to])) to++; // a marker is removed with the whitespace after it
    // A row must keep something on its line: a row that was only this marker keeps a delimiter.
    const rest = doc.text.slice(row.indent.to, present.from) + doc.text.slice(to, row.to);
    edits.push({ from: present.from, to, insert: /^[ \t]*$/.test(rest) ? doc.schema.sep : '' });
    // Without the marker, the lead might read as a marker, a heading or a comment: quote it.
    const lead = row.lead;
    if (lead.text !== null && !lead.quoted && formatValue(doc, 'lead', lead.text) !== lead.text) {
      edits.push({ from: lead.valueFrom, to: lead.valueTo, insert: formatValue(doc, 'lead', lead.text) });
    }
  }
  if (cellValue === true) edits.push(...setCell(doc, row, column, null));
  else if (column.default?.type === 'bool' && column.default.value && cellValue === null) edits.push(...setCell(doc, row, column, 'false'));
  return edits;
}

/**
 * Inserts a row (DESIGN §6). Declared columns are written positionally while they run on from the
 * lead, and the rest by name; implicit columns are always named. A column that can't be named is
 * written in position, with empty cells before it. `cells` names columns; any other name throws.
 */
export function insertRow(
  doc: RowsDocument,
  at: { beforeLine: number } | 'end',
  indent: number,
  lead: string,
  cells: Record<string, string> = {},
): TextEdit[] {
  const { columns, sep } = doc.schema;
  const wanted = Object.keys(cells).map((name) => {
    const column = columns.find((c) => c.name === name && c.index > 0);
    if (!column) throw new Error(`insertRow: no column named ${name}`);
    return column;
  });
  const declared = columns.filter((c) => c.index > 0 && !c.implicit);
  let run = 0;
  while (run < declared.length && declared[run].name in cells) run++;
  for (const c of wanted) if (!c.settable && !c.implicit) run = Math.max(run, c.index);
  const parts = [' '.repeat(indent) + formatValue(doc, 'lead', lead)];
  for (const c of declared.slice(0, run)) parts.push(c.name in cells ? formatValue(doc, c, cells[c.name]) : '');
  for (const c of wanted) {
    if (c.index <= run && !c.implicit) continue;
    if (!c.settable) throw new Error(`insertRow: column ${c.name} can't be named`);
    parts.push(`${c.name}=${formatValue(doc, c, cells[c.name])}`);
  }
  const line = parts.join(` ${sep} `);

  if (at !== 'end' && at.beforeLine <= doc.lines.length) {
    const from = doc.lines[at.beforeLine - 1].from;
    return [{ from, to: from, insert: line + '\n' }];
  }
  const end = doc.text.length;
  if (doc.text === '') return [{ from: 0, to: 0, insert: line }];
  return [{ from: end, to: end, insert: doc.endsWithNewline ? line + '\n' : '\n' + line }];
}
