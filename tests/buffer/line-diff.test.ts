// The line diff (spec §6): applying its edits to the old text gives the new text, and lines in both
// are left untouched. Property-tested over seeded random texts, so a failure names its seed.

import { describe, expect, it } from 'vitest';
import { InMemoryBuffer, lineDiff } from '../../src/buffer';
import type { TextEdit } from '../../src/buffer';

/** mulberry32: a small seeded generator, so every run tests the same cases. */
function random(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function apply(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** Each line with its terminator, and where it starts. */
function lines(text: string): { line: string; from: number; to: number }[] {
  const out: { line: string; from: number; to: number }[] = [];
  let from = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    out.push({ line, from, to: from + line.length });
    from += line.length;
  }
  return out;
}

/** The length of the longest common subsequence of two line lists, by plain dynamic programming. */
function lcsLength(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0);
  for (const x of a) {
    const row = [0];
    b.forEach((y, j) => row.push(x === y ? prev[j] + 1 : Math.max(prev[j + 1], row[j])));
    prev = row;
  }
  return prev[b.length];
}

const untouched = (edits: readonly TextEdit[], from: number, to: number) => edits.every((e) => e.to <= from || e.from >= to);

describe('lineDiff', () => {
  it('replaces only the lines that differ', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual([{ from: 2, to: 4, insert: 'B\n' }]);
    expect(lineDiff('a\nc\n', 'a\nb\nc\n')).toEqual([{ from: 2, to: 2, insert: 'b\n' }]);
    expect(lineDiff('a\nb\nc\n', 'a\nc\n')).toEqual([{ from: 2, to: 4, insert: '' }]);
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('handles empty texts and a last line with no newline', () => {
    expect(apply('', lineDiff('', 'a\nb'))).toBe('a\nb');
    expect(apply('a\nb', lineDiff('a\nb', ''))).toBe('');
    expect(lineDiff('a\nb', 'a\nb\n')).toEqual([{ from: 2, to: 3, insert: 'b\n' }]);
  });

  it('property: applying the edits to the old text gives the new text, and they touch as few lines as can be', () => {
    // A small alphabet, so lines repeat and the alignment has choices to make.
    for (let seed = 1; seed <= 400; seed++) {
      const r = random(seed);
      const text = (count: number) => Array.from({ length: count }, () => 'abcde'[r(5)] + '\n').join('') + (r(4) === 0 ? 'z' : '');
      const before = text(r(25));
      const after = text(r(25));
      const edits = lineDiff(before, after);
      expect(apply(before, edits), `seed ${seed}`).toBe(after);
      // Edits are in order, with an unchanged line between any two.
      edits.slice(1).forEach((e, i) => expect(e.from, `seed ${seed}`).toBeGreaterThan(edits[i].to));
      const old = lines(before);
      const kept = old.filter((l) => untouched(edits, l.from, l.to)).length;
      expect(kept, `seed ${seed}`).toBe(lcsLength(old.map((l) => l.line), lines(after).map((l) => l.line)));
    }
  });

  it('property: a line kept from the old text into the new one is never inside an edit', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = random(seed);
      // Distinct old lines; the new text keeps some of them in order, and adds lines of its own.
      const old = Array.from({ length: r(30) }, (_, i) => `line ${i}\n`);
      const keptIndices = old.map((_, i) => i).filter(() => r(3) > 0);
      const after: string[] = [];
      for (const i of keptIndices) {
        while (r(3) === 0) after.push(`new ${after.length}\n`);
        after.push(old[i]);
      }
      if (r(2) === 0) after.push('tail\n');
      const before = old.join('');
      const edits = lineDiff(before, after.join(''));
      expect(apply(before, edits), `seed ${seed}`).toBe(after.join(''));
      const spans = lines(before);
      for (const i of keptIndices) expect(untouched(edits, spans[i].from, spans[i].to), `seed ${seed}, line ${i}`).toBe(true);
    }
  });

  it('applies to a buffer as one change that leaves a position on an unchanged line where it was', () => {
    const before = 'a\nb\nc\nd\n';
    const buffer = new InMemoryBuffer(before);
    let mapped = -1;
    buffer.onChange((c) => (mapped = c.mapPos(before.indexOf('d') + 1)));
    buffer.apply(lineDiff(before, 'a\nB\nc\nd\n'), 'remote');
    expect(buffer.text()).toBe('a\nB\nc\nd\n');
    expect(mapped).toBe(before.indexOf('d') + 1);
  });
});
