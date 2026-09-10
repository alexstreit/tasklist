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
const nearRow = () => preview.querySelector<HTMLTableRowElement>('tr.near-cursor')?.cells[0].textContent ?? null;
const scroll = vi.fn();

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = scroll;
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
    expect(nearRow()).toBeNull();
  });

  it('near-highlights the preceding item when the cursor is on a comment or blank line', () => {
    view.dispatch({ selection: { anchor: view.state.doc.line(13).from } });
    vi.advanceTimersByTime(60);
    expect(nearRow()).toBe('User list');
    expect(cursorRow()).toBeNull();
    // Line 14 is the Ops item appended earlier; line 15 is the trailing blank line.
    view.dispatch({ selection: { anchor: view.state.doc.line(15).from } });
    vi.advanceTimersByTime(60);
    expect(nearRow()).toBe('Ops');
  });

  it('scrolls the highlighted row into view on an editor cursor move, once per change', () => {
    scroll.mockClear();
    view.dispatch({ selection: { anchor: view.state.doc.line(6).from } });
    vi.advanceTimersByTime(60);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(preview.querySelector('tr.at-cursor'));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    // Moving within the same item's line does not scroll again.
    view.dispatch({ selection: { anchor: view.state.doc.line(6).from + 2 } });
    vi.advanceTimersByTime(60);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('moves the editor cursor and focuses the editor when a row is clicked', () => {
    const consent = rows().find((r) => r.cells[0].textContent === 'Consent screen')!;
    consent.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.line(9).from);
    expect(document.activeElement).toBe(view.contentDOM);
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('Consent screen');
  });

  it('does not scroll the preview when the move came from a preview click', () => {
    scroll.mockClear();
    rows().find((r) => r.cells[0].textContent === 'User list')!.click();
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('User list');
    expect(scroll).not.toHaveBeenCalled();
  });
});
