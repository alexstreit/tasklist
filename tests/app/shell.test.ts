// @vitest-environment jsdom
// The shell re-analyzes on a ~50 ms debounce, hands the model to the active
// renderer, keeps the editor cursor and the preview in sync, and opens/saves
// the buffer as a file.

import { diagnosticCount, forEachDiagnostic } from '@codemirror/lint';
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
const titles = () => rows().map((r) => r.cells[1].textContent);
const cursorRow = () => preview.querySelector<HTMLTableRowElement>('tr.at-cursor')?.cells[1].textContent ?? null;
const nearRow = () => preview.querySelector<HTMLTableRowElement>('tr.near-cursor')?.cells[1].textContent ?? null;
const scroll = vi.fn();

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = scroll;
  document.body.innerHTML =
    '<button id="open"></button><button id="save"></button><button id="save-as"></button><span id="filename"></span><span id="status"></span>' +
    '<div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section>';
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
    expect(preview.querySelector('tfoot td:nth-child(3)')!.firstChild!.textContent).toBe('3d');
  });

  it('re-renders after an edit once the debounce elapses', () => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Ops | 1d\n' } });
    expect(titles()).toHaveLength(8);
    vi.advanceTimersByTime(60);
    expect(titles()).toHaveLength(9);
    expect(preview.querySelector('tfoot td:nth-child(3)')!.firstChild!.textContent).toBe('4d');
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
    const consent = rows().find((r) => r.cells[1].textContent === 'Consent screen')!;
    consent.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.line(9).from);
    expect(document.activeElement).toBe(view.contentDOM);
    vi.advanceTimersByTime(60);
    expect(cursorRow()).toBe('Consent screen');
  });

  it('does not scroll the preview when the move came from a preview click', () => {
    scroll.mockClear();
    rows().find((r) => r.cells[1].textContent === 'User list')!.click();
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

describe('diagnostics', () => {
  const collect = () => {
    const out: { from: number; to: number; severity: string; message: string }[] = [];
    forEachDiagnostic(view.state, (d) => out.push({ from: d.from, to: d.to, severity: d.severity, message: d.message }));
    return out;
  };

  it('shows the model diagnostics for the current buffer', () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# heading\nAuth\n    Login | 4x\n' } });
    vi.advanceTimersByTime(60);
    const out = collect();
    expect(out.map((d) => d.severity)).toEqual(['warning', 'warning']);
    expect(view.state.doc.sliceString(out[0].from, out[0].to)).toBe('# heading');
    expect(view.state.doc.sliceString(out[1].from, out[1].to)).toBe('4x');
    expect(out[1].message).toBe('unparseable duration: "4x"');
  });

  it('underlines only the offending field and marks the gutter', () => {
    const marks = [...view.contentDOM.querySelectorAll('.cm-lintRange-warning')].map((m) => m.textContent);
    expect(marks).toEqual(['# heading', '4x']);
    expect(view.dom.querySelectorAll('.cm-gutter-lint .cm-lint-marker-warning')).toHaveLength(2);
  });

  it('clears a diagnostic as soon as its line is fixed', () => {
    const line3 = view.state.doc.line(3);
    view.dispatch({ changes: { from: line3.from, to: line3.to, insert: '    Login | 4h' } });
    vi.advanceTimersByTime(60);
    expect(diagnosticCount(view.state)).toBe(1);
    view.dispatch({ changes: { from: 0, to: view.state.doc.line(1).to + 1 } });
    vi.advanceTimersByTime(60);
    expect(diagnosticCount(view.state)).toBe(0);
    expect(view.dom.querySelectorAll('.cm-lint-marker')).toHaveLength(0);
  });
});

describe('renderer switcher', () => {
  const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#renderers button')].find((b) => b.textContent === label)!;

  it('lists every registered renderer, greying out one whose requirements are unmet', () => {
    expect([...document.querySelectorAll('#renderers button')].map((b) => b.textContent)).toEqual(['Tree', 'Table', 'Gantt']);
    expect(tab('Tree').classList.contains('active')).toBe(true);
    expect(tab('Table').disabled).toBe(false);
    expect(tab('Gantt').disabled).toBe(true);
    expect(tab('Gantt').title).toBe('needs a date column');
  });

  it('switches to the table renderer and back', () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Auth | 2d\n    Login | 4h\n' } });
    vi.advanceTimersByTime(60);
    tab('Table').click();
    expect(tab('Table').classList.contains('active')).toBe(true);
    expect(preview.querySelector('table')!.className).toContain('plan-table');
    expect(rows().map((r) => r.cells[1].textContent)).toEqual(['1', '2']);
    expect(rows().map((r) => r.cells[2].textContent)).toEqual(['Auth', 'Login']);
    tab('Tree').click();
    expect(preview.querySelector('table')!.className).toContain('plan-tree');
  });

  it('keeps cursor sync working in the table', () => {
    tab('Table').click();
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    vi.advanceTimersByTime(60);
    expect(preview.querySelector<HTMLTableRowElement>('tr.at-cursor')!.cells[2].textContent).toBe('Login');
    rows()[0].click();
    expect(view.state.selection.main.head).toBe(0);
    vi.advanceTimersByTime(60);
    expect(preview.querySelector<HTMLTableRowElement>('tr.at-cursor')!.cells[2].textContent).toBe('Auth');
  });

  it('never renders a greyed-out renderer', () => {
    tab('Gantt').click();
    expect(tab('Gantt').classList.contains('active')).toBe(false);
    expect(tab('Table').classList.contains('active')).toBe(true);
    expect(preview.querySelector('table')!.className).toContain('plan-table');
  });
});

describe('exporters', () => {
  const status = () => document.getElementById('status')!.textContent;
  const button = () => document.querySelector<HTMLButtonElement>('#exporters button')!;
  const setClipboard = (clipboard: unknown) => Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

  it('shows one button per registered exporter', () => {
    expect([...document.querySelectorAll('#exporters button')].map((b) => b.textContent)).toEqual(['Copy for Excel']);
  });

  it('reports visibly when the clipboard API is unavailable, as in an embedded frame', async () => {
    setClipboard(undefined);
    button().click();
    await flush();
    expect(status()).toBe('Could not copy: clipboard unavailable in this context');
  });

  it('copies the current document as TSV and confirms briefly on the button', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Auth | 2d\n    ~Login | 4h | alice\n' } });
    vi.advanceTimersByTime(60);
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    button().click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(
      '#\tlevel\ttitle\test (h)\towner\tnotes\tdone\n1\t1\tAuth\t16\t\t\tFALSE\n1.1\t2\tLogin\t4\talice\t\tTRUE',
    );
    expect(button().textContent).toBe('Copied');
    vi.advanceTimersByTime(1500);
    expect(button().textContent).toBe('Copy for Excel');
  });

  it('reports a rejected clipboard write in the status line', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new DOMException('Write permission denied.', 'NotAllowedError'); }) });
    button().click();
    await flush();
    expect(status()).toBe('Could not copy: Write permission denied.');
    expect(button().textContent).toBe('Copy for Excel');
  });
});
