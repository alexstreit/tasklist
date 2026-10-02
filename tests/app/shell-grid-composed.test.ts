// @vitest-environment jsdom
// Task 37: the composed grid, through the shell, on in-memory File System Access handles holding
// examples/portfolio/. The grid shows the master's rows with alpha's and beta's in composed order;
// each edit goes to the row's own file, through the rows edit API against that file's document;
// structure operations stay within a file; Unmount and deletes say what they do to files; and a
// mounted file's problems are fixed in place. Each test builds on the one before, as the shell is
// one page; each leaves the files as they were unless it says otherwise.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeFolder, fakeMemory } from '../support/fs';
import alpha from '../../examples/portfolio/teams/alpha.plan?raw';
import beta from '../../examples/portfolio/teams/beta.plan?raw';
import portfolioPlan from '../../examples/portfolio/portfolio.plan?raw';

const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));

const folder = fakeFolder('Portfolio', { 'portfolio.plan': portfolioPlan, teams: { 'alpha.plan': alpha, 'beta.plan': beta } });
Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder.handle) });

// Cell columns, as the grid numbers them: the root is `profile: schedule`.
const WBS = -1;
const DONE = 0;
const MILESTONE = -2;
const TITLE = 1;
const EST = 2;
const DEPS = 5;
const OWNER = 7;
const NOTES = 8;

const ALPHA = 'teams/alpha.plan';
const BETA = 'teams/beta.plan';
const ROOT = 'portfolio.plan';

/** Lets reads finish and the debounced analyses run, three times over: a read or a recompose can start another. */
const settle = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200; i++) await Promise.resolve();
    vi.advanceTimersByTime(60);
  }
};
const $ = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.getElementById(id) as T;
const button = (selector: string, label: string) => [...document.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === label)!;
const tab = (label: string) => button('#renderers button', label);
const editorTab = (label: string) => button('#editors button', label);
const tool = (label: string) => button('#editor .sheet-toolbar button', label);
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const status = () => $('status').textContent;

const gridRows = () => [...document.querySelectorAll<HTMLTableRowElement>('#editor tbody tr')];
const row = (file: string, line: number) => document.querySelector<HTMLTableRowElement>(`#editor tbody tr[data-file="${file}"][data-line="${line}"]`)!;
const cell = (file: string, line: number, column: number) => row(file, line).querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const input = () => document.querySelector<HTMLInputElement>('#editor tbody tr:not(.new-task):not(.draft) input.cell-input');
const notice = () => document.querySelector('#editor .sheet-notice')?.textContent ?? null;
const confirmText = () => document.querySelector('#editor .sheet-confirm .fix-warning')?.textContent ?? null;
const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
/** A cell's own text: without a muted value, or a badge, beside it. */
const own = (td: HTMLTableCellElement) => td.firstChild?.textContent ?? '';

/** Double-click a cell, type, and commit with Enter. */
async function edit(file: string, line: number, column: number, value: string): Promise<void> {
  click(cell(file, line, column), 'dblclick');
  input()!.value = value;
  press(input()!, 'Enter');
  await settle();
}

/** Select a row by its WBS cell. */
const select = (file: string, line: number) => click(cell(file, line, WBS));
async function undo(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    // The grid's keys act on its place: a fresh grid (after text()) has none yet.
    select(ROOT, 6);
    press(cell(ROOT, 6, WBS), 'z', { ctrlKey: true });
    await settle();
  }
}

const lines = (s: string) => s.split(/(?<=\n)/);
/** The master's text with alpha after Product A's line and beta after Product B's. */
const composedText = (master = portfolioPlan, a = alpha, b = beta) => {
  const m = lines(master);
  return [...m.slice(0, 6), a, m[6], b, ...m.slice(7)].join('');
};
/** The composed text, read through the text editor; the grid is shown again after. */
async function text(): Promise<string> {
  editorTab('Text').click();
  await settle();
  const value = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.state.doc.toString();
  editorTab('Grid').click();
  await settle();
  return value;
}
/** The schedule table's start and finish by title. */
function schedule(): Record<string, string[]> {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('#host tbody tr')];
  return Object.fromEntries(rows.map((r) => [own(r.cells[1]), [own(r.cells[2]), own(r.cells[3])]]));
}

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  vi.useFakeTimers();
  await import('../../src/app/main');
  await settle();
  $('open-folder').click();
  await settle();
  editorTab('Grid').click();
  tab('Schedule').click();
  await settle();
});

describe('the composed grid', () => {
  it('shows the master’s rows with alpha’s and beta’s in composed order, numbered across the plan and shaded', () => {
    const shown = gridRows().map((tr) => {
      if (tr.classList.contains('new-task')) return 'new task';
      if (tr.classList.contains('segment-header')) return `header ${tr.querySelector('.segment-path')!.textContent}`;
      const kind = tr.classList.contains('front-matter') ? 'settings' : tr.classList.contains('item') ? `${tr.cells[0].textContent} ${own(tr.querySelector('td.title')!)}` : 'comment';
      return `${tr.dataset.file}:${tr.dataset.line} ${kind}${tr.classList.contains('mounted') ? ' (mounted)' : ''}`;
    });
    expect(shown).toEqual([
      'portfolio.plan:1 settings',
      'portfolio.plan:5 comment',
      'portfolio.plan:6 1 Product A',
      'header alpha.plan',
      'teams/alpha.plan:1 settings (mounted)',
      'teams/alpha.plan:5 comment (mounted)',
      'teams/alpha.plan:6 1.1 Design (mounted)',
      'teams/alpha.plan:7 1.2 Build (mounted)',
      'portfolio.plan:7 2 Product B',
      'header beta.plan',
      'teams/beta.plan:1 settings (mounted)',
      'teams/beta.plan:6 comment (mounted)',
      'teams/beta.plan:7 2.1 Spec (mounted)',
      'teams/beta.plan:8 2.2 Code (mounted)',
      'portfolio.plan:8 3 ^Tradeshow',
      'new task',
    ].map((s) => s.replace(' ^Tradeshow', ' Tradeshow')));
    // Shaded by mount depth, as the text editor shades segments; titles indented at their composed depth.
    expect(row(ALPHA, 6).classList.contains('segment-depth-1')).toBe(true);
    expect(cell(ALPHA, 6, TITLE).style.paddingLeft).toBe('1.75em');
    expect(cell(ROOT, 6, TITLE).style.paddingLeft).toBe('0.5em');
    // A mounted file's settings are one collapsed, read-only row, like the root's.
    expect(row(BETA, 1).querySelector('td.raw')!.textContent).toBe('--- profile: plan columns: work:duration unit=h hpd=8 dpw=5 | owner:text roles: effort=work ---');
    // The mount rows carry their file badge.
    expect(cell(ROOT, 6, TITLE).querySelector('.file-badge')!.textContent).toBe('alpha.plan');
  });

  it('editing Build’s estimate writes alpha’s text only, moves Product B to 64–96, and one Ctrl+Z restores it', async () => {
    await edit(ALPHA, 7, EST, '4d');
    expect(schedule().Build).toEqual(['Fri 9 Oct', 'Wed 14 Oct']);
    expect(schedule()['Product B']).toEqual(['Thu 15 Oct', 'Tue 20 Oct']);
    expect(panelFile(ALPHA).textContent).toContain('●');
    expect(panelFile(ROOT).textContent).not.toContain('●');
    expect(folder.writes).toEqual([]);
    expect(await text()).toBe(composedText(portfolioPlan, alpha.replace('| 3d |', '| 4d |')));
    await undo();
    expect(schedule()['Product B']).toEqual(['Wed 14 Oct', 'Mon 19 Oct']);
    expect(await text()).toBe(composedText());
  });

  it('beta’s est cell writes its work column (by role), owner its owner (by name), and its notes cell is refused', async () => {
    await edit(BETA, 7, EST, '2d');
    await edit(BETA, 7, OWNER, 'sam');
    expect(await text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Spec    | 1d', 'Spec    | 2d | sam')));
    click(cell(BETA, 7, NOTES), 'dblclick');
    expect(input()).toBeNull();
    expect(notice()).toBe('beta.plan has no column for notes.');
    // A printable key says the same.
    click(cell(BETA, 8, NOTES));
    press(cell(BETA, 8, NOTES), 'x');
    expect(input()).toBeNull();
    expect(notice()).toBe('beta.plan has no column for notes.');
    await undo(2);
    expect(await text()).toBe(composedText());
  });

  it('the milestone toggle on a beta row is disabled, with its tooltip, and Space gives the note; done writes ~ in beta', async () => {
    const toggle = cell(BETA, 7, MILESTONE);
    expect(toggle.querySelector('input')!.disabled).toBe(true);
    expect(toggle.title).toBe('beta.plan has no milestone marker.');
    click(toggle);
    press(toggle, ' ');
    expect(notice()).toBe('beta.plan has no milestone marker.');
    // Alpha is a schedule file: its toggle works.
    expect(cell(ALPHA, 6, MILESTONE).querySelector('input')!.disabled).toBe(false);
    click(cell(BETA, 7, DONE).querySelector('input')!);
    await settle();
    expect(await text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Spec    | 1d', '~Spec    | 1d')));
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('dependencies resolve in the row’s own file: 1.1 writes #design in alpha, and 2.1 (Spec, in beta) is refused', async () => {
    expect(cell(ALPHA, 7, DEPS).textContent).toBe('1.1');
    click(cell(ALPHA, 7, DEPS));
    press(cell(ALPHA, 7, DEPS), 'Delete');
    await settle();
    expect(await text()).toBe(composedText(portfolioPlan, alpha.replace(' | deps=#design', '')));
    await edit(ALPHA, 7, DEPS, '1.1');
    // The anchor already there is reused: alpha's text is as it was.
    expect(await text()).toBe(composedText());
    await edit(ALPHA, 7, DEPS, '2.1');
    expect(notice()).toBe('Dependencies between plan files come later.');
    expect(await text()).toBe(composedText());
    // From a root row too.
    await edit(ROOT, 8, DEPS, '1.1');
    expect(notice()).toBe('Dependencies between plan files come later.');
    await undo(2);
    expect(await text()).toBe(composedText());
  });

  it('insert above Spec inserts into beta, at its level', async () => {
    select(BETA, 7);
    press(cell(BETA, 7, WBS), 'Insert');
    const draft = document.querySelector<HTMLInputElement>('#editor tr.draft input')!;
    draft.value = 'Review';
    press(draft, 'Enter');
    await settle();
    expect(await text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Spec    | 1d', 'Review\nSpec    | 1d')));
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('Outdent on Design is disabled with its tooltip, and its key gives the note', async () => {
    select(ALPHA, 6);
    expect(tool('Outdent').disabled).toBe(true);
    expect(tool('Outdent').title).toBe('That would move it out of alpha.plan.');
    press(cell(ALPHA, 6, WBS), 'ArrowLeft', { altKey: true, shiftKey: true });
    expect(notice()).toBe('That would move it out of alpha.plan.');
    expect(await text()).toBe(composedText());
  });

  it('Move up on Code swaps it with Spec within beta; on Spec it is disabled', async () => {
    select(BETA, 7);
    expect(tool('Move up').disabled).toBe(true);
    expect(tool('Move up').title).toBe('');
    select(BETA, 8);
    expect(tool('Move up').disabled).toBe(false);
    tool('Move up').click();
    await settle();
    expect(await text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Spec    | 1d\nCode    | 4d', 'Code    | 4d\nSpec    | 1d')));
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('Alt+Down on Product A swaps it with Product B in the master, and the segments follow', async () => {
    select(ROOT, 6);
    press(cell(ROOT, 6, WBS), 'ArrowDown', { altKey: true });
    await settle();
    const master = lines(portfolioPlan);
    const swapped = [...master.slice(0, 5), master[6], master[5], ...master.slice(7)].join('');
    const m = lines(swapped);
    expect(await text()).toBe([...m.slice(0, 6), beta, m[6], alpha, ...m.slice(7)].join(''));
    const titles = gridRows().filter((tr) => tr.classList.contains('item')).map((tr) => `${tr.cells[0].textContent} ${own(tr.querySelector('td.title')!)}`);
    expect(titles).toEqual(['1 Product B', '1.1 Spec', '1.2 Code', '2 Product A', '2.1 Design', '2.2 Build', '3 Tradeshow']);
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('Unmount on Product B clears its cell: beta’s rows leave the grid, beta.plan is unchanged, and one undo brings them back', async () => {
    select(ROOT, 7);
    expect(tool('Unmount').disabled).toBe(false);
    tool('Unmount').click();
    await settle();
    expect(gridRows().some((tr) => tr.dataset.file === BETA)).toBe(false);
    expect(panelFile(BETA).textContent).not.toContain('●');
    expect(await text()).toBe(composedText(portfolioPlan.replace(' | mount=teams/beta.plan ', ''), alpha, '').replace(lines(portfolioPlan)[6], lines(portfolioPlan)[6].replace(' | mount=teams/beta.plan ', '')));
    await undo();
    // Beta's header, settings, comment, Spec and Code.
    expect(gridRows().filter((tr) => tr.dataset.file === BETA)).toHaveLength(5);
    expect(await text()).toBe(composedText());
  });

  it('a header above each mounted file’s rows names it, marks it unsaved, and is no place (Task 37, after the browser pass)', async () => {
    const header = (file: string) => gridRows().find((tr) => tr.classList.contains('segment-header') && tr.dataset.file === file)!;
    const alphaHeader = header(ALPHA);
    // Right above alpha's settings row, spanning every column, with no line and nothing focusable.
    expect(gridRows()[gridRows().indexOf(alphaHeader) + 1]).toBe(row(ALPHA, 1));
    expect(alphaHeader.cells).toHaveLength(1);
    expect(alphaHeader.cells[0].colSpan).toBe(gridRows()[2].cells.length);
    expect(alphaHeader.dataset.line).toBeUndefined();
    expect(alphaHeader.querySelectorAll('[tabindex="0"], td[tabindex]')).toHaveLength(0);
    expect([...alphaHeader.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open', 'Unmount']);
    expect(alphaHeader.querySelector('.segment-unsaved')).toBeNull();
    // An edit in beta marks beta's header; undoing it clears the mark.
    await edit(BETA, 8, OWNER, 'ana');
    expect(header(BETA).querySelector('.segment-unsaved')?.textContent).toBe('●');
    expect(header(ALPHA).querySelector('.segment-unsaved')).toBeNull();
    await undo();
    expect(header(BETA).querySelector('.segment-unsaved')).toBeNull();
    expect(await text()).toBe(composedText());
  });

  it('ArrowDown from Product A skips alpha’s header (and its settings row) to alpha’s first row', () => {
    click(cell(ROOT, 6, TITLE));
    press(cell(ROOT, 6, TITLE), 'ArrowDown');
    const at = document.activeElement!.closest('tr')!;
    expect([at.dataset.file, at.dataset.line]).toEqual([ALPHA, '5']);
  });

  it('the header’s Unmount clears the mount cell, and one Ctrl+Z brings the segment back', async () => {
    const unmountButton = () => button(`#editor tr.segment-header[data-file="${ALPHA}"] button`, 'Unmount');
    click(unmountButton());
    await settle();
    expect(gridRows().some((tr) => tr.dataset.file === ALPHA)).toBe(false);
    const m = lines(portfolioPlan.replace('Product A {#a}  | mount=teams/alpha.plan | due', 'Product A {#a} | due'));
    expect(await text()).toBe([...m.slice(0, 7), beta, ...m.slice(7)].join(''));
    await undo();
    expect(await text()).toBe(composedText());
    expect(unmountButton()).toBeDefined();
  });

  it('the header’s Open, and the mount row’s badge, make the file active', async () => {
    click(button(`#editor tr.segment-header[data-file="${BETA}"] button`, 'Open'));
    await settle();
    expect(document.title).toBe('teams/beta.plan — Plan');
    panelFile(ROOT).click();
    await settle();
    click(cell(ROOT, 6, TITLE).querySelector('.file-badge')!);
    await settle();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    panelFile(ROOT).click();
    await settle();
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(await text()).toBe(composedText());
  });

  it('deleting Product A asks first, saying alpha.plan stays as it is; Cancel changes nothing, and Apply removes the row', async () => {
    select(ROOT, 6);
    press(cell(ROOT, 6, WBS), 'Delete');
    expect(confirmText()).toBe(
      "Delete Product A? teams/alpha.plan stays as it is; it just won't be shown here. Product B refers to it in deps; that reference will be removed.",
    );
    button('#editor .sheet-confirm button', 'Cancel').click();
    await settle();
    expect(await text()).toBe(composedText());
    select(ROOT, 6);
    press(cell(ROOT, 6, WBS), 'Delete');
    button('#editor .sheet-confirm button', 'Apply').click();
    await settle();
    expect(gridRows().some((tr) => tr.dataset.file === ALPHA)).toBe(false);
    expect(panelFile(ALPHA).textContent).not.toContain('●');
    const master = lines(portfolioPlan);
    const without = [...master.slice(0, 5), master[6].replace('  | deps=#a', ''), ...master.slice(7)];
    expect(await text()).toBe([...without.slice(0, 6), beta, ...without.slice(6)].join(''));
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('deleting a mounted task names its file: at once when nothing refers to it, and in the reference confirm', async () => {
    select(ALPHA, 7);
    press(cell(ALPHA, 7, WBS), 'Delete');
    await settle();
    expect(confirmText()).toBeNull();
    expect(status()).toBe('Deleted Build from alpha.plan.');
    expect(await text()).toBe(composedText(portfolioPlan, alpha.replace(lines(alpha)[6], '')));
    await undo();
    select(ALPHA, 6);
    press(cell(ALPHA, 6, WBS), 'Delete');
    expect(confirmText()).toBe('Delete Design from alpha.plan? Build refers to it in deps; that reference will be removed.');
    button('#editor .sheet-confirm button', 'Apply').click();
    await settle();
    expect(status()).toBe('Deleted Design from alpha.plan.');
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('a diagnostic in beta shows on its cell; its problem sits under beta’s group and focuses the row; its fix applies to beta.plan', async () => {
    // Typed in the text editor: the grid normalises `4 hours` to 4h. And beta's work column loses its units.
    editorTab('Text').click();
    await settle();
    // Found again each time: switching editors mounts a new view.
    const replace = (from: string, to: string) => {
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
      const at = view.state.doc.toString().indexOf(from);
      view.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
    };
    replace('Code    | 4d', 'Code    | 4 hours');
    replace('work:duration unit=h hpd=8 dpw=5', 'work:duration');
    await settle();
    editorTab('Grid').click();
    await settle();
    expect(cell(BETA, 8, EST).classList.contains('warning')).toBe(true);
    // The settings banner stays the root's.
    expect(document.querySelector<HTMLElement>('#editor .settings-banner')!.hidden).toBe(true);
    const list = [...document.querySelectorAll<HTMLLIElement>('#editor .problems li')];
    const heading = list.findIndex((li) => li.classList.contains('problem-file') && li.textContent === BETA);
    // Beta's group is the only one, so it has no heading (Task 35): every entry names beta.
    const entries = list.filter((li) => !li.classList.contains('problem-file'));
    expect(entries.map((li) => li.dataset.file)).toEqual([BETA, BETA, BETA, BETA]);
    const onCode = entries.find((li) => li.dataset.line === '8' && li.classList.contains('warning'))!;
    onCode.querySelector<HTMLButtonElement>('button.problem')!.click();
    await settle();
    expect(document.activeElement).toBe(cell(BETA, 8, EST));
    const settings = entries.find((li) => [...li.querySelectorAll('button.fix')].some((b) => b.textContent === 'Add unit=h hpd=8 dpw=5'))!;
    button(`#editor .problems li[data-file="${BETA}"][data-line="${settings.dataset.line}"] button.fix`, 'Add unit=h hpd=8 dpw=5').click();
    await settle();
    expect(await text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Code    | 4d', 'Code    | 4 hours')));
    editorTab('Text').click();
    await settle();
    replace('Code    | 4 hours', 'Code    | 4d');
    await settle();
    editorTab('Grid').click();
    await settle();
    expect(await text()).toBe(composedText());
  });

  it('Save writes the master and beta after an edit in each, and leaves alpha alone', async () => {
    await edit(BETA, 8, OWNER, 'ana');
    await edit(ROOT, 8, OWNER, 'pmo');
    $('save').click();
    await settle();
    expect(folder.writes.map(([path]) => path)).toEqual([ROOT, BETA]);
    expect(folder.tree['portfolio.plan']).toBe(portfolioPlan.replace('due=2026-10-23', 'due=2026-10-23 | owner=pmo'));
    expect((folder.tree.teams as Record<string, string>)['beta.plan']).toBe(beta.replace('Code    | 4d', 'Code    | 4d | ana'));
  });
});
