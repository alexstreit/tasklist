import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { formatDuration } from '../../src/core';
import { est } from './helpers';

// The duration grammar is rows' (base §5, tested by the conformance suite). The plan reads values as hours.
describe('reading summable values (§2.6)', () => {
  const read = (value: string, columns = 'est:duration unit=h hpd=8 dpw=5') => {
    const model = analyze(`---\ncolumns: ${columns}\n---\nA | ${value}\n`);
    const cell = est(model, model.roots[0], model.columns[0].name);
    return { hours: cell.hasValue ? cell.effective : null, mode: cell.mode, diagnostics: model.diagnostics.map((d) => d.code) };
  };

  it.each([
    ['4', 4, 'pinned'],
    ['4h', 4, 'pinned'],
    ['2d', 16, 'pinned'],
    ['1.5w', 60, 'pinned'],
    ['+1d', 8, 'additive'],
    ['2d 4h', 20, 'pinned'],
    ['4h 2d', 20, 'pinned'],
    ['1w 2d 4h', 60, 'pinned'],
    ['+2d 4h', 20, 'additive'],
    ['2 d 4 h', 20, 'pinned'],
    ['+ 2 d 4 h', 20, 'additive'],
    ['90m', 1.5, 'pinned'],
  ])('reads %s as %ih', (value, hours, mode) => {
    expect(read(value)).toEqual({ hours, mode, diagnostics: [] });
  });

  it.each(['abc', '4x', '2d 2d', '4 2d'])('%s is a rows validation error and counts as empty', (value) => {
    expect(read(value)).toEqual({ hours: null, mode: 'derived', diagnostics: ['invalid-value'] });
  });

  it('a number column reads numbers, with + additive', () => {
    expect(read('2.5', 'n:number')).toEqual({ hours: 2.5, mode: 'pinned', diagnostics: [] });
    expect(read('+2', 'n:number')).toEqual({ hours: 2, mode: 'additive', diagnostics: [] });
    expect(read('-2', 'n:number')).toEqual({ hours: null, mode: 'derived', diagnostics: ['negative-value'] });
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0h'],
    [4, '4h'],
    [4.5, '4.5h'],
    [8, '1d'],
    [13, '1d 5h'],
    [16, '2d'],
    [24, '3d'],
    [40, '1w'],
    [48, '1w 1d'],
    [60, '1w 2d 4h'],
  ])('%ih -> %s', (hours, expected) => {
    expect(formatDuration(hours)).toBe(expected);
  });
});
