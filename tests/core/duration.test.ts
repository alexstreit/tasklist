import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, parseNumber } from '../../src/core';

describe('parseDuration (§2.6)', () => {
  it.each([
    ['4', 4, false],
    ['4h', 4, false],
    ['2d', 16, false],
    ['1.5w', 60, false],
    ['+1d', 8, true],
    ['  4h  ', 4, false],
  ])('parses %s', (raw, value, additive) => {
    expect(parseDuration(raw)).toEqual({ value, additive });
  });

  it.each(['', 'abc', '4x', '2d 4h', '1..5', '-4h', 'h'])('rejects %s', (raw) => {
    expect(parseDuration(raw)).toBeNull();
  });
});

describe('parseNumber (§2.6)', () => {
  it.each([
    ['3', 3, false],
    ['2.5', 2.5, false],
    ['+2', 2, true],
  ])('parses %s', (raw, value, additive) => {
    expect(parseNumber(raw)).toEqual({ value, additive });
  });

  it.each(['', '4h', 'x'])('rejects %s', (raw) => {
    expect(parseNumber(raw)).toBeNull();
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
