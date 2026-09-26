// Line operations, spec §3.8. Plain strings in, text edits out.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import { deleteLines, indent, insertLineAbove, moveDown, moveUp, outdent, toggleComment } from '../../src/editing';
import type { LineRange } from '../../src/editing';
import type { TextEdit } from '../../src/buffer';

/** Apply edits the way a buffer would, so tests can assert on text. */
function applied(text: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((out, e) => out.slice(0, e.from) + e.insert + out.slice(e.to), text);
}

const range = (fromLine: number, toLine = fromLine): LineRange => ({ fromLine, toLine });

describe('indent / outdent', () => {
  it('indents every line of a range by four spaces', () => {
    expect(applied('a\nb\nc\n', indent('a\nb\nc\n', range(1, 3)))).toBe('    a\n    b\n    c\n');
  });

  it('outdents every line of a range by up to four spaces', () => {
    const text = '        a\n  b\nc\n';
    expect(applied(text, outdent(text, range(1, 3)))).toBe('    a\nb\nc\n');
  });

  it('outdent at column 0 produces no edit', () => {
    expect(outdent('a\nb\n', range(1, 2))).toEqual([]);
  });

  it('round-trips indent then outdent', () => {
    const text = 'Auth | 2d\n    Login | 4h\n';
    expect(applied(applied(text, indent(text, range(1, 2))), outdent(applied(text, indent(text, range(1, 2))), range(1, 2)))).toBe(text);
  });
});

describe('moveUp / moveDown', () => {
  it('moves a single line', () => {
    expect(applied('a\nb\nc\n', moveUp('a\nb\nc\n', range(2)))).toBe('b\na\nc\n');
    expect(applied('a\nb\nc\n', moveDown('a\nb\nc\n', range(2)))).toBe('a\nc\nb\n');
  });

  it('moves a multi-line range as a block', () => {
    const text = 'a\nb\nc\nd\n';
    expect(applied(text, moveDown(text, range(1, 2)))).toBe('c\na\nb\nd\n');
    expect(applied(text, moveUp(text, range(2, 3)))).toBe('b\nc\na\nd\n');
  });

  it('works on a document with no trailing newline', () => {
    expect(applied('a\nb\nc', moveDown('a\nb\nc', range(2)))).toBe('a\nc\nb');
    expect(applied('a\nb\nc', moveUp('a\nb\nc', range(3)))).toBe('a\nc\nb');
  });

  it('is a no-op at line 1 and at the last line', () => {
    expect(moveUp('a\nb\n', range(1))).toEqual([]);
    expect(moveDown('a\nb', range(2))).toEqual([]);
    expect(moveDown('a\nb\n', range(1, 3))).toEqual([]);
  });

  it('leaves the moved lines' + ' own text untouched, so positions inside them still map', () => {
    const text = 'a\nbb\nc\n';
    // The only edits are the removal and reinsertion of the neighbouring line.
    expect(moveUp(text, range(2)).every((e) => e.to <= 2 || e.from >= 5)).toBe(true);
  });
});

describe('insertLineAbove', () => {
  it('inserts a line above the range, with the content it is given', () => {
    expect(applied('a\nb\n', insertLineAbove('a\nb\n', range(2), '    '))).toBe('a\n    \nb\n');
    expect(applied('a\nb\n', insertLineAbove('a\nb\n', range(1)))).toBe('\na\nb\n');
  });
});

describe('deleteLines', () => {
  it('deletes a parent line and leaves its children attached to the previous item', () => {
    const text = 'Auth\n    Login\nAdmin\n    Users\n        Roles\n';
    const out = applied(text, deleteLines(text, range(4)));
    expect(out).toBe('Auth\n    Login\nAdmin\n        Roles\n');
    const model = analyze(out);
    // Roles is now a child of Admin, numbered 2.1.
    expect(model.roots[1].children.map((c) => [c.title, c.outlineNumber])).toEqual([['Roles', '2.1']]);
  });

  it('deletes a range of lines', () => {
    expect(applied('a\nb\nc\nd\n', deleteLines('a\nb\nc\nd\n', range(2, 3)))).toBe('a\nd\n');
  });

  it('deletes the last line of a document with no trailing newline', () => {
    expect(applied('a\nb\nc', deleteLines('a\nb\nc', range(3)))).toBe('a\nb');
  });
});

describe('toggleComment', () => {
  it('comments at the line indent and restores the text when toggled twice', () => {
    const text = 'Auth\n    Login page | 4h\n';
    const once = applied(text, toggleComment(text, range(2)));
    expect(once).toBe('Auth\n    // Login page | 4h\n');
    expect(applied(once, toggleComment(once, range(2)))).toBe(text);
  });

  it('comments a block at its shallowest indent', () => {
    const text = 'a\n    b\n';
    const once = applied(text, toggleComment(text, range(1, 2)));
    expect(once).toBe('// a\n//     b\n');
    expect(applied(once, toggleComment(once, range(1, 2)))).toBe(text);
  });

  it('comments a mixed block when any non-blank line is uncommented', () => {
    const text = '// a\nb\n';
    expect(applied(text, toggleComment(text, range(1, 2)))).toBe('// // a\n// b\n');
  });

  it('skips blank lines inside a block but comments a lone blank line', () => {
    const text = 'a\n\nb\n';
    expect(applied(text, toggleComment(text, range(1, 3)))).toBe('// a\n\n// b\n');
    expect(applied('\n', toggleComment('\n', range(1)))).toBe('// \n');
  });

  it('uses the comment marker it is given', () => {
    const text = 'Auth\n    Login // not a comment here\n';
    const once = applied(text, toggleComment(text, range(2), '#'));
    expect(once).toBe('Auth\n    # Login // not a comment here\n');
    expect(applied(once, toggleComment(once, range(2), '#'))).toBe(text);
  });
});
