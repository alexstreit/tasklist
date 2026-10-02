// @vitest-environment jsdom
// The shell re-analyzes on a ~50 ms debounce, hands the model to the active
// renderer, keeps the editor cursor and the preview in sync, and opens/saves
// the buffer as a file.

import { diagnosticCount, forEachDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CodeMirrorBuffer } from '../../src/buffer';
import type { Model } from '../../src/core';

// Every model the shell builds, with the buffer's version when it was built.
const built: { model: Model; bufferVersion: number }[] = [];
// The shell's buffer is the one its text editor mounts on, which happens before its first analysis.
let shellBuffer: CodeMirrorBuffer | undefined;
const createView = CodeMirrorBuffer.prototype.createView;
CodeMirrorBuffer.prototype.createView = function (this: CodeMirrorBuffer, ...args) {
  shellBuffer ??= this;
  return createView.apply(this, args);
};
const buffer = () => shellBuffer!;
vi.mock('../../src/app/registry', async (original) => {
  const registry = await original<typeof import('../../src/app/registry')>();
  const analyze: typeof registry.analyze = (text, options) => {
    const model = registry.analyze(text, options);
    built.push({ model, bufferVersion: buffer().version() });
    return model;
  };
  return { ...registry, analyze };
});

let view: EditorView;
let preview: HTMLElement;

// Fake File System Access API. The file holds what was last written to it, as a real one does:
// saving reads it again first (spec §6).
let onDisk = '';
const written: string[] = [];
let writable = true;
const handle = {
  name: 'q4.plan',
  getFile: async () => ({ text: async () => onDisk }),
  createWritable: async () => {
    if (!writable) throw new DOMException('The user denied write access', 'NotAllowedError');
    return { write: async (t: string) => void written.push((onDisk = t)), close: async () => {} };
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
    '<button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span>' +
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
    const openText = '---\ncolumns: est:duration | owner:text\n---\n\n// note   \nAuth | 2d   \n\tLogin | 4h\n    Reset | 1h |\n\n';
    onDisk = openText;
    document.getElementById('open')!.click();
    await flush();
    expect(view.state.doc.toString()).toBe(openText.replace('\t', '    '));
    expect(document.title).toBe('q4.plan — Plan');
    written.length = 0;
    document.getElementById('save')!.click();
    await flush();
    expect(written).toEqual([openText.replace('\t', '    ')]);
  });

  it('applies an outside edit to the clean file when the window regains focus', async () => {
    expect(document.title).toBe('q4.plan — Plan');
    onDisk = onDisk.replace('Reset | 1h |', 'Reset | 2h |');
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(view.state.doc.toString()).toBe(onDisk);
    expect(document.title).toBe('q4.plan — Plan');
  });

  it('asks before saving over an outside edit made while the file had unsaved changes', async () => {
    view.dispatch({ changes: { from: 0, insert: '// mine\n' } });
    const outside = onDisk.replace('Login | 4h', 'Login | 5h');
    onDisk = outside;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(view.state.doc.toString().startsWith('// mine\n')).toBe(true);
    expect(view.state.doc.toString()).not.toContain('Login | 5h');
    written.length = 0;
    ctrlS();
    await flush();
    expect(document.querySelector('.dialog p')!.textContent).toBe('q4.plan changed on disk since you opened it. Overwrite it, or keep your changes unsaved?');
    [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === 'Keep')!.click();
    await flush();
    expect(written).toEqual([]);
    expect(onDisk).toBe(outside);
    ctrlS();
    await flush();
    [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === 'Overwrite')!.click();
    await flush();
    expect(written).toEqual([view.state.doc.toString()]);
    expect(document.title).toBe('q4.plan — Plan');
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

// Task 34: the toolbar follows what the workspace can do. A single file in Edge gets Refresh, not Save all.
describe('toolbar with a single file saved in place', () => {
  it('offers Open file, Open folder (disabled without a directory picker), Save, Save As and Refresh', () => {
    const shown = [...document.querySelectorAll<HTMLButtonElement>('body > button')].filter((b) => !b.hidden).map((b) => b.id);
    expect(shown).toEqual(['open', 'open-folder', 'save', 'save-as', 'refresh']);
    expect(document.getElementById('open')!.textContent).toBe('Open file');
    const openFolder = document.getElementById('open-folder') as HTMLButtonElement;
    expect(openFolder.disabled).toBe(true);
    expect(openFolder.title).toBe('Opening a folder needs Edge or Chrome');
    expect(document.getElementById('files')!.hidden).toBe(true);
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
    // A heading line is a rows structural error; 4x a validation error (spec §2.9).
    expect(out.map((d) => d.severity)).toEqual(['error', 'warning']);
    expect(view.state.doc.sliceString(out[0].from, out[0].to)).toBe('# heading');
    expect(view.state.doc.sliceString(out[1].from, out[1].to)).toBe('4x');
    expect(out[1].message).toBe('"4x" is not a valid duration; the text is kept.');
  });

  it('underlines only the offending field and marks the gutter', () => {
    const marks = (severity: string) => [...view.contentDOM.querySelectorAll(`.cm-lintRange-${severity}`)].map((m) => m.textContent);
    expect([marks('error'), marks('warning')]).toEqual([['# heading'], ['4x']]);
    expect(view.dom.querySelectorAll('.cm-gutter-lint .cm-lint-marker-error')).toHaveLength(1);
    expect(view.dom.querySelectorAll('.cm-gutter-lint .cm-lint-marker-warning')).toHaveLength(1);
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
    expect([...document.querySelectorAll('#renderers button')].map((b) => b.textContent)).toEqual(['Tree', 'Table', 'Schedule', 'Gantt', 'Pins']);
    expect(tab('Tree').classList.contains('active')).toBe(true);
    expect(tab('Table').disabled).toBe(false);
    expect(tab('Schedule').disabled).toBe(true);
    expect(tab('Schedule').title).toBe('needs project-start');
    expect(tab('Gantt').disabled).toBe(true);
    expect(tab('Gantt').title).toBe('needs project-start');
    // The pin review requires nothing.
    expect(tab('Pins').disabled).toBe(false);
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
    tab('Schedule').click();
    expect(tab('Schedule').classList.contains('active')).toBe(false);
    expect(tab('Table').classList.contains('active')).toBe(true);
    expect(preview.querySelector('table')!.className).toContain('plan-table');
  });

  it('lines the Gantt up with the text editor’s lines, and shows the pin review', () => {
    const text = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n// plan\nBuild\n    API | 3d\n    UI | 2d | | 2026-10-12\n';
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    vi.advanceTimersByTime(60);
    tab('Gantt').click();
    vi.advanceTimersByTime(60);
    const bands = [...preview.querySelectorAll<HTMLElement>('.gantt-row')];
    // The comment and front matter lines are rows with no mark.
    expect(bands.map((b) => Number(b.dataset.line))).toEqual([6, 7, 8]);
    expect(bands.map((b) => parseFloat(b.style.top))).toEqual([6, 7, 8].map((line) => view.lineBlockAt(view.state.doc.line(line).from).top));
    tab('Pins').click();
    expect([...preview.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((r) => r.cells[1].textContent)).toEqual(['UI']);
    tab('Table').click();
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
      "#\tlevel\ttitle\test (h)\towner\tnotes\tdone\n'1\t1\tAuth\t16\t\t\tFALSE\n'1.1\t2\tLogin\t4\talice\t\tTRUE",
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

// Spec §3.4: one buffer, one editor mounted at a time.
describe('editor toggle', () => {
  const editorButton = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('#editors button')].find((b) => b.textContent === label)!;
  const pane = () => document.getElementById('editor')!;
  const gridCell = (line: number, column: number) =>
    pane().querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`)!.cells[column + 1];
  const ctrlZ = () =>
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));

  it('swaps the text editor for the grid and keeps the preview working', () => {
    // Earlier tests left the table renderer showing; the tree names rows in cells[1].
    [...document.querySelectorAll<HTMLButtonElement>('#renderers button')].find((b) => b.textContent === 'Tree')!.click();
    expect(titles()).toEqual(['Auth', 'Login']);
    editorButton('Grid').click();
    expect(pane().querySelector('.cm-editor')).toBeNull();
    expect(pane().querySelectorAll('tbody tr.item')).toHaveLength(2);
    // Remembered for next time (a convenience; nothing depends on it).
    expect(localStorage.getItem('plan.editor')).toBe('grid');
    expect(titles()).toEqual(['Auth', 'Login']);
  });

  it('carries a grid edit back to the text editor, undoable across the switch', () => {
    const before = 'Auth | 2d\n    ~Login | 4h | alice\n';
    gridCell(2, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = pane().querySelector<HTMLInputElement>('tbody input.cell-input')!;
    input.value = 'Sign in';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    vi.advanceTimersByTime(60);
    expect(titles()).toEqual(['Auth', 'Sign in']);

    editorButton('Text').click();
    expect(localStorage.getItem('plan.editor')).toBe('text');
    view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    expect(view.state.doc.toString()).toBe('Auth | 2d\n    ~Sign in | 4h | alice\n');
    ctrlZ();
    vi.advanceTimersByTime(60);
    expect(view.state.doc.toString()).toBe(before);
    expect(titles()).toEqual(['Auth', 'Login']);
  });
});

// Task 32: the shell relays a hovered line between the editor and the view, naming neither.
describe('hover across panes', () => {
  const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#renderers button')].find((b) => b.textContent === label)!;
  const editorButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#editors button')].find((b) => b.textContent === label)!;
  const pane = () => document.getElementById('editor')!;
  const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const leave = (el: Element) => el.dispatchEvent(new MouseEvent('mouseleave'));
  const gridHover = () => [...pane().querySelectorAll<HTMLElement>('tbody tr.hover')].map((tr) => Number(tr.dataset.line));
  const ganttHover = () => [...preview.querySelectorAll<HTMLElement>('.gantt-band.hover')].map((b) => Number(b.dataset.line));
  const text = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n// plan\nBuild\n    API | 3d\n    UI | 2d\n';

  it('relays between the grid and the Gantt both ways, a comment row too, and leaving clears both', async () => {
    const { stackLayout } = await import('../support/layout');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    vi.advanceTimersByTime(60);
    tab('Gantt').click();
    vi.advanceTimersByTime(60);
    // The text editor doesn't take part in hover: hovering the Gantt with it mounted breaks nothing.
    over(preview.querySelector('.gantt-row[data-line="7"]')!);
    leave(preview.querySelector('.gantt-body')!);

    // jsdom lays nothing out; the grid publishes only the rows it measures on screen.
    const restore = stackLayout(pane(), (el) => (el instanceof HTMLTableRowElement ? 22 : undefined));
    try {
      editorButton('Grid').click();
      vi.advanceTimersByTime(60);
      over(preview.querySelector('.gantt-row[data-line="7"] .gantt-bar')!);
      expect(gridHover()).toEqual([7]);
      leave(preview.querySelector('.gantt-body')!);
      expect(gridHover()).toEqual([]);
      over(pane().querySelector('tr[data-line="8"] td')!);
      expect(ganttHover()).toEqual([8]);
      over(pane().querySelector('tr[data-line="5"] td')!);
      expect(ganttHover()).toEqual([5]);
      leave(pane().querySelector('table')!);
      expect(ganttHover()).toEqual([]);
      over(preview.querySelector('.gantt-row[data-line="6"]')!);
      expect(gridHover()).toEqual([6]);
      leave(preview.querySelector('.gantt-body')!);
      expect(gridHover()).toEqual([]);

      // A view that doesn't follow still shows the hovered line, by line.
      tab('Tree').click();
      over(pane().querySelector('tr[data-line="7"] td')!);
      expect([...preview.querySelectorAll<HTMLTableRowElement>('tbody tr.hover')].map((tr) => tr.cells[1].textContent)).toEqual(['API']);
      leave(pane().querySelector('table')!);
      expect(preview.querySelector('tbody tr.hover')).toBeNull();
    } finally {
      editorButton('Text').click();
      view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
      restore();
    }
  });
});

describe('model versions', () => {
  it('every model the shell built carries the buffer’s version at the time', () => {
    vi.advanceTimersByTime(60);
    // Edits, undo, a load, and both editors, by the time this runs: many versions, not one.
    expect(new Set(built.map(({ model }) => model.version)).size).toBeGreaterThan(5);
    expect(built.map(({ model }) => model.version)).toEqual(built.map(({ bufferVersion }) => bufferVersion));
    expect(built[built.length - 1].model.version).toBe(buffer().version());
    expect(buffer().version()).toBeGreaterThan(0);
  });
});

describe('search in the single-file workspace (Task 36)', () => {
  it('Ctrl+F opens CodeMirror’s search panel; replace-all is one undo', async () => {
    const { closeSearchPanel, replaceAll, SearchQuery, setSearchQuery } = await import('@codemirror/search');
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', keyCode: 70, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.querySelector('.cm-search')).not.toBeNull();
    // Past the history's grouping delay, so the replace isn't joined to the edit before it.
    vi.advanceTimersByTime(1000);
    const before = view.state.doc.toString();
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'API', caseSensitive: true, replace: 'Service' })) });
    replaceAll(view);
    expect(before).toContain('API');
    expect(view.state.doc.toString()).toBe(before.replace('API', 'Service'));
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe(before);
    closeSearchPanel(view);
    expect(document.querySelector('.cm-search')).toBeNull();
  });
});
