// Reference test: the spec §2.10 example, every cell asserted.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDuration } from '../../src/core';
import { byTitle, est, flatten, load, total } from './helpers';

const text = readFileSync(new URL('../../examples/example.plan', import.meta.url), 'utf8');

describe('spec §2.10 example', () => {
  const { model } = load(text);

  it.each([
    // title, effective, derived (the child sum; absent on a leaf), mode, doneSum
    ['Auth', 16, 23, 'pinned', 4],
    ['Login page', 4, undefined, 'pinned', 4],
    ['Password reset', 6, undefined, 'pinned', 0],
    ['OAuth (Google)', 13, 5, 'additive', 0],
    ['Consent screen', 2, undefined, 'pinned', 0],
    ['Token refresh', 3, undefined, 'pinned', 0],
    ['Admin', 8, 8, 'derived', 0],
    ['User list', 8, undefined, 'pinned', 0],
  ])('%s: effective %ih, derived %s, %s, doneSum %ih', (title, effective, derived, mode, doneSum) => {
    const cell = est(model, byTitle(model, title));
    expect(cell.effective).toBe(effective);
    expect(cell.derived).toBe(derived);
    expect(cell.mode).toBe(mode);
    expect(cell.doneSum).toBe(doneSum);
  });

  it('formats the headline durations as in the table', () => {
    expect(formatDuration(est(model, byTitle(model, 'Auth')).effective)).toBe('2d');
    expect(formatDuration(est(model, byTitle(model, 'OAuth (Google)')).effective)).toBe('1d 5h');
    expect(formatDuration(est(model, byTitle(model, 'Admin')).effective)).toBe('1d');
  });

  it.each([
    ['Auth', '1'],
    ['Login page', '1.1'],
    ['Password reset', '1.2'],
    ['OAuth (Google)', '1.3'],
    ['Consent screen', '1.3.1'],
    ['Token refresh', '1.3.2'],
    ['Admin', '2'],
    ['User list', '2.1'],
  ])('%s has outline number %s', (title, outlineNumber) => {
    expect(byTitle(model, title).outlineNumber).toBe(outlineNumber);
  });

  it('the commented-out Audit log line has no number and does not consume one', () => {
    expect(flatten(model).map((n) => n.title)).not.toContain('Audit log');
    expect(flatten(model).map((n) => n.outlineNumber)).toEqual(['1', '1.1', '1.2', '1.3', '1.3.1', '1.3.2', '2', '2.1']);
  });

  it('document total is 3d, doneSum 4h', () => {
    const sum = total(model)!;
    expect(sum.effective).toBe(24);
    expect(formatDuration(sum.effective)).toBe('3d');
    expect(sum.doneSum).toBe(4);
    expect(formatDuration(sum.doneSum)).toBe('4h');
    expect(total(model, 'owner')).toBeUndefined();
    expect(total(model, 'notes')).toBeUndefined();
  });

  it('only Login page is done', () => {
    for (const title of ['Auth', 'Password reset', 'OAuth (Google)', 'Consent screen', 'Token refresh', 'Admin', 'User list']) {
      expect(byTitle(model, title).done).toBe(false);
    }
    expect(byTitle(model, 'Login page').done).toBe(true);
  });

  it('text columns carry owner and notes', () => {
    expect(byTitle(model, 'Login page').fields[1]?.text).toBe('alice');
    expect(byTitle(model, 'Password reset').fields[1]?.text).toBe('alice');
    expect(byTitle(model, 'Admin').fields[1]?.text).toBe('bob');
    expect(byTitle(model, 'OAuth (Google)').fields[2]?.text).toBe('may not need for v1');
    expect(byTitle(model, 'OAuth (Google)').fields[1]).toBeNull();
  });

  it('hierarchy matches the indentation', () => {
    expect(model.roots.map((r) => r.title)).toEqual(['Auth', 'Admin']);
    expect(byTitle(model, 'Auth').children.map((c) => c.title)).toEqual([
      'Login page',
      'Password reset',
      'OAuth (Google)',
    ]);
    expect(byTitle(model, 'OAuth (Google)').children.map((c) => c.title)).toEqual([
      'Consent screen',
      'Token refresh',
    ]);
    expect(byTitle(model, 'Admin').children.map((c) => c.title)).toEqual(['User list']);
  });

  it('the only diagnostic is the override-differs info on Auth', () => {
    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0]).toMatchObject({
      line: 5,
      severity: 'info',
      message: 'override differs from children (2d vs 2d 7h)',
    });
  });
});
