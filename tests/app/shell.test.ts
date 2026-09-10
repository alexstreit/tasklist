// @vitest-environment jsdom
// The shell re-analyzes on a ~50 ms debounce and hands the model to the right pane.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let view: EditorView;
let output: HTMLElement;

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.body.innerHTML = '<div id="editor"></div><pre id="model"></pre>';
  vi.useFakeTimers();
  await import('../../src/app/main');
  view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
  output = document.getElementById('model')!;
});

describe('app shell', () => {
  it('dumps the model of the initial document', () => {
    const model = JSON.parse(output.textContent!);
    expect(model.totals[0]).toEqual({ effective: 24, doneSum: 4 });
    expect(model.roots.map((r: { title: string }) => r.title)).toEqual(['Auth', 'Admin']);
  });

  it('updates the dump after an edit, once the debounce elapses', () => {
    const before = output.textContent;
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Ops | 1d\n' } });
    expect(output.textContent).toBe(before);
    vi.advanceTimersByTime(60);
    const model = JSON.parse(output.textContent!);
    expect(model.roots.map((r: { title: string }) => r.title)).toEqual(['Auth', 'Admin', 'Ops']);
    expect(model.totals[0].effective).toBe(32);
  });
});
