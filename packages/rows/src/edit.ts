// Format-preserving edits (DESIGN §6). Hosts never re-serialise a document: they ask for TextEdit[]
// against the text the library parsed, apply them, and parse again. Edits write any value; whether
// it is valid is the parser's business.
import { indentLevels } from './extensions';
import { isWs } from './text';
import { HEADING, isDelimiterLine, NAMED, TRAILING_ANCHORS } from './tokenize';
import type { Cell, Column, Row, RowsDocument } from './types';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** What an edit function returns: the edits to apply (none when there is nothing to change), or why it won't write. */
export type EditResult = { edits: TextEdit[] } | { refused: string };

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
  return quote(doc, column === 'lead' || column.index === 0, text);
}

/** formatValue for a lead or any other cell, overflow cells included. */
function quote(doc: RowsDocument, lead: boolean, text: string): string {
  const { sep, comment, markers, extensions } = doc.schema;
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
export function setLead(doc: RowsDocument, row: Row, text: string): EditResult {
  return { edits: [replaceValue(doc, row.lead, formatValue(doc, 'lead', text))] };
}

/**
 * Sets one cell (DESIGN §6). Refuses when the value can't be written: the key of a row whose ID is
 * in an anchor, set to null or to text that isn't an ID; or a column that can't be named, when it
 * isn't set, isn't the next positional slot, and padding up to it would follow a named or overflow cell.
 */
export function setCell(doc: RowsDocument, row: Row, column: Column, text: string | null): EditResult {
  if (column.index === 0) return setLead(doc, row, text ?? '');
  const cell = row.cells[column.index];

  // The ID of an anchored row lives in the anchor: rename it there, and in the key cell if written.
  if (column === doc.schema.key && row.anchors.length > 0) {
    if (text === null || !ID.test(text)) return { refused: `the row's ID is in an anchor, which can't hold ${text === null ? 'null' : 'a non-ID'}` };
    const anchor = row.anchors[0];
    const edits: TextEdit[] = [{ from: anchor.from + 1, to: anchor.to, insert: text }];
    if (cell && cell.text !== null) edits.push(replaceValue(doc, cell, formatValue(doc, column, text)));
    return { edits };
  }

  if (cell) {
    if (text !== null) return { edits: [replaceValue(doc, cell, formatValue(doc, column, text))] };
    if (cell.text === null) return { edits: [] };
    const cells = sourceCells(row);
    const later = cells.slice(cells.indexOf(cell) + 1);
    // Removing a named cell must not turn a later overflow cell positional, or make a repeat of its column the value.
    if (later.length === 0 || (cell.name && later.every((c) => c.name && c.column))) return { edits: [removeCell(doc, row, cell)] };
    // An emptied named cell stays named only with no whitespace after its `=` (base §3).
    let to = cell.valueTo;
    if (cell.name) while (isWs(doc.text[to])) to++;
    return { edits: [{ from: cell.valueFrom, to, insert: '' }] };
  }

  if (text === null) return { edits: [] };
  const value = formatValue(doc, column, text);
  const positional = row.cells.filter((c, i) => i > 0 && c && !c.name).length;
  const named = [...row.cells.slice(1), ...row.overflow].some((c) => c?.name);
  if (!column.implicit && column.index === positional + 1 && !named && row.overflow.length === 0) return { edits: appendCell(doc, row, value) };
  if (column.settable) return { edits: appendCell(doc, row, `${column.name}=${value}`) };
  // The one case setCell pads: empty cells up to a column that can't be named.
  if (!column.implicit && !named && row.overflow.length === 0) {
    const pads = Array<string>(column.index - positional - 1).fill('');
    return { edits: appendCell(doc, row, [...pads, value].join(` ${doc.schema.sep} `)) };
  }
  return { refused: `column ${column.name} can't be named, and padding up to it would follow a named cell` };
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
 * Refuses when that cell can't be written; a name that is neither a marker nor a column throws.
 */
export function setMarker(doc: RowsDocument, row: Row, name: string, on: boolean): EditResult {
  const marker = doc.schema.markers.find((m) => m.name === name);
  const column = marker?.column ?? doc.schema.columns.find((c) => c.name === name && c.index > 0);
  if (!column) throw new Error(`setMarker: no marker or column named ${name}`);
  const cell = row.cells[column.index];
  const cellValue = cell?.value?.type === 'bool' ? cell.value.value : null;

  if (!marker) {
    if (flag(doc, row, column) === on) return { edits: [] };
    const removes = !on && column.default?.type === 'bool' && !column.default.value && cell?.text != null;
    return setCell(doc, row, column, removes ? null : String(on));
  }

  const edits: TextEdit[] = [];
  // The marker edits, then the cell correction, unless the correction is refused.
  const withCell = (result: EditResult): EditResult => ('refused' in result ? result : { edits: [...edits, ...result.edits] });
  const present = row.markers.find((m) => m.name === name);
  if (on) {
    if (!present) edits.push({ from: row.indent.to, to: row.indent.to, insert: marker.char });
    return cellValue === false ? withCell(setCell(doc, row, column, null)) : { edits };
  }
  if (present) {
    let to = present.to;
    while (isWs(doc.text[to])) to++; // a marker is removed with the whitespace after it
    // The only marker before an empty lead leaves the lead written as "", so the row neither turns
    // blank nor begins with the delimiter.
    const emptyLead = row.markers.length === 1 && row.lead.text === null;
    edits.push({ from: present.from, to, insert: emptyLead ? (to < row.to ? '"" ' : '""') : '' });
    // Without the marker, the lead might read as a marker, a heading or a comment: quote it.
    const lead = row.lead;
    if (lead.text !== null && !lead.quoted && formatValue(doc, 'lead', lead.text) !== lead.text) {
      edits.push({ from: lead.valueFrom, to: lead.valueTo, insert: formatValue(doc, 'lead', lead.text) });
    }
  }
  if (cellValue === true) return withCell(setCell(doc, row, column, null));
  if (column.default?.type === 'bool' && column.default.value && cellValue === null) return withCell(setCell(doc, row, column, 'false'));
  return { edits };
}

/**
 * Inserts a row (DESIGN §6). Declared columns are written positionally while they run on from the
 * lead, and the rest by name; implicit columns are always named. A column that can't be named is
 * written in position, with empty cells before it. `cells` names columns; any other name throws.
 * Refuses an indent that nesting doesn't allow there, for the new row or a row after it.
 */
export function insertRow(
  doc: RowsDocument,
  at: { beforeLine: number } | 'end',
  indent: number,
  lead: string,
  cells: Record<string, string> = {},
): EditResult {
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

  if (doc.schema.nest) {
    const before = at === 'end' ? doc.rows.length : doc.rows.filter((r) => r.line < at.beforeLine).length;
    const widths = doc.rows.map((r) => r.indent.width);
    const bad = (ws: number[]) => indentLevels(ws).filter((l) => l.bad).length;
    if (bad([...widths.slice(0, before), indent, ...widths.slice(before)]) > bad(widths)) {
      return { refused: `an indent of ${indent} doesn't fit the nesting here` };
    }
  }

  if (at !== 'end' && at.beforeLine <= doc.lines.length) {
    const from = doc.lines[at.beforeLine - 1].from;
    return { edits: [{ from, to: from, insert: line + '\n' }] };
  }
  const end = doc.text.length;
  if (doc.text === '') return { edits: [{ from: 0, to: 0, insert: line }] };
  return { edits: [{ from: end, to: end, insert: doc.endsWithNewline ? line + '\n' : '\n' + line }] };
}

// ---------- levels (ext §6.2; plan spec §4b.6.4) ----------

/** The parser's indent walk over row indents, with each row's depth in the indentation tree. */
function indentTree(widths: number[]) {
  const levels = indentLevels(widths);
  const depth: number[] = [];
  levels.forEach((l) => depth.push(l.parent === null ? 0 : depth[l.parent] + 1));
  return { levels, depth };
}

const badCount = (widths: number[]) => indentLevels(widths).filter((l) => l.bad).length;

/** The levels open before row `at`: the row above it and that row's ancestors, root first. */
function openBefore(levels: { parent: number | null }[], at: number): number[] {
  const open: number[] = [];
  for (let r: number | null = at > 0 ? at - 1 : null; r !== null; r = levels[r].parent) open.unshift(r);
  return open;
}

/** The file's usual step: the most common indent difference between a row and its parent, 4 when there is none. */
function usualStep(widths: number[], levels: { parent: number | null; bad: boolean }[]): number {
  const counts = new Map<number, number>();
  levels.forEach((l, i) => {
    if (l.parent !== null && !l.bad) counts.set(widths[i] - widths[l.parent], (counts.get(widths[i] - widths[l.parent]) ?? 0) + 1);
  });
  let [step, most] = [4, 0];
  for (const [d, n] of counts) if (n > most || (n === most && d < step)) [step, most] = [d, n];
  return step;
}

/**
 * The indent for `level` at row position `at`: the indent its new siblings already use, or the
 * parent's indent plus the usual step. With `lookahead`, the row now at `at` is one of those
 * siblings when it is a child of the new parent. Null when the level isn't open there.
 */
function indentFor(widths: number[], at: number, level: number, lookahead: boolean): number | null {
  const { levels } = indentTree(widths);
  const open = openBefore(levels, at);
  if (!Number.isInteger(level) || level < 0 || level > open.length) return null;
  if (level === 0) return 0;
  if (level < open.length) return widths[open[level]];
  const parent = open[level - 1];
  if (lookahead && at < widths.length && levels[at].parent === parent && !levels[at].bad) return widths[at];
  return widths[parent] + usualStep(widths, levels);
}

/** A row that would become line 1 reading as `---` opens a frontmatter block that isn't there. */
const opensFrontmatter = (doc: RowsDocument, firstLine: string) => doc.frontmatter === null && isDelimiterLine(firstLine);

/** Edits giving each row its indent in `widths`: only rows whose indent changes are touched. */
function indentEdits(rows: Row[], widths: number[]): TextEdit[] {
  return rows.flatMap((r, k) => (widths[k] === r.indent.width ? [] : [{ from: r.indent.from, to: r.indent.to, insert: ' '.repeat(widths[k]) }]));
}

/**
 * The indent a row inserted before a line (or at the end) would take at `level` (plan spec
 * §4b.6.4). Null when the document has no nesting or that level isn't open there.
 */
export function levelIndent(doc: RowsDocument, at: { beforeLine: number } | 'end', level: number): number | null {
  if (!doc.schema.nest) return null;
  const before = at === 'end' ? doc.rows.length : doc.rows.filter((r) => r.line < at.beforeLine).length;
  return indentFor(doc.rows.map((r) => r.indent.width), before, level, true);
}

/**
 * Puts a row at a level of the indentation tree, taking its descendants with it (DESIGN §6). Indent
 * makes it the last child of its previous sibling, outdent the next sibling of its parent. Refuses
 * without nesting, at a level that isn't open there, or when a row would be left at an indent that
 * fits no level.
 */
export function setLevel(doc: RowsDocument, row: Row, level: number): EditResult {
  if (!doc.schema.nest) return { refused: 'the document has no nesting' };
  const { rows } = doc;
  const widths = rows.map((r) => r.indent.width);
  const { depth } = indentTree(widths);
  const i = rows.indexOf(row);
  const indent = indentFor(widths, i, level, false);
  if (indent === null) return { refused: `level ${level} isn't open here` };
  let end = i + 1;
  while (end < rows.length && depth[end] > depth[i]) end++;
  const next = widths.map((w, k) => (k >= i && k < end ? w + indent - widths[i] : w));
  if (badCount(next) > badCount(widths)) return { refused: `level ${level} here would leave a row at an indent that fits no level` };
  if (row.line === 1 && opensFrontmatter(doc, ' '.repeat(indent) + doc.text.slice(row.indent.to, row.to))) {
    return { refused: 'the row would read as a frontmatter delimiter' };
  }
  return { edits: indentEdits(rows, next) };
}

/**
 * Swaps a row with the line above or below it (DESIGN §6). When that line is a row, the moved row's
 * indent snaps to the valid level nearest its own at the new position. Refuses when there is no body
 * line to swap with, or no indent leaves every row at a level.
 */
export function moveRow(doc: RowsDocument, row: Row, dir: 'up' | 'down'): EditResult {
  const other = doc.lines[row.line - 1 + (dir === 'up' ? -1 : 1)];
  if (!other || other.kind.startsWith('fm-')) return { refused: `there is no line ${dir === 'up' ? 'above' : 'below'} to swap with` };
  const otherText = doc.text.slice(other.from, other.to);
  let indent = row.indent.width;

  if (other.row && doc.schema.nest) {
    const { rows } = doc;
    const widths = rows.map((r) => r.indent.width);
    const was = indentTree(widths).depth[rows.indexOf(row)];
    const order = rows.slice();
    const [k, j] = [rows.indexOf(row), rows.indexOf(other.row)];
    [order[k], order[j]] = [order[j], order[k]];
    const swapped = order.map((r) => r.indent.width);
    const candidates = new Set([indent]);
    for (let level = 0; ; level++) {
      const w = indentFor(swapped, j, level, false);
      if (w === null) break;
      candidates.add(w);
    }
    const scored = [...candidates].flatMap((w) => {
      const next = swapped.map((x, m) => (m === j ? w : x));
      if (badCount(next) > badCount(widths)) return [];
      return [{ w, far: Math.abs(indentTree(next).depth[j] - was), shift: Math.abs(w - indent) }];
    });
    scored.sort((a, b) => a.far - b.far || a.shift - b.shift || a.w - b.w);
    if (scored.length === 0) return { refused: 'moving it would leave a row at an indent that fits no level' };
    indent = scored[0].w;
  }

  const indentTo = indent === row.indent.width ? row.from : row.indent.to;
  const newIndent = indent === row.indent.width ? '' : ' '.repeat(indent);
  const first = dir === 'up' ? newIndent + doc.text.slice(indentTo, row.to) : otherText;
  if (Math.min(row.line, other.line) === 1 && opensFrontmatter(doc, first)) return { refused: 'the new first line would read as a frontmatter delimiter' };
  // The row's own text stays in place, so positions in it map through the move.
  if (dir === 'down') {
    return { edits: [{ from: row.from, to: indentTo, insert: `${otherText}\n${newIndent}` }, { from: row.to, to: other.to, insert: '' }] };
  }
  return { edits: [{ from: other.from, to: indentTo, insert: newIndent }, { from: row.to, to: row.to, insert: `\n${otherText}` }] };
}

/**
 * Deletes a row's line and promotes its descendants one level, so the rest of the tree keeps its
 * shape (DESIGN §6). Refuses when that would leave a row at an indent that fits no level.
 */
export function deleteRow(doc: RowsDocument, row: Row): EditResult {
  const next = doc.lines[row.line];
  // The last line goes with the newline after it, if any, so a blank line above it stays a line.
  const edits: TextEdit[] = [{ from: row.from, to: next ? next.from : doc.text.length, insert: '' }];
  if (row.line === 1 && next && opensFrontmatter(doc, doc.text.slice(next.from, next.to))) {
    return { refused: 'the new first line would read as a frontmatter delimiter' };
  }
  // Without its last anchor the file has no identity (ext §3.1), so a cell naming the implicit key would name no column.
  const { key, keys } = doc.schema;
  const lastAnchor = row.anchors.length > 0 && !('key' in keys) && doc.rows.every((r) => r === row || r.anchors.length === 0);
  if (lastAnchor && key?.implicit && doc.rows.some((r) => r !== row && r.cells[key.index]?.name)) {
    return { refused: `it has the last anchor, and other rows set ${key.name} by name` };
  }
  if (!doc.schema.nest) return { edits };

  const { rows } = doc;
  const widths = rows.map((r) => r.indent.width);
  const { levels, depth } = indentTree(widths);
  const i = rows.indexOf(row);
  const promoted = widths.slice();
  let shift = 0;
  for (let k = i + 1; k < rows.length && depth[k] > depth[i]; k++) {
    if (levels[k].parent === i) shift = widths[i] - widths[k]; // each child takes the row's indent, its subtree with it
    promoted[k] += shift;
  }
  const [after, rest] = [promoted.filter((_, k) => k !== i), rows.filter((_, k) => k !== i)];
  if (badCount(after) > badCount(widths)) return { refused: 'promoting its children would leave a row at an indent that fits no level' };
  return { edits: [...edits, ...indentEdits(rest, after)] };
}

const RECOVERED = new Set(['unterminated-quote', 'text-after-quote', 'unknown-escape']);

/**
 * The `auto` repairs for a row (DESIGN §6): cells rewritten from their recovered text, a heading-like
 * lead quoted, and an indent that fits no level snapped to the level the parser recovered. The rows
 * after it at that level move with it, so the tree is unchanged. Idempotent.
 */
export function repairRow(doc: RowsDocument, row: Row): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const cell of sourceCells(row)) {
    const broken = row.errors.some((e) => RECOVERED.has(e.code) && e.from! >= cell.from && e.to! <= cell.to);
    if (!broken || cell.text === null) continue;
    edits.push({ from: cell.valueFrom, to: cell.valueTo, insert: quote(doc, cell === row.lead, cell.text) });
  }
  const lead = row.lead;
  if (row.errors.some((e) => e.code === 'heading-line') && !edits.some((e) => e.from === lead.valueFrom) && lead.text !== null && !lead.quoted) {
    const quoted = quote(doc, true, lead.text);
    if (quoted !== lead.text) edits.push({ from: lead.valueFrom, to: lead.valueTo, insert: quoted });
  }
  if (row.errors.some((e) => e.code === 'bad-indent')) edits.push(...snapIndent(doc, row));
  return edits;
}

/** The indent edits that put a bad-indent row, and the rows after it at its level, where the parser recovered them. */
function snapIndent(doc: RowsDocument, row: Row): TextEdit[] {
  const { rows } = doc;
  const widths = rows.map((r) => r.indent.width);
  const { levels } = indentTree(widths);
  const i = rows.indexOf(row);
  const parent = levels[i].parent;
  let target = 0;
  if (parent !== null) {
    const open = openBefore(levels, i);
    target = widths[open[open.indexOf(parent) + 1]];
  }
  const floor = parent === null ? 0 : widths[parent];
  const next = widths.slice();
  for (let k = i; k < rows.length && (k === i || widths[k] > floor); k++) next[k] += target - widths[i];
  const after = indentLevels(next);
  const kept = !after[i].bad && after.every((l, k) => l.parent === levels[k].parent) && badCount(next) < badCount(widths);
  const firstLine = ' '.repeat(next[0]) + doc.text.slice(rows[0].indent.to, rows[0].to);
  if (!kept || next.some((w) => w < 0) || (rows[0].line === 1 && opensFrontmatter(doc, firstLine))) return [];
  return indentEdits(rows, next);
}
