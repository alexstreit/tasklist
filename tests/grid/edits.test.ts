// Cell edits, spec §4b.2. Text in, text out, through real parse output.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import type { Model, ModelNode } from '../../src/core';
import { appendItem, setDone, setField, setTitle } from '../../src/grid/edits';
import type { TextEdit } from '../../src/buffer';

function flat(model: Model): ModelNode[] {
  const out: ModelNode[] = [];
  const visit = (n: ModelNode): void => void (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}

/** Apply edits the way a buffer would. */
function applied(text: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((out, e) => out.slice(0, e.from) + e.insert + out.slice(e.to), text);
}

/** The node on `line`, from a fresh analysis of `text`. */
function node(text: string, line: number): ModelNode {
  const found = flat(analyze(text)).find((n) => n.line === line);
  if (!found) throw new Error(`no item on line ${line}`);
  return found;
}

describe('setTitle', () => {
  it('replaces the title and leaves the fields and their alignment alone', () => {
    const text = '~Login page             | 4h  | alice\n';
    expect(applied(text, setTitle(text, node(text, 1), 'Sign-in page'))).toBe('~Sign-in page             | 4h  | alice\n');
  });

  it('is a no-op when the title has not changed, and drops separators from the value', () => {
    const text = 'Auth | 2d\n';
    expect(setTitle(text, node(text, 1), 'Auth')).toEqual([]);
    expect(applied(text, setTitle(text, node(text, 1), 'A | B'))).toBe('A B | 2d\n');
  });
});

describe('setField', () => {
  it('replaces an existing value in place', () => {
    const text = 'Auth                        | 2d\n';
    expect(applied(text, setField(text, node(text, 1), 0, '3d'))).toBe('Auth                        | 3d\n');
  });

  it('adds the field to a line with no pipes', () => {
    const text = 'Auth\n';
    expect(applied(text, setField(text, node(text, 1), 0, '4h'))).toBe('Auth | 4h\n');
  });

  it('pads a title-only line with empty fields to reach a later column', () => {
    const text = 'Auth\n';
    const padded = applied(text, setField(text, node(text, 1), 2, 'later'));
    expect(padded).toBe('Auth | | | later\n');
    // Padding is real: the value landed in the notes column.
    expect(analyze(padded).roots[0].cells[2]).toMatchObject({ kind: 'text', value: 'later' });
  });

  it('uses the trailing separator already on the line instead of adding another', () => {
    const text = 'Auth |\n';
    expect(applied(text, setField(text, node(text, 1), 0, '4h'))).toBe('Auth | 4h\n');
  });

  it('trims the trailing empty fields when the committed value is empty', () => {
    const text = 'Auth | | | later\n';
    expect(applied(text, setField(text, node(text, 1), 2, ''))).toBe('Auth\n');
  });

  it('keeps earlier fields when a middle value is cleared', () => {
    const text = 'Auth | 2d | bob | note\n';
    expect(applied(text, setField(text, node(text, 1), 1, ''))).toBe('Auth | 2d |  | note\n');
    expect(applied(text, setField(text, node(text, 1), 2, ''))).toBe('Auth | 2d | bob\n');
  });

  it('clearing a field that does not exist is a no-op', () => {
    const text = 'Auth\n';
    expect(setField(text, node(text, 1), 1, '')).toEqual([]);
  });
});

describe('setDone', () => {
  it('inserts the marker after the indent and removes it with its trailing space', () => {
    const text = 'Auth\n    Login page | 4h\n';
    expect(applied(text, setDone(text, node(text, 2), true))).toBe('Auth\n    ~Login page | 4h\n');
    const marked = '    ~ Login page | 4h\n';
    expect(applied(marked, setDone(marked, node(marked, 1), false))).toBe('    Login page | 4h\n');
  });

  it('does nothing when the node has no marker of its own', () => {
    const text = '~Auth\n    Login\n';
    const child = node(text, 2);
    expect(child.done).toBe(true);
    expect(setDone(text, child, false)).toEqual([]);
  });
});

describe('appendItem', () => {
  it('appends at the given indent, and adds the missing newline first', () => {
    expect(applied('Auth\n', appendItem('Auth\n', 'Admin', 0))).toBe('Auth\nAdmin\n');
    expect(applied('Auth', appendItem('Auth', 'Sub', 4))).toBe('Auth\n    Sub\n');
    expect(applied('', appendItem('', 'First', 0))).toBe('First\n');
  });

  it('ignores an empty title', () => {
    expect(appendItem('Auth\n', '   ', 0)).toEqual([]);
  });
});
