import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, PLAN_PROFILE } from '../../src/core';

const DEFAULTS = [
  { name: 'est', type: 'duration' },
  { name: 'owner', type: 'text' },
  { name: 'notes', type: 'text' },
];
const columns = (text: string, filename?: string) => analyze(text, filename).columns;

describe('columns (§2.1, §2.6)', () => {
  it('defaults when there is no front matter', () => {
    expect(columns('')).toEqual(DEFAULTS);
    expect(analyze('').diagnostics).toHaveLength(0);
  });

  it('defaults when front matter has no columns key', () => {
    expect(columns('---\ncalendar: x\n---\n')).toEqual(DEFAULTS);
  });

  it('parses declared columns in order, and never shows the implicit ones', () => {
    expect(columns('---\ncolumns: est:duration | pts:number | who:text\n---\n')).toEqual([
      { name: 'est', type: 'duration' },
      { name: 'pts', type: 'number' },
      { name: 'who', type: 'text' },
    ]);
  });

  it('unknown type falls back to text with a warning (rows validation)', () => {
    const model = analyze('---\ncolumns: when:money\n---\n');
    expect(model.columns).toEqual([{ name: 'when', type: 'text' }]);
    expect(model.diagnostics).toMatchObject([{ line: 2, severity: 'warning', code: 'unknown-type' }]);
  });

  it('every rows type is a column; only duration and number are summed', () => {
    const model = analyze('---\ncolumns: due:date | ok:bool | size:enum[s, m]\n---\nA | 2026-01-02 | true | m\n');
    expect(model.columns.map((c) => c.type)).toEqual(['date', 'bool', 'enum']);
    expect(model.roots[0].cells).toEqual([
      expect.objectContaining({ kind: 'text', value: '2026-01-02' }),
      expect.objectContaining({ kind: 'text', value: 'true' }),
      expect.objectContaining({ kind: 'text', value: 'm' }),
    ]);
    expect(model.totals).toEqual([null, null, null]);
  });

  it('duplicate names are an error (rows structural)', () => {
    const model = analyze('---\ncolumns: est:duration | est:number\n---\n');
    expect(model.diagnostics).toMatchObject([{ severity: 'error', code: 'duplicate-column-name' }]);
  });
});

describe('the plan profile (§2.1)', () => {
  it('is built in with the text published as profiles/plan.rows', () => {
    const published = readFileSync(new URL('../../profiles/plan.rows', import.meta.url), 'utf8');
    expect(published.startsWith(PLAN_PROFILE)).toBe(true);
  });

  it('applies to a .plan file or an unnamed one, and not to other files', () => {
    expect(columns('A | 2h\n', 'a.plan')).toEqual(DEFAULTS);
    expect(columns('A | 2h\n')).toEqual(DEFAULTS);
    expect(columns('A | 2h\n', 'a.rows')).toEqual([]);
    expect(columns('---\nprofile: plan\n---\nA | 2h\n', 'a.rows')).toEqual(DEFAULTS);
  });

  it('done is the ~ marker or done=true by name (§2.5)', () => {
    const model = analyze('~A\nB | done=true\nC | done=false\n');
    expect(model.roots.map((r) => r.done)).toEqual([true, true, false]);
  });

  it('the §2.10 example is the rows conformance case', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../../examples/example.plan')).toBe(read('../../packages/rows/conformance/plan-example/input.rows'));
  });
});
