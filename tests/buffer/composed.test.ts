// The composed buffer (plan spec §3.7, §4.5) on its own: edits land in their files' own buffers as
// `remote`, an edit across a boundary is refused whole, the files' own changes arrive exactly, and
// recomposing stays out of the one history.

import { describe, expect, it } from 'vitest';
import { CodeMirrorBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { BufferChange } from '../../src/buffer';

const ROOT = 'A | mount=x\nB\n';
const X = 'X1\nX2';

function setup(root = ROOT, x = X) {
  const own = new Map([
    ['r', new CodeMirrorBuffer(root)],
    ['x', new CodeMirrorBuffer(x)],
  ]);
  const composed = new ComposedBuffer('r', { buffer: (p) => own.get(p) });
  const mounts = [{ file: 'r', line: 1, target: 'x' }];
  composed.recompose(mounts, () => '//');
  const seen: BufferChange[] = [];
  own.get('x')!.onChange((c) => seen.push(c));
  let refused = 0;
  composed.onRefused(() => refused++);
  return { own, composed, mounts, seen, refused: () => refused };
}

const at = (composed: ComposedBuffer, s: string) => composed.text().indexOf(s);

describe('the composed buffer', () => {
  it('composes x after A, with a joint after its last line, outside the history', () => {
    const { composed } = setup();
    expect(composed.text()).toBe('A | mount=x\nX1\nX2\nB\n');
    composed.undo();
    expect(composed.text()).toBe('A | mount=x\nX1\nX2\nB\n');
  });

  it('routes an edit to its file as remote, and one undo restores it', () => {
    const { own, composed, seen } = setup();
    composed.apply([{ from: at(composed, 'X2'), to: at(composed, 'X2') + 2, insert: 'Y' }], 'text-editor');
    expect(own.get('x')!.text()).toBe('X1\nY');
    expect(own.get('r')!.text()).toBe(ROOT);
    expect(seen.map((c) => c.origin)).toEqual(['remote']);
    // Not in x's own history.
    own.get('x')!.undo();
    expect(own.get('x')!.text()).toBe('X1\nY');
    composed.undo();
    expect(own.get('x')!.text()).toBe(X);
    expect(composed.text()).toBe('A | mount=x\nX1\nX2\nB\n');
  });

  it('refuses a transaction whole when any change crosses a boundary, or touches the joint', () => {
    const { own, composed, refused } = setup();
    const before = composed.text();
    composed.apply(
      [
        { from: 0, to: 1, insert: 'a' },
        { from: at(composed, 'X2'), to: at(composed, 'B') + 1, insert: '' },
      ],
      'text-editor',
    );
    expect(composed.text()).toBe(before);
    expect(own.get('r')!.text()).toBe(ROOT);
    composed.apply([{ from: at(composed, 'X2') + 2, to: at(composed, 'X2') + 3, insert: '' }], 'text-editor');
    expect(composed.text()).toBe(before);
    expect(refused()).toBe(2);
  });

  it('places a file’s own change exactly, as remote, outside the history', () => {
    const { own, composed } = setup();
    composed.apply([{ from: 0, to: 1, insert: 'Z' }], 'text-editor');
    own.get('x')!.apply([{ from: 0, to: 2, insert: 'W' }], 'text-editor');
    expect(composed.text()).toBe('Z | mount=x\nW\nX2\nB\n');
    composed.undo();
    expect(composed.text()).toBe('A | mount=x\nW\nX2\nB\n');
  });

  it('applies edits in a file’s own offsets, even at its end before a segment', () => {
    const own = new Map([
      ['r', new CodeMirrorBuffer('A | mount=x\n')],
      ['x', new CodeMirrorBuffer('X\n')],
    ]);
    const composed = new ComposedBuffer('r', { buffer: (p) => own.get(p) });
    composed.recompose([{ file: 'r', line: 1, target: 'x' }], () => '//');
    expect(composed.text()).toBe('A | mount=x\nX\n');
    composed.applyFile('r', [{ from: 12, to: 12, insert: 'B\n' }], 'grid');
    expect(own.get('r')!.text()).toBe('A | mount=x\nB\n');
    expect(own.get('x')!.text()).toBe('X\n');
    expect(composed.text()).toBe('A | mount=x\nB\nX\n');
  });

  it('recomposes when the mounts change, outside the history', () => {
    const { own, composed, mounts } = setup();
    composed.apply([{ from: at(composed, 'B') + 1, to: at(composed, 'B') + 1, insert: ' | x' }], 'text-editor');
    composed.recompose([], () => '//');
    expect(composed.text()).toBe('A | mount=x\nB | x\n');
    composed.recompose(mounts, () => '//');
    composed.undo();
    expect(own.get('r')!.text()).toBe(ROOT);
    expect(composed.text()).toBe('A | mount=x\nX1\nX2\nB\n');
  });

  it('a change in several files is one transaction and one undo', () => {
    const { own, composed } = setup();
    composed.apply(
      [
        { from: 0, to: 1, insert: 'a' },
        { from: at(composed, 'X1'), to: at(composed, 'X1') + 1, insert: 'x' },
      ],
      'text-editor',
    );
    expect([own.get('r')!.text(), own.get('x')!.text()]).toEqual(['a | mount=x\nB\n', 'x1\nX2']);
    composed.undo();
    expect([own.get('r')!.text(), own.get('x')!.text()]).toEqual([ROOT, X]);
  });
});

describe('undoing at a boundary', () => {
  it('a segment’s last line moved down and back, or deleted and restored, stays in its file', () => {
    const own = new Map([
      ['r', new CodeMirrorBuffer('A | mount=x\nB\n')],
      ['x', new CodeMirrorBuffer('X1\nX2\nX3\n')],
    ]);
    const composed = new ComposedBuffer('r', { buffer: (p) => own.get(p) });
    composed.recompose([{ file: 'r', line: 1, target: 'x' }], () => '//');
    expect(composed.text()).toBe('A | mount=x\nX1\nX2\nX3\nB\n');
    // Deleting X3's whole line, up to B's line start, then undoing: X3 goes back into x, not r.
    const from = composed.text().indexOf('X3');
    composed.apply([{ from, to: from + 3, insert: '' }], 'text-editor');
    expect(own.get('x')!.text()).toBe('X1\nX2\n');
    composed.undo();
    expect([own.get('r')!.text(), own.get('x')!.text()]).toEqual(['A | mount=x\nB\n', 'X1\nX2\nX3\n']);
    composed.redo();
    composed.undo();
    expect([own.get('r')!.text(), own.get('x')!.text()]).toEqual(['A | mount=x\nB\n', 'X1\nX2\nX3\n']);
    // The grid adding a row at the end of r, whose last row's segment ends the text, then undo and redo.
    const tail = new Map([
      ['r', new CodeMirrorBuffer('A | mount=x\n')],
      ['x', new CodeMirrorBuffer('X\n')],
    ]);
    const end = new ComposedBuffer('r', { buffer: (p) => tail.get(p) });
    end.recompose([{ file: 'r', line: 1, target: 'x' }], () => '//');
    end.applyFile('r', [{ from: 12, to: 12, insert: 'B\n' }], 'grid');
    expect([tail.get('r')!.text(), tail.get('x')!.text()]).toEqual(['A | mount=x\nB\n', 'X\n']);
    end.undo();
    expect([tail.get('r')!.text(), tail.get('x')!.text()]).toEqual(['A | mount=x\n', 'X\n']);
    end.redo();
    expect([tail.get('r')!.text(), tail.get('x')!.text()]).toEqual(['A | mount=x\nB\n', 'X\n']);
  });
});
