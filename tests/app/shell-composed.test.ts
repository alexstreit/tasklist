// @vitest-environment jsdom
// Task 36: the composed text editor, through the shell, on in-memory File System Access handles
// holding examples/portfolio/. The master shows alpha's and beta's text as segments; edits land in
// their files; edits across a boundary are refused; one search and one undo history cover every
// file; and Ctrl+S saves every file changed. Each test builds on the one before, as the shell is
// one page; each leaves the files as they were on disk unless it says otherwise.

import { forEachDiagnostic } from '@codemirror/lint';
import { foldable, foldEffect, foldedRanges, unfoldAll } from '@codemirror/language';
import { replaceAll, SearchQuery, setSearchQuery, findNext } from '@codemirror/search';
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
const teams = () => folder.tree.teams as Record<string, string>;

let view: EditorView;
const findView = () => (view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!);
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
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#host tbody tr')];
const own = (td: HTMLTableCellElement) => td.firstChild?.textContent ?? '';
const status = () => $('status').textContent;
const text = () => view.state.doc.toString();
const lineOf = (s: string) => view.state.doc.lineAt(text().indexOf(s));
const key = (k: string, keyCode: number, mods: KeyboardEventInit = {}) =>
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, keyCode, bubbles: true, cancelable: true, ...mods }));
const ctrlZ = () => key('z', 90, { ctrlKey: true });
const ctrlS = () => key('s', 83, { ctrlKey: true });
const altDown = () => key('ArrowDown', 40, { altKey: true });
const cursorOn = (s: string) => view.dispatch({ selection: { anchor: text().indexOf(s) } });
const replace = (from: string, to: string) => {
  const at = text().indexOf(from);
  view.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
};
const dialog = () => document.querySelector('.dialog')?.querySelector('p')?.textContent ?? null;
const choose = async (label: string) => {
  [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === label)!.click();
  await settle();
};
const lines = (s: string) => s.split(/(?<=\n)/);
/** The master's text with alpha after Product A's line and beta after Product B's. */
const composedText = (master = portfolioPlan, a = alpha, b = beta) => {
  const m = lines(master);
  return [...m.slice(0, 6), a, m[6], b, ...m.slice(7)].join('');
};

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  vi.useFakeTimers();
  (await import('../../src/app/main')).boot();
  await settle();
  $('open-folder').click();
  await settle();
  findView();
});

describe('the composed text editor', () => {
  it('shows the master’s text, with alpha’s after Product A’s line and beta’s after Product B’s', () => {
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(text()).toBe(composedText());
  });

  it('numbers each file’s lines as its own, and makes each segment’s mount line its header, with Open and Unmount (Task 37)', () => {
    const numbers = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map((e) => e.textContent).filter((t) => t !== '');
    // jsdom draws every line: the master's 1–6, alpha's 1–7, the master's 7, beta's 1–8, the master's 8, and the empty last line.
    expect(numbers.slice(1)).toEqual(['1', '2', '3', '4', '5', '6', '1', '2', '3', '4', '5', '6', '7', '7', '1', '2', '3', '4', '5', '6', '7', '8', '8', '9']);
    // Task 38: a segment's numbers are in its colour, dimmer than the root's, so alpha's 7 and the master's 7 differ.
    const inSegment = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter((e) => e.textContent !== '').slice(1).map((e) => e.classList.contains('cm-segment-gutter'));
    const root = false;
    const seg = true;
    expect(inSegment).toEqual([root, root, root, root, root, root, ...Array(7).fill(seg), root, ...Array(8).fill(seg), root, root]);
    // No block above a segment: the mount line is its header, and its controls end the line.
    expect(document.querySelectorAll('.cm-segment-header')).toHaveLength(0);
    const mounts = [...document.querySelectorAll('.cm-line.cm-segment-mount')];
    expect(mounts.map((l) => l.textContent!.slice(0, 9))).toEqual(['Product A', 'Product B']);
    expect(mounts.map((l) => l.querySelector('.cm-segment-unsaved'))).toEqual([null, null]);
    expect(mounts.map((l) => [...l.querySelectorAll<HTMLButtonElement>('.cm-segment-controls button')].map((b) => [b.textContent, b.tabIndex]))).toEqual([
      [['Open', -1], ['Unmount', -1]],
      [['Open', -1], ['Unmount', -1]],
    ]);
    // The segments' lines are shaded, at mount depth 1, and padded under their mount rows.
    const shaded = [...document.querySelectorAll<HTMLElement>('.cm-line.cm-segment-depth-1')];
    expect(shaded).toHaveLength(15);
    expect(shaded[0].style.paddingLeft).toBe('calc(4ch + 6px)');
  });

  it('the mount line’s Unmount clears its cell, and one Ctrl+Z brings the segment back; its Open makes the file active (Task 37)', async () => {
    const control = (title: string, label: string) =>
      [...[...document.querySelectorAll('.cm-line.cm-segment-mount')].find((l) => l.textContent!.startsWith(title))!.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === label,
      )!;
    control('Product B', 'Unmount').click();
    await settle();
    const m = lines(portfolioPlan.replace('Product B {#b}  | mount=teams/beta.plan  | deps', 'Product B {#b}  | deps'));
    expect(text()).toBe([...m.slice(0, 6), alpha, ...m.slice(6)].join(''));
    expect(panelFile('teams/beta.plan').textContent).not.toContain('●');
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText());
    control('Product A', 'Open').click();
    await settle();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    expect(text()).toBe(composedText());
  });

  it('highlights each line with its own file’s syntax: beta’s work column is a duration', () => {
    const code = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent === 'Code    | 4d')!;
    expect(code.querySelector('.cm-plan-duration')?.textContent).toBe('4d');
    const pin = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.startsWith('project-start: 2026-10-07'))!;
    expect(pin.querySelector('.cm-plan-front-matter')).not.toBeNull();
  });

  it('an edit in alpha’s segment changes alpha’s text only, writes nothing, and one Ctrl+Z restores it', async () => {
    replace('Build               | 3d', 'Build               | 4d');
    await settle();
    tab('Schedule').click();
    await settle();
    const shown = Object.fromEntries(rows().map((r) => [own(r.cells[1]), [own(r.cells[2]), own(r.cells[3])]]));
    // Build finishes at hour 64; Product B runs 64–96, Thu 15 to Tue 20 Oct (Task 35).
    expect(shown.Build).toEqual(['Fri 9 Oct', 'Wed 14 Oct']);
    expect(shown['Product B']).toEqual(['Thu 15 Oct', 'Tue 20 Oct']);
    expect(folder.writes).toEqual([]);
    expect(document.title).toBe('portfolio.plan — Plan');
    // Alpha's mount line, Product A's, marks it unsaved.
    expect(document.querySelector('.cm-segment-mount .cm-segment-unsaved')?.textContent).toBe('●');
    // The panel marks alpha unsaved, and not the master.
    expect(panelFile('teams/alpha.plan').textContent).toContain('●');
    expect(panelFile('portfolio.plan').textContent).not.toContain('●');
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText());
    expect(panelFile('teams/alpha.plan').textContent).not.toContain('●');
  });

  it('refuses an edit from beta’s last line into the master’s next line, and says why', async () => {
    const from = text().indexOf('Code    | 4d') + 4;
    const to = text().indexOf('^Tradeshow') + 3;
    view.dispatch({ changes: { from, to }, selection: { anchor: from } });
    await settle();
    expect(text()).toBe(composedText());
    expect(status()).toBe("Edits can't cross from one plan file into another.");
  });

  describe('line operations act on the lines of the cursor’s file (Task 37)', () => {
    const master = lines(portfolioPlan);
    /** The master with Product A and Product B swapped: beta's segment then follows B, and alpha's A. */
    const swapped = () => [...master.slice(0, 5), master[6], beta, master[5], alpha, ...master.slice(7)].join('');
    const altUp = () => key('ArrowUp', 38, { altKey: true });

    it('Alt+Down on Product A swaps it with Product B, and the segments follow; one Ctrl+Z restores it', async () => {
      cursorOn('Product A {#a}');
      altDown();
      await settle();
      expect(text()).toBe(swapped());
      // The cursor stays on the line it moved.
      expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe(master[5].trimEnd());
      ctrlZ();
      await settle();
      expect(text()).toBe(composedText());
    });

    it('Alt+Up on Product B gives the same', async () => {
      cursorOn('Product B {#b}');
      altUp();
      await settle();
      expect(text()).toBe(swapped());
      ctrlZ();
      await settle();
      expect(text()).toBe(composedText());
    });

    it('a move inside a segment is as before', async () => {
      cursorOn('Spec    | 1d');
      altDown();
      await settle();
      expect(text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Spec    | 1d\nCode    | 4d\n', 'Code    | 4d\nSpec    | 1d\n')));
      ctrlZ();
      await settle();
      expect(text()).toBe(composedText());
    });

    it('Alt+Down on a segment’s last row does nothing, as on a single file’s last line', async () => {
      $('status').textContent = '';
      cursorOn('Code    | 4d');
      altDown();
      await settle();
      expect(text()).toBe(composedText());
      expect(status()).toBe('');
    });

    it('a selection spanning the master and a segment is refused, and says why', async () => {
      $('status').textContent = '';
      const from = text().indexOf('Product A {#a}');
      view.dispatch({ selection: { anchor: from, head: text().indexOf('Design {#design}') } });
      altDown();
      expect(status()).toBe("Edits can't cross from one plan file into another.");
      $('status').textContent = '';
      key('Tab', 9);
      await settle();
      expect(text()).toBe(composedText());
      expect(status()).toBe("Edits can't cross from one plan file into another.");
    });

    it('a mount row with its own master children moves without them, as in a single file', async () => {
      // Kickoff becomes Product A's own child in the master; alpha's segment follows it.
      const end = text().indexOf('due=2026-10-16') + 'due=2026-10-16'.length;
      view.dispatch({ changes: { from: end, insert: '\n    Kickoff' } });
      await settle();
      const withChild = portfolioPlan.replace('due=2026-10-16\n', 'due=2026-10-16\n    Kickoff\n');
      const m = lines(withChild);
      expect(text()).toBe([...m.slice(0, 7), alpha, m[7], beta, ...m.slice(8)].join(''));
      cursorOn('Product A {#a}');
      altDown();
      await settle();
      // The raw line moves: Kickoff now comes first, and Product A, which has no children, is followed by alpha's segment.
      expect(text()).toBe([...m.slice(0, 5), m[6], m[5], alpha, m[7], beta, ...m.slice(8)].join(''));
      ctrlZ();
      await settle();
      expect(text()).toBe([...m.slice(0, 7), alpha, m[7], beta, ...m.slice(8)].join(''));
      ctrlZ();
      await settle();
      expect(text()).toBe(composedText());
    });
  });

  it('search finds Code in beta; replace-all changes only beta, and one undo restores it', async () => {
    const query = new SearchQuery({ search: 'Code', caseSensitive: true, replace: 'Coding' });
    view.dispatch({ effects: setSearchQuery.of(query) });
    cursorOn('---');
    findNext(view);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Code');
    expect(view.state.selection.main.from).toBe(text().indexOf('Code    | 4d'));
    replaceAll(view);
    await settle();
    expect(text()).toBe(composedText(portfolioPlan, alpha, beta.replace('Code', 'Coding')));
    expect(panelFile('teams/beta.plan').textContent).toContain('●');
    expect(panelFile('teams/alpha.plan').textContent).not.toContain('●');
    expect(panelFile('portfolio.plan').textContent).not.toContain('●');
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText());
  });

  it('search opens a folded segment to show a match', async () => {
    const productA = lineOf('Product A {#a}');
    const range = foldable(view.state, productA.from, productA.to)!;
    view.dispatch({ effects: foldEffect.of(range) });
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'Design', caseSensitive: true })) });
    cursorOn('Product A');
    findNext(view);
    let folds = 0;
    foldedRanges(view.state).between(0, view.state.doc.length, () => void folds++);
    expect(folds).toBe(0);
  });

  it('folding Product A hides alpha’s segment', () => {
    const productA = lineOf('Product A {#a}');
    const range = foldable(view.state, productA.from, productA.to)!;
    // From the end of Product A's line to the end of alpha's last line.
    expect(range).toEqual({ from: productA.to, to: text().indexOf('Build               | 3d | deps=#design') + 'Build               | 3d | deps=#design'.length });
    view.dispatch({ effects: foldEffect.of(range) });
    expect([...document.querySelectorAll('.cm-line')].some((l) => l.textContent === 'Design {#design}    | 2d')).toBe(false);
    unfoldAll(view);
  });

  it('a click on Code in the schedule table moves the cursor to Code in beta’s segment', async () => {
    rows().find((r) => own(r.cells[1]) === 'Code')!.click();
    await settle();
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('Code    | 4d');
    expect(rows().filter((r) => r.classList.contains('at-cursor')).map((r) => own(r.cells[1]))).toEqual(['Code']);
  });

  it('shows a mounted file’s diagnostic in its segment, and its fix goes to that file', async () => {
    replace('project-start: 2026-10-07', 'project-start: 2026-02-30');
    await settle();
    const found: { from: number; message: string; fix?: string }[] = [];
    forEachDiagnostic(view.state, (d, from) => found.push({ from, message: d.message, fix: d.actions?.[0]?.name }));
    const at = text().indexOf('2026-02-30');
    const pin = found.find((d) => d.from >= lineOf('2026-02-30').from && d.from <= at)!;
    expect(pin.fix).toMatch(/^Set project start to /);
    let diagnostic: { actions?: readonly { apply(view: EditorView, from: number, to: number): void }[] } | null = null;
    forEachDiagnostic(view.state, (d, from) => {
      if (from === pin.from) diagnostic = d;
    });
    diagnostic!.actions![0].apply(view, 0, 0);
    await settle();
    expect(text()).not.toContain('2026-02-30');
    expect(lineOf('Team Alpha').number).toBeGreaterThan(lineOf('project-start: 2').number);
    ctrlZ();
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText());
  });

  it('an edit made in the composed view reaches alpha’s own buffer, outside its undo history', async () => {
    replace('Design {#design}    | 2d', 'Design {#design}    | 3d');
    await settle();
    panelFile('teams/alpha.plan').click();
    await settle();
    findView();
    expect(document.title).toBe('● teams/alpha.plan — Plan');
    expect(text()).toBe(alpha.replace('| 2d', '| 3d'));
    // Alpha's own undo history has none of it.
    ctrlZ();
    expect(text()).toBe(alpha.replace('| 2d', '| 3d'));
  });

  it('an unsaved edit made in alpha’s own view shows in the master', async () => {
    replace('Build               | 3d', 'Build               | 5d');
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    expect(text()).toBe(composedText(portfolioPlan, alpha.replace('| 2d', '| 3d').replace('| 3d | deps', '| 5d | deps')));
    // The master's history holds its own edit of Design, not alpha's of Build.
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText(portfolioPlan, alpha.replace('| 3d | deps', '| 5d | deps')));
    panelFile('teams/alpha.plan').click();
    await settle();
    findView();
    ctrlZ();
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    expect(text()).toBe(composedText());
  });

  it('typing a mount on a new master row composes its file in; undo removes the segment and the cell together', async () => {
    replace(' | mount=teams/beta.plan ', ' ');
    await settle();
    const master = portfolioPlan.replace(' | mount=teams/beta.plan ', ' ');
    expect(text()).toBe([...lines(master).slice(0, 6), alpha, ...lines(master).slice(6)].join(''));
    view.dispatch({ changes: { from: text().length, insert: 'Team B | mount=teams/beta.plan\n' } });
    await settle();
    expect(text()).toBe([...lines(master).slice(0, 6), alpha, ...lines(master).slice(6), 'Team B | mount=teams/beta.plan\n', beta].join(''));
    ctrlZ();
    await settle();
    expect(text()).toBe([...lines(master).slice(0, 6), alpha, ...lines(master).slice(6)].join(''));
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText());
  });

  it('beta changed on disk while clean: focusing the window updates its segment, and an earlier edit in alpha can still be undone', async () => {
    replace('Design {#design}    | 2d', 'Design {#design}    | 1d');
    await settle();
    teams()['beta.plan'] = beta.replace('Spec    | 1d', 'Spec    | 2d');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(text()).toBe(composedText(portfolioPlan, alpha.replace('| 2d', '| 1d'), teams()['beta.plan']));
    ctrlZ();
    await settle();
    expect(text()).toBe(composedText(portfolioPlan, alpha, teams()['beta.plan']));
    teams()['beta.plan'] = beta;
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(text()).toBe(composedText());
  });

  it('Ctrl+S saves the master and beta after an edit in each, each checked on disk, and leaves alpha alone', async () => {
    replace('^Tradeshow      ', '^Trade show     ');
    replace('Code    | 4d', 'Code    | 5d');
    await settle();
    folder.writes.length = 0;
    // Beta changed on disk meanwhile: saving it asks, and Keep leaves it unwritten.
    teams()['beta.plan'] = `${beta}// changed outside\n`;
    ctrlS();
    await settle();
    expect(dialog()).toBe('beta.plan changed on disk since you opened it. Overwrite it, or keep your changes unsaved?');
    await choose('Keep');
    expect(folder.writes.map(([path]) => path)).toEqual(['portfolio.plan']);
    teams()['beta.plan'] = beta;
    ctrlS();
    await settle();
    expect(dialog()).toBeNull();
    expect(folder.writes.map(([path]) => path)).toEqual(['portfolio.plan', 'portfolio.plan', 'teams/beta.plan']);
    expect(teams()['beta.plan']).toBe(beta.replace('Code    | 4d', 'Code    | 5d'));
    expect(teams()['alpha.plan']).toBe(alpha);
    expect(status()).toBe('Saved portfolio.plan and beta.plan');
  });
});
