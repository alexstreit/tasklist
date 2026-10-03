// @vitest-environment jsdom
// The new plan wizard in a folder (Task 40): it creates the file through the workspace, which becomes
// active, or mounts it under the selected row as one undo step, with the master still active.
// Each test builds on the one before, as the shell is one page.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ItemNode, Model } from '../../src/core';
import { fakeFolder, fakeMemory } from '../support/fs';
import alpha from '../../examples/portfolio/teams/alpha.plan?raw';

const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));

// The last model the shell built.
let model: Model;
vi.mock('../../src/app/registry', async (original) => {
  const registry = await original<typeof import('../../src/app/registry')>();
  const analyze: typeof registry.analyze = (text, options) => (model = registry.analyze(text, options));
  return { ...registry, analyze };
});

// Product A mounts a team plan; Product B mounts nothing yet.
const master = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\nProduct A {#a} | mount=teams/alpha.plan\nProduct B {#b}\n';
const folder = fakeFolder('Portfolio', { 'portfolio.plan': master, teams: { 'alpha.plan': alpha } });
Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder.handle) });

let view: EditorView;
const findView = () => (view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!);
const settle = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200; i++) await Promise.resolve();
    vi.advanceTimersByTime(60);
  }
};
const $ = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.getElementById(id) as T;
const teams = () => folder.tree.teams as Record<string, string>;
const wizard = () => document.querySelector<HTMLElement>('.wizard');
const title = () => wizard()!.querySelector('h2')!.textContent;
const wizardButton = (label: string) => [...wizard()!.querySelectorAll<HTMLButtonElement>('.dialog-buttons button')].find((b) => b.textContent === label && !b.hidden)!;
const pickType = (name: string) => {
  const radio = wizard()!.querySelector<HTMLInputElement>(`input[value="${name}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
};
const setName = (name: string) => {
  const input = wizard()!.querySelector<HTMLInputElement>('#wizard-name')!;
  input.value = name;
  input.dispatchEvent(new Event('input'));
};
const setLocation = (folderPath: string) => {
  const input = wizard()!.querySelector<HTMLInputElement>('#wizard-location')!;
  input.value = folderPath;
  input.dispatchEvent(new Event('input'));
};
const notes = () => [...wizard()!.querySelectorAll('.wizard-note')].map((n) => n.textContent);
const note = () => notes()[0];
const offered = () => [...wizard()!.querySelectorAll<HTMLOptionElement>('#wizard-folders option')].map((o) => [o.value, o.label]);
const panelFile = (path: string) => document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!;
const editorTab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('#editors button')].find((b) => b.textContent === label)!;
const cursorOn = (text: string) => {
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) } });
};
const node = (title: string): ItemNode => {
  const find = (nodes: readonly ItemNode[]): ItemNode | undefined => nodes.map((n) => (n.title === title ? n : find(n.children))).find(Boolean);
  return find(model.roots)!;
};
const newPlan = async () => {
  $('new').click();
  await settle();
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
  // Open folder… on the start screen.
  [...document.querySelectorAll<HTMLButtonElement>('#start .start-choice')].find((b) => b.textContent === 'Open folder…')!.click();
  await settle();
  findView();
});

describe('the wizard in a folder', () => {
  it('Estimate at the top level creates untitled.plan with exactly the profile, and it becomes active', async () => {
    expect(document.title).toBe('portfolio.plan — Plan');
    await newPlan();
    expect(title()).toBe('New plan · Type (step 1 of 2)');
    wizardButton('Next').click();
    expect(title()).toBe('New plan · Name and location (step 2 of 2)');
    expect(wizard()!.querySelector<HTMLInputElement>('#wizard-name')!.value).toBe('untitled.plan');
    // A combobox: empty is the top level, and the folders are offered.
    const location = wizard()!.querySelector<HTMLInputElement>('#wizard-location')!;
    expect([location.value, location.placeholder, location.getAttribute('list')]).toEqual(['', "The folder's top level", 'wizard-folders']);
    expect(offered()).toEqual([
      ['.', "The folder's top level"],
      ['teams/', ''],
    ]);
    // The cursor is on the front matter, not on an item row.
    expect(wizard()!.querySelector('#wizard-mount')).toBeNull();
    wizardButton('Create').click();
    await settle();
    expect(folder.tree['untitled.plan']).toBe('---\nprofile: plan\n---\n');
    expect(document.title).toBe('untitled.plan — Plan');
    expect(panelFile('untitled.plan').classList.contains('active')).toBe(true);
    expect($('status').textContent).toBe('Created untitled.plan');
  });

  it('refuses an empty name, a /, and a name that exists in the chosen folder, each with its note', async () => {
    await newPlan();
    wizardButton('Next').click();
    const refusal = (name: string, where = '') => {
      setName(name);
      setLocation(where);
      wizardButton('Create').click();
      return [note(), title()];
    };
    const stays = 'New plan · Name and location (step 2 of 2)';
    expect(refusal('')).toEqual(['Enter a name.', stays]);
    expect(refusal('   ')).toEqual(['Enter a name.', stays]);
    expect(refusal('teams/x')).toEqual(["A name can't contain /.", stays]);
    expect(refusal('untitled')).toEqual(['untitled.plan already exists.', stays]);
    expect(refusal('alpha.plan', 'teams/')).toEqual(['teams/alpha.plan already exists.', stays]);
    // Typing clears the note.
    setName('alpha2');
    expect(note()).toBe('');
    // The location must be relative, with no .. and no empty parts; its note is beside it.
    const where = (typed: string) => (setLocation(typed), wizardButton('Create').click(), [notes()[1], title()]);
    expect(where('/teams')).toEqual(['The location must be relative to the folder.', stays]);
    expect(where('teams/../..')).toEqual(["The location can't go up a folder (..).", stays]);
    expect(where('..')).toEqual(["The location can't go up a folder (..).", stays]);
    expect(where('teams//deep')).toEqual(["The location can't have empty parts.", stays]);
    // `.` and a trailing / are fine: alpha.plan exists at teams/.
    expect(refusal('alpha', 'teams')).toEqual(['teams/alpha.plan already exists.', stays]);
    expect(refusal('untitled', '.')).toEqual(['untitled.plan already exists.', stays]);
    wizardButton('Cancel').click();
    await settle();
    expect(wizard()).toBeNull();
    expect(Object.keys(teams())).toEqual(['alpha.plan']);
  });

  it('Schedule in teams/ creates the file with project-start set to today', async () => {
    await newPlan();
    pickType('schedule');
    wizardButton('Next').click();
    setName('gamma');
    setLocation('teams/');
    wizardButton('Next').click();
    expect(title()).toBe('New plan · Project start (step 3 of 3)');
    wizardButton('Create').click();
    await settle();
    expect(teams()['gamma.plan']).toBe('---\nprofile: schedule\nproject-start: 2026-10-02\n---\n');
    expect(document.title).toBe('teams/gamma.plan — Plan');
  });

  it('creates a typed folder that doesn’t exist yet, teams/gamma, and lists it next time', async () => {
    await newPlan();
    wizardButton('Next').click();
    expect(offered().map(([value]) => value)).toEqual(['.', 'teams/']);
    setName('epsilon');
    setLocation('teams/gamma');
    wizardButton('Create').click();
    await settle();
    expect(teams().gamma).toEqual({ 'epsilon.plan': '---\nprofile: plan\n---\n' });
    expect(document.title).toBe('teams/gamma/epsilon.plan — Plan');
    await newPlan();
    wizardButton('Next').click();
    expect(offered().map(([value]) => value)).toEqual(['.', 'teams/', 'teams/gamma/']);
    wizardButton('Cancel').click();
    await settle();
  });

  it('offers no mount box on a row that already mounts a plan', async () => {
    panelFile('portfolio.plan').click();
    await settle();
    findView();
    cursorOn('Product A');
    await settle();
    await newPlan();
    wizardButton('Next').click();
    expect(wizard()!.querySelector('#wizard-mount')).toBeNull();
    wizardButton('Cancel').click();
    await settle();
  });

  it('with the box ticked on Product B’s row in the grid, mounts the new plan under it; the master stays active', async () => {
    editorTab('Grid').click();
    await settle();
    const row = [...document.querySelectorAll<HTMLTableRowElement>('#editor tbody tr.item')].find((tr) => tr.textContent!.includes('Product B'))!;
    row.querySelector<HTMLTableCellElement>('td[data-column="-1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    await newPlan();
    wizardButton('Next').click();
    const box = wizard()!.querySelector<HTMLInputElement>('#wizard-mount')!;
    expect(box.closest('label')!.textContent).toBe(' Mount it under Product B');
    expect(box.checked).toBe(false);
    box.click();
    setName('delta');
    setLocation('teams/');
    wizardButton('Create').click();
    await settle();
    expect(teams()['delta.plan']).toBe('---\nprofile: plan\n---\n');
    expect(document.title).toBe('● portfolio.plan — Plan');
    expect(panelFile('portfolio.plan').classList.contains('active')).toBe(true);
    expect(node('Product B').composes).toBe('teams/delta.plan');
    expect(model.files.has('teams/delta.plan')).toBe(true);
    // Nothing is saved: the master on disk is as it was.
    expect(folder.tree['portfolio.plan']).toBe(master);
  });

  it('one Ctrl+Z removes the mount and leaves the file on disk', async () => {
    editorTab('Text').click();
    await settle();
    findView();
    expect(view.state.doc.toString()).toContain('Product B {#b} | mount=teams/delta.plan');
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(view.state.doc.toString()).toContain('Product B {#b}\n');
    expect(view.state.doc.toString()).not.toContain('mount=teams/delta.plan');
    expect(node('Product B').composes).toBeUndefined();
    expect(document.title).toBe('portfolio.plan — Plan');
    expect(teams()['delta.plan']).toBe('---\nprofile: plan\n---\n');
  });
});

describe('locationOf', () => {
  it('reads a typed location as a folder relative to the workspace, or refuses it', async () => {
    const { locationOf } = await import('../../src/app/wizard');
    expect(['', ' ', '.', './', 'teams', 'teams/', ' teams/gamma ', 'a/b/c/'].map(locationOf)).toEqual([
      { folder: '' },
      { folder: '' },
      { folder: '' },
      { folder: '' },
      { folder: 'teams/' },
      { folder: 'teams/' },
      { folder: 'teams/gamma/' },
      { folder: 'a/b/c/' },
    ]);
    expect(['/', '/teams', '..', 'a/../b', 'a//b', 'teams//'].map(locationOf)).toEqual([
      { refused: 'The location must be relative to the folder.' },
      { refused: 'The location must be relative to the folder.' },
      { refused: "The location can't go up a folder (..)." },
      { refused: "The location can't go up a folder (..)." },
      { refused: "The location can't have empty parts." },
      { refused: "The location can't have empty parts." },
    ]);
  });
});
