// One test per diagnostic in spec §2.9, asserting line number and severity.

import { describe, expect, it } from 'vitest';
import { load } from './helpers';

function only(model: { diagnostics: { line: number; severity: string; message: string }[] }) {
  expect(model.diagnostics).toHaveLength(1);
  return model.diagnostics[0];
}

describe('spec §2.9 diagnostics', () => {
  it('tabs converted on load → info', () => {
    const { model } = load('A\n\tB | 2h');
    const d = only(model);
    expect(d.line).toBe(2);
    expect(d.severity).toBe('info');
    expect(d.message).toMatch(/tab/i);
  });

  it("line starts with '#' → warning", () => {
    const { model } = load('A | 4h\n# a heading');
    const d = only(model);
    expect(d.line).toBe(2);
    expect(d.severity).toBe('warning');
  });

  it('more fields than columns → warning, extras ignored', () => {
    const { model } = load('A | 4h | bob | note | extra | more');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(model.roots[0].cells).toHaveLength(3);
  });

  it('unparseable duration → warning, treated as empty (derived)', () => {
    const { model } = load('A | soonish\n    B | 4h');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    const cell = model.roots[0].cells[0];
    expect(cell).toMatchObject({ mode: 'derived', effective: 4 });
  });

  it('unparseable number → warning', () => {
    const { model } = load('---\ncolumns: n:number\n---\nA | x1');
    const d = only(model);
    expect(d.line).toBe(4);
    expect(d.severity).toBe('warning');
  });

  it('unknown front matter key → warning', () => {
    const { model } = load('---\ncalendar: 2026\n---\nA | 4h');
    const d = only(model);
    expect(d.line).toBe(2);
    expect(d.severity).toBe('warning');
  });

  it('unknown column type → warning, column treated as text', () => {
    const { model } = load('---\ncolumns: est:frobnicate\n---\nA | whatever');
    const d = only(model);
    expect(d.line).toBe(2);
    expect(d.severity).toBe('warning');
    expect(model.columns).toEqual([{ name: 'est', type: 'text' }]);
    // treated as text: no unparseable-value warning for "whatever"
    expect(model.roots[0].cells[0]).toMatchObject({ kind: 'text', value: 'whatever' });
  });

  it('duplicate column name → warning', () => {
    const { model } = load('---\ncolumns: est:duration | est:number\n---\nA | 4h');
    const d = only(model);
    expect(d.line).toBe(2);
    expect(d.severity).toBe('warning');
  });

  it('front matter opened but not closed → one warning on line 1, remaining lines still front matter', () => {
    const { model, tree } = load('---\ncolumns: est:duration\nA | 4h\nB | 2h\n// note');
    // The swallowed lines raise no unknown-key warnings of their own.
    expect(model.diagnostics.map((d) => [d.line, d.severity])).toEqual([[1, 'warning']]);
    expect(model.diagnostics[0].message).toBe('front matter not closed');
    expect(tree.nodes.every((n) => n.kind === 'front-matter')).toBe(true);
    expect(model.roots).toHaveLength(0);
  });

  it('override differs from child sum → info', () => {
    const { model } = load('A | 4h\n    B | 1h');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('info');
    expect(d.message).toBe('override differs from children (4h vs 1h)');
  });

  it('override over children without estimates → no diagnostic', () => {
    const { model } = load('A | 4h\n    B\n    C | later');
    expect(model.diagnostics.filter((d) => d.severity === 'info')).toHaveLength(0);
  });

  it('override differing from a single estimated child → info', () => {
    const { model } = load('A | 4h\n    B\n    C | 1h');
    const infos = model.diagnostics.filter((d) => d.severity === 'info');
    expect(infos).toHaveLength(1);
    expect(infos[0].message).toBe('override differs from children (4h vs 1h)');
  });

  it('override equal to child sum → no diagnostic', () => {
    const { model } = load('A | 4h\n    B | 4h');
    expect(model.diagnostics).toHaveLength(0);
  });
});
