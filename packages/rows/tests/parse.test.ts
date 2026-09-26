// What the conformance fixtures don't assert: line kinds, spans, and schema details.
import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/index';

const slice = (doc: { text: string }, s: { from?: number; to?: number }) => doc.text.slice(s.from, s.to);

describe('parseRows', () => {
  it('classifies every line', () => {
    const doc = parseRows('---\ntable: t\n# c\n\nbad\n---\n// note\n\nA\n');
    expect(doc.lines.map((l) => l.kind)).toEqual(['fm-open', 'fm-entry', 'fm-comment', 'fm-blank', 'fm-malformed', 'fm-close', 'comment', 'blank', 'row']);
    expect(doc.lines[8].row).toBe(doc.rows[0]);
    expect(doc.endsWithNewline).toBe(true);
    expect(slice(doc, doc.frontmatter!)).toBe('---\ntable: t\n# c\n\nbad\n---');
  });

  it('marks an unclosed opening --- as ignored and reads the rest as body', () => {
    const doc = parseRows('---\nA\n');
    expect(doc.lines.map((l) => l.kind)).toEqual(['fm-malformed', 'row']);
    expect(doc.frontmatter).toBeNull();
  });

  it('gives frontmatter entries key and value spans, and unquotes values', () => {
    const doc = parseRows('---\n  table :  "a\\"b"  \n---\n');
    const [entry] = doc.frontmatter!.entries;
    expect(entry).toMatchObject({ key: 'table', value: 'a"b', quoted: true, line: 2 });
    expect(slice(doc, { from: entry.keyFrom, to: entry.keyTo })).toBe('table');
    expect(slice(doc, { from: entry.valueFrom, to: entry.valueTo })).toBe('"a\\"b"');
  });

  it('gives every cell a whole-cell span and a value span, and the indent its own', () => {
    const doc = parseRows('---\ncolumns: est | notes\n---\n  Auth  |  2d  | notes="a | b"  \n');
    const row = doc.rows[0];
    expect(slice(doc, row.indent)).toBe('  ');
    expect(slice(doc, { from: row.lead.valueFrom, to: row.lead.valueTo })).toBe('Auth');
    const notes = row.cells[2]!;
    expect(slice(doc, notes)).toBe('notes="a | b"');
    expect(slice(doc, { from: notes.valueFrom, to: notes.valueTo })).toBe('"a | b"');
    expect(slice(doc, notes.name!)).toBe('notes');
    expect(notes).toMatchObject({ quoted: true, text: 'a | b', value: { type: 'text', text: 'a | b' } });
    expect(row.cells[1]!.column!.name).toBe('est');
  });

  it('gives errors spans in the text', () => {
    const doc = parseRows('---\ncolumns: notes\n---\nA | "x\\qy" | extra\n');
    expect(doc.errors.map((e) => [e.code, slice(doc, e)])).toEqual([
      ['unknown-escape', '\\q'],
      ['too-many-cells', 'extra'],
    ]);
  });

  it('gives declarations spans when written unquoted in the file, and none from a profile', () => {
    const doc = parseRows('---\ncolumns: est:duration unit=h | 2x\n---\n');
    const [, est, bad] = doc.schema.columns;
    expect(slice(doc, est)).toBe('est:duration unit=h');
    expect(est).toMatchObject({ type: 'duration', options: [{ key: 'unit', value: 'h' }], settable: true });
    expect(bad.settable).toBe(false);
    expect(slice(doc, doc.errors[0])).toBe('2x');
    const fromProfile = parseRows('---\nprofile: p\n---\n', { profiles: { p: '---\ncolumns: a\n---\n' } });
    expect(fromProfile.schema.columns[1].from).toBeUndefined();
  });

  it('reads option values that are quoted', () => {
    const doc = parseRows('---\ncolumns: notes:text default="a b" required\n---\n');
    expect(doc.schema.columns[1].options).toEqual([
      { key: 'default', value: 'a b' },
      { key: 'required', value: null },
    ]);
  });

  it('reads ref types as text only in a base-only parse (base §9)', () => {
    const text = '---\ncolumns: a:ref | b:ref[people]\n---\n';
    expect(parseRows(text).schema.columns.map((c) => c.type)).toEqual(['text', 'ref', 'ref[people]']);
    expect(parseRows(text, { extensions: false }).schema.columns.map((c) => c.type)).toEqual(['text', 'text', 'text']);
  });

  it('checks sep before comment, and blames sep whenever the file set it (base §2.2)', () => {
    const codes = (fm: string) => parseRows(`---\n${fm}\n---\n`).errors.map((e) => e.code);
    expect(codes('sep: |\ncomment: a|b')).toEqual(['invalid-sep', 'invalid-comment']);
    expect(codes('sep: ;\ncomment: ;;')).toEqual(['invalid-sep']);
    expect(codes('comment:')).toEqual(['invalid-comment']);
  });

  it('reports an unresolvable default profile on line 1', () => {
    expect(parseRows('A\n', { defaultProfile: 'nope' }).errors).toMatchObject([{ code: 'unresolvable-profile', line: 1 }]);
  });

  it('exposes resolved keys, the file overriding the profile', () => {
    const doc = parseRows('---\nprofile: p\nlead: task\nx-mine: 1\n---\n', { profiles: { p: '---\nlead: title\ncolumns: a\n---\n' } });
    expect(doc.schema.keys).toEqual({ profile: 'p', lead: 'task', columns: 'a', 'x-mine': '1' });
    expect(doc.schema.lead.name).toBe('task');
  });

  it('leaves the table name null without a filename or table key', () => {
    expect(parseRows('A').schema.table).toBeNull();
    expect(parseRows('A', { filename: 'dir/my.list.rows' }).schema.table).toBe('my.list');
  });
});
