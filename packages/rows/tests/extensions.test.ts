// What the conformance fixtures don't assert about the extensions: the tree, reference values,
// anchor spans and the schema.
import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/index';

const fm = (keys: string, body: string) => parseRows(`---\n${keys}\n---\n${body}`);

describe('nesting', () => {
  it('builds children, depth and roots in file order', () => {
    const doc = fm('nest: parent', 'A\n  B\n    C\n  D\nE\n');
    const [a, b, c, d, e] = doc.rows;
    expect(doc.roots).toEqual([a, e]);
    expect(a.children).toEqual([b, d]);
    expect(b.children).toEqual([c]);
    expect(doc.rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('leaves every row a root without nest', () => {
    const doc = parseRows('A\n  B\n');
    expect(doc.roots).toEqual(doc.rows);
    expect(doc.rows[1].parent).toBeNull();
  });

  it('breaks a long cycle without hanging, and keeps parents that point into it', () => {
    const n = 500;
    const body = Array.from({ length: n }, (_, i) => `R${i} {#r${i}} | parent=#r${(i + 1) % n}`).join('\n');
    const doc = fm('nest: parent', `${body}\nOut | parent=#r0\n`);
    expect(doc.errors.filter((e) => e.code === 'parent-cycle')).toHaveLength(n);
    expect(doc.rows.slice(0, n).every((r) => r.parent === null)).toBe(true);
    expect(doc.rows[n].parent).toBe(doc.rows[0]);
    expect(doc.rows[0].children).toEqual([doc.rows[n]]);
  });
});

describe('references', () => {
  it('resolves targets, aliases and qualifiers', () => {
    const doc = fm('columns: deps:ref many qualifier=lag:duration', 'A {#a #alias}\nB | #alias +2d, #a\n');
    const [a, b] = doc.rows;
    expect(b.cells[1]!.value).toEqual({
      type: 'ref',
      refs: [
        { table: null, id: 'alias', target: a, qualifier: { type: 'duration', sign: '+', terms: { d: 2 }, bare: false } },
        { table: null, id: 'a', target: a, qualifier: null },
      ],
    });
  });

  it('names the target table when the file has one', () => {
    const doc = parseRows('---\ncolumns: dep:ref\n---\nA {#a}\nB | tasks#a\n', { filename: 'tasks.rows' });
    expect(doc.rows[1].cells[1]!.value).toMatchObject({ refs: [{ table: 'tasks', id: 'a', target: doc.rows[0] }] });
  });
});

describe('identity and markers', () => {
  it('gives anchors spans on the #ID, and the lead value span excludes markers and anchors', () => {
    const doc = fm('markers: done=~', '  ~Login {#login #l}\n');
    const row = doc.rows[0];
    expect(row.anchors.map((a) => [a.id, doc.text.slice(a.from, a.to)])).toEqual([
      ['login', '#login'],
      ['l', '#l'],
    ]);
    expect(row.markers.map((m) => doc.text.slice(m.from, m.to))).toEqual(['~']);
    expect(doc.text.slice(row.lead.valueFrom, row.lead.valueTo)).toBe('Login');
    expect(doc.text.slice(row.lead.from, row.lead.to)).toBe('~Login {#login #l}');
  });

  it('exposes the resolved extension schema', () => {
    const doc = fm('key: code\nnest: up\nmarkers: done=~\norder: -n\ncolumns: n:number', 'A\n');
    const s = doc.schema;
    expect(s.columns.map((c) => [c.name, c.type, c.implicit])).toEqual([
      ['name', 'text', false],
      ['n', 'number', false],
      ['code', 'text', true],
      ['up', 'ref', true],
      ['done', 'bool', true],
    ]);
    expect(s).toMatchObject({ identity: true, key: { name: 'code' }, nest: { column: { name: 'up' }, valid: true }, order: { column: { name: 'n' }, descending: true } });
    expect(s.markers).toMatchObject([{ name: 'done', char: '~', column: { name: 'done', default: { type: 'bool', value: false } } }]);
  });

  it('turns none of it on in a base-only parse', () => {
    const doc = parseRows('---\nkey: id\nnest: parent\nmarkers: done=~\n---\n~A {#a}\n  B\n', { extensions: false });
    expect(doc.schema).toMatchObject({ identity: false, key: null, nest: null, markers: [] });
    expect(doc.rows.map((r) => [r.lead.text, r.id, r.parent])).toEqual([
      ['~A {#a}', null, null],
      ['B', null, null],
    ]);
  });
});
