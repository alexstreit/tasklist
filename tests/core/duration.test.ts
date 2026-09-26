import { describe, expect, it } from 'vitest';
import { analyze, formatDuration } from '../../src/core';
import type { SummableCell } from '../../src/core';

// The duration grammar is rows' (base §5, tested by the conformance suite). The plan reads values as hours.
describe('reading summable values (§2.6)', () => {
  const read = (value: string, columns = 'est:duration unit=h hpd=8 dpw=5') => {
    const model = analyze(`---\ncolumns: ${columns}\n---\nA | ${value}\n`);
    const cell = model.roots[0].cells[0] as SummableCell;
    return { hours: cell.hasValue ? cell.effective : null, mode: cell.mode, diagnostics: model.diagnostics.map((d) => d.code) };
  };

  it.each([
    ['4', 4, 'override'],
    ['4h', 4, 'override'],
    ['2d', 16, 'override'],
    ['1.5w', 60, 'override'],
    ['+1d', 8, 'additive'],
    ['2d 4h', 20, 'override'],
    ['4h 2d', 20, 'override'],
    ['1w 2d 4h', 60, 'override'],
    ['+2d 4h', 20, 'additive'],
    ['2 d 4 h', 20, 'override'],
    ['90m', 1.5, 'override'],
  ])('reads %s as %ih', (value, hours, mode) => {
    expect(read(value)).toEqual({ hours, mode, diagnostics: [] });
  });

  it.each(['abc', '4x', '2d 2d', '4 2d'])('%s is a rows validation error and counts as empty', (value) => {
    expect(read(value)).toEqual({ hours: null, mode: 'derived', diagnostics: ['invalid-value'] });
  });

  it('a number column reads numbers, with + additive', () => {
    expect(read('2.5', 'n:number')).toEqual({ hours: 2.5, mode: 'override', diagnostics: [] });
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
