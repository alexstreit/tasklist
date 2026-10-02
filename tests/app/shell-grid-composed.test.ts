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

// Beside the portfolio: gamma, a plan mounted nowhere, and loop, which mounts the master (Mount plan…, Task 37).
const gamma = '---\nprofile: plan\n---\nGamma task | 1d\n';
const loop = 'Loop | mount=../portfolio.plan\n';
const folder = fakeFolder('Portfolio', { 'portfolio.plan': portfolioPlan, teams: { 'alpha.plan': alpha, 'beta.plan': beta, 'gamma.plan': gamma, 'loop.plan': loop } });
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
      const kind = tr.classList.contains('front-matter') ? 'settings' : tr.classList.contains('item') ? `${tr.cells[0].textContent} ${own(tr.querySelector('td.title')!)}` : 'comment';
      return `${tr.dataset.file}:${tr.dataset.line} ${kind}${tr.classList.contains('mounted') ? ' (mounted)' : ''}`;
    });
    expect(shown).toEqual([
      'portfolio.plan:1 settings',
      'portfolio.plan:5 comment',
      'portfolio.plan:6 1 Product A',
      'teams/alpha.plan:1 settings (mounted)',
      'teams/alpha.plan:5 comment (mounted)',
      'teams/alpha.plan:6 1.1 Design (mounted)',
      'teams/alpha.plan:7 1.2 Build (mounted)',
      'portfolio.plan:7 2 Product B',
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
    // Beta's settings, comment, Spec and Code.
    expect(gridRows().filter((tr) => tr.dataset.file === BETA)).toHaveLength(4);
    expect(await text()).toBe(composedText());
  });

  it('a segment’s mount row is its header: badge, unsaved marker, Open and Unmount, out of the tab order (Task 37, after the browser pass)', async () => {
    expect(document.querySelectorAll('#editor tr.segment-header')).toHaveLength(0);
    const productA = row(ROOT, 6);
    expect(productA.classList.contains('segment-mount')).toBe(true);
    expect(productA.classList.contains('mounted')).toBe(false);
    const parts = () => [...cell(ROOT, 7, TITLE).children].map((el) => `${el.className}:${el.textContent}:${(el as HTMLElement).tabIndex}`);
    expect(parts()).toEqual(['file-badge:beta.plan:-1', 'segment-action:Open:-1', 'segment-action:Unmount:-1']);
    // An edit in beta marks Product B, after its badge; undoing it clears the mark.
    await edit(BETA, 8, OWNER, 'ana');
    expect(parts()).toEqual(['file-badge:beta.plan:-1', 'segment-unsaved:●:-1', 'segment-action:Open:-1', 'segment-action:Unmount:-1']);
    await undo();
    expect(parts()).toEqual(['file-badge:beta.plan:-1', 'segment-action:Open:-1', 'segment-action:Unmount:-1']);
    // The border runs from the mount row to the segment's last row; the master's next row is outside it.
    const bordered = gridRows().filter((tr) => tr.classList.contains('in-segment')).map((tr) => `${tr.dataset.file}:${tr.dataset.line}`);
    expect(bordered).toEqual([
      'portfolio.plan:6',
      'teams/alpha.plan:1',
      'teams/alpha.plan:5',
      'teams/alpha.plan:6',
      'teams/alpha.plan:7',
      'portfolio.plan:7',
      'teams/beta.plan:1',
      'teams/beta.plan:6',
      'teams/beta.plan:7',
      'teams/beta.plan:8',
    ]);
    // The row itself is still a row: its title is focusable, and edited as before.
    click(cell(ROOT, 6, TITLE), 'dblclick');
    expect(input()!.value).toBe('Product A');
    press(input()!, 'Escape');
    expect(await text()).toBe(composedText());
  });

  it('the mount row’s own master children are inside the border, unshaded', async () => {
    editorTab('Text').click();
    await settle();
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const end = view.state.doc.toString().indexOf('due=2026-10-16') + 'due=2026-10-16'.length;
    view.dispatch({ changes: { from: end, insert: '\n    Kickoff' } });
    await settle();
    editorTab('Grid').click();
    await settle();
    const kickoff = row(ROOT, 7);
    expect(own(kickoff.querySelector('td.title')!)).toBe('Kickoff');
    expect([kickoff.classList.contains('in-segment'), kickoff.classList.contains('mounted')]).toEqual([true, false]);
    await undo();
    expect(await text()).toBe(composedText());
  });

  it('ArrowDown from the row above the segment, its mount row, goes straight into the segment', () => {
    click(cell(ROOT, 6, TITLE));
    press(cell(ROOT, 6, TITLE), 'ArrowDown');
    const at = document.activeElement!.closest('tr')!;
    // Alpha's first row the place can be on: its settings row is read-only, so its comment line.
    expect([at.dataset.file, at.dataset.line]).toEqual([ALPHA, '5']);
  });

  it('the mount row’s Unmount clears its cell, and one Ctrl+Z brings the segment back', async () => {
    const unmountButton = () => button(`#editor tr[data-file="${ROOT}"][data-line="6"] .segment-action`, 'Unmount');
    click(unmountButton());
    await settle();
    expect(gridRows().some((tr) => tr.dataset.file === ALPHA)).toBe(false);
    const m = lines(portfolioPlan.replace('Product A {#a}  | mount=teams/alpha.plan | due', 'Product A {#a} | due'));
    expect(await text()).toBe([...m.slice(0, 7), beta, ...m.slice(7)].join(''));
    await undo();
    expect(await text()).toBe(composedText());
    expect(unmountButton()).toBeDefined();
  });

  it('the mount row’s Open, and its badge, make the file active', async () => {
    click(button(`#editor tr[data-file="${ROOT}"][data-line="7"] .segment-action`, 'Open'));
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

  describe('Mount plan… (Task 37, after the browser pass)', () => {
    const GAMMA = 'teams/gamma.plan';
    const picker = () => document.querySelector<HTMLElement>('#editor .mount-picker');
    const choice = (path: string) => document.querySelector<HTMLButtonElement>(`#editor .mount-choice[data-path="${path}"]`)!;
    /** Select a row and open the picker; the plans are read first. */
    async function pick(file: string, line: number): Promise<void> {
      select(file, line);
      tool(row(file, line).querySelector('.file-badge') ? 'Change mounted plan…' : 'Mount plan…').click();
      await settle();
      expect(picker()).not.toBeNull();
    }

    it('mounting teams/beta.plan on a new master row composes it, and one Ctrl+Z undoes it', async () => {
      // Beta is shown under Product B, where it would be an overlap: Product B unmounts it first.
      select(ROOT, 7);
      tool('Unmount').click();
      await settle();
      const adder = document.querySelector<HTMLInputElement>('#editor tr.new-task input')!;
      adder.value = 'Launch';
      press(adder, 'Enter');
      await settle();
      expect(own(cell(ROOT, 9, TITLE))).toBe('Launch');
      // CodeMirror's history joins adjacent edits made within 500ms; a person takes longer than the fake clock.
      vi.advanceTimersByTime(600);
      await pick(ROOT, 9);
      expect(tool('Change mounted plan…')).toBeUndefined();
      expect(choice(BETA).disabled).toBe(false);
      choice(BETA).click();
      await settle();
      expect(picker()).toBeNull();
      expect(await text()).toContain(`Launch | mount=teams/beta.plan\n${beta}`);
      expect(gridRows().filter((tr) => tr.dataset.file === BETA)).toHaveLength(4);
      await undo();
      expect(await text()).not.toContain('mount=teams/beta.plan');
      expect(own(cell(ROOT, 9, TITLE))).toBe('Launch');
      // The new row, then Product B's unmount.
      await undo(2);
      expect(await text()).toBe(composedText());
    });

    it('changes a mount’s path: Product B mounts gamma instead of beta, and one Ctrl+Z restores it', async () => {
      await pick(ROOT, 7);
      expect(document.querySelector('#editor .mount-picker-heading')!.textContent).toBe('Change the plan mounted on Product B');
      // What Product B shows now is no overlap, but choosing it changes nothing.
      expect([choice(BETA).disabled, choice(BETA).title]).toEqual([true, 'This row mounts it already.']);
      choice(GAMMA).click();
      await settle();
      const now = await text();
      expect(now).toContain('Product B {#b}  | mount=teams/gamma.plan  | deps=#a\n---\nprofile: plan\n---\nGamma task | 1d\n');
      expect(gridRows().some((tr) => tr.dataset.file === BETA)).toBe(false);
      expect(gridRows().some((tr) => tr.dataset.file === GAMMA)).toBe(true);
      await undo();
      expect(await text()).toBe(composedText());
    });

    it('disables the row’s own file, a file that would make a loop, and one mounted elsewhere, each with its reason', async () => {
      await pick(ALPHA, 6);
      const offered = [...document.querySelectorAll<HTMLButtonElement>('#editor .mount-choice')].map((b) => [b.dataset.path, b.disabled ? b.title : 'enabled']);
      expect(offered).toEqual([
        ['portfolio.plan', 'portfolio.plan mounts this file, directly or through other files'],
        [ALPHA, "teams/alpha.plan is this row's own file; a file can't mount itself"],
        [BETA, 'teams/beta.plan is already mounted elsewhere in the plan'],
        [GAMMA, 'enabled'],
        ['teams/loop.plan', 'teams/loop.plan mounts this file, directly or through other files'],
      ]);
      // The filter narrows the list; Escape closes it and writes nothing.
      const filter = picker()!.querySelector<HTMLInputElement>('input')!;
      filter.value = 'gam';
      filter.dispatchEvent(new Event('input'));
      expect([...document.querySelectorAll<HTMLLIElement>('#editor .mount-picker li')].filter((li) => !li.hidden).map((li) => li.textContent)).toEqual([GAMMA]);
      press(filter, 'Escape');
      expect(picker()).toBeNull();
      expect(await text()).toBe(composedText());
    });

    it('a nested mount from a row in alpha is written relative to alpha', async () => {
      await pick(ALPHA, 7);
      choice(GAMMA).click();
      await settle();
      expect(await text()).toBe(
        composedText(portfolioPlan, alpha.replace('Build               | 3d | deps=#design\n', `Build               | 3d | deps=#design | mount=gamma.plan\n${gamma}`)),
      );
      // Gamma is shown two mounts deep.
      expect(row(GAMMA, 4).classList.contains('segment-depth-2')).toBe(true);
      await undo();
      expect(await text()).toBe(composedText());
    });
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
