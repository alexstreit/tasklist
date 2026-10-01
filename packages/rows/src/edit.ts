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
 * keep something on its line, so a delimiter that begins the row stays. For a cell that isn't the lead.
 */
export function removeCell(doc: RowsDocument, row: Row, cell: Cell): TextEdit {
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

/** Every ID a row declares: its anchors, primary first, or its key value. */
const idsOf = (row: Row): string[] => (row.anchors.length > 0 ? row.anchors.map((a) => a.id) : row.id !== null ? [row.id] : []);

/**
 * Gives a row an anchor, or replaces its anchor's ID (DESIGN §6). A key cell the row writes is set
 * to the same ID, so the anchor and key agree (ext §3.2). Refuses an ID that is invalid or already
 * used, ignoring case; and the file's first anchor while a row sets the implicit key by name, since
 * identity would turn that cell into the row's key (the mirror of deleteRow's refusal).
 */
export function setAnchor(doc: RowsDocument, row: Row, id: string): EditResult {
  if (!doc.schema.extensions) throw new Error('setAnchor: the document was read without extensions, so it has no anchors');
  if (!ID.test(id)) return { refused: `${JSON.stringify(id)} isn't an ID` };
  if (row.anchors[0]?.id === id) return { edits: [] };
  // The ID being replaced doesn't count as used: the anchor's, or the key value of a row without one.
  const own = idsOf(row)[0] ?? null;
  const lower = id.toLowerCase();
  const used = doc.rows.some((r) => idsOf(r).some((x) => x.toLowerCase() === lower && !(r === row && x === own)));
  if (used) return { refused: `#${id} is already an ID in this file, ignoring case` };

  if (!doc.schema.identity) {
    // Identity would make the key the implicit `id` column, so a cell written `id=…` would become a key.
    const setsKey = (c: Cell | null) => c !== null && c.name === null && NAMED.exec(doc.text.slice(c.from, c.to))?.[0] === 'id=';
    const implicit = !doc.schema.columns.some((c) => c.name === 'id');
    if (implicit && doc.rows.some((r) => [...r.cells.slice(1), ...r.overflow].some(setsKey))) {
      return { refused: 'it would be the first anchor, and a row sets id by name' };
    }
  }

  const edits: TextEdit[] = [];
  if (row.anchors.length > 0) edits.push({ from: row.anchors[0].from + 1, to: row.anchors[0].to, insert: id });
  else {
    const lead = row.lead;
    let insert = `${lead.valueFrom === lead.valueTo ? '' : ' '}{#${id}}`;
    // An anchor after an unterminated quote would be inside it: close the quote where its text ends.
    if (isUnterminated(row, lead)) {
      const backslashes = /\\*$/.exec(doc.text.slice(lead.valueFrom + 1, lead.valueTo))![0].length;
      insert = (backslashes % 2 === 1 ? '\\"' : '"') + insert;
    }
    if (doc.text[lead.valueTo] === doc.schema.sep) insert += ' ';
    edits.push({ from: lead.valueTo, to: lead.valueTo, insert });
  }
  const key = doc.schema.key;
  const cell = key ? row.cells[key.index] : null;
  if (key && cell && cell.text !== null) edits.push(replaceValue(doc, cell, formatValue(doc, key, id)));
  return { edits };
}

/**
 * The edits that remove every in-file reference to `row` from the other rows' ref cells: a
 * reference goes with its qualifier and a comma, and a cell left with none is cleared. A valid
 * cell's references are matched by target; in a cell that doesn't read as references, a reference
 * by text to an ID this row is the first to declare.
 */
function referenceEdits(doc: RowsDocument, row: Row): TextEdit[] {
  const mine = new Set(idsOf(row).filter((id) => doc.rows.find((r) => idsOf(r).includes(id)) === row));
  const edits: TextEdit[] = [];
  for (const r of doc.rows) {
    if (r === row) continue;
    for (const cell of r.cells) {
      const column = cell?.column;
      if (!cell || cell.text === null || column?.kind !== 'ref' || !column.refCurrent) continue;
      const value = cell.value?.type === 'ref' ? cell.value : null;
      // Split as the parser splits (ext §4.3): references by commas, a qualifier after whitespace.
      const parts = cell.text.split(',');
      const kept = parts.filter((part, k) => {
        if (value) return value.refs[k].target !== row;
        const locator = /^[ \t]*(\S*)/.exec(part)![1];
        const hash = locator.lastIndexOf('#');
        const prefix = locator.slice(0, Math.max(hash, 0));
        return hash === -1 || (prefix !== '' && prefix !== column.refTable) || !mine.has(locator.slice(hash + 1));
      });
      if (kept.length === parts.length) continue;
      const text = kept.join(',').replace(/^[ \t]+|[ \t]+$/g, '');
      const result = setCell(doc, r, column, text === '' ? null : text);
      if ('edits' in result) edits.push(...result.edits);
    }
  }
  return edits;
}

/** The value a bool column has for a row: its marker, then its cell, then its default; null when none says. */
export function readFlag(doc: RowsDocument, row: Row, column: Column): boolean | null {
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
    if (readFlag(doc, row, column) === on) return { edits: [] };
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
 * Each row's level: its depth in the indentation tree (ext §6.2, the parser's `indentLevels`), which
 * setLevel, levelIndent and moveRow work in. This is not `Row.depth`, which follows the parent
 * relation: an indent-0 row naming a parent in the `parent` column is at level 0 here, and so are
 * its descendants one level down. Every row is at level 0 without nesting.
 */
export function rowLevels(doc: RowsDocument): Map<Row, number> {
  const depth = doc.schema.nest ? indentTree(doc.rows.map((r) => r.indent.width)).depth : [];
  return new Map(doc.rows.map((row, i) => [row, depth[i] ?? 0]));
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
 * Moves a row with its subtree past its previous or next sibling's subtree (DESIGN §6). Siblings and
 * subtrees are the indentation tree's; without nesting, every row is a sibling with no subtree. The
 * lines between the two subtrees stay where they are. Each subtree takes the indent the other's first
 * row had, its descendants shifted with it, so the tree and its errors are the same as before, with
 * the two subtrees swapped. Refuses only when there is no such sibling, or when the new first line
 * would read as a frontmatter delimiter.
 */
export function moveRow(doc: RowsDocument, row: Row, dir: 'up' | 'down'): EditResult {
  const { rows, text } = doc;
  const nest = doc.schema.nest !== null;
  const widths = rows.map((r) => r.indent.width);
  const depth = nest ? indentTree(widths).depth : widths.map(() => 0);
  const i = rows.indexOf(row);
  /** The index after the last row of k's subtree. */
  const end = (k: number) => {
    let e = k + 1;
    while (e < rows.length && depth[e] > depth[k]) e++;
    return e;
  };
  let sibling = -1;
  if (dir === 'up') {
    for (let k = i - 1; k >= 0 && depth[k] >= depth[i]; k--) {
      if (depth[k] === depth[i]) {
        sibling = k;
        break;
      }
    }
  } else if (end(i) < rows.length && depth[end(i)] === depth[i]) {
    sibling = end(i);
  }
  if (sibling === -1) return { refused: `there is no ${dir === 'up' ? 'previous' : 'next'} sibling to swap with` };

  // First block A, the lines between, then block B; the result is B, the lines between, then A.
  const [a, b] = dir === 'up' ? [sibling, i] : [i, sibling];
  const line = (n: number) => doc.lines[n - 1];
  const [aFrom, aTo] = [line(rows[a].line).from, line(rows[b - 1].line).to];
  const [bFrom, bTo] = [line(rows[b].line).from, line(rows[end(b) - 1].line).to];
  const between = text.slice(aTo + 1, bFrom); // each line with its newline
  const shift = nest ? widths[b] - widths[a] : 0;
  /** A block's text with each row's indent shifted by `by`. */
  const shifted = (from: number, to: number, by: number) =>
    rows
      .filter((r) => r.from >= from && r.to <= to)
      .reduceRight((t, r) => (by === 0 ? t : t.slice(0, r.indent.from - from) + ' '.repeat(r.indent.width + by) + t.slice(r.indent.to - from)), text.slice(from, to));
  const moved = dir === 'up' ? b : a;
  const by = dir === 'up' ? -shift : shift;
  const first = rows[b];
  if (rows[a].line === 1 && opensFrontmatter(doc, ' '.repeat(widths[a]) + text.slice(first.indent.to, first.to))) {
    return { refused: 'the new first line would read as a frontmatter delimiter' };
  }

  // The moved subtree's text stays in place, so positions in it map through the move; its first
  // row's indent edit joins the edit that meets it.
  const head = rows[moved];
  const newIndent = by === 0 ? '' : ' '.repeat(head.indent.width + by);
  const headTo = by === 0 ? head.from : head.indent.to;
  const inner = by === 0 ? [] : indentEdits(rows.slice(moved + 1, end(moved)), widths.slice(moved + 1, end(moved)).map((w) => w + by));
  if (dir === 'up') {
    return { edits: [{ from: aFrom, to: headTo, insert: newIndent }, ...inner, { from: bTo, to: bTo, insert: `\n${between}${shifted(aFrom, aTo, shift)}` }] };
  }
  return { edits: [{ from: head.from, to: headTo, insert: `${shifted(bFrom, bTo, -shift)}\n${between}${newIndent}` }, ...inner, { from: aTo, to: bTo, insert: '' }] };
}

/**
 * Deletes a row's line and promotes its descendants one level, so the rest of the tree keeps its
 * shape (DESIGN §6). With `removeReferences`, every in-file reference to the row goes too. Refuses
 * when that would leave a row at an indent that fits no level.
 */
export function deleteRow(doc: RowsDocument, row: Row, options: { removeReferences?: boolean } = {}): EditResult {
  const next = doc.lines[row.line];
  // The last line goes with the newline after it, if any, so a blank line above it stays a line.
  const edits: TextEdit[] = [{ from: row.from, to: next ? next.from : doc.text.length, insert: '' }];
  if (options.removeReferences) edits.push(...referenceEdits(doc, row));
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

/** The syntax errors whose cell the parser recovers, and repairRow rewrites. */
export const RECOVERED_CODES: ReadonlySet<string> = new Set(['unterminated-quote', 'text-after-quote', 'unknown-escape']);

/**
 * One kind of repair: a cell rewritten from its recovered text (`cell` says which, the lead
 * included), a heading-like title quoted, or the indent snap, whose edits may move later rows.
 */
export type Repair = { kind: 'cell'; cell: Cell; edits: TextEdit[] } | { kind: 'title' | 'indent'; edits: TextEdit[] };

/**
 * The `auto` repairs for a row (DESIGN §6), labelled: cells rewritten from their recovered text, a
 * heading-like lead quoted, and an indent that fits no level snapped to the level the parser
 * recovered. The rows after it at that level move with it, so the tree is unchanged. Idempotent.
 */
export function repairs(doc: RowsDocument, row: Row): Repair[] {
  const out: Repair[] = [];
  for (const cell of sourceCells(row)) {
    const broken = row.errors.some((e) => RECOVERED_CODES.has(e.code) && e.from! >= cell.from && e.to! <= cell.to);
    if (!broken || cell.text === null) continue;
    out.push({ kind: 'cell', cell, edits: [{ from: cell.valueFrom, to: cell.valueTo, insert: quote(doc, cell === row.lead, cell.text) }] });
  }
  const lead = row.lead;
  const leadRewritten = out.some((r) => r.kind === 'cell' && r.cell === lead);
  if (row.errors.some((e) => e.code === 'heading-line') && !leadRewritten && lead.text !== null && !lead.quoted) {
    const quoted = quote(doc, true, lead.text);
    if (quoted !== lead.text) out.push({ kind: 'title', edits: [{ from: lead.valueFrom, to: lead.valueTo, insert: quoted }] });
  }
  if (row.errors.some((e) => e.code === 'bad-indent')) {
    const edits = snapIndent(doc, row);
    if (edits.length > 0) out.push({ kind: 'indent', edits });
  }
  return out;
}

/** The edits of every repair for a row, as one list. */
export function repairRow(doc: RowsDocument, row: Row): TextEdit[] {
  return repairs(doc, row).flatMap((r) => r.edits);
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
