// @vitest-environment jsdom
// Task 41: the filter box in the shell. On examples/demo.plan, `carol` shows UX wireframes, Web app,
// User guide and Training, with Design, Build and Docs dimmed (Task 41's table); every pane follows
// it, through the shell. Then the portfolio folder: switching files clears it, and so does closing.
// Each test builds on the one before, as the shell is one page.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import alpha from '../../examples/portfolio/teams/alpha.plan?raw';
import beta from '../../examples/portfolio/teams/beta.plan?raw';
import portfolioPlan from '../../examples/portfolio/portfolio.plan?raw';
import { fakeFolder, fakeMemory } from '../support/fs';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-02' }));
const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));
const folder = fakeFolder('Portfolio', { 'portfolio.plan': portfolioPlan, teams: { 'alpha.plan': alpha, 'beta.plan': beta } });
Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder.handle) });

const TITLES = ['Design', 'UX wireframes', 'Build', 'Web app', 'Docs', 'User guide', 'Training'];
const SHOWN = [11, 13, 15, 17, 27, 28, 29];

let view: EditorView;
const findView = () => (view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!);
const settle = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200; i++) await Promise.resolve();
    vi.advanceTimersByTime(60);
  }
};
const $ = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.getElementById(id) as T;
const box = () => $<HTMLInputElement>('filter');
const count = () => document.querySelector('.filter-count')!.textContent;
const button = (selector: string, label: string) => [...document.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === label)!;
const tab = (label: string) => button('#renderers button', label);
const editorTab = (label: string) => button('#editors button', label);
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#host tbody tr')];
const own = (td: HTMLTableCellElement) => td.firstChild?.textContent ?? '';
/** The text editor's shown lines, each by its title (or its text, for a line with no cells). */
const editorTitles = () => [...view.contentDOM.querySelectorAll('.cm-line')].map((l) => l.textContent!.trim().split(/ {2,}| \{| \|/)[0]);
const dimmedInEditor = () => [...view.contentDOM.querySelectorAll('.cm-line.cm-filter-context')].map((l) => l.textContent!.trim().split(' {')[0]);
const filter = async (query: string) => {
  box().value = query;
  box().dispatchEvent(new Event('input'));
  await settle();
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  vi.useFakeTimers();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
  (await import('../../src/app/main')).boot({ document: demo });
  await settle();
  findView();
});

describe('the filter box', () => {
  it('is at the toolbar’s right end, after the status line, while a document is open; empty, with no count', () => {
    expect($('filename').parentElement!.lastElementChild).toBe(box().parentElement);
    expect($('status').compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box().parentElement!.hidden).toBe(false);
    expect([box().value, count()]).toEqual(['', '']);
    expect(editorTitles()).toHaveLength(30);
  });

  it('carol: Showing 4 of 23 tasks; the text editor and the tree show only the matches and their ancestors, the ancestors dimmed', async () => {
    tab('Tree').click();
    await settle();
    const total = document.querySelector('#host tfoot')!.textContent;
    await filter('carol');
    expect(count()).toBe('Showing 4 of 23 tasks');
    expect(editorTitles()).toEqual(TITLES);
    expect(dimmedInEditor()).toEqual(['Design', 'Build', 'Docs']);
    expect(rows().map((r) => own(r.cells[1]))).toEqual(TITLES);
    expect(rows().filter((r) => r.classList.contains('filter-context')).map((r) => own(r.cells[1]))).toEqual(['Design', 'Build', 'Docs']);
    // Display only: the total still sums the whole plan.
    expect(document.querySelector('#host tfoot')!.textContent).toBe(total);
  });

  it('the schedule table and the Gantt show the same rows, and the schedule is what it is unfiltered', async () => {
    tab('Schedule').click();
    await settle();
    const filtered = rows().map((r) => [Number(r.dataset.line), r.textContent]);
    expect(filtered.map(([line]) => line)).toEqual(SHOWN);
    tab('Gantt').click();
    await settle();
    expect([...document.querySelectorAll<HTMLElement>('#host .gantt-row')].map((r) => Number(r.dataset.line)).sort((a, b) => a - b)).toEqual(SHOWN);
    // Unfiltered, the schedule table's rows for those lines read the same.
    key(box(), 'Escape');
    await settle();
    tab('Schedule').click();
    await settle();
    expect(rows()).toHaveLength(23);
    expect(rows().filter((r) => SHOWN.includes(Number(r.dataset.line))).map((r) => [Number(r.dataset.line), r.textContent])).toEqual(filtered);
  });

  it('the grid draws only the filter’s rows, keeps the new-task row, and labels its total "Total (all rows)"', async () => {
    editorTab('Grid').click();
    await settle();
    const total = () => [...document.querySelectorAll('#editor tfoot td')].map((td) => td.textContent);
    const unfiltered = total();
    expect(unfiltered).toContain('Total');
    await filter('carol');
    const body = [...document.querySelectorAll<HTMLTableRowElement>('#editor tbody tr')];
    expect(body.map((tr) => (tr.classList.contains('new-task') ? 'new-task' : tr.querySelector('td.title')!.textContent))).toEqual([...TITLES, 'new-task']);
    expect(body.filter((tr) => tr.classList.contains('filter-context')).map((tr) => tr.querySelector('td.title')!.textContent)).toEqual(['Design', 'Build', 'Docs']);
    expect(total()).toEqual(unfiltered.map((text) => (text === 'Total' ? 'Total (all rows)' : text)));
    editorTab('Text').click();
    await settle();
    findView();
    expect(editorTitles()).toEqual(TITLES);
  });

  it('in the grid, a problem on a hidden row is marked; clicking it clears the box, and its row has the focus', async () => {
    editorTab('Grid').click();
    await settle();
    await filter('carol');
    const goLive = [...document.querySelectorAll<HTMLLIElement>('#editor .problems li')].find((li) => li.querySelector('.where')?.textContent === 'Go-live')!;
    expect(goLive.querySelector('.filter-hidden')?.textContent).toBe('hidden by filter');
    goLive.querySelector<HTMLButtonElement>('button.problem')!.click();
    await settle();
    expect([box().value, count()]).toEqual(['', '']);
    expect(document.activeElement!.closest('tr')!.dataset.line).toBe('26');
    expect(rows()).toHaveLength(23);
    editorTab('Text').click();
    await settle();
    findView();
  });

  it('Esc in the box clears the filter and returns focus to the editor; the ✕ clears it too', async () => {
    view.focus();
    box().focus();
    key(box(), 'Escape');
    await settle();
    expect([box().value, count()]).toEqual(['', '']);
    expect(editorTitles()).toHaveLength(30);
    expect(document.activeElement).toBe(view.contentDOM);
    await filter('carol');
    $('filter-clear').click();
    await settle();
    expect([box().value, count()]).toEqual(['', '']);
    expect(editorTitles()).toHaveLength(30);
  });

  it('Ctrl+Shift+F focuses the box', () => {
    view.focus();
    key(view.contentDOM, 'F', { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(box());
  });

  it('keeps Web app shown while its title is edited to "Mobile app" under `carol web`; Enter recomputes, and it goes with Build', async () => {
    await filter('carol web');
    expect(count()).toBe('Showing 1 of 23 tasks');
    expect(editorTitles()).toEqual(['Build', 'Web app']);
    const line = view.state.doc.line(17);
    const from = line.from + line.text.indexOf('Web app');
    view.dispatch({ changes: { from, to: from + 'Web app'.length, insert: 'Mobile app' }, userEvent: 'input.type' });
    await settle();
    expect(editorTitles()).toEqual(['Build', 'Mobile app']);
    expect(rows().map((r) => own(r.cells[1]))).toEqual(['Build', 'Mobile app']);
    expect(count()).toBe('Showing 1 of 23 tasks');
    key(box(), 'Enter');
    await settle();
    expect(count()).toBe('Showing 0 of 23 tasks');
    expect(editorTitles()).toEqual([]);
    expect(rows()).toEqual([]);
    key(box(), 'Escape');
    await settle();
  });
});

describe('in a folder', () => {
  it('filters the composition: code shows Code in beta, with Product B dimmed: Showing 1 of 7 tasks', async () => {
    $('open-folder').click();
    await settle();
    // The edit above is unsaved: discard it.
    button('.dialog button', 'Discard and continue')?.click();
    await settle();
    findView();
    expect(document.title).toBe('portfolio.plan — Plan');
    await filter('code');
    expect(count()).toBe('Showing 1 of 7 tasks');
    expect(editorTitles()).toEqual(['Product B', 'Code']);
    expect(dimmedInEditor()).toEqual(['Product B']);
  });

  it('switching the active file clears the filter', async () => {
    panelFile('teams/alpha.plan').click();
    await settle();
    findView();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect([box().value, count()]).toEqual(['', '']);
    expect(view.contentDOM.querySelectorAll('.cm-line')).toHaveLength(alpha.split('\n').length);
  });

  it('closing clears it, and the box goes with the document', async () => {
    await filter('build');
    expect(count()).toBe('Showing 1 of 2 tasks');
    $('close').click();
    button('.close-menu button', 'Close folder').click();
    await settle();
    expect([box().value, count()]).toEqual(['', '']);
    expect(box().parentElement!.hidden).toBe(true);
  });
});
