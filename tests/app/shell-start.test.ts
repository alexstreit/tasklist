// @vitest-environment jsdom
// The start screen, templates, the wizard outside a folder, and Close (Task 40), on a real load:
// boot with no initial document. Each test builds on the one before, as the shell is one page.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ItemNode, Model } from '../../src/core';
import { critical, finish, slack, start } from '../../src/plugins/schedule/fields';
import { fakeFolder, fakeMemory } from '../support/fs';
import type { FakeFolder, Tree } from '../support/fs';
import demo from '../../examples/demo.plan?raw';
import example from '../../examples/example.plan?raw';
import alpha from '../../examples/portfolio/teams/alpha.plan?raw';
import beta from '../../examples/portfolio/teams/beta.plan?raw';
import portfolio from '../../examples/portfolio/portfolio.plan?raw';

const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));

// The last model the shell built.
let model: Model;
vi.mock('../../src/app/registry', async (original) => {
  const registry = await original<typeof import('../../src/app/registry')>();
  const analyze: typeof registry.analyze = (text, options) => (model = registry.analyze(text, options));
  return { ...registry, analyze };
});

let picked: FakeFolder;
const showDirectoryPicker = vi.fn(async () => picked.handle);
// Save As is cancelled: the test only needs to see that it was offered.
const showSaveFilePicker = vi.fn(async () => {
  throw new DOMException('The user aborted a request.', 'AbortError');
});
Object.assign(window, { showDirectoryPicker, showSaveFilePicker, showOpenFilePicker: vi.fn() });

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
const status = () => $('status').textContent;
const visible = (b: HTMLElement) => !b.hidden;
const shown = () => [...document.querySelectorAll<HTMLButtonElement>('.toolbar > button')].filter(visible).map((b) => b.textContent);
const choices = () => [...document.querySelectorAll<HTMLButtonElement>('#start button.start-choice')].filter(visible);
const choice = (label: string) => choices().find((b) => b.querySelector('.start-label')!.textContent === label)!;
const onStart = () => !$('start').hidden && $('editor').hidden && $('preview').hidden;
const dialog = () => document.querySelector('.dialog:not(.wizard) p')?.textContent ?? null;
const answer = async (label: string) => {
  [...document.querySelectorAll<HTMLButtonElement>('.dialog:not(.wizard) button')].find((b) => b.textContent === label)!.click();
  await settle();
};
const wizard = () => document.querySelector<HTMLElement>('.wizard');
const wizardButton = (label: string) => [...wizard()!.querySelectorAll<HTMLButtonElement>('.dialog-buttons button')].find((b) => b.textContent === label && !b.hidden)!;
const pickType = (name: string) => {
  const radio = wizard()!.querySelector<HTMLInputElement>(`input[value="${name}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
};
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const panelFiles = () =>
  [...document.querySelectorAll<HTMLButtonElement>('#files button.file')].map(
    (b) => b.dataset.path + [...b.querySelectorAll('.file-marker')].map((m) => ` ${m.textContent}`).join('') + (b.classList.contains('active') ? ' (active)' : ''),
  );
const ctrlS = () =>
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));
const items = (): ItemNode[] => {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
};

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12));
  (await import('../../src/app/main')).boot();
  await settle();
});

describe('the start screen', () => {
  it('shows on a real load, in place of the panes, with no Reopen while no folder is remembered', () => {
    expect(onStart()).toBe(true);
    expect(document.title).toBe('Plan');
    expect(choices().map((b) => b.querySelector('.start-label')!.textContent)).toEqual(['New plan…', 'Open folder…', 'Open file…', 'Estimate', 'Schedule', 'Portfolio']);
    expect(choices().slice(3).map((b) => b.querySelector('.start-description')!.textContent)).toEqual([
      'A feature list whose estimates roll up.',
      'A small project with dependencies, milestones and a deadline.',
      'A master plan that mounts two team plans, written into a folder you pick.',
    ]);
    // The toolbar offers only what needs no document.
    expect(shown()).toEqual(['New…', 'Open file', 'Open folder']);
    expect($('editors').hidden).toBe(true);
    expect($('files').hidden).toBe(true);
  });

  it('reaches every choice from the keyboard: each is an enabled button in order, and the first has the focus', () => {
    expect(choices().every((b) => b.tagName === 'BUTTON' && !b.disabled && b.tabIndex === 0)).toBe(true);
    expect(document.activeElement).toBe(choice('New plan…'));
  });
});

describe('single-file templates', () => {
  it('Estimate opens untitled, with the bundled example’s text exactly, and Ctrl+S offers Save As', async () => {
    choice('Estimate').click();
    await settle();
    findView();
    expect(onStart()).toBe(false);
    expect(view.state.doc.toString()).toBe(example);
    expect(document.title).toBe('Untitled — Plan');
    expect([...document.querySelectorAll<HTMLButtonElement>('.toolbar > button')].filter(visible).map((b) => b.id)).toEqual(['new', 'open', 'open-folder', 'save', 'save-as', 'refresh', 'close']);
    showSaveFilePicker.mockClear();
    ctrlS();
    await settle();
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(showSaveFilePicker.mock.calls[0]).toEqual([expect.objectContaining({ suggestedName: 'untitled.plan' })]);
    expect(document.title).toBe('Untitled — Plan');
  });

  it('Close in the single-file workspace returns to the start screen', async () => {
    $('close').click();
    await settle();
    expect(onStart()).toBe(true);
    expect(document.querySelector('.close-menu:not([hidden])')).toBeNull();
  });

  it('Schedule opens untitled, with the bundled demo’s text exactly', async () => {
    choice('Schedule').click();
    await settle();
    findView();
    expect(view.state.doc.toString()).toBe(demo);
    expect(document.title).toBe('Untitled — Plan');
    showSaveFilePicker.mockClear();
    ctrlS();
    await settle();
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
  });
});

describe('the wizard outside a folder', () => {
  it('has no name step: Schedule goes from its type to its project start, today by default', async () => {
    view.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    $('new').click();
    await settle();
    expect(wizard()!.querySelector('h2')!.textContent).toBe('New plan · Type (step 1 of 1)');
    expect([...wizard()!.querySelectorAll('.wizard-choice strong')].map((s) => s.textContent)).toEqual(['Estimate', 'Schedule']);
    pickType('schedule');
    expect(wizard()!.querySelector('h2')!.textContent).toBe('New plan · Type (step 1 of 2)');
    wizardButton('Next').click();
    expect(wizard()!.querySelector('h2')!.textContent).toBe('New plan · Project start (step 2 of 2)');
    expect(wizard()!.querySelector('#wizard-name')).toBeNull();
    expect(wizard()!.querySelector<HTMLInputElement>('#wizard-start')!.value).toBe('2026-10-02');
  });

  it('asks about unsaved changes after Create; Cancel changes nothing', async () => {
    wizardButton('Create').click();
    await settle();
    expect(wizard()).toBeNull();
    expect(dialog()).toBe('Untitled has unsaved changes.');
    await answer('Cancel');
    expect(view.state.doc.toString()).toBe(`// edited\n${demo}`);
    expect(document.title).toBe('● Untitled — Plan');
  });

  it('Discard and continue opens the new plan untitled', async () => {
    $('new').click();
    await settle();
    pickType('schedule');
    wizardButton('Next').click();
    wizardButton('Create').click();
    await settle();
    await answer('Discard and continue');
    findView();
    expect(view.state.doc.toString()).toBe('---\nprofile: schedule\nproject-start: 2026-10-02\n---\n');
    expect(document.title).toBe('Untitled — Plan');
  });

  it('Estimate is one step, and Escape closes the wizard with nothing changed', async () => {
    $('new').click();
    await settle();
    expect(wizardButton('Create')).toBeDefined();
    wizard()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(wizard()).toBeNull();
    $('new').click();
    await settle();
    wizardButton('Create').click();
    await settle();
    findView();
    expect(view.state.doc.toString()).toBe('---\nprofile: plan\n---\n');
  });
});

describe('the Portfolio template', () => {
  /** A folder whose listing doesn't show `name`, though it is there: a file that appeared after the listing. */
  const hiding = (tree: Tree, name: string): Tree => new Proxy(tree, { ownKeys: (t) => Reflect.ownKeys(t).filter((k) => k !== name) });
  const remembered = async () => (await memory.load())?.handle ?? null;
  const toStart = async () => {
    $('close').click();
    $('close-folder').click();
    await settle();
    expect(onStart()).toBe(true);
  };

  it('a dismissed picker writes nothing and remembers nothing', async () => {
    $('close').click();
    await settle();
    showDirectoryPicker.mockRejectedValueOnce(new DOMException('The user aborted a request.', 'AbortError'));
    choice('Portfolio').click();
    await settle();
    expect(onStart()).toBe(true);
    expect(await remembered()).toBeNull();
  });

  it('an open that fails remembers nothing: the first file blocked in an empty folder leaves no plan files', async () => {
    picked = fakeFolder('Blocked', hiding({ 'portfolio.plan': 'Mine\n' }, 'portfolio.plan'));
    choice('Portfolio').click();
    await settle();
    expect(picked.writes).toEqual([]);
    expect(status()).toBe("portfolio.plan already exists, so the template wasn't written. No plan files in folder");
    expect(onStart()).toBe(true);
    expect(await remembered()).toBeNull();
  });

  it('a create blocked partway keeps what was written, names the file, and opens the folder as Open folder would', async () => {
    picked = fakeFolder('Partial', { teams: hiding({ 'beta.plan': 'Theirs\n' }, 'beta.plan') });
    choice('Portfolio').click();
    await settle();
    expect(picked.writes).toEqual([
      ['portfolio.plan', portfolio],
      ['teams/alpha.plan', alpha],
    ]);
    expect((picked.tree.teams as Tree)['beta.plan']).toBe('Theirs\n');
    expect(status()).toBe("teams/beta.plan already exists, so the template wasn't fully written. Opened the folder instead.");
    // The first top-level file.
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(await remembered()).toBe(picked.handle);
    await toStart();
    expect(choices()[0].querySelector('.start-label')!.textContent).toBe('Reopen Partial');
  });

  it('into a folder that already has teams/alpha.plan, writes nothing, names that file, and opens the folder as Open folder would', async () => {
    picked = fakeFolder('Taken', { teams: { 'alpha.plan': 'Alpha\n' } });
    choice('Portfolio').click();
    await settle();
    expect(picked.writes).toEqual([]);
    expect(status()).toBe("teams/alpha.plan already exists, so the template wasn't written. Opened the folder instead.");
    // No top-level file, so the first listed.
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect(panelFiles()).toEqual(['teams/alpha.plan (active)']);
    expect(await remembered()).toBe(picked.handle);
    await toStart();
  });

  it('writes its three files with their relative paths into an empty folder, and opens it with portfolio.plan active', async () => {
    picked = fakeFolder('Portfolio', {});
    choice('Portfolio').click();
    await settle();
    expect(picked.writes).toEqual([
      ['portfolio.plan', portfolio],
      ['teams/alpha.plan', alpha],
      ['teams/beta.plan', beta],
    ]);
    expect(onStart()).toBe(false);
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(status()).toBe('Opened portfolio.plan');
    expect(panelFiles()).toEqual(['portfolio.plan (active)', 'teams/alpha.plan', 'teams/beta.plan']);
    expect(await memory.load()).toEqual({ handle: picked.handle, active: 'portfolio.plan' });
  });

  it('schedules as Task 35’s hand-worked table says', () => {
    // Copied from the table in TASKS.md, Task 35: start, finish, slack and critical, in hours from Mon 5 Oct.
    const table: Record<string, [number, number, number, boolean]> = {
      'Product A': [16, 56, 0, true],
      Design: [16, 32, 0, true],
      Build: [32, 56, 0, true],
      'Product B': [56, 88, 0, true],
      Spec: [56, 64, 24, false],
      Code: [56, 88, 0, true],
      Tradeshow: [88, 88, 0, true],
    };
    expect(items().map((n) => n.title)).toEqual(Object.keys(table));
    expect(Object.fromEntries(items().map((n) => [n.title, [model.get(n, start)!.effective, model.get(n, finish), model.get(n, slack), model.get(n, critical)]]))).toEqual(table);
  });
});

describe('Close', () => {
  const closeFile = () => $('close-file');

  it('Close file is disabled, saying to use Close folder, while no other file would stay open', () => {
    $('close').click();
    expect(document.querySelector('.close-menu')!.hasAttribute('hidden')).toBe(false);
    expect([...document.querySelectorAll('.close-menu button')].map((b) => b.textContent)).toEqual(['Close file', 'Close folder']);
    expect(closeFile().disabled).toBe(true);
    expect(closeFile().title).toBe('This is the only open file; use Close folder.');
    $('close').click();
    expect(document.querySelector('.close-menu')!.hasAttribute('hidden')).toBe(true);
  });

  it('Close file with two open files makes the other active', async () => {
    panelFile('teams/alpha.plan').click();
    await settle();
    expect(document.title).toBe('teams/alpha.plan — Plan');
    expect(closeFile().disabled).toBe(false);
    closeFile().click();
    await settle();
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(status()).toBe('Closed teams/alpha.plan');
    // The master still shows alpha as its segment.
    findView();
    expect(view.state.doc.toString()).toContain('Design {#design}');
    expect(closeFile().disabled).toBe(true);
  });

  it('with unsaved changes in a mounted file, Close file lists that file, and Cancel changes nothing', async () => {
    panelFile('teams/alpha.plan').click();
    await settle();
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    const at = view.state.doc.toString().indexOf('Spec    | 1d') + 'Spec    | '.length;
    view.dispatch({ changes: { from: at, to: at + 1, insert: '2' } });
    await settle();
    expect(panelFiles()).toEqual(['portfolio.plan (active)', 'teams/alpha.plan', 'teams/beta.plan ●']);
    closeFile().click();
    await settle();
    expect(dialog()).toBe('beta.plan has unsaved changes.');
    await answer('Cancel');
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(panelFiles()).toEqual(['portfolio.plan (active)', 'teams/alpha.plan', 'teams/beta.plan ●']);
    expect(view.state.doc.toString()).toContain('Spec    | 2d');
  });

  it('Close folder lists it too; Discard and continue returns to the start screen, which offers Reopen', async () => {
    $('close-folder').click();
    await settle();
    expect(dialog()).toBe('beta.plan has unsaved changes.');
    await answer('Discard and continue');
    expect(onStart()).toBe(true);
    expect(document.title).toBe('Plan');
    expect(choices()[0].querySelector('.start-label')!.textContent).toBe('Reopen Portfolio');
    expect(shown()).toEqual(['New…', 'Open file', 'Open folder', 'Reopen Portfolio']);
    expect(picked.tree.teams).toEqual({ 'alpha.plan': alpha, 'beta.plan': beta });
  });

  it('Reopen from the start screen opens the folder again', async () => {
    choice('Reopen Portfolio').click();
    await settle();
    expect(onStart()).toBe(false);
    expect(document.title).toBe('portfolio.plan — Plan');
  });
});
