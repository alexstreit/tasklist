// @vitest-environment jsdom
// A confirm fix in the text editor shows its preview first (spec §4b.6.2):
// Apply writes it, Cancel or Escape writes nothing.

import { forEachDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeMirrorBuffer } from '../../src/buffer';
import { analyze } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import type { TextEditor } from '../../src/editor';

let buffer: CodeMirrorBuffer;
let editor: TextEditor;

function open(text: string, filename = 'test.plan'): void {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  buffer = new CodeMirrorBuffer(text);
  editor = mountTextEditor(buffer, document.body, { onCursorLine: () => {}, onSave: () => {} });
  buffer.onChange(() => editor.update(analyze(buffer.text(), filename)));
  editor.update(analyze(buffer.text(), filename));
}

afterEach(() => editor.destroy());

const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const panel = () => document.querySelector<HTMLElement>('.cm-fix-preview');
const panelButton = (label: string) => [...panel()!.querySelectorAll('button')].find((b) => b.textContent === label)!;

/** Runs the lint action with this name on the first diagnostic that offers it. */
function act(name: string): void {
  let found: Diagnostic | undefined;
  forEachDiagnostic(view().state, (d) => (found ??= d.actions?.some((a) => a.name === name) ? d : undefined));
  found!.actions!.find((a) => a.name === name)!.apply(view(), found!.from, found!.to);
}

describe('confirm fixes in the text editor', () => {
  it('show the preview first; Cancel writes nothing, Apply writes the fix', () => {
    const text = 'A\n    <!-- note -->\n';
    open(text);
    act('Make it a comment');
    expect(buffer.text()).toBe(text);
    expect(panel()!.querySelector('pre')!.textContent).toBe('-     <!-- note -->\n+     // note');
    panelButton('Cancel').click();
    expect(panel()).toBeNull();
    expect(buffer.text()).toBe(text);
    act('Make it a comment');
    panelButton('Apply').click();
    expect(buffer.text()).toBe('A\n    // note\n');
    expect(panel()).toBeNull();
  });

  it('Escape cancels, and an edit to the text drops the preview', () => {
    const text = 'A\n    <!-- note -->\n';
    open(text);
    act('Make it a comment');
    panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
    act('Make it a comment');
    view().dispatch({ changes: { from: 0, insert: 'X' } });
    expect(panel()).toBeNull();
    expect(buffer.text()).toBe(`X${text}`);
  });

  it('show the warning, and a typed name for "Rename column…"', () => {
    open('---\ncolumns: est:duration | est:text\n---\nA | 1h\n');
    act('Rename column…');
    const input = panel()!.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('est2');
    input.value = 'kind';
    input.dispatchEvent(new Event('input'));
    expect(panel()!.querySelector('pre')!.textContent).toBe('- columns: est:duration | est:text\n+ columns: est:duration | kind:text');
    panelButton('Apply').click();
    expect(buffer.text()).toBe('---\ncolumns: est:duration | kind:text\n---\nA | 1h\n');
  });

  it('shows the warning of a rename that other rows refer to', () => {
    open('A {#a}\nB {#a}\nC | parent=#a\n');
    act('Rename the later one');
    expect(panel()!.querySelector('.cm-fix-warning')!.textContent).toBe("A row refers to #a. It isn't clear which task it meant, so check it after renaming.");
  });

  it('click fixes still apply straight away', () => {
    open('---\ncolumns: est:duration\n---\nA | 1d\n', 'legacy.plan');
    act('Add unit=h hpd=8 dpw=5');
    expect(panel()).toBeNull();
    expect(buffer.text()).toBe('---\ncolumns: est:duration unit=h hpd=8 dpw=5\n---\nA | 1d\n');
  });
});
