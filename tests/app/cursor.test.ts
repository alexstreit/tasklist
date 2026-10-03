import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { cursorItemFor, itemLines } from '../../src/app/cursor';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const example = readFileSync(new URL('../../examples/example.plan', import.meta.url), 'utf8');
const lines = itemLines(analyze(example, { filename: 'example.plan' }));
const at = (line: number) => ({ file: 'example.plan', line });

describe('cursor item', () => {
  it('lists each file’s item lines in document order', () => {
    expect([...lines]).toEqual([['example.plan', [5, 6, 7, 8, 9, 10, 11, 12]]]);
  });

  it('is exact on an item line', () => {
    expect(cursorItemFor(lines, at(7))).toEqual({ file: 'example.plan', line: 7, exact: true });
  });

  it('is the nearest preceding item on a comment or blank line', () => {
    expect(cursorItemFor(lines, at(13))).toEqual({ file: 'example.plan', line: 12, exact: false });
    expect(cursorItemFor(lines, at(14))).toEqual({ file: 'example.plan', line: 12, exact: false });
  });

  it('is null before the first item or with no cursor', () => {
    expect(cursorItemFor(lines, at(4))).toBeNull();
    expect(cursorItemFor(lines, at(1))).toBeNull();
    expect(cursorItemFor(lines, null)).toBeNull();
    expect(cursorItemFor(new Map(), at(3))).toBeNull();
  });

  it('in a portfolio, is a mounted file’s item, and the nearest is within the same file (Task 36)', () => {
    const composed = itemLines(analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve }));
    expect([...composed]).toEqual([
      ['portfolio.plan', [6, 7, 8]],
      ['teams/alpha.plan', [6, 7]],
      ['teams/beta.plan', [7, 8]],
    ]);
    expect(cursorItemFor(composed, { file: 'teams/beta.plan', line: 8 })).toEqual({ file: 'teams/beta.plan', line: 8, exact: true });
    // Beta's comment line comes before its first row: no item of beta precedes it.
    expect(cursorItemFor(composed, { file: 'teams/beta.plan', line: 6 })).toBeNull();
    expect(cursorItemFor(composed, { file: 'teams/alpha.plan', line: 9 })).toEqual({ file: 'teams/alpha.plan', line: 7, exact: false });
  });
});
