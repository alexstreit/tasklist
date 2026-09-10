// @vitest-environment jsdom
// The shell re-analyzes on a ~50 ms debounce, hands the model to the active
// renderer, keeps the editor cursor and the preview in sync, and opens/saves
// the buffer as a file.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let view: EditorView;
let preview: HTMLElement;

// Fake File System Access API.
let openText = '';
const written: string[] = [];
let writable = true;
const handle = {
  name: 'q4.plan',
  getFile: async () => ({ text: async () => openText }),
  createWritable: async () => {
    if (!writable) throw new DOMException('The user denied write access', 'NotAllowedError');
    return { write: async (t: string) => void written.push(t), close: async () => {} };
  },
};
const showOpenFilePicker = vi.fn(async () => [handle]);
const showSaveFilePicker = vi.fn(async () => handle);
Object.assign(window, { showOpenFilePicker, showSaveFilePicker });

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const ctrlS = () =>
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));

const rows = () => [...preview.querySelectorAll<HTMLTableRowElement>('tbody tr')];
const titles = () => rows().map((r) => r.cells[0].textContent);
const cursorRow = () => preview.querySelector<HTMLTableRowElement>('tr.at-cursor')?.cells[0].textContent ?? null;
const nearRow = () => preview.querySelector<HTMLTableRowElement>('tr.near-cursor')?.cells[0].textContent ?? null;
const scroll = vi.fn();

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = scroll;
  document.body.innerHTML =
    '<button id="open"></button><button id="save"></button><button id="save-as"></button><span id="filename"></span><span id="status"></span>' +
    '<div id="editor"></div><section id="preview"></section>';
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

describe('open and save', () => {
  it('shows the unsaved indicator on Untitled before any save', () => {
    // Earlier tests edited the buffer, so it is unsaved by now; check the shape only.
    expect(document.title).toMatch(/^● Untitled — Plan$/);
  });

  it('Ctrl+S on a new document prompts for a location; later saves do not', async () => {
    ctrlS();
    await flush();
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(written).toEqual([view.state.doc.toString()]);
    expect(document.title).toBe('q4.plan — Plan');
    expect(document.getElementById('status')!.textContent).toBe('Saved q4.plan');
    view.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    expect(document.title).toBe('● q4.plan — Plan');
    ctrlS();
    await flush();
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(2);
    expect(written[1].startsWith('// edited\n')).toBe(true);
    expect(document.title).toBe('q4.plan — Plan');
  });

  it('undoing back to the saved text clears the indicator', () => {
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(document.title).toBe('● q4.plan — Plan');
    view.dispatch({ changes: { from: 0, to: 1 } });
    expect(document.title).toBe('q4.plan — Plan');
  });

  it('prompts on beforeunload only with unsaved changes', () => {
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    const unsaved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
    view.dispatch({ changes: { from: 0, to: 1 } });
  });

  it('round-trips a file with comments, blank lines, trailing whitespace and front matter, converting tabs', async () => {
    openText = '---\ncolumns: est:duration | owner:text\n---\n\n// note   \nAuth | 2d   \n\tLogin | 4h\n    Reset | 1h |\n\n';
    document.getElementById('open')!.click();
    await flush();
    expect(view.state.doc.toString()).toBe(openText.replace('\t', '    '));
    expect(document.title).toBe('q4.plan — Plan');
    written.length = 0;
    document.getElementById('save')!.click();
    await flush();
    expect(written).toEqual([openText.replace('\t', '    ')]);
  });

  it('reports a failed save and keeps the document unsaved', async () => {
    writable = false;
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    ctrlS();
    await flush();
    expect(document.getElementById('status')!.textContent).toBe('Could not save: The user denied write access');
    expect(document.title).toBe('● q4.plan — Plan');
    writable = true;
  });
});
