// Keymap per spec §4.3, exercised at the state level.

import { indentLess, indentMore, moveLineDown, moveLineUp, toggleLineComment } from '@codemirror/commands';
import { describe, expect, it } from 'vitest';
import { planKeymap, selectSubtree } from '../../src/editor';
import { at, example, run, state } from './helpers';

describe('bindings', () => {
  const find = (key: string) => planKeymap.find((b) => b.key === key);

  it('binds Alt+Up/Down to line moves', () => {
    expect(find('Alt-ArrowUp')?.run).toBe(moveLineUp);
    expect(find('Alt-ArrowDown')?.run).toBe(moveLineDown);
  });

  it('binds Tab / Shift+Tab to indent / outdent', () => {
    expect(find('Tab')?.run).toBe(indentMore);
    expect(find('Tab')?.shift).toBe(indentLess);
  });

  it('binds Ctrl+/ to line comment toggle and Ctrl+Shift+Up to subtree selection', () => {
    expect(find('Mod-/')?.run).toBe(toggleLineComment);
    expect(find('Mod-Shift-ArrowUp')?.run).toBe(selectSubtree);
  });

  it('does not bind Alt+Left/Right', () => {
    expect(find('Alt-ArrowLeft')).toBeUndefined();
    expect(find('Alt-ArrowRight')).toBeUndefined();
  });
});

describe('Alt+Up/Down', () => {
  it('moves a single line', () => {
    const doc = 'a\nb\nc\n';
    expect(run(state(doc, { anchor: at(doc, 'b') }), moveLineDown).state.doc.toString()).toBe('a\nc\nb\n');
    expect(run(state(doc, { anchor: at(doc, 'b') }), moveLineUp).state.doc.toString()).toBe('b\na\nc\n');
  });

  it('moves all lines touched by a selection as a block', () => {
    const doc = 'a\nb\nc\nd\n';
    const sel = { anchor: at(doc, 'a'), head: at(doc, 'b') + 1 };
    expect(run(state(doc, sel), moveLineDown).state.doc.toString()).toBe('c\na\nb\nd\n');
    const sel2 = { anchor: at(doc, 'b'), head: at(doc, 'c') + 1 };
    expect(run(state(doc, sel2), moveLineUp).state.doc.toString()).toBe('b\nc\na\nd\n');
  });
});

describe('Tab / Shift+Tab', () => {
  it('indents the current line by exactly 4 spaces, regardless of cursor column', () => {
    const doc = 'Auth | 2d\n';
    expect(run(state(doc, { anchor: 4 }), indentMore).state.doc.toString()).toBe('    Auth | 2d\n');
  });

  it('indents and outdents every line in a selection', () => {
    const doc = 'a\nb\nc\n';
    const indented = run(state(doc, { anchor: 0, head: at(doc, 'c') + 1 }), indentMore).state;
    expect(indented.doc.toString()).toBe('    a\n    b\n    c\n');
    const back = run(indented, indentLess).state;
    expect(back.doc.toString()).toBe(doc);
  });

  it('outdents by 4 spaces', () => {
    expect(run(state('        x\n', { anchor: 9 }), indentLess).state.doc.toString()).toBe('    x\n');
  });

  it('Shift+Tab at column 0 is a no-op', () => {
    const doc = 'Auth | 2d\n    Login | 4h\n';
    const out = run(state(doc, { anchor: 2 }), indentLess).state;
    expect(out.doc.toString()).toBe(doc);
  });
});

describe('Ctrl+/', () => {
  it('toggles // on the current line and restores it when toggled twice', () => {
    const doc = example;
    const once = run(state(doc, { anchor: at(doc, 'Password') }), toggleLineComment).state;
    expect(once.doc.line(7).text).toBe('    // Password reset          | 6h  | alice');
    const twice = run(once, toggleLineComment).state;
    expect(twice.doc.toString()).toBe(doc);
  });

  it('uncomments an existing comment line and re-comments it', () => {
    const doc = example;
    const once = run(state(doc, { anchor: at(doc, '// Q4') }), toggleLineComment).state;
    expect(once.doc.line(4).text).toBe('Q4 auth work. Estimates are rough.');
    expect(run(once, toggleLineComment).state.doc.toString()).toBe(doc);
  });

  it('toggles every line in a selection', () => {
    const doc = 'a\n    b\n';
    const once = run(state(doc, { anchor: 0, head: doc.length - 1 }), toggleLineComment).state;
    expect(once.doc.toString()).toBe('// a\n//     b\n');
    expect(run(once, toggleLineComment).state.doc.toString()).toBe(doc);
  });
});

describe('Ctrl+Shift+Up', () => {
  it('grows the selection subtree by subtree', () => {
    const doc = example;
    const line = (n: number) => state(doc).doc.line(n);
    let st = state(doc, { anchor: at(doc, 'Consent') });
    let r = run(st, selectSubtree);
    expect([r.state.selection.main.from, r.state.selection.main.to]).toEqual([line(9).from, line(9).to]);
    r = run(r.state, selectSubtree);
    expect([r.state.selection.main.from, r.state.selection.main.to]).toEqual([line(8).from, line(10).to]);
    r = run(r.state, selectSubtree);
    expect([r.state.selection.main.from, r.state.selection.main.to]).toEqual([line(5).from, line(10).to]);
    r = run(r.state, selectSubtree);
    expect(r.handled).toBe(false);
  });
});
