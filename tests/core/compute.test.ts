import { describe, expect, it } from 'vitest';
import { byTitle, est, load } from './helpers';

describe('roll-up (§2.7)', () => {
  it('+ on a leaf equals an override of the same value, no diagnostic', () => {
    const plus = load('A | +4h');
    const override = load('A | 4h');
    expect(est(plus.model, plus.model.roots[0]).effective).toBe(est(override.model, override.model.roots[0]).effective);
    expect(est(plus.model, plus.model.roots[0]).mode).toBe('additive');
    expect(plus.model.diagnostics).toHaveLength(0);
  });

  it('empty field derives from children', () => {
    const { model } = load('A\n    B | 4h\n    C | 2h');
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'derived', effective: 6, derived: 6 });
  });

  it('additive on a parent adds to the child sum', () => {
    const { model } = load('A | +1d\n    B | 4h');
    expect(est(model, model.roots[0])).toMatchObject({ mode: 'additive', effective: 12, derived: 4, pin: 8 });
  });
});

describe('hasValue (§2.7)', () => {
  it('is true for a leaf with a value and false for an empty leaf', () => {
    const { model } = load('A | 4h\nB');
    expect(est(model, model.roots[0]).hasValue).toBe(true);
    expect(est(model, model.roots[1]).hasValue).toBe(false);
  });

  it('is false for a parent whose whole subtree is empty', () => {
    const { model } = load('A\n    B\n        C\n    D');
    expect(est(model, model.roots[0]).hasValue).toBe(false);
    expect(est(model, byTitle(model, 'B')).hasValue).toBe(false);
  });

  it('propagates up from a single valued descendant', () => {
    const { model } = load('A\n    B\n        C | 1h\n    D');
    expect(est(model, model.roots[0]).hasValue).toBe(true);
    expect(est(model, byTitle(model, 'B')).hasValue).toBe(true);
    expect(est(model, byTitle(model, 'D')).hasValue).toBe(false);
  });

  it('is true for a parent with a value and empty children', () => {
    const { model } = load('A | 2d\n    B');
    expect(est(model, model.roots[0]).hasValue).toBe(true);
    expect(est(model, byTitle(model, 'B')).hasValue).toBe(false);
  });

  it('derived reflects the children only', () => {
    const { model } = load('A | 4h\n    B\nC | 1h\n    D | 2h\nE | 1h');
    expect(est(model, byTitle(model, 'A')).derived).toBeUndefined();
    expect(est(model, byTitle(model, 'C')).derived).toBe(2);
    expect(est(model, byTitle(model, 'D')).derived).toBeUndefined();
    expect(est(model, byTitle(model, 'E')).derived).toBeUndefined();
  });

  it('treats an unparseable value as empty', () => {
    const { model } = load('A | soon');
    expect(est(model, model.roots[0]).hasValue).toBe(false);
  });
});

describe('done (§2.8)', () => {
  it('~ on a parent makes all descendants done; doneSum equals effective', () => {
    const { model } = load('~Parent\n    A | 4h\n        Deep | 2h\n    B | 2h');
    const parent = model.roots[0];
    expect(parent.done).toBe(true);
    expect(byTitle(model, 'A').done).toBe(true);
    expect(byTitle(model, 'Deep').done).toBe(true);
    expect(byTitle(model, 'B').done).toBe(true);
    expect(est(model, parent).doneSum).toBe(est(model, parent).effective);
    expect(est(model, parent).effective).toBe(6);
  });

  it('a parent with all children done is not itself done', () => {
    const { model } = load('Parent\n    ~A | 4h\n    ~B | 2h');
    expect(model.roots[0].done).toBe(false);
    expect(est(model, model.roots[0]).doneSum).toBe(6);
  });

  it('doneSum may exceed effective when an override is smaller than the children', () => {
    const { model } = load('Parent | 1h\n    ~A | 4h');
    expect(est(model, model.roots[0]).effective).toBe(1);
    expect(est(model, model.roots[0]).doneSum).toBe(4);
  });
});

describe('the rollup field (PLUGINS.md §4)', () => {
  it('a leaf estimate is pinned, with nothing derived', () => {
    const { model } = load('A | 4h');
    expect(est(model, model.roots[0])).toEqual({ pin: 4, effective: 4, mode: 'pinned', hasValue: true, doneSum: 0 });
  });

  it('a parent with estimated children has derived', () => {
    const { model } = load('A\n    B | 4h\n    C');
    expect(est(model, model.roots[0])).toEqual({ derived: 4, effective: 4, mode: 'derived', hasValue: true, doneSum: 0 });
  });

  it('a parent whose children have no estimates has no derived and no diagnostic', () => {
    const { model } = load('A | 1d\n    B\n    C');
    expect(est(model, model.roots[0])).toEqual({ pin: 8, effective: 8, mode: 'pinned', hasValue: true, doneSum: 0 });
    expect(model.diagnostics).toEqual([]);
  });
});
