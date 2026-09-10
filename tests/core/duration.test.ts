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
    ['2d 4h', 20, false],
    ['4h 2d', 20, false],
    ['1w 2d 4h', 60, false],
    ['+2d 4h', 20, true],
    ['1.5d 4h', 16, false],
    ['2 d', 16, false],
    ['2 d 4 h', 20, false],
    ['+ 2 d 4 h', 20, true],
  ])('parses %s', (raw, value, additive) => {
    expect(parseDuration(raw)).toEqual({ value, additive });
  });

  it.each(['', 'abc', '4x', '1..5', '-4h', 'h', '+', '2d 2d', '2dh'])('rejects %s as unparseable', (raw) => {
    expect(parseDuration(raw)).toEqual({ error: `unparseable duration: "${raw}"` });
  });

  it.each(['4 2d', '2d 4', '2 d 4'])('rejects %s: bare number in a compound value', (raw) => {
    expect(parseDuration(raw)).toEqual({ error: 'bare number not allowed in compound duration' });
  });

  it.each([
    ['4', 4],
    ['2d 4h', 20],
    ['4h 2d', 20],
    ['1w 2d 4h', 60],
    ['+2d 4h', 20],
    ['1.5d 4h', 16],
    ['0.5h 1w', 40.5],
    ['2 d 4 h', 20],
  ])('%s round-trips through formatDuration', (raw, hours) => {
    const parsed = parseDuration(raw);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(formatDuration(parsed.value)).toBe(formatDuration(hours));
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
    expect(parseNumber(raw)).toEqual({ error: `unparseable number: "${raw}"` });
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
