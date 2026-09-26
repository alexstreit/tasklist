// Cell edits, spec §4b.2: the grid's calls into the rows edit API, text in and
// text out through real parse output. The rows rules themselves are tested in
// packages/rows; these check what the grid asks for.

import { applyEdits } from 'rows';
import type { EditResult } from 'rows';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import type { Model, ModelNode } from '../../src/core';
import { canMarkDone, insertItem, setDone, setField, setTitle } from '../../src/grid/edits';

function flat(model: Model): ModelNode[] {
  const out: ModelNode[] = [];
  const visit = (n: ModelNode): void => void (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}

/** The model of `text` and its node on `line`. */
function at(text: string, line: number): { model: Model; node: ModelNode } {
  const model = analyze(text);
  const node = flat(model).find((n) => n.line === line);
  if (!node) throw new Error(`no item on line ${line}`);
  return { model, node };
}

function applied(text: string, result: EditResult): string {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return applyEdits(text, result.edits);
}

describe('setTitle', () => {
  it('replaces the title and leaves the marker, anchor, fields and alignment alone', () => {
    const text = '~Login page {#login}    | 4h  | alice\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setTitle(model, node, 'Sign-in page'))).toBe('~Sign-in page {#login}    | 4h  | alice\n');
  });

  it('is a no-op when the title has not changed, and quotes a title that would not read back', () => {
    const text = 'Auth | 2d\n';
    const { model, node } = at(text, 1);
    expect(setTitle(model, node, 'Auth')).toEqual({ edits: [] });
    expect(setTitle(model, node, ' Auth ')).toEqual({ edits: [] });
    expect(applied(text, setTitle(model, node, 'A | B'))).toBe('"A | B" | 2d\n');
    expect(applied(text, setTitle(model, node, '~x'))).toBe('"~x" | 2d\n');
  });
});

describe('setField', () => {
  it('replaces an existing value in place', () => {
    const text = 'Auth                        | 2d\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setField(model, node, 0, '3d'))).toBe('Auth                        | 3d\n');
  });

  it('appends the next positional slot, and names a later column instead of padding', () => {
    const text = 'Auth\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setField(model, node, 0, '4h'))).toBe('Auth | 4h\n');
    expect(applied(text, setField(model, node, 2, 'later'))).toBe('Auth | notes=later\n');
  });

  it('writes a named cell in place, and quotes a value containing the delimiter', () => {
    const text = 'Auth | 2d | owner=bob\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setField(model, node, 1, 'carol'))).toBe('Auth | 2d | owner=carol\n');
    expect(applied(text, setField(model, node, 2, 'a | b'))).toBe('Auth | 2d | owner=bob | notes="a | b"\n');
  });

  it('clears a trailing cell with its delimiter, and empties an interior one', () => {
    const text = 'Auth | 2d | bob | note\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setField(model, node, 2, ''))).toBe('Auth | 2d | bob\n');
    expect(applied(text, setField(model, node, 1, ''))).toBe('Auth | 2d |  | note\n');
  });

  it('is a no-op for an unchanged value or clearing a cell that is not set', () => {
    const text = 'Auth | 2d\n';
    const { model, node } = at(text, 1);
    expect(setField(model, node, 0, '2d')).toEqual({ edits: [] });
    expect(setField(model, node, 1, '')).toEqual({ edits: [] });
  });

  it('writes tabs as spaces, since the buffer holds none', () => {
    const text = 'Auth\n';
    const { model, node } = at(text, 1);
    expect(applied(text, setField(model, node, 1, 'a\tb'))).toBe('Auth | owner=a b\n');
  });
});

describe('setDone', () => {
  it('inserts the marker after the indent and removes it with its trailing space', () => {
    const text = 'Auth\n    Login page {#login} | 4h\n';
    const a = at(text, 2);
    expect(applied(text, setDone(a.model, a.node, true))).toBe('Auth\n    ~Login page {#login} | 4h\n');
    const marked = '    ~ Login page | 4h\n';
    const b = at(marked, 1);
    expect(applied(marked, setDone(b.model, b.node, false))).toBe('    Login page | 4h\n');
  });

  it('removes done=true set by name', () => {
    const text = 'Login | 4h | done=true\n';
    const { model, node } = at(text, 1);
    expect(node.done).toBe(true);
    expect(applied(text, setDone(model, node, false))).toBe('Login | 4h\n');
  });

  it('does nothing when the node has no marker of its own', () => {
    const text = '~Auth\n    Login\n';
    const { model, node } = at(text, 2);
    expect(node.done).toBe(true);
    expect(setDone(model, node, false)).toEqual({ edits: [] });
  });

  it('is available only when the document has a done marker or done column', () => {
    expect(canMarkDone(analyze('Auth\n'))).toBe(true);
    expect(canMarkDone(analyze('Auth\n', 'a.rows'))).toBe(false);
  });
});

describe('insertItem', () => {
  it('inserts before a line or at the end, at the given indent', () => {
    const model = analyze('Auth\n    Login\n');
    expect(applied(model.doc.text, insertItem(model, { beforeLine: 2 }, 4, 'Sign up'))).toBe('Auth\n    Sign up\n    Login\n');
    expect(applied(model.doc.text, insertItem(model, 'end', 0, 'Admin'))).toBe('Auth\n    Login\nAdmin\n');
  });

  it('quotes a title that would read as a marker, and ignores an empty one', () => {
    const model = analyze('Auth\n');
    expect(applied(model.doc.text, insertItem(model, 'end', 0, '~ not done'))).toBe('Auth\n"~ not done"\n');
    expect(insertItem(model, 'end', 0, '   ')).toEqual({ edits: [] });
  });

  it('refuses an indent that the nesting does not allow there', () => {
    const model = analyze('A\n        B\n    // note\n');
    expect(insertItem(model, { beforeLine: 3 }, 4, 'X')).toEqual({ refused: expect.stringContaining("doesn't fit the nesting") });
  });
});
