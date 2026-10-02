// The edit API (DESIGN §6): the Task 20 examples, then the property over generated files.
import { describe, expect, it } from 'vitest';
import { applyEdits, deleteRow, formatValue, setAnchor, type EditResult, insertRow, levelIndent, moveRow, parseRows, repairRow, setCell, setLead, setLevel, setMarker, type Column, type ParseOptions, type Row, type RowsDocument } from '../src/index';
import { indentLevels } from '../src/extensions';
import { generatedFiles, mulberry32 } from './generators';

const PLAN = '---\nnest: parent\nmarkers: done=~\ncolumns: est:duration unit=h hpd=8 | owner | notes\n---\n';
/** The edits of a result that must not be refused. */
const editsOf = (result: EditResult) => {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result.edits;
};
const edited = (doc: RowsDocument, result: EditResult, options: ParseOptions = {}) => {
  const text = applyEdits(doc.text, editsOf(result));
  return { text, doc: parseRows(text, options) };
};
const col = (doc: RowsDocument, name: string) => doc.schema.columns.find((c) => c.name === name)!;
const lastLine = (text: string) => text.trimEnd().split('\n').pop();

describe('setLead', () => {
  it('changes only the title, keeping indent, marker, anchor and cells', () => {
    const doc = parseRows(`${PLAN}    ~Login page {#login} | 4h\n`);
    expect(lastLine(edited(doc, setLead(doc, doc.rows[0], 'Sign in')).text)).toBe('    ~Sign in {#login} | 4h');
  });

  it.each(['~Login', '# Heading', 'Title {#x}'])('quotes %s so it reads back exactly', (title) => {
    const doc = parseRows(`${PLAN}    ~Login page {#login} | 4h\n`);
    const after = edited(doc, setLead(doc, doc.rows[0], title)).doc.rows[0];
    expect(after.lead).toMatchObject({ text: title, quoted: true });
    expect(after.markers.map((m) => m.name)).toEqual(['done']);
    expect(after.anchors.map((a) => a.id)).toEqual(['login']);
  });

  it('keeps an anchor after a quoted lead (Q13)', () => {
    const doc = parseRows(`${PLAN}"~T" {#t} | 1h\n`);
    expect(lastLine(edited(doc, setLead(doc, doc.rows[0], 'Plain')).text)).toBe('Plain {#t} | 1h');
    expect(lastLine(edited(doc, setLead(doc, doc.rows[0], '~Still')).text)).toBe('"~Still" {#t} | 1h');
  });
});

describe('setCell', () => {
  const doc = parseRows('---\ncolumns: est | owner | notes\n---\nAuth | 2d\n');
  const row = doc.rows[0];

  it('writes a column that is not the next slot by name, and the next slot positionally', () => {
    expect(lastLine(edited(doc, setCell(doc, row, col(doc, 'notes'), 'later')).text)).toBe('Auth | 2d | notes=later');
    expect(lastLine(edited(doc, setCell(doc, row, col(doc, 'owner'), 'bob')).text)).toBe('Auth | 2d | bob');
  });

  it('quotes a value containing the delimiter', () => {
    const after = edited(doc, setCell(doc, row, col(doc, 'owner'), 'a | b'));
    expect(lastLine(after.text)).toBe('Auth | 2d | "a | b"');
    expect(after.doc.rows[0].cells[2]!.text).toBe('a | b');
  });

  it('removes a trailing cell with its delimiter, and empties an interior one', () => {
    const three = parseRows('---\ncolumns: est | owner | notes\n---\nAuth | 2d | bob | n\n');
    expect(lastLine(edited(three, setCell(three, three.rows[0], col(three, 'notes'), null)).text)).toBe('Auth | 2d | bob');
    const emptied = edited(three, setCell(three, three.rows[0], col(three, 'owner'), null));
    expect(lastLine(emptied.text)).toBe('Auth | 2d |  | n');
    expect(emptied.doc.rows[0].cells.map((c) => c?.text ?? null)).toEqual(['Auth', '2d', null, 'n']);
  });

  it('empties a named cell before an overflow cell without leaving a space after its =, so it stays named', () => {
    const named = parseRows('---\ncolumns: a | b\n---\nX | b=1 | extra\n');
    const after = edited(named, setCell(named, named.rows[0], col(named, 'b'), null));
    expect(lastLine(after.text)).toBe('X | b=| extra');
    expect(after.doc.rows[0].cells[2]).toMatchObject({ name: { text: 'b' }, text: null });
    expect(after.doc.errors.map((e) => e.code)).toEqual(['unnamed-after-named']);
    const twice = parseRows('---\ncolumns: a | b\n---\nX | b=1 | b=2\n');
    const emptied = edited(twice, setCell(twice, twice.rows[0], col(twice, 'b'), null));
    expect(lastLine(emptied.text)).toBe('X | b=| b=2');
    expect(emptied.doc.rows[0].cells[2]!.text).toBeNull();
  });

  it('keeps the delimiter of a row that begins with one when its last cell goes', () => {
    const lone = parseRows('---\ncolumns: a\n---\n| x\n');
    const after = edited(lone, setCell(lone, lone.rows[0], col(lone, 'a'), null));
    expect(lastLine(after.text)).toBe('|');
    expect(after.doc.rows).toHaveLength(1);
  });

  it('writes a value that fails validation, exactly as given', () => {
    const typed = parseRows('---\ncolumns: est:duration\n---\nA\n');
    const after = edited(typed, setCell(typed, typed.rows[0], col(typed, 'est'), '4 hours')).doc.rows[0];
    expect(after.cells[1]).toMatchObject({ text: '4 hours', value: null });
  });

  it('writes implicit columns by name only', () => {
    const plan = parseRows(`${PLAN}A\n`);
    expect(lastLine(edited(plan, setCell(plan, plan.rows[0], col(plan, 'done'), 'true')).text)).toBe('A | done=true');
  });

  it('mounts a file by writing the mount cell, and unmounts by clearing it (ext §12)', () => {
    const plan = parseRows('---\nnest: parent\nmount: mount\ncolumns: est\n---\nProduct A {#a} | 2w\n    Kickoff\n');
    const [a] = plan.rows;
    const mounted = edited(plan, setCell(plan, a, col(plan, 'mount'), 'teams/alpha.plan'));
    expect(mounted.text.split('\n')[5]).toBe('Product A {#a} | 2w | mount=teams/alpha.plan');
    expect(mounted.doc.rows[0].mount).toMatchObject({ path: 'teams/alpha.plan' });
    const spaced = edited(plan, setCell(plan, a, col(plan, 'mount'), 'Team Alpha/alpha.plan#backend'));
    expect(spaced.doc.rows[0].mount).toMatchObject({ path: 'Team Alpha/alpha.plan', part: 'backend' });
    const unmounted = edited(mounted.doc, setCell(mounted.doc, mounted.doc.rows[0], col(mounted.doc, 'mount'), null));
    expect(unmounted.text).toBe(plan.text);
    expect(unmounted.doc.rows[0].mount).toBeUndefined();
  });

  it('closes an unterminated quote before appending, keeping its text', () => {
    const open = parseRows('---\ncolumns: a | b\n---\nA | "x \\\n');
    const after = edited(open, setCell(open, open.rows[0], col(open, 'b'), 'y')).doc.rows[0];
    expect(after.cells.map((c) => c?.text ?? null)).toEqual(['A', 'x \\', 'y']);
  });

  it('renames an anchored ID in the anchor, and refuses a value the anchor cannot hold', () => {
    const ids = parseRows('---\nkey: id\n---\nAuth {#auth} | id=auth\n');
    const after = edited(ids, setCell(ids, ids.rows[0], col(ids, 'id'), 'login'));
    expect(lastLine(after.text)).toBe('Auth {#login} | id=login');
    expect(after.doc.errors).toEqual([]);
    expect(setCell(ids, ids.rows[0], col(ids, 'id'), 'not an id')).toHaveProperty('refused');
    expect(setCell(ids, ids.rows[0], col(ids, 'id'), null)).toHaveProperty('refused');
  });
});

describe('setMarker', () => {
  it('removes the marker character', () => {
    const doc = parseRows(`${PLAN}~Login\n`);
    expect(lastLine(edited(doc, setMarker(doc, doc.rows[0], 'done', false)).text)).toBe('Login');
  });

  it('removes a done=true written by name', () => {
    const doc = parseRows(`${PLAN}Login | done=true\n`);
    expect(lastLine(edited(doc, setMarker(doc, doc.rows[0], 'done', false)).text)).toBe('Login');
  });

  it('adds the marker straight after the indent, and corrects an explicit false', () => {
    const doc = parseRows(`${PLAN}A\n    Login | done=false\n`);
    expect(lastLine(edited(doc, setMarker(doc, doc.rows[1], 'done', true)).text)).toBe('    ~Login');
  });

  it('writes an empty lead as "" when its only marker goes, so the row keeps its line without beginning with the delimiter', () => {
    const doc = parseRows(`${PLAN}A\n    ~\n    ~ | 1d\n`);
    const only = edited(doc, setMarker(doc, doc.rows[1], 'done', false));
    expect(only.text.split('\n')[6]).toBe('    ""');
    expect(only.doc.rows[1]).toMatchObject({ markers: [], lead: { text: '' } });
    const withCell = edited(doc, setMarker(doc, doc.rows[2], 'done', false));
    expect(lastLine(withCell.text)).toBe('    "" | 1d');
    const structural = (d: RowsDocument) => d.errors.filter((e) => e.class !== 'validation');
    expect([structural(only.doc), structural(withCell.doc)]).toEqual([[], []]);
  });

  it('returns no edits when the flag already has the value', () => {
    const doc = parseRows(`${PLAN}~Login\n`);
    expect(setMarker(doc, doc.rows[0], 'done', true)).toEqual({ edits: [] });
  });

  it('quotes a lead that would read as a marker once the marker is gone', () => {
    const doc = parseRows(`${PLAN}~~Login\n`);
    const after = edited(doc, setMarker(doc, doc.rows[0], 'done', false));
    expect(lastLine(after.text)).toBe('"~Login"');
    expect(after.doc.rows[0]).toMatchObject({ markers: [], lead: { text: '~Login' } });
  });
});

describe('insertRow and formatValue', () => {
  it('writes the run of declared columns positionally and the rest by name', () => {
    const doc = parseRows(`${PLAN}A\n`);
    const text = applyEdits(doc.text, editsOf(insertRow(doc, 'end', 4, 'B', { est: '2h', notes: 'n', done: 'true' })));
    expect(lastLine(text)).toBe('    B | 2h | notes=n | done=true');
  });

  it('refuses an indent that nesting does not allow, for the new row or a row after it', () => {
    const doc = parseRows(`${PLAN}A\n        B\nC\n`);
    expect(insertRow(doc, { beforeLine: 8 }, 4, 'X')).toHaveProperty('refused'); // between A's and B's levels
    expect(insertRow(doc, { beforeLine: 6 }, 4, 'X')).toHaveProperty('refused'); // the first row
    const nested = parseRows(`${PLAN}A\n    B\n`);
    expect(insertRow(nested, { beforeLine: 7 }, 8, 'X')).toHaveProperty('refused'); // leaves B between levels
    expect(insertRow(nested, { beforeLine: 7 }, 2, 'X')).toHaveProperty('edits');
  });

  it('inserts before a line, and keeps a file without a final newline that way', () => {
    const doc = parseRows('A\nC');
    expect(applyEdits(doc.text, editsOf(insertRow(doc, { beforeLine: 2 }, 0, 'B')))).toBe('A\nB\nC');
    expect(applyEdits(doc.text, editsOf(insertRow(doc, 'end', 0, 'D')))).toBe('A\nC\nD');
  });

  it('quotes exactly when needed', () => {
    const doc = parseRows(`${PLAN}A\n`);
    const lead = (t: string) => formatValue(doc, 'lead', t);
    expect([lead('Plain'), lead('a | b'), lead('~x'), lead('# h'), lead('#h'), lead('// c'), lead('---'), lead(''), lead('x {#y}'), lead('x {y}')]).toEqual([
      'Plain', '"a | b"', '"~x"', '"# h"', '#h', '"// c"', '"---"', '""', '"x {#y}"', 'x {y}',
    ]);
    const notes = col(doc, 'notes');
    expect([formatValue(doc, notes, 'a=b'), formatValue(doc, notes, '~x'), formatValue(doc, notes, 'say "hi"'), formatValue(doc, notes, 'a\nb')]).toEqual([
      '"a=b"', '~x', 'say "hi"', '"a\\nb"',
    ]);
  });
});

describe('setAnchor', () => {
  const SCHED = '---\nnest: parent\ncolumns: est | deps:ref many qualifier=lag:duration\n---\n';

  it('gives a row an anchor after its lead, keeping its padding and cells', () => {
    const doc = parseRows(`${SCHED}Design\n    Wireframes      | 1d\n`);
    const after = edited(doc, setAnchor(doc, doc.rows[1], 'wireframes'));
    expect(lastLine(after.text)).toBe('    Wireframes {#wireframes}      | 1d');
    expect(after.doc.rows[1]).toMatchObject({ id: 'wireframes', lead: { text: 'Wireframes' } });
    expect(after.doc.errors).toEqual([]);
  });

  it('replaces the ID of an anchor, and returns nothing when it already has that ID', () => {
    const doc = parseRows(`${SCHED}Review {#review #rev}\n`);
    expect(lastLine(edited(doc, setAnchor(doc, doc.rows[0], 'check')).text)).toBe('Review {#check #rev}');
    expect(setAnchor(doc, doc.rows[0], 'review')).toEqual({ edits: [] });
  });

  it('refuses an ID that is invalid, or used in any case; a row may change the case of its own', () => {
    const doc = parseRows(`${SCHED}Review {#review}\nAPI {#api #ui}\nDocs\n`);
    expect(setAnchor(doc, doc.rows[2], 'bad id')).toEqual({ refused: '"bad id" isn\'t an ID' });
    expect(setAnchor(doc, doc.rows[2], '-x')).toEqual({ refused: '"-x" isn\'t an ID' });
    expect(setAnchor(doc, doc.rows[2], 'REVIEW')).toEqual({ refused: "#REVIEW is already an ID in this file, ignoring case" });
    expect(setAnchor(doc, doc.rows[2], 'UI')).toEqual({ refused: "#UI is already an ID in this file, ignoring case" });
    expect(setAnchor(doc, doc.rows[1], 'UI')).toHaveProperty('refused'); // its own alias
    expect(lastLine(edited(doc, setAnchor(doc, doc.rows[0], 'Review')).text.split('\nAPI')[0])).toBe('Review {#Review}');
  });

  it('sets a key cell the row writes to the same ID, so anchor and key agree', () => {
    const doc = parseRows('---\nkey: id\ncolumns: owner\n---\nA | al | id=a\nB | bo\n');
    const after = edited(doc, setAnchor(doc, doc.rows[0], 'alpha'));
    expect(after.text.split('\n')[4]).toBe('A {#alpha} | al | id=alpha');
    expect(after.doc.errors).toEqual([]);
    expect(lastLine(edited(doc, setAnchor(doc, doc.rows[1], 'b')).text)).toBe('B {#b} | bo');
  });

  it('refuses the first anchor while a row sets the implicit id by name, which identity would make a key', () => {
    const doc = parseRows('---\ncolumns: owner\n---\nA\nB | id=x\n');
    expect(setAnchor(doc, doc.rows[0], 'a')).toEqual({ refused: 'it would be the first anchor, and a row sets id by name' });
    // Not when identity is already on, or when the cell is quoted.
    const on = parseRows('---\ncolumns: owner\n---\nA\nB | id=x\nC {#c}\n');
    expect(setAnchor(on, on.rows[0], 'a')).toHaveProperty('edits');
    const quoted = parseRows('---\ncolumns: owner\n---\nA\nB | "id=x"\n');
    expect(setAnchor(quoted, quoted.rows[0], 'a')).toHaveProperty('edits');
  });

  it('writes an anchor on an empty lead, and after an unterminated quote, which it closes', () => {
    const empty = parseRows(`${SCHED}~ | 1d\n`.replace('nest: parent', 'nest: parent\nmarkers: done=~'));
    const a = edited(empty, setAnchor(empty, empty.rows[0], 'x'));
    expect(a.doc.rows[0]).toMatchObject({ id: 'x', lead: { text: null } });
    expect(a.doc.errors.map((e) => e.code)).toEqual(empty.errors.map((e) => e.code)); // the empty lead's own
    const open = parseRows(`${SCHED}"Open\n`);
    const b = edited(open, setAnchor(open, open.rows[0], 'o'));
    expect(lastLine(b.text)).toBe('"Open" {#o}');
    expect(b.doc.rows[0]).toMatchObject({ id: 'o', lead: { text: 'Open' } });
  });
});

// ---------- the DESIGN §6 property ----------

const TITLES = ['New', '~x', '!x', '+x', '# h', '#h', 'a {#x}', 'a {x}', ' pad', 'pad ', 'a | b', 'a ; b', 'a , b', 'a / b', '"q', 'q"', '', '---', '// c', '-- c', 'x\ny', 't\tab', 'é', '\\', 'a=b', '{#only}', '"', 'x\\"y'];
const VALUES = [...TITLES, 'v', '2d', '#a', '#b +2d, #a', 'true', 'false', 'id', 'a-1', 'notes=z', '1'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Everything a reader sees on each line: a row's parts, or a non-row line's text. */
const project = (doc: RowsDocument) =>
  doc.lines.map((l) =>
    l.row
      ? {
          indent: l.row.indent.width,
          lead: l.row.lead.text,
          markers: l.row.markers.map((m) => m.name),
          anchors: l.row.anchors.map((a) => a.id),
          cells: l.row.cells.slice(1).map((c) => c?.text ?? null),
          overflow: l.row.overflow.map((c) => (c.name ? `${c.name.text}=` : '') + (c.text ?? '')),
          id: l.row.id,
          aliases: l.row.aliases,
        }
      : { kind: l.kind, text: doc.text.slice(l.from, l.to) },
  );
type RowView = Extract<ReturnType<typeof project>[number], { lead: unknown }>;

const files = generatedFiles();
const random = mulberry32(20);
const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
const rowLine = (doc: RowsDocument, row: Row) => doc.lines.findIndex((l) => l.row === row);

function flag(doc: RowsDocument, row: Row, column: Column): boolean | null {
  const marker = doc.schema.markers.find((m) => m.column === column);
  if (marker && row.markers.some((m) => m.name === marker.name)) return true;
  const v = row.cells[column.index]?.value;
  if (v?.type === 'bool') return v.value;
  return column.default?.type === 'bool' ? column.default.value : null;
}

/** Padding would put an unnamed cell after a named or overflow one. */
const blocksPadding = (row: Row) => row.overflow.length > 0 || row.cells.some((c) => c?.name);

/** Syntax and structural errors in `after` beyond those `before` had, counted by code. */
function addedErrors(before: RowsDocument, after: RowsDocument): string[] {
  const count = (doc: RowsDocument) => {
    const n = new Map<string, number>();
    for (const e of doc.errors) if (e.class !== 'validation') n.set(e.code, (n.get(e.code) ?? 0) + 1);
    return n;
  };
  const [was, now] = [count(before), count(after)];
  return [...now].filter(([code, k]) => k > (was.get(code) ?? 0)).map(([code]) => code);
}

describe('every edit changes only its target, and adds no syntax or structural error (DESIGN §6)', () => {
  const withRows = files.filter((f) => parseRows(f.text, f.options).rows.length > 0);

  it(`setLead, over ${withRows.length} files`, () => {
    expect(withRows.length).toBeGreaterThanOrEqual(1000);
    for (const { text, options } of withRows) {
      const doc = parseRows(text, options);
      const row = pick(doc.rows);
      const title = pick(TITLES);
      const after = edited(doc, setLead(doc, row, title), options);
      const want = project(doc);
      (want[rowLine(doc, row)] as RowView).lead = title;
      const why = JSON.stringify({ text, title });
      expect(project(after.doc), why).toEqual(want);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
    }
  });

  it(`setCell, over ${withRows.length} files`, () => {
    let written = 0;
    let mounts = 0; // writes to an implicit mount column (ext §12)
    for (const { text, options } of withRows) {
      const doc = parseRows(text, options);
      const row = pick(doc.rows);
      const column = pick(doc.schema.columns);
      const value = random() < 0.25 ? null : pick(VALUES);
      const result = setCell(doc, row, column, value);
      const want = project(doc);
      const target = want[rowLine(doc, row)] as RowView;
      const anchored = column === doc.schema.key && row.anchors.length > 0;
      const why = JSON.stringify({ text, column: column.name, value });
      if ('refused' in result) {
        // Only the documented refusals.
        const documented = (anchored && (value === null || !ID.test(value))) || (value !== null && !row.cells[column.index] && !column.settable && blocksPadding(row));
        expect(documented, why).toBe(true);
        continue;
      }
      if (result.edits.length === 0) {
        // A no-op: a null that is already null.
        expect(value === null && (row.cells[column.index]?.text ?? null) === null, why).toBe(true);
        continue;
      }
      written++;
      if (column === doc.schema.mount?.column && column.implicit) mounts++;
      if (column.index === 0) target.lead = value ?? '';
      else if (anchored) {
        target.anchors[0] = value!;
        target.id = value;
        if (target.cells[column.index - 1] !== null) target.cells[column.index - 1] = value;
      } else {
        target.cells[column.index - 1] = value;
        if (column === doc.schema.key) target.id = value !== null && ID.test(value) ? value : null;
      }
      const after = edited(doc, result, options);
      expect(project(after.doc), why).toEqual(want);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
    }
    expect(written).toBeGreaterThanOrEqual(1000);
    expect(mounts).toBeGreaterThanOrEqual(20);
  });

  it('setMarker, over every file with a marker or bool column', () => {
    let checked = 0;
    for (const { text, options } of withRows) {
      const doc = parseRows(text, options);
      const flags = doc.schema.columns.filter((c) => c.kind === 'bool' && c.index > 0);
      if (flags.length === 0) continue;
      const row = pick(doc.rows);
      const column = pick(flags);
      const on = random() < 0.5;
      const name = doc.schema.markers.find((m) => m.column === column)?.name ?? column.name;
      const result = setMarker(doc, row, name, on);
      const why = JSON.stringify({ text, name, on });
      if ('refused' in result) {
        // Only setCell's refusal of a column that can't be named, when padding up to it would follow a named cell.
        expect(!column.settable && flag(doc, row, column) !== on && !row.cells[column.index] && blocksPadding(row), why).toBe(true);
        continue;
      }
      const after = edited(doc, result, options);
      const i = rowLine(doc, row);
      const newRow = after.doc.lines[i].row!;
      expect(flag(after.doc, newRow, after.doc.schema.columns[column.index]), why).toBe(on);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      // Everything else is unchanged: the other markers, the lead, anchors, and the other cells.
      const [before, now] = [project(doc), project(after.doc)];
      if (!on && row.markers.length === 1 && row.markers[0].name === name && row.lead.text === null) (before[i] as RowView).lead = '';
      const strip = (v: RowView) => ({ ...v, markers: v.markers.filter((m) => m !== name), cells: v.cells.filter((_, k) => k !== column.index - 1) });
      expect(now.map((v, k) => (k === i ? strip(v as RowView) : v)), why).toEqual(before.map((v, k) => (k === i ? strip(v as RowView) : v)));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(1000);
  });

  it(`setAnchor, over ${withRows.length} files`, () => {
    /** Each line's projection with its cells by column name, so an implicit key column appearing shifts nothing. */
    const named = (doc: RowsDocument) =>
      project(doc).map((v, k) => {
        const row = doc.lines[k].row;
        if (!row || !('cells' in v)) return v;
        return { ...v, cells: row.cells.slice(1).flatMap((c, i) => (c?.text != null ? [[doc.schema.columns[i + 1].name, c.text]] : [])) };
      });
    let written = 0;
    for (const { text, options } of withRows) {
      const doc = parseRows(text, options);
      const row = pick(doc.rows);
      const others = doc.rows.flatMap((r) => r.anchors.map((a) => a.id));
      const id = pick(['new', 'x-1', 'R0', '2027-plan', 'bad id', '', '-x', 'a_b', ...others, ...others.map((x) => x.toUpperCase())]);
      const result = setAnchor(doc, row, id);
      const why = JSON.stringify({ text, line: row.line, id });
      const ids = (r: Row) => (r.anchors.length > 0 ? r.anchors.map((a) => a.id) : r.id !== null ? [r.id] : []);
      if ('refused' in result) {
        // Only the documented refusals: not an ID; used, ignoring case, by another row or another of this row's IDs; the first anchor while a row sets id by name.
        const own = ids(row)[0];
        const used = doc.rows.some((r) => ids(r).some((x) => x.toLowerCase() === id.toLowerCase() && !(r === row && x === own)));
        const setsId = (r: Row) => [...r.cells.slice(1), ...r.overflow].some((c) => c && !c.name && doc.text.slice(c.from, c.to).startsWith('id='));
        const first = !doc.schema.identity && !doc.schema.columns.some((c) => c.name === 'id') && doc.rows.some(setsId);
        expect(!ID.test(id) || used || first, why).toBe(true);
        continue;
      }
      if (result.edits.length === 0) {
        expect(row.anchors[0]?.id, why).toBe(id);
        continue;
      }
      written++;
      const after = edited(doc, result, options);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      const want = named(doc);
      const target = want[rowLine(doc, row)] as RowView;
      if (target.anchors.length > 0) target.anchors[0] = id;
      else target.anchors = [id];
      target.id = id;
      const key = after.doc.schema.key!;
      target.cells = (target.cells as unknown as [string, string][]).map(([name, v]) => [name, name === key.name ? id : v]) as never;
      expect(named(after.doc), why).toEqual(want);
    }
    expect(written).toBeGreaterThanOrEqual(1000);
  });

  it(`insertRow, over ${files.length} files`, () => {
    let inserted = 0;
    for (const { text, options } of files) {
      const doc = parseRows(text, options);
      const body = doc.lines.map((l, k) => (l.kind.startsWith('fm-') ? -1 : k + 1)).filter((k) => k > 0);
      const at = body.length > 0 && random() < 0.7 ? { beforeLine: pick(body) } : ('end' as const);
      const indent = pick([0, 2, 4]);
      const lead = pick(TITLES);
      const cells: Record<string, string> = {};
      for (const c of doc.schema.columns.slice(1)) {
        if (random() < 0.4 && (c.settable || !c.implicit) && !(c.name in cells)) cells[c.name] = pick(VALUES);
      }
      const result = insertRow(doc, at, indent, lead, cells);
      const why = JSON.stringify({ text, at, indent, lead, cells });
      if ('refused' in result) {
        // Only an indent that nesting doesn't allow, for the new row or one after it.
        expect(doc.schema.nest, why).not.toBeNull();
        continue;
      }
      inserted++;
      const after = edited(doc, result, options);
      const before = project(doc);
      const index = at === 'end' ? doc.lines.length : at.beforeLine - 1;
      const now = project(after.doc);
      expect(now.length, why).toBe(before.length + 1);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      expect([...now.slice(0, index), ...now.slice(index + 1)], why).toEqual(before);
      const row = now[index] as RowView;
      expect(row.lead, why).toBe(lead);
      expect(row.indent).toBe(indent);
      expect([row.markers, row.anchors, row.overflow]).toEqual([[], [], []]);
      doc.schema.columns.slice(1).forEach((c, k) => {
        const first = doc.schema.columns.findIndex((x) => x.name === c.name) === c.index;
        if (first) expect(row.cells[k], why).toBe(c.name in cells ? cells[c.name] : null);
      });
    }
    expect(inserted).toBeGreaterThanOrEqual(3000);
  });
});

// ---------- level-based structure edits and repairs (DESIGN §6; plan spec §4b.6.4) ----------

const NEST = '---\nnest: parent\nmarkers: done=~\ncolumns: est:duration unit=h | owner | notes\n---\n';
/** The body of a NEST file. */
const body = (text: string) => text.split('\n').slice(5).join('\n');
/** Each row's parent by indentation, as a row index. */
const parents = (doc: RowsDocument) => indentLevels(doc.rows.map((r) => r.indent.width)).map((l) => l.parent);
const depths = (doc: RowsDocument) => {
  const out: number[] = [];
  for (const p of parents(doc)) out.push(p === null ? 0 : out[p] + 1);
  return out;
};

describe('setLevel', () => {
  it('indents a row to the last child of its previous sibling, its children with it', () => {
    const doc = parseRows(`${NEST}S\nR\n    C\n`);
    expect(body(edited(doc, setLevel(doc, doc.rows[1], 1)).text)).toBe('S\n    R\n        C\n');
  });

  it('outdents a row to the next sibling of its parent, its children with it', () => {
    const doc = parseRows(`${NEST}A\n    R\n        C\nB\n`);
    expect(body(edited(doc, setLevel(doc, doc.rows[1], 0)).text)).toBe('A\nR\n    C\nB\n');
  });

  it("writes the file's usual step for a new level, and the indent the new siblings use", () => {
    const doc = parseRows(`${NEST}A\n  B\n  C\n    D\nE\n`);
    expect(body(edited(doc, setLevel(doc, doc.rows[2], 2)).text)).toBe('A\n  B\n    C\n      D\nE\n');
    expect(body(edited(doc, setLevel(doc, doc.rows[4], 1)).text)).toBe('A\n  B\n  C\n    D\n  E\n');
  });

  it('refuses a level that is not open there, and a document without nesting', () => {
    const doc = parseRows(`${NEST}A\n    B\n`);
    expect(setLevel(doc, doc.rows[0], 1)).toHaveProperty('refused');
    expect(setLevel(doc, doc.rows[1], 3)).toHaveProperty('refused');
    const flat = parseRows('A\nB\n');
    expect(setLevel(flat, flat.rows[1], 1)).toEqual({ refused: 'the document has no nesting' });
  });

  it('rewrites a row whose indent fits no level', () => {
    const doc = parseRows(`${NEST}A\n        B\n    C\n`);
    const after = edited(doc, setLevel(doc, doc.rows[2], 1));
    expect(body(after.text)).toBe('A\n        B\n        C\n');
    expect(after.doc.errors).toEqual([]);
  });
});

describe('moveRow', () => {
  it('swaps a row and its subtree with the previous sibling and its subtree', () => {
    const doc = parseRows(`${NEST}Auth\n    Login\n        Form\n    Reset\nAdmin\n    Users\n`);
    const after = edited(doc, moveRow(doc, doc.rows[4], 'up'));
    expect(body(after.text)).toBe('Admin\n    Users\nAuth\n    Login\n        Form\n    Reset\n');
    expect(after.doc.errors).toEqual([]);
    expect(body(edited(doc, moveRow(doc, doc.rows[1], 'down')).text)).toBe('Auth\n    Reset\n    Login\n        Form\nAdmin\n    Users\n');
  });

  it('keeps the lines between the two subtrees where they are, and the ones inside with their subtree', () => {
    const doc = parseRows(`${NEST}A\n    // in A\n    a\n\n// before B\nB\n`);
    expect(body(edited(doc, moveRow(doc, doc.rows[2], 'up')).text)).toBe('B\n\n// before B\nA\n    // in A\n    a\n');
    expect(body(edited(doc, moveRow(doc, doc.rows[0], 'down')).text)).toBe('B\n\n// before B\nA\n    // in A\n    a\n');
  });

  it('refuses without a sibling on that side: moving across levels is indent and outdent', () => {
    const doc = parseRows(`${NEST}Auth\n    Login\nAdmin\n`);
    expect(moveRow(doc, doc.rows[0], 'up')).toEqual({ refused: 'there is no previous sibling to swap with' });
    expect(moveRow(doc, doc.rows[1], 'up')).toEqual({ refused: 'there is no previous sibling to swap with' });
    expect(moveRow(doc, doc.rows[1], 'down')).toEqual({ refused: 'there is no next sibling to swap with' });
    expect(moveRow(doc, doc.rows[2], 'down')).toEqual({ refused: 'there is no next sibling to swap with' });
    expect(body(edited(doc, moveRow(doc, doc.rows[0], 'down')).text)).toBe('Admin\nAuth\n    Login\n');
  });

  it('swaps the first indents of siblings a recovery put at different indents, so the tree is unchanged', () => {
    const doc = parseRows(`${NEST}A\n        B\n            b\n    C\n`);
    const after = edited(doc, moveRow(doc, doc.rows[3], 'up'));
    expect(body(after.text)).toBe('A\n        C\n    B\n        b\n');
    expect(after.doc.errors.map((e) => e.code)).toEqual(['bad-indent']);
    expect(after.doc.rows[0].children.map((r) => r.lead.text)).toEqual(['C', 'B']);
  });

  it('swaps neighbouring rows in a file without nesting, whatever their indent', () => {
    const doc = parseRows('A\n  B\n');
    expect(edited(doc, moveRow(doc, doc.rows[1], 'up')).text).toBe('  B\nA\n');
  });

  it('refuses to make a --- row the first line of a file without frontmatter', () => {
    const doc = parseRows('A\n---\n');
    expect(moveRow(doc, doc.rows[1], 'up')).toHaveProperty('refused');
  });
});

describe('deleteRow', () => {
  it('A / B / C / D (ext §6.2): deleting B gives a valid file, A with children C and D', () => {
    const doc = parseRows(`${NEST}A\n        B\n    C\n    D\n`);
    const after = edited(doc, deleteRow(doc, doc.rows[1]));
    expect(body(after.text)).toBe('A\n    C\n    D\n');
    expect(after.doc.errors).toEqual([]);
    expect(after.doc.rows[0].children.map((r) => r.lead.text)).toEqual(['C', 'D']);
  });

  it('promotes the descendants one level, so the rest of the tree keeps its shape', () => {
    const doc = parseRows(`${NEST}A\n    B\n        C\n            D\n        E\nF\n`);
    expect(body(edited(doc, deleteRow(doc, doc.rows[1])).text)).toBe('A\n    C\n        D\n    E\nF\n');
    expect(body(edited(doc, deleteRow(doc, doc.rows[0])).text)).toBe('B\n    C\n        D\n    E\nF\n');
  });

  it('refuses to delete the last anchor while another row sets the implicit id by name', () => {
    const doc = parseRows('A {#a}\nB | id=b\n');
    expect(deleteRow(doc, doc.rows[0])).toEqual({ refused: 'it has the last anchor, and other rows set id by name' });
    expect(deleteRow(doc, doc.rows[1])).toHaveProperty('edits');
  });

  it('removes every reference to the row with removeReferences: a many cell keeps the others, an emptied cell is cleared', () => {
    const text = '---\nnest: parent\ncolumns: deps:ref many qualifier=lag:duration | notes\n---\nReview {#review #rev}\nAPI {#api} | #review | x\nUI | #wire, #rev 1d,#api\nDocs | #review 1d\nWire {#wire} | parent=#review\n';
    const doc = parseRows(text);
    const after = edited(doc, deleteRow(doc, doc.rows[0], { removeReferences: true }));
    expect(after.text.split('\n').slice(4).join('\n')).toBe('API {#api} |  | x\nUI | #wire,#api\nDocs\nWire {#wire}\n');
    expect(after.doc.errors).toEqual([]);
    // Without the option the references stay, and dangle.
    const plain = edited(doc, deleteRow(doc, doc.rows[0]));
    expect(plain.doc.errors.map((e) => e.code)).toEqual(['unresolved-ref', 'unresolved-ref', 'unresolved-ref', 'unresolved-ref']);
  });

  it('keeps the last-anchor refusal with removeReferences', () => {
    const doc = parseRows('A {#a}\nB | id=b\n');
    expect(deleteRow(doc, doc.rows[0], { removeReferences: true })).toEqual({ refused: 'it has the last anchor, and other rows set id by name' });
  });

  it('deletes the last line, and the only one', () => {
    const doc = parseRows('A\nB');
    expect(edited(doc, deleteRow(doc, doc.rows[1])).text).toBe('A\n');
    const final = parseRows('A\n\nB\n');
    expect(edited(final, deleteRow(final, final.rows[1])).text).toBe('A\n\n');
    const only = parseRows('A\n');
    expect(edited(only, deleteRow(only, only.rows[0])).text).toBe('');
  });
});

describe('levelIndent', () => {
  it("gives an inserted row the level's indent, snapped to a valid one", () => {
    const doc = parseRows(`${NEST}A\n        B\n    C\n`);
    expect(levelIndent(doc, { beforeLine: 8 }, 1)).toBe(8); // before C, at C's recovered level
    expect(levelIndent(doc, { beforeLine: 7 }, 1)).toBe(8); // before B: B is a child of A, a sibling
    expect(levelIndent(doc, { beforeLine: 7 }, 2)).toBeNull();
    expect(levelIndent(doc, 'end', 2)).toBe(12);
    expect(levelIndent(parseRows('A\n'), 'end', 0)).toBeNull();
  });
});

describe('repairRow', () => {
  const repaired = (text: string, line: number) => {
    const doc = parseRows(text);
    const row = doc.rows.find((r) => r.line === line)!;
    return applyEdits(doc.text, repairRow(doc, row));
  };

  it('rewrites cells from their recovered text, correctly quoted', () => {
    expect(body(repaired(`${NEST}A | 2h | bob | "call Bob | then Alice\n`, 6))).toBe('A | 2h | bob | "call Bob | then Alice"\n');
    expect(body(repaired(`${NEST}A | 2h | "a"b | "x\\q"\n`, 6))).toBe('A | 2h | ab | x\\q\n');
    expect(body(repaired(`${NEST}"~Open {#a}\n`, 6))).toBe('"~Open {#a}"\n');
  });

  it('quotes a heading-like title, keeping the marker, anchor and cells', () => {
    expect(body(repaired(`${NEST}# Foo {#f} | 1h\n`, 6))).toBe('"# Foo" {#f} | 1h\n');
  });

  it('snaps an indent that fits no level to the recovered level, and moves the rows at that level with it', () => {
    expect(body(repaired(`${NEST}A\n        B\n    C\n    D\n        E\nF\n`, 8))).toBe('A\n        B\n        C\n        D\n            E\nF\n');
    expect(body(repaired(`${NEST}    A\n    B\n`, 6))).toBe('A\nB\n');
  });

  it('returns nothing for a row without repairable errors', () => {
    const doc = parseRows(`${NEST}A | 4 hours | x | y | z\n`);
    expect(repairRow(doc, doc.rows[0])).toEqual([]);
  });
});

describe('the level-based edits and repairRow add no syntax or structural error (DESIGN §6)', () => {
  const nested = files.filter((f) => {
    const doc = parseRows(f.text, f.options);
    return doc.schema.nest !== null && doc.rows.length > 0;
  });
  /** A line's projection without its indent: everything a reader sees but the level. */
  const flat = (doc: RowsDocument) => project(doc).map((v) => ('lead' in v ? { ...v, indent: 0 } : v));

  it(`setLevel, over ${nested.length} nested files`, () => {
    expect(nested.length).toBeGreaterThanOrEqual(2000);
    let written = 0;
    for (const { text, options } of nested) {
      const doc = parseRows(text, options);
      const k = Math.floor(random() * doc.rows.length);
      const row = doc.rows[k];
      // Any level open there (up to one deeper than the row above), and now and then one that isn't.
      const open = k === 0 ? 0 : depths(doc)[k - 1] + 1;
      const level = Math.floor(random() * (open + 1)) + (random() < 0.1 ? open + 1 : 0);
      const result = setLevel(doc, row, level);
      const why = JSON.stringify({ text, line: row.line, level });
      if ('refused' in result) {
        expect(result.refused, why).toMatch(/isn't open here|fits no level|frontmatter delimiter/);
        continue;
      }
      const after = edited(doc, result, options);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      expect(flat(after.doc), why).toEqual(flat(doc));
      expect(depths(after.doc)[k], why).toBe(level);
      // Its descendants keep their parents.
      const [before, now] = [parents(doc), parents(after.doc)];
      for (let d = k + 1; d < doc.rows.length && depths(doc)[d] > depths(doc)[k]; d++) expect(now[d], why).toBe(before[d]);
      if (result.edits.length > 0) written++;
    }
    expect(written).toBeGreaterThanOrEqual(1000);
  });

  it(`moveRow, over ${files.length} files`, () => {
    let moved = 0;
    for (const { text, options } of files) {
      const doc = parseRows(text, options);
      if (doc.rows.length === 0) continue;
      const k = Math.floor(random() * doc.rows.length);
      const row = doc.rows[k];
      const dir = pick(['up', 'down'] as const);
      const result = moveRow(doc, row, dir);
      const why = JSON.stringify({ text, line: row.line, dir });
      // The rows of each subtree, by the indentation tree (every row is its own without nesting).
      const depth = doc.schema.nest ? depths(doc) : doc.rows.map(() => 0);
      const end = (r: number) => {
        let e = r + 1;
        while (e < doc.rows.length && depth[e] > depth[r]) e++;
        return e;
      };
      let sibling: number | null = null;
      for (let r = k - 1; dir === 'up' && r >= 0 && depth[r] >= depth[k]; r--) if (depth[r] === depth[k]) (sibling ??= r);
      if (dir === 'down' && end(k) < doc.rows.length && depth[end(k)] === depth[k]) sibling = end(k);
      if ('refused' in result) {
        if (sibling === null) expect(result.refused, why).toMatch(/no (previous|next) sibling to swap with/);
        else expect(result.refused, why).toMatch(/frontmatter delimiter/);
        continue;
      }
      expect(sibling, why).not.toBeNull();
      moved++;
      const after = edited(doc, result, options);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      // The lines: the two subtrees swapped, the lines between them where they were.
      const [a, b] = dir === 'up' ? [sibling!, k] : [k, sibling!];
      const lineOf = (r: number) => doc.rows[r].line - 1;
      const [aFrom, aTo, bFrom, bTo] = [lineOf(a), lineOf(b - 1) + 1, lineOf(b), lineOf(end(b) - 1) + 1];
      const want = flat(doc);
      want.splice(aFrom, bTo - aFrom, ...want.slice(bFrom, bTo), ...want.slice(aTo, bFrom), ...want.slice(aFrom, aTo));
      expect(flat(after.doc), why).toEqual(want);
      // The tree: each row keeps its parent, and the two subtrees swap places under theirs.
      if (!doc.schema.nest) continue;
      const order = [...doc.rows.keys()];
      order.splice(a, end(b) - a, ...order.slice(b, end(b)), ...order.slice(a, b));
      const before = parents(doc);
      expect(parents(after.doc), why).toEqual(order.map((r) => (before[r] === null ? null : order.indexOf(before[r]!))));
    }
    expect(moved).toBeGreaterThanOrEqual(2000);
  });

  it(`deleteRow, over ${files.length} files, half of them with removeReferences`, () => {
    let deleted = 0;
    let withReferences = 0;
    for (const { text, options } of files) {
      const doc = parseRows(text, options);
      if (doc.rows.length === 0) continue;
      const k = Math.floor(random() * doc.rows.length);
      const row = doc.rows[k];
      const removeReferences = random() < 0.5;
      const result = deleteRow(doc, row, { removeReferences });
      const why = JSON.stringify({ text, line: row.line, removeReferences });
      if ('refused' in result) {
        expect(result.refused, why).toMatch(/fits no level|frontmatter delimiter|the last anchor/);
        continue;
      }
      deleted++;
      if (removeReferences) withReferences++;
      const after = edited(doc, result, options);
      expect(addedErrors(doc, after.doc), why).toEqual([]);
      const want = flat(doc);
      // With removeReferences, each ref cell loses the references to the row: by target when the
      // cell reads as references, else by the text of an ID the row is the first to declare.
      const ids = (r: Row) => (r.anchors.length > 0 ? r.anchors.map((a) => a.id) : r.id !== null ? [r.id] : []);
      const mine = ids(row).filter((id) => doc.rows.find((r) => ids(r).includes(id)) === row);
      const toRow = (cell: NonNullable<Row['cells'][number]>, part: string, k: number) =>
        cell.value?.type === 'ref' ? cell.value.refs[k].target === row : mine.some((id) => /^(\S*)#(\S+)/.exec(part.trim())?.[2] === id && ['', cell.column!.refTable].includes(/^(\S*)#/.exec(part.trim())![1]));
      const parts = (text: string | null) => (text === null || text === '' ? null : text.split(',').map((p) => p.trim()).join(','));
      const refColumns = doc.schema.columns.filter((c) => c.kind === 'ref' && c.refCurrent);
      if (removeReferences) {
        doc.rows.forEach((r) => {
          if (r === row) return;
          const v = want[r.line - 1] as RowView;
          for (const c of refColumns) {
            const cell = r.cells[c.index];
            if (cell?.text == null) continue;
            v.cells[c.index - 1] = parts(cell.text.split(',').filter((p, i) => !toRow(cell, p, i)).join(','));
          }
        });
      }
      want.splice(row.line - 1, 1);
      const normal = (list: ReturnType<typeof flat>) =>
        list.map((v) => ('lead' in v ? { ...v, cells: (v as RowView).cells.map((t, i) => (refColumns.some((c) => c.index === i + 1) ? parts(t) : t)) } : v));
      // Deleting the only anchored row turns identity off (ext §3.1), and with it the implicit id column.
      const same = after.doc.schema.identity === doc.schema.identity;
      const cells = (list: ReturnType<typeof flat>) => (same ? normal(list) : list.map((v) => ('cells' in v ? { ...v, cells: [] } : v)));
      expect(cells(flat(after.doc)), why).toEqual(cells(want));
      if (removeReferences) {
        // No reference to the row's IDs is left pointing at nothing.
        const declared = new Set(after.doc.rows.flatMap(ids));
        const dangling = after.doc.rows.flatMap((r) =>
          r.cells.flatMap((c) => (c?.column?.kind === 'ref' && c.text ? c.text.split(',').map((p) => /#(\S+)/.exec(p)?.[1]).filter((id) => id && mine.includes(id) && !declared.has(id)) : [])),
        );
        expect(dangling, why).toEqual([]);
      }
      if (!doc.schema.nest) continue;
      // The tree keeps its shape: the row's children take its parent.
      const before = parents(doc);
      const expected = before.filter((_, r) => r !== k).map((p) => (p === k ? before[k] : p)).map((p) => (p === null || p < k ? p : p - 1));
      expect(parents(after.doc), why).toEqual(expected);
    }
    expect(deleted).toBeGreaterThanOrEqual(3000);
    expect(withReferences).toBeGreaterThanOrEqual(1500);
  });

  it(`repairRow, over every row with an error in ${files.length} files`, () => {
    let repaired = 0;
    for (const { text, options } of files) {
      const doc = parseRows(text, options);
      for (const row of doc.rows.filter((r) => r.errors.length > 0)) {
        const edits = repairRow(doc, row);
        if (edits.length === 0) continue;
        repaired++;
        const why = JSON.stringify({ text, line: row.line });
        const after = edited(doc, { edits }, options);
        expect(addedErrors(doc, after.doc), why).toEqual([]);
        // It keeps every value and the tree.
        expect(flat(after.doc), why).toEqual(flat(doc));
        if (doc.schema.nest) expect(parents(after.doc), why).toEqual(parents(doc));
        const again = after.doc.rows.find((r) => r.line === row.line)!;
        expect(again.errors.filter((e) => ['unterminated-quote', 'text-after-quote', 'unknown-escape'].includes(e.code)), why).toEqual([]);
        expect(repairRow(after.doc, again), why).toEqual([]);
      }
    }
    expect(repaired).toBeGreaterThanOrEqual(1000);
  });
});
