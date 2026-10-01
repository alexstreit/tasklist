// One test per diagnostic in spec §2.9, asserting line number and severity.

import { describe, expect, it } from 'vitest';
import { applyEdits } from 'rows';
import { analyze } from '../../src/app/registry';
import type { Model } from '../../src/core';
import { est, load, total } from './helpers';

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
    expect(model.roots[0].fields).toHaveLength(3);
  });

  it('unparseable duration → warning, treated as empty (derived)', () => {
    const { model } = load('A | soonish\n    B | 4h');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'derived', effective: 4 });
  });

  it('invalid compound duration → warning, treated as empty (derived)', () => {
    const { model } = load('A | 2d 2d\n    B | 2 d 4 h');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(d.code).toBe('invalid-value');
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'derived', effective: 20 });
  });

  it('bare number in compound duration → warning (rows validation)', () => {
    const { model } = load('A | 4 2d');
    const d = only(model);
    expect(d.line).toBe(1);
    expect(d.severity).toBe('warning');
    expect(d.code).toBe('invalid-value');
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'derived', hasValue: false });
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
    expect(model.roots[0].fields[0]?.text).toBe('whatever');
    expect(total(model)).toBeUndefined();
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
    expect(total(model)).toEqual({ effective: 6, doneSum: 0 });
  });

  it('a line beginning <!-- → info, with a fix that turns it into a // comment', () => {
    const text = 'A | 4h\n    <!-- note -->\n';
    const d = only(analyze(text));
    expect(d).toMatchObject({ line: 2, severity: 'info', code: 'html-comment' });
    expect(d.fixes).toHaveLength(1);
    // The row leaves the grid: a confirm fix, with the lines before and after (spec §4b.6.6).
    expect(d.fixes![0]).toMatchObject({ tier: 'confirm', preview: '-     <!-- note -->\n+     // note' });
    const fixed = applyEdits(text, d.fixes![0].edits);
    expect(fixed).toBe('A | 4h\n    // note\n');
    expect(analyze(fixed).diagnostics).toEqual([]);
  });

  it('a negative value → warning, treated as empty', () => {
    const { model } = load('A | -4h\n    B | 1h');
    const d = only(model);
    expect(d).toMatchObject({ line: 1, severity: 'warning', code: 'negative-value' });
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'derived', effective: 1 });
  });

  it('a legacy file opened as .plan: conversion warnings, whose fix clears them and brings the totals', () => {
    const text = '---\ncolumns: est:duration | owner:text\n---\nA | 2d\nB | 4\n';
    const model = analyze(text, { filename: 'legacy.plan' });
    // 2d can't convert without hpd; a bare number isn't valid without unit= (rows validation).
    expect(model.diagnostics).toMatchObject([
      { line: 4, severity: 'warning', code: 'unconvertible-duration' },
      { line: 5, severity: 'warning', code: 'invalid-value' },
    ]);
    expect(total(model)).toEqual({ effective: 0, doneSum: 0 });
    const [fix] = model.diagnostics[0].fixes!;
    expect(model.diagnostics[1].fixes).toEqual([fix]);
    expect(fix).toMatchObject({ label: 'Add unit=h hpd=8 dpw=5', tier: 'click' });
    const fixed = applyEdits(text, fix.edits);
    expect(fixed.split('\n')[1]).toBe('columns: est:duration unit=h hpd=8 dpw=5 | owner:text');
    const after = analyze(fixed, { filename: 'legacy.plan' });
    expect(after.diagnostics).toEqual([]);
    expect(total(after)).toEqual({ effective: 20, doneSum: 0 });
  });

  it('the conversion fix adds only the options a column is missing', () => {
    const model = analyze('---\ncolumns: est:duration unit=h\n---\nA | 1w\n', { filename: 'x.plan' });
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

describe('spec §4b.6.6 tree and title fixes', () => {
  /** The one fix on the diagnostic with `code`, and the text after applying it. */
  const fixOf = (text: string, code: string) => {
    const d = analyze(text).diagnostics.find((x) => x.code === code)!;
    expect(d.fixes, code).toHaveLength(1);
    const fix = d.fixes![0];
    return { fix, fixed: applyEdits(text, fix.edits) };
  };

  it('an indent that fits no level: auto, rewritten to the recovered level', () => {
    const { fix, fixed } = fixOf('A\n        B\n    C\n    D\n', 'bad-indent');
    expect(fix).toMatchObject({ label: 'Rewrite the indent', tier: 'auto' });
    expect(fixed).toBe('A\n        B\n        C\n        D\n');
    expect(analyze(fixed).diagnostics).toEqual([]);
  });

  it('a first row indented: auto, indent 0', () => {
    const { fix, fixed } = fixOf('    A\nB\n', 'bad-indent');
    expect(fix).toMatchObject({ label: 'Indent 0', tier: 'auto' });
    expect(fixed).toBe('A\nB\n');
  });

  it('parent= that disagrees with the indentation, or forms a cycle: click, remove the parent cell', () => {
    const mismatch = fixOf('A {#a}\nB {#b}\n    C | parent=#a\n', 'parent-mismatch');
    expect(mismatch.fix).toMatchObject({ label: 'Use indentation', tier: 'click' });
    expect(mismatch.fixed).toBe('A {#a}\nB {#b}\n    C\n');
    const cycle = fixOf('A {#a} | parent=#b\nB {#b} | parent=#a\n', 'parent-cycle');
    expect(cycle.fixed).toBe('A {#a}\nB {#b} | parent=#a\n');
    expect(analyze(cycle.fixed).diagnostics).toEqual([]);
  });

  it('a title that reads as a heading: auto, quoted', () => {
    const { fix, fixed } = fixOf('# Foo | 2h\n', 'heading-line');
    expect(fix).toMatchObject({ label: 'Quote the title', tier: 'auto' });
    expect(fixed).toBe('"# Foo" | 2h\n');
    expect(analyze(fixed).roots[0].title).toBe('# Foo');
  });

  it('a repeated marker: click, the extra one removed', () => {
    const { fix, fixed } = fixOf('~~x\n', 'repeated-marker');
    expect(fix).toMatchObject({ label: 'Remove extra marker', tier: 'click' });
    expect(fixed).toBe('~x\n');
    expect(analyze(fixed).roots[0]).toMatchObject({ title: 'x', done: true });
  });

  it('a cell with a quoting error: auto, rewritten from its recovered text', () => {
    const { fix, fixed } = fixOf('Login | 4h | alice | "call Bob | then Alice\n', 'unterminated-quote');
    expect(fix).toMatchObject({ label: 'Rewrite the cell', tier: 'auto' });
    expect(fixed).toBe('Login | 4h | alice | "call Bob | then Alice"\n');
    expect(fixOf('A | "a"b\n', 'text-after-quote').fixed).toBe('A | ab\n');
  });

  it('a row that begins with the delimiter has no fix: typing a title fixes it', () => {
    expect(analyze('| 2h\n').diagnostics.find((d) => d.code === 'row-begins-with-delimiter')!.fixes).toBeUndefined();
  });
});
