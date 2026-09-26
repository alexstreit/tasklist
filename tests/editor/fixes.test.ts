// @vitest-environment jsdom
// A diagnostic's fixes are lint actions (spec §4.4): applying one sends its
// edits through the buffer as one edit, which one Ctrl+Z undoes.

import { forEachDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeMirrorBuffer } from '../../src/buffer';
import { analyze } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import type { TextEditor } from '../../src/editor';

const LEGACY = '---\ncolumns: est:duration | owner:text\n---\nA | 2d\nB | 4\n';

let buffer: CodeMirrorBuffer;
let editor: TextEditor;
let origins: string[];

beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  buffer = new CodeMirrorBuffer(LEGACY);
  origins = [];
  editor = mountTextEditor(buffer, document.body, { onCursorLine: () => {}, onSave: () => {} });
  // The shell's job, done synchronously.
  buffer.onChange((change) => {
    origins.push(change.origin);
    editor.update(analyze(buffer.text(), 'legacy.plan'));
  });
  editor.update(analyze(buffer.text(), 'legacy.plan'));
});

afterEach(() => editor.destroy());

function view(): EditorView {
  return EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
}

function diagnostics(): Diagnostic[] {
  const out: Diagnostic[] = [];
  forEachDiagnostic(view().state, (d) => out.push(d));
  return out;
}

describe('fixes as lint actions', () => {
  it('offers the conversion fix on both legacy values', () => {
    const offered = diagnostics().map((d) => d.actions?.map((a) => a.name));
    expect(offered).toEqual([['Add unit=h hpd=8 dpw=5'], ['Add unit=h hpd=8 dpw=5']]);
  });

  it('applies the fix through the buffer, and one Ctrl+Z undoes it', () => {
    const d = diagnostics()[0];
    d.actions![0].apply(view(), d.from, d.to);
    expect(buffer.text()).toBe('---\ncolumns: est:duration unit=h hpd=8 dpw=5 | owner:text\n---\nA | 2d\nB | 4\n');
    expect(origins).toEqual(['text-editor']);
    expect(diagnostics()).toEqual([]);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    view().contentDOM.dispatchEvent(event);
    expect(buffer.text()).toBe(LEGACY);
    expect(diagnostics().length).toBe(2);
  });

  it('does nothing once the text has changed under the diagnostic', () => {
    // Taken before the edit, as a diagnostic still showing during the shell's debounce would be.
    const d = diagnostics()[0];
    view().dispatch({ changes: { from: buffer.text().length, insert: 'C\n' } });
    const before = buffer.text();
    d.actions![0].apply(view(), d.from, d.to);
    expect(buffer.text()).toBe(before);
  });
});
