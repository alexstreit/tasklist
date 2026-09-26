// The edit API (DESIGN §6): the Task 20 examples, then the property over generated files.
import { describe, expect, it } from 'vitest';
import { applyEdits, formatValue, insertRow, parseRows, setCell, setLead, setMarker, type Column, type ParseOptions, type Row, type RowsDocument } from '../src/index';
import { generatedFiles, mulberry32 } from './generators';

const PLAN = '---\nnest: parent\nmarkers: done=~\ncolumns: est:duration unit=h hpd=8 | owner | notes\n---\n';
const edited = (doc: RowsDocument, edits: ReturnType<typeof setLead>, options: ParseOptions = {}) => {
  const text = applyEdits(doc.text, edits);
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
    expect(setCell(ids, ids.rows[0], col(ids, 'id'), 'not an id')).toEqual([]);
    expect(setCell(ids, ids.rows[0], col(ids, 'id'), null)).toEqual([]);
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

  it('keeps a row that was only a marker, as a delimiter', () => {
    const doc = parseRows(`${PLAN}A\n    ~\n`);
    const after = edited(doc, setMarker(doc, doc.rows[1], 'done', false));
    expect(lastLine(after.text)).toBe('    |');
    expect(after.doc.rows[1]).toMatchObject({ markers: [], lead: { text: null } });
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
    const text = applyEdits(doc.text, insertRow(doc, 'end', 4, 'B', { est: '2h', notes: 'n', done: 'true' }));
    expect(lastLine(text)).toBe('    B | 2h | notes=n | done=true');
  });

  it('inserts before a line, and keeps a file without a final newline that way', () => {
    const doc = parseRows('A\nC');
    expect(applyEdits(doc.text, insertRow(doc, { beforeLine: 2 }, 0, 'B'))).toBe('A\nB\nC');
    expect(applyEdits(doc.text, insertRow(doc, 'end', 0, 'D'))).toBe('A\nC\nD');
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

describe('every edit changes only its target (DESIGN §6)', () => {
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
      expect(project(after.doc), JSON.stringify({ text, title })).toEqual(want);
    }
  });

  it(`setCell, over ${withRows.length} files`, () => {
    let written = 0;
    for (const { text, options } of withRows) {
      const doc = parseRows(text, options);
      const row = pick(doc.rows);
      const column = pick(doc.schema.columns);
      const value = random() < 0.25 ? null : pick(VALUES);
      const edits = setCell(doc, row, column, value);
      const want = project(doc);
      const target = want[rowLine(doc, row)] as RowView;
      const anchored = column === doc.schema.key && row.anchors.length > 0;
      if (edits.length === 0) {
        // The documented refusals, or a null that is already null.
        const refused =
          (anchored && (value === null || !ID.test(value))) ||
          (value !== null && !row.cells[column.index] && !column.settable) ||
          (value === null && (row.cells[column.index]?.text ?? null) === null);
        expect(refused, JSON.stringify({ text, column: column.name, value })).toBe(true);
        continue;
      }
      written++;
      if (column.index === 0) target.lead = value ?? '';
      else if (anchored) {
        target.anchors[0] = value!;
        target.id = value;
        if (target.cells[column.index - 1] !== null) target.cells[column.index - 1] = value;
      } else {
        target.cells[column.index - 1] = value;
        if (column === doc.schema.key) target.id = value !== null && ID.test(value) ? value : null;
      }
      const after = edited(doc, edits, options);
      expect(project(after.doc), JSON.stringify({ text, column: column.name, value })).toEqual(want);
    }
    expect(written).toBeGreaterThanOrEqual(1000);
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
      const after = edited(doc, setMarker(doc, row, name, on), options);
      const i = rowLine(doc, row);
      const newRow = after.doc.lines[i].row!;
      const why = JSON.stringify({ text, name, on });
      if (!column.settable && !doc.schema.markers.some((m) => m.column === column) && flag(doc, row, column) !== on && !row.cells[column.index]) continue; // can't be named
      expect(flag(after.doc, newRow, after.doc.schema.columns[column.index]), why).toBe(on);
      // Everything else is unchanged: the other markers, the lead, anchors, and the other cells.
      const [before, now] = [project(doc), project(after.doc)];
      const strip = (v: RowView) => ({ ...v, markers: v.markers.filter((m) => m !== name), cells: v.cells.filter((_, k) => k !== column.index - 1) });
      expect(now.map((v, k) => (k === i ? strip(v as RowView) : v)), why).toEqual(before.map((v, k) => (k === i ? strip(v as RowView) : v)));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(1000);
  });

  it(`insertRow, over ${files.length} files`, () => {
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
      const after = edited(doc, insertRow(doc, at, indent, lead, cells), options);
      const before = project(doc);
      const index = at === 'end' ? doc.lines.length : at.beforeLine - 1;
      const now = project(after.doc);
      const why = JSON.stringify({ text, at, lead, cells });
      expect(now.length, why).toBe(before.length + 1);
      expect([...now.slice(0, index), ...now.slice(index + 1)], why).toEqual(before);
      const inserted = now[index] as RowView;
      expect(inserted.lead, why).toBe(lead);
      expect(inserted.indent).toBe(indent);
      expect([inserted.markers, inserted.anchors, inserted.overflow]).toEqual([[], [], []]);
      doc.schema.columns.slice(1).forEach((c, k) => {
        const first = doc.schema.columns.findIndex((x) => x.name === c.name) === c.index;
        if (first) expect(inserted.cells[k], why).toBe(c.name in cells ? cells[c.name] : null);
      });
    }
  });
});
