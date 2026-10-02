// @vitest-environment jsdom
// The shell with a portfolio (Tasks 35 and 36), over in-memory File System Access handles holding
// examples/portfolio/: a mount row in the single-file workspace says to open the folder; in the
// folder the views show the whole portfolio; a file badge opens its file; a team file's unsaved edit
// shows in the master without being written; and the problems list names each file. Each test builds
// on the one before, as the shell is one page.

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

let view: EditorView;
const findView = () => (view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!);
/** Lets reads finish and the debounced analyses run, twice over: a read can start another. */
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
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#host tbody tr')];
/** A cell's own text: without a muted value beside it, or a badge. */
const own = (td: HTMLTableCellElement) => td.firstChild?.textContent ?? '';
const replace = (from: string, to: string) => {
  const at = view.state.doc.toString().indexOf(from);
  view.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
};

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
  findView();
});

describe('a mount row in the single-file workspace', () => {
  it('says to open the folder, and shows no badge', async () => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Team | mount=teams/alpha.plan\n' } });
    await settle();
    editorTab('Grid').click();
    await settle();
    const problems = [...document.querySelectorAll('.problems li .message')].map((m) => m.textContent);
    expect(problems).toContain('Open the folder to see mounted plans.');
    expect(document.querySelectorAll('#host .file-badge')).toHaveLength(0);
    editorTab('Text').click();
    findView();
    view.dispatch({ changes: { from: view.state.doc.length - 'Team | mount=teams/alpha.plan\n'.length, to: view.state.doc.length } });
    await settle();
  });
});

describe('the portfolio', () => {
  it('opens the folder on portfolio.plan, and the tree shows the whole portfolio, its mounted rows shaded', async () => {
    $('open-folder').click();
    await settle();
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(rows().map((r) => `${own(r.cells[0])} ${own(r.cells[1])}`)).toEqual(['1 Product A', '1.1 Design', '1.2 Build', '2 Product B', '2.1 Spec', '2.2 Code', '3 Tradeshow']);
    expect(rows().map((r) => r.classList.contains('mounted'))).toEqual([false, true, true, false, true, true, false]);
    // 10d of work in all.
    expect(own(document.querySelector<HTMLTableCellElement>('#host tfoot td:nth-child(3)')!)).toBe('2w');
  });

  it('shows the portfolio’s schedule', async () => {
    tab('Schedule').click();
    await settle();
    expect(rows().map((r) => [own(r.cells[1]), own(r.cells[2]), own(r.cells[3])])).toEqual([
      ['Product A', 'Wed 7 Oct', 'Tue 13 Oct'],
      ['Design', 'Wed 7 Oct', 'Thu 8 Oct'],
      ['Build', 'Fri 9 Oct', 'Tue 13 Oct'],
      ['Product B', 'Wed 14 Oct', 'Mon 19 Oct'],
      ['Spec', 'Wed 14 Oct', 'Wed 14 Oct'],
      ['Code', 'Wed 14 Oct', 'Mon 19 Oct'],
      ['Tradeshow', 'Mon 19 Oct', 'Mon 19 Oct'],
    ]);
  });

  it('a click on a mounted row moves the cursor to it, in its segment (Task 36)', async () => {
    findView();
    rows()[1].click();
    await settle();
    const head = view.state.selection.main.head;
    expect(view.state.doc.lineAt(head).text).toBe('Design {#design}    | 2d');
    expect(rows().filter((r) => r.classList.contains('at-cursor')).map((r) => own(r.cells[1]))).toEqual(['Design']);
  });

  it('Open on a mount row’s badge makes its file the active file', async () => {
    const badges = [...document.querySelectorAll<HTMLButtonElement>('#host .file-badge')];
    expect(badges.map((b) => [b.textContent, b.title])).toEqual([
      ['alpha.plan', 'Open teams/alpha.plan'],
      ['beta.plan', 'Open teams/beta.plan'],
    ]);
    badges[0].click();
    await settle();
    findView();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect(view.state.doc.toString()).toBe(alpha);
  });

  it('shows a team file’s unsaved edit in the master, and writes nothing', async () => {
    replace('Build               | 3d', 'Build               | 4d');
    await settle();
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    expect(document.title).toBe('portfolio.plan — Plan');
    // Build finishes at hour 64, Wed 14 Oct; Product B runs 64–96, Thu 15 to Tue 20 Oct.
    const shown = Object.fromEntries(rows().map((r) => [own(r.cells[1]), [own(r.cells[2]), own(r.cells[3])]]));
    expect(shown.Build).toEqual(['Fri 9 Oct', 'Wed 14 Oct']);
    expect(shown['Product B']).toEqual(['Thu 15 Oct', 'Tue 20 Oct']);
    expect(folder.writes).toEqual([]);
    expect((folder.tree.teams as Record<string, string>)['alpha.plan']).toBe(alpha);
  });

  it('the problems list names each file; a mounted file’s problem focuses its row in the grid (Task 37)', async () => {
    // A row with an invalid estimate in the master, and one in alpha's unsaved text: each has the
    // invalid value, and no duration to schedule.
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Extra | 1x\n' } });
    panelFile('teams/alpha.plan').click();
    await settle();
    findView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'Test | 2 hours\n' } });
    panelFile('portfolio.plan').click();
    await settle();
    editorTab('Grid').click();
    await settle();
    const list = [...document.querySelectorAll<HTMLLIElement>('.problems li')];
    expect(list.map((li) => (li.classList.contains('problem-file') ? `# ${li.textContent}` : li.querySelector('.where')!.textContent))).toEqual([
      '# portfolio.plan',
      'Extra',
      'Extra',
      '# teams/alpha.plan',
      'Test',
      'Test',
    ]);
    const mounted = list[4];
    expect(mounted.dataset.file).toBe('teams/alpha.plan');
    mounted.querySelector<HTMLButtonElement>('button.problem')!.click();
    await settle();
    // The master stays active, and the grid's place is on Test, in alpha's segment.
    expect(document.title).toBe('● portfolio.plan — Plan');
    const focused = document.activeElement!.closest('tr')!;
    expect([focused.dataset.file, focused.querySelector('td.title')!.textContent]).toEqual(['teams/alpha.plan', 'Test']);
  });
});
