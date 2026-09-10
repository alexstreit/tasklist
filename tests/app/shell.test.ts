// @vitest-environment jsdom
// The shell re-analyzes on a ~50 ms debounce, hands the model to the active
// renderer, and keeps the editor cursor and the preview in sync.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let view: EditorView;
let preview: HTMLElement;

const rows = () => [...preview.querySelectorAll<HTMLTableRowElement>('tbody tr')];
const titles = () => rows().map((r) => r.cells[0].textContent);
const cursorRow = () => preview.querySelector<HTMLTableRowElement>('tr.at-cursor')?.cells[0].textContent ?? null;

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.body.innerHTML = '<div id="editor"></div><section id="preview"></section>';
  vi.useFakeTimers();
  await import('../../src/app/main');
  view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
  preview = document.getElementById('preview')!;
});

describe('app shell', () => {
  it('renders the initial document', () => {
    expect(titles()).toEqual([
      'Auth', 'Login page', 'Password reset', 'OAuth (Google)', 'Consent screen', 'Token refresh', 'Admin', 'User list',
    ]);
    expect(preview.querySelector('tfoot td:nth-child(2)')!.firstChild!.textContent).toBe('3d');
  });

  it('re-renders after an edit once the debounce elapses', () => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Ops | 1d\n' } });
    expect(titles()).toHaveLength(8);
    vi.advanceTimersByTime(60);
    expect(titles()).toHaveLength(9);
    expect(preview.querySelector('tfoot td:nth-child(2)')!.firstChild!.textContent).toBe('4d');
  });

  it('highlights the row under the editor cursor as it moves', () => {
    view.dispatch({ selection: { anchor: view.state.doc.line(7).from + 3 } });
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('Password reset');
    view.dispatch({ selection: { anchor: view.state.doc.line(12).from } });
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('User list');
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBeNull();
  });

  it('moves the editor cursor and focuses the editor when a row is clicked', () => {
    const consent = rows().find((r) => r.cells[0].textContent === 'Consent screen')!;
    consent.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.line(9).from);
    expect(document.activeElement).toBe(view.contentDOM);
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('Consent screen');
  });
});
