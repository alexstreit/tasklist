// Reference test: the spec §2.10 example, every cell asserted.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDuration } from '../../src/core';
import type { TextCell } from '../../src/core';
import { byTitle, est, flatten, load } from './helpers';

const text = readFileSync(new URL('../../examples/example.plan', import.meta.url), 'utf8');

describe('spec §2.10 example', () => {
  const { model } = load(text);

  it.each([
    // title, effective, childSum, mode, doneSum
    ['Auth', 16, 23, 'override', 4],
    ['Login page', 4, 0, 'override', 4],
    ['Password reset', 6, 0, 'override', 0],
    ['OAuth (Google)', 13, 5, 'additive', 0],
    ['Consent screen', 2, 0, 'override', 0],
    ['Token refresh', 3, 0, 'override', 0],
    ['Admin', 8, 8, 'derived', 0],
    ['User list', 8, 0, 'override', 0],
  ])('%s: effective %ih, childSum %ih, %s, doneSum %ih', (title, effective, childSum, mode, doneSum) => {
    const cell = est(byTitle(model, title));
    expect(cell.effective).toBe(effective);
    expect(cell.childSum).toBe(childSum);
    expect(cell.mode).toBe(mode);
    expect(cell.doneSum).toBe(doneSum);
  });

  it('formats the headline durations as in the table', () => {
    expect(formatDuration(est(byTitle(model, 'Auth')).effective)).toBe('2d');
    expect(formatDuration(est(byTitle(model, 'OAuth (Google)')).effective)).toBe('1d 5h');
    expect(formatDuration(est(byTitle(model, 'Admin')).effective)).toBe('1d');
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
    const total = model.totals[0]!;
    expect(total.effective).toBe(24);
    expect(formatDuration(total.effective)).toBe('3d');
    expect(total.doneSum).toBe(4);
    expect(formatDuration(total.doneSum)).toBe('4h');
    expect(model.totals[1]).toBeNull();
    expect(model.totals[2]).toBeNull();
  });

  it('only Login page is done', () => {
    for (const title of ['Auth', 'Password reset', 'OAuth (Google)', 'Consent screen', 'Token refresh', 'Admin', 'User list']) {
      expect(byTitle(model, title).done).toBe(false);
    }
    expect(byTitle(model, 'Login page').done).toBe(true);
  });

  it('text columns carry owner and notes', () => {
    expect((byTitle(model, 'Login page').cells[1] as TextCell).value).toBe('alice');
    expect((byTitle(model, 'Password reset').cells[1] as TextCell).value).toBe('alice');
    expect((byTitle(model, 'Admin').cells[1] as TextCell).value).toBe('bob');
    expect((byTitle(model, 'OAuth (Google)').cells[2] as TextCell).value).toBe('may not need for v1');
    expect((byTitle(model, 'OAuth (Google)').cells[1] as TextCell).value).toBe('');
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
