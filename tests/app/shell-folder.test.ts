// @vitest-environment jsdom
// The shell with a folder workspace (spec §6), over in-memory File System Access handles: Reopen,
// Open folder, the file panel, switching files, saving, re-reading on focus, the changed-on-disk
// prompts and replacing the open files. The page starts in the download fallback, as in Firefox,
// but with a directory picker, so the toolbar changes when a folder opens. Each test builds on the
// one before, as the shell is one page.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import example from '../../examples/example.plan?raw';
import { fakeFolder, fakeMemory } from '../support/fs';
import type { FakeFolder, Tree } from '../support/fs';

const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));

const old = fakeFolder('Old', { 'old.plan': 'Old | 1h\n' });
const portfolio = fakeFolder('Portfolio', {
  'portfolio.plan': 'Portfolio\n',
  teams: { 'alpha.plan': 'Alpha\n    A1 | 1h\n    A2 | 2h\n    A3 | 3h\n', 'beta.plan': 'Beta | 1d\n', 'gamma.plan': 'Gamma\n' },
  '.git': { 'x.plan': 'x' },
});
let picked: FakeFolder = portfolio;
const showDirectoryPicker = vi.fn(async () => picked.handle);
Object.assign(window, { showDirectoryPicker });

let view: EditorView;
const findView = () => (view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!);
const flush = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};
const $ = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.getElementById(id) as T;
const status = () => $('status').textContent;
const key = (k: string, keyCode: number) =>
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, keyCode, ctrlKey: true, bubbles: true, cancelable: true }));
const ctrlS = () => key('s', 83);
const ctrlZ = () => key('z', 90);
const dialog = () => document.querySelector('.dialog')?.querySelector('p')?.textContent ?? null;
const dialogButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].map((b) => b.textContent);
const choose = async (label: string) => {
  [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === label)!.click();
  await flush();
};
const click = async (el: HTMLElement) => {
  el.click();
  await flush();
  vi.advanceTimersByTime(60);
};
const panelFiles = () =>
  [...document.querySelectorAll<HTMLButtonElement>('#files button.file')].map(
    (b) => b.dataset.path + [...b.querySelectorAll('.file-marker')].map((m) => ` ${m.textContent}`).join('') + (b.classList.contains('active') ? ' (active)' : ''),
  );
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const type = (text: string) => view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
const leave = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const shown = () => [...document.querySelectorAll<HTMLButtonElement>('.toolbar > button')].filter((b) => !b.hidden).map((b) => b.textContent);
const teams = () => portfolio.tree.teams as Record<string, string>;

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  await memory.remember(old.handle, null);
  old.permission = 'denied';
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  vi.useFakeTimers();
  (await import('../../src/app/main')).boot({ document: example });
  await flush();
  findView();
});

describe('reopening the remembered folder', () => {
  it('offers Reopen beside the open buttons; no panel, Save all or Refresh before a folder is open', () => {
    expect(shown()).toEqual(['New…', 'Open file', 'Open folder', 'Reopen Old', 'Download', 'Close']);
    expect($('open-folder').disabled).toBe(false);
    expect($('files').hidden).toBe(true);
  });

  it('a refusal says so, changes nothing, and keeps Reopen', async () => {
    await click($('reopen'));
    expect(status()).toBe('Permission to open Old was refused');
    expect(document.title).toBe('Untitled — Plan');
    expect(shown()).toContain('Reopen Old');
  });

  it('asks before replacing an unsaved document; Discard and continue reopens once permission is granted', async () => {
    type('// edited\n');
    old.permission = 'granted';
    await click($('reopen'));
    expect(dialog()).toBe('Untitled has unsaved changes.');
    expect(dialogButtons()).toEqual(['Save all and continue', 'Discard and continue', 'Cancel']);
    await choose('Discard and continue');
    vi.advanceTimersByTime(60);
    expect(document.title).toBe('old.plan — Plan');
    expect(view.state.doc.toString()).toBe('Old | 1h\n');
    expect(shown()).toEqual(['New…', 'Open file', 'Open folder', 'Reopen Old', 'Save', 'Save all', 'Refresh', 'Close']);
    expect(panelFiles()).toEqual(['old.plan (active)']);
    expect(leave()).toBe(false);
  });
});

describe('opening a folder', () => {
  it('opens the first top-level file, lists the folder grouped by folder, and remembers it in place of the other', async () => {
    await click($('open-folder'));
    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(status()).toBe('Opened portfolio.plan');
    expect(panelFiles()).toEqual(['portfolio.plan (active)', 'teams/alpha.plan', 'teams/beta.plan', 'teams/gamma.plan']);
    expect([...document.querySelectorAll('#files .file-folder')].map((f) => f.textContent)).toEqual(['teams/']);
    expect(panelFile('teams/alpha.plan').textContent).toBe('alpha.plan');
    expect(shown()).toContain('Reopen Portfolio');
    expect((await memory.load())?.handle).toBe(portfolio.handle);
  });

  it('collapses the panel from its heading', () => {
    const toggle = document.querySelector<HTMLButtonElement>('#files .file-panel-toggle')!;
    toggle.click();
    expect(document.querySelector<HTMLElement>('#files .file-list')!.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(document.querySelector<HTMLElement>('#files .file-list')!.hidden).toBe(false);
  });

  it('moves between files with the arrow keys, one tab stop on the active file', () => {
    const active = panelFile('portfolio.plan');
    expect([...document.querySelectorAll<HTMLButtonElement>('#files button.file')].map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
    active.focus();
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(panelFile('teams/alpha.plan'));
    panelFile('teams/alpha.plan').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    panelFile('teams/beta.plan').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // The last file stays focused.
    panelFile('teams/gamma.plan').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(panelFile('teams/gamma.plan'));
    panelFile('teams/gamma.plan').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(panelFile('teams/beta.plan'));
  });
});

describe('switching files', () => {
  it('a click makes a file active, reading it, and the editor and views follow', async () => {
    await click(panelFile('teams/alpha.plan'));
    findView();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect(view.state.doc.toString()).toBe(teams()['alpha.plan']);
    expect([...document.querySelectorAll('#host tbody tr')].map((r) => (r as HTMLTableRowElement).cells[1].textContent)).toEqual(['Alpha', 'A1', 'A2', 'A3']);
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan', 'teams/gamma.plan']);
    expect((await memory.load())?.active).toBe('teams/alpha.plan');
  });

  it('keeps each file’s text and undo history: Ctrl+Z undoes the active file’s edit, not the other’s', async () => {
    type('    A4 | 4h\n');
    await click(panelFile('teams/beta.plan'));
    findView();
    type('    B1 | 1h\n');
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan ●', 'teams/beta.plan ● (active)', 'teams/gamma.plan']);
    await click(panelFile('teams/alpha.plan'));
    findView();
    expect(view.state.doc.toString()).toBe(teams()['alpha.plan'] + '    A4 | 4h\n');
    ctrlZ();
    expect(view.state.doc.toString()).toBe(teams()['alpha.plan']);
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan ●', 'teams/gamma.plan']);
    // Redo, so both files have unsaved changes for the next test.
    view.dispatch({ changes: { from: view.state.doc.length, insert: '    A4 | 4h\n' } });
  });

  it('prompts on leaving while any file, active or not, is unsaved', () => {
    expect(leave()).toBe(true);
  });
});

describe('saving', () => {
  it('Ctrl+S writes only the active file', async () => {
    portfolio.writes.length = 0;
    ctrlS();
    await flush();
    expect(portfolio.writes.map(([path]) => path)).toEqual(['teams/alpha.plan']);
    expect(status()).toBe('Saved teams/alpha.plan');
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan ●', 'teams/gamma.plan']);
  });

  it('Save all writes every unsaved file and clears their markers', async () => {
    // A separate undo step from A4: the history groups edits made close together.
    vi.advanceTimersByTime(1000);
    type('    A5 | 5h\n');
    portfolio.writes.length = 0;
    await click($('save-all'));
    expect(portfolio.writes.map(([path]) => path)).toEqual(['teams/alpha.plan', 'teams/beta.plan']);
    expect(teams()['beta.plan']).toBe('Beta | 1d\n    B1 | 1h\n');
    expect(status()).toBe('Saved alpha.plan and beta.plan');
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan', 'teams/gamma.plan']);
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect(leave()).toBe(false);
  });
});

describe('changes on disk', () => {
  it('focusing the window applies a clean file’s change line by line: the cursor stays, and undo keeps the change', async () => {
    // Line 4 ("    A3 | 3h") stays as it is; line 2 changes length above it.
    const line4 = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: line4.from + 6 } });
    teams()['alpha.plan'] = teams()['alpha.plan'].replace('    A1 | 1h', '    A1 renamed | 1h');
    window.dispatchEvent(new Event('focus'));
    await flush();
    vi.advanceTimersByTime(60);
    expect(view.state.doc.toString()).toBe(teams()['alpha.plan']);
    const head = view.state.selection.main.head;
    expect(view.state.doc.lineAt(head).number).toBe(4);
    expect(head - view.state.doc.line(4).from).toBe(6);
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan', 'teams/gamma.plan']);
    // The last undoable edit was A5; undoing it leaves the renamed line alone.
    ctrlZ();
    expect(view.state.doc.toString()).toBe(teams()['alpha.plan'].replace('    A5 | 5h\n', ''));
    expect(view.state.doc.toString()).toContain('A1 renamed');
  });

  it('an unsaved file changed on disk is marked and left as it is; saving asks, and Keep writes nothing', async () => {
    teams()['alpha.plan'] = 'Alpha\n    from outside\n';
    $('refresh').click();
    await flush();
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan ● ↻ (active)', 'teams/beta.plan', 'teams/gamma.plan']);
    expect(view.state.doc.toString()).not.toContain('from outside');
    portfolio.writes.length = 0;
    ctrlS();
    await flush();
    expect(dialog()).toBe('alpha.plan changed on disk since you opened it. Overwrite it, or keep your changes unsaved?');
    expect(dialogButtons()).toEqual(['Overwrite', 'Keep']);
    await choose('Keep');
    expect(portfolio.writes).toEqual([]);
    expect(status()).toBe('alpha.plan was not saved');
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan ● ↻ (active)', 'teams/beta.plan', 'teams/gamma.plan']);
  });

  it('Overwrite writes, and clears both markers', async () => {
    ctrlS();
    await flush();
    await choose('Overwrite');
    expect(portfolio.writes.map(([path]) => path)).toEqual(['teams/alpha.plan']);
    expect(teams()['alpha.plan']).toBe(view.state.doc.toString());
    expect(panelFiles()).toEqual(['portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan', 'teams/gamma.plan']);
  });

  it('focus lists the folder again: a new file appears, a deleted one that is not open goes', async () => {
    portfolio.tree['new.plan'] = 'New\n';
    delete teams()['gamma.plan'];
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(panelFiles()).toEqual(['new.plan', 'portfolio.plan', 'teams/alpha.plan (active)', 'teams/beta.plan']);
  });

  it('a file gone from disk stays open, marked missing; saving it asks to put it back at its path', async () => {
    const text = teams()['beta.plan'];
    await click(panelFile('teams/beta.plan'));
    findView();
    delete teams()['beta.plan'];
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(status()).toBe('beta.plan is no longer on disk');
    expect(panelFiles()).toEqual(['new.plan', 'portfolio.plan', 'teams/alpha.plan', 'teams/beta.plan ✕ (active)']);
    expect(view.state.doc.toString()).toBe(text);
    ctrlS();
    await flush();
    expect(dialog()).toBe('beta.plan is no longer on disk. Save it again at teams/beta.plan?');
    expect(dialogButtons()).toEqual(['Yes', 'No']);
    await choose('Yes');
    expect(teams()['beta.plan']).toBe(text);
    expect(panelFiles()).toEqual(['new.plan', 'portfolio.plan', 'teams/alpha.plan', 'teams/beta.plan (active)']);
  });
});

describe('replacing the open files', () => {
  const empty = fakeFolder('Empty', { 'readme.txt': 'x' });
  const other = fakeFolder('Other', { 'o.plan': 'O\n' });

  it('Cancel leaves everything as it was, without showing the picker', async () => {
    type('    B2 | 2h\n');
    const calls = showDirectoryPicker.mock.calls.length;
    await click($('open-folder'));
    expect(dialog()).toBe('beta.plan has unsaved changes.');
    await choose('Cancel');
    expect(showDirectoryPicker.mock.calls.length).toBe(calls);
    expect(document.title).toBe('● teams/beta.plan — Plan');
    expect(dialog()).toBeNull();
  });

  it('an empty folder opens nothing and says so: the open files stay, and none has no path', async () => {
    portfolio.writes.length = 0;
    await click($('save-all'));
    picked = empty;
    await click($('open-folder'));
    expect(status()).toBe('No plan files in folder');
    expect(document.title).toBe('teams/beta.plan — Plan');
    expect(panelFiles()).toEqual(['new.plan', 'portfolio.plan', 'teams/alpha.plan', 'teams/beta.plan (active)']);
    expect(shown()).toContain('Reopen Portfolio');
  });

  it('Save all and continue saves every unsaved file, then opens the folder; no file is left without a path', async () => {
    type('    B3 | 3h\n');
    await click(panelFile('teams/alpha.plan'));
    findView();
    type('    A6 | 6h\n');
    portfolio.writes.length = 0;
    picked = other;
    await click($('open-folder'));
    expect(dialog()).toBe('alpha.plan and beta.plan have unsaved changes.');
    await choose('Save all and continue');
    vi.advanceTimersByTime(60);
    expect(portfolio.writes.map(([path]) => path)).toEqual(['teams/alpha.plan', 'teams/beta.plan']);
    expect(document.title).toBe('o.plan — Plan');
    expect(panelFiles()).toEqual(['o.plan (active)']);
    expect(shown()).toContain('Reopen Other');
  });

  it('Save all and continue stops when a save is kept', async () => {
    // The open folder's file is shown through its own composed view, in a new editor view (Task 36).
    findView();
    type('x\n');
    other.tree['o.plan'] = 'changed outside\n';
    picked = portfolio;
    await click($('open-folder'));
    await choose('Save all and continue');
    expect(dialog()).toBe('o.plan changed on disk since you opened it. Overwrite it, or keep your changes unsaved?');
    await choose('Keep');
    expect(document.title).toBe('● o.plan — Plan');
    expect(other.writes).toEqual([]);
  });

  it('Discard and continue drops the unsaved changes and opens the file', async () => {
    findView();
    await click($('open'));
    // Open file asks too, before its file input shows.
    expect(dialog()).toBe('o.plan has unsaved changes.');
    await choose('Cancel');
    await click($('reopen'));
    await choose('Discard and continue');
    vi.advanceTimersByTime(60);
    findView();
    expect(document.title).toBe('o.plan — Plan');
    expect(view.state.doc.toString()).toBe('changed outside\n');
  });

  it('a remembered folder that no longer resolves is forgotten, and Reopen goes', async () => {
    other.gone = true;
    await click($('reopen'));
    expect(status()).toBe('Other can no longer be found, so it was forgotten');
    expect(await memory.load()).toBeNull();
    expect(shown()).not.toContain('Reopen Other');
    expect($('reopen').hidden).toBe(true);
  });
});
