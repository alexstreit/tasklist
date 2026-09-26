// One test per diagnostic in spec §2.9, asserting line number and severity.

import { describe, expect, it } from 'vitest';
import { applyEdits } from 'rows';
import { analyze } from '../../src/core';
import type { Model } from '../../src/core';
import { load } from './helpers';

function only(model: Model) {
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

  it('heading line → error (rows structural), still an item', () => {
    const { model } = load('A | 4h\n# a heading');
    const d = only(model);
    expect(d).toMatchObject({ line: 2, severity: 'error', code: 'heading-line' });
    expect(model.roots.map((r) => r.title)).toEqual(['A', '# a heading']);
  });

  it('more cells than columns → error (rows structural), extras ignored', () => {
    const { model } = load('A | 4h | bob | note | extra | more');
    const d = only(model);
    expect(d).toMatchObject({ line: 1, severity: 'error', code: 'too-many-cells' });
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

  it('invalid compound duration → warning, treated as empty (derived)', () => {
    const { model } = load('A | 2d 2d\n    B | 2 d 4 h');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(d.code).toBe('invalid-value');
    expect(model.roots[0].cells[0]).toMatchObject({ mode: 'derived', effective: 20 });
  });

  it('bare number in compound duration → warning (rows validation)', () => {
    const { model } = load('A | 4 2d');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(d.code).toBe('invalid-value');
    expect(model.roots[0].cells[0]).toMatchObject({ mode: 'derived', hasValue: false });
  });

  it('unparseable number → warning', () => {
    const { model } = load('---\ncolumns: n:number\n---\nA | x1');
    const d = only(model);
    expect(d.line).toBe(4);
    expect(d.severity).toBe('warning');
  });

  it('unknown front matter key → info; rows, extension and x- keys are known', () => {
    const { model } = load('---\ncalendar: 2026\nx-mine: 1\norder: position\n---\nA | 4h');
    const d = only(model);
    expect(d).toMatchObject({ line: 2, severity: 'info', code: 'unknown-key' });
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

  it('duplicate column name → error (rows structural)', () => {
    const { model } = load('---\ncolumns: est:duration | est:number\n---\nA | 4h');
    const d = only(model);
    expect(d).toMatchObject({ line: 2, severity: 'error', code: 'duplicate-column-name' });
  });

  it('front matter opened but not closed → one error on line 1, and every row stays visible', () => {
    const { model, tree } = load('---\ncolumns: est:duration\nA | 4h\nB | 2h\n// note');
    expect(model.diagnostics).toMatchObject([{ line: 1, severity: 'error', code: 'unclosed-frontmatter' }]);
    expect(tree.nodes.map((n) => n.kind)).toEqual(['front-matter', 'item', 'item', 'item', 'comment']);
    expect(model.roots.map((r) => r.title)).toEqual(['columns: est:duration', 'A', 'B']);
    expect(model.totals[0]).toEqual({ effective: 6, doneSum: 0 });
  });

  it('a line beginning <!-- → info, with a fix that turns it into a // comment', () => {
    const text = 'A | 4h\n    <!-- note -->\n';
    const d = only(analyze(text));
    expect(d).toMatchObject({ line: 2, severity: 'info', code: 'html-comment' });
    expect(d.fixes).toHaveLength(1);
    const fixed = applyEdits(text, d.fixes![0].edits);
    expect(fixed).toBe('A | 4h\n    // note\n');
    expect(analyze(fixed).diagnostics).toEqual([]);
  });

  it('a negative value → warning, treated as empty', () => {
    const { model } = load('A | -4h\n    B | 1h');
    const d = only(model);
    expect(d).toMatchObject({ line: 1, severity: 'warning', code: 'negative-value' });
    expect(model.roots[0].cells[0]).toMatchObject({ mode: 'derived', effective: 1 });
  });

  it('a legacy file opened as .plan: conversion warnings, whose fix clears them and brings the totals', () => {
    const text = '---\ncolumns: est:duration | owner:text\n---\nA | 2d\nB | 4\n';
    const model = analyze(text, 'legacy.plan');
    // 2d can't convert without hpd; a bare number isn't valid without unit= (rows validation).
    expect(model.diagnostics).toMatchObject([
      { line: 4, severity: 'warning', code: 'unconvertible-duration' },
      { line: 5, severity: 'warning', code: 'invalid-value' },
    ]);
    expect(model.totals[0]).toEqual({ effective: 0, doneSum: 0 });
    const [fix] = model.diagnostics[0].fixes!;
    expect(model.diagnostics[1].fixes).toEqual([fix]);
    expect(fix.label).toBe('Add unit=h hpd=8 dpw=5');
    const fixed = applyEdits(text, fix.edits);
    expect(fixed.split('\n')[1]).toBe('columns: est:duration unit=h hpd=8 dpw=5 | owner:text');
    const after = analyze(fixed, 'legacy.plan');
    expect(after.diagnostics).toEqual([]);
    expect(after.totals[0]).toEqual({ effective: 20, doneSum: 0 });
  });

  it('the conversion fix adds only the options a column is missing', () => {
    const model = analyze('---\ncolumns: est:duration unit=h\n---\nA | 1w\n', 'x.plan');
    expect(model.diagnostics[0].fixes![0].label).toBe('Add hpd=8 dpw=5');
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
