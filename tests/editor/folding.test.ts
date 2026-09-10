// Indent-based folding. Spec §4.2.

import { foldable } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { example, state } from './helpers';

function foldRange(doc: string, lineNo: number) {
  const st = state(doc);
  const line = st.doc.line(lineNo);
  return foldable(st, line.from, line.to);
}

describe('folding', () => {
  const st = state(example);
  const lineRange = (from: number, to: number) => ({ from: st.doc.line(from).to, to: st.doc.line(to).to });

  it('folds Auth over all its descendants', () => {
    expect(foldRange(example, 5)).toEqual(lineRange(5, 10));
  });

  it('folds OAuth (Google) over its two children', () => {
    expect(foldRange(example, 8)).toEqual(lineRange(8, 10));
  });

  it('includes an indented trailing comment in the parent fold', () => {
    expect(foldRange(example, 11)).toEqual(lineRange(11, 13));
  });

  it('is not offered on leaves, comments or blank lines', () => {
    for (const line of [4, 6, 7, 9, 10, 12, 13, 14]) {
      expect(foldRange(example, line), `line ${line}`).toBeNull();
    }
  });

  it('is not offered on an item followed only by an indented comment', () => {
    expect(foldRange('A\n    // note\nB\n', 1)).toBeNull();
  });

  it('skips blank lines inside a subtree but not trailing ones', () => {
    const doc = 'A\n\n    B\n\nC\n';
    const s = state(doc);
    expect(foldable(s, s.doc.line(1).from, s.doc.line(1).to)).toEqual({ from: s.doc.line(1).to, to: s.doc.line(3).to });
  });
});
