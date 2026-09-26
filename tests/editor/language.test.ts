// @vitest-environment jsdom
// Highlighting per spec §4.1, as the view shows it. Which span gets which
// class is tests/editor/syntax.test.ts; this checks what reaches the DOM,
// done dimming, and the context taken from the latest model.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import { planEditor, showSyntax, toggleCommentLines } from '../../src/editor';
import example from '../../examples/example.plan?raw';

let view: EditorView;

beforeEach(() => {
  // jsdom has no layout; CodeMirror only needs these to not throw.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => view.destroy());

/** A view on `doc`, given the model for it as the shell would. */
function open(doc: string): void {
  view = new EditorView({ state: EditorState.create({ doc, extensions: planEditor() }), parent: document.body });
  showSyntax(view, analyze(doc));
}

const lines = () => [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')];
const texts = (cls: string) => [...view.contentDOM.querySelectorAll(`.${cls}`)].map((el) => el.textContent);
const doneLines = () => lines().flatMap((el, i) => (el.classList.contains('cm-plan-done') ? [i + 1] : []));

describe('highlighting in the view', () => {
  it('shows every category of the §2.10 example', () => {
    open(example);
    expect(texts('cm-plan-front-matter')).toEqual(['---', 'profile: plan', '---']);
    expect(texts('cm-plan-comment')).toEqual(['// Q4 auth work. Estimates are rough.', '// Audit log            | 2d     <- dropped for now']);
    expect(texts('cm-plan-marker')).toEqual(['~']);
    expect(texts('cm-plan-additive')).toEqual(['+']);
    expect(texts('cm-plan-duration')).toEqual(['2d', '4h', '6h', '1d', '2h', '3h', '1d']);
    expect(texts('cm-plan-separator').length).toBe(13);
  });

  it('shows anchors, cell names, quoted values and escapes', () => {
    open('~Login {#login} | 4h | owner=bob | "a \\"b\\" | c"\n');
    expect(texts('cm-plan-anchor')).toEqual(['{#login}']);
    expect(texts('cm-plan-name')).toEqual(['owner', '=']);
    expect(texts('cm-plan-escape')).toEqual(['\\"', '\\"']);
    expect(texts('cm-plan-quoted').join('')).toBe('"a \\"b\\" | c"');
  });

  it('dims done lines and the descendants of a done parent, not the following sibling', () => {
    open('~Auth | 2d\n    Login | 4h\n        Deep | 1h\nAdmin | 1d\n');
    expect(doneLines()).toEqual([1, 2, 3]);
  });

  it('keeps done lines on their text through an edit, before the next model arrives', () => {
    open('Auth\n~Login\n');
    view.dispatch({ changes: { from: 0, insert: 'New\n' } });
    expect(doneLines()).toEqual([3]);
  });

  it('only treats --- on line 1 as front matter', () => {
    open('Auth | 2d\n---\n');
    expect(texts('cm-plan-front-matter')).toEqual([]);
  });

  it('shows the lines after an unclosed opening --- as rows, as the parser reads them', () => {
    open('---\nAuth | 2d\n');
    expect(texts('cm-plan-front-matter')).toEqual(['---']);
    expect(texts('cm-plan-duration')).toEqual(['2d']);
  });

  it('ignores a model for other text than the view shows', () => {
    open('Auth\n');
    showSyntax(view, analyze('~Auth\n'));
    expect(doneLines()).toEqual([]);
  });

  it('declares the document comment marker as the line comment token', () => {
    open('Auth\n');
    expect(view.state.languageDataAt<{ line: string }>('commentTokens', 0)[0]).toEqual({ line: '//' });
    const doc = '---\ncomment: #\n---\nAuth\n';
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    showSyntax(view, analyze(doc));
    expect(view.state.languageDataAt<{ line: string }>('commentTokens', 0)[0]).toEqual({ line: '#' });
  });

  it('Ctrl+/ toggles the document comment marker', () => {
    const doc = '---\ncomment: #\n---\nAuth\n';
    open(doc);
    view.dispatch({ selection: { anchor: doc.indexOf('Auth') } });
    toggleCommentLines(view);
    expect(view.state.doc.toString()).toBe('---\ncomment: #\n---\n# Auth\n');
  });
});
