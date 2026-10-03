// @vitest-environment jsdom
// Task 41, in review: the default view is the highest-ranked available one (the Gantt 20, the
// schedule table 10, the tree 0), and a view the user picks is kept across files while it's
// available, remembered per viewer. Over a fake folder with a schedule file and an estimate file.
// Each test builds on the one before, as the shell is one page.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import example from '../../examples/example.plan?raw';
import { fakeFolder, fakeMemory } from '../support/fs';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-02' }));
const memory = fakeMemory();
vi.mock('../../src/app/workspace/memory', () => ({ createFolderMemory: () => memory }));
const folder = fakeFolder('Views', { 'demo.plan': demo, 'estimate.plan': example });
Object.assign(window, { showDirectoryPicker: vi.fn(async () => folder.handle) });

const settle = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200; i++) await Promise.resolve();
    vi.advanceTimersByTime(60);
  }
};
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('#renderers button')];
const shown = () => tabs().find((b) => b.classList.contains('active'))?.textContent;
const tab = (label: string) => tabs().find((b) => b.textContent === label)!;
const show = async (path: string) => {
  document.querySelector<HTMLButtonElement>(`#files button.file[data-path="${path}"]`)!.click();
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
  // A remembered view that no renderer has any more counts as no choice.
  localStorage.setItem('plan.view', 'retired');
  (await import('../../src/app/main')).boot({ document: demo });
  await settle();
  document.getElementById('open-folder')!.click();
  await settle();
});

describe('the default view', () => {
  it('a schedule file opens on the Gantt, and an estimate file on the tree', async () => {
    await show('demo.plan');
    expect(shown()).toBe('Gantt');
    expect(document.querySelector('#host .gantt')).not.toBeNull();
    await show('estimate.plan');
    expect(shown()).toBe('Tree');
    expect(tab('Gantt').disabled).toBe(true);
  });
});

describe('the view chosen', () => {
  it('picking Tree on a schedule file sticks, across files, and is remembered', async () => {
    await show('demo.plan');
    tab('Tree').click();
    await settle();
    expect(shown()).toBe('Tree');
    await show('estimate.plan');
    await show('demo.plan');
    expect(shown()).toBe('Tree');
    expect(localStorage.getItem('plan.view')).toBe('tree');
  });

  it('a chosen Gantt falls back to the tree on an estimate file, and returns on a schedule file', async () => {
    tab('Gantt').click();
    await settle();
    await show('estimate.plan');
    expect(shown()).toBe('Tree');
    // Still the choice: the fallback isn't remembered.
    expect(localStorage.getItem('plan.view')).toBe('gantt');
    await show('demo.plan');
    expect(shown()).toBe('Gantt');
  });
});
