import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import { cursorItemFor, itemLines } from '../../src/app/cursor';

const example = readFileSync(new URL('../../examples/example.plan', import.meta.url), 'utf8');
const lines = itemLines(analyze(example));

describe('cursor item', () => {
  it('lists item lines in document order', () => {
    expect(lines).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('is exact on an item line', () => {
    expect(cursorItemFor(lines, 7)).toEqual({ line: 7, exact: true });
  });

  it('is the nearest preceding item on a comment or blank line', () => {
    expect(cursorItemFor(lines, 13)).toEqual({ line: 12, exact: false });
    expect(cursorItemFor(lines, 14)).toEqual({ line: 12, exact: false });
  });

  it('is null before the first item or with no cursor', () => {
    expect(cursorItemFor(lines, 4)).toBeNull();
    expect(cursorItemFor(lines, 1)).toBeNull();
    expect(cursorItemFor(lines, null)).toBeNull();
    expect(cursorItemFor([], 3)).toBeNull();
  });
});
