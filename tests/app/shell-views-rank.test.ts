// @vitest-environment jsdom
// Task 41, in review: with no view chosen, the highest-ranked available view is picked when a file is
// opened or becomes active, not on every analysis. Within a file the view shown stays while it can.
// Over a fake folder with an estimate file and a schedule file; nothing is ever chosen here.

import { EditorView } from '@codemirror/view';
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
  localStorage.clear();
  (await import('../../src/app/main')).boot({ document: example });
  await settle();
  document.getElementById('open-folder')!.click();
  await settle();
});

describe('the view, with none chosen', () => {
  it('stays on the Tree while project-start is typed into an estimate file, character by character', async () => {
    await show('estimate.plan');
    expect(shown()).toBe('Tree');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    // After `profile: plan`, before the closing ---.
    let at = view.state.doc.line(3).from;
    for (const ch of 'project-start: 2026-10-05\n') {
      view.dispatch({ changes: { from: at, insert: ch }, userEvent: 'input.type' });
      at += 1;
      await settle();
      expect(shown()).toBe('Tree');
    }
    // The Gantt can show it now; it just isn't picked within the file.
    expect(view.state.doc.line(3).text).toBe('project-start: 2026-10-05');
    expect(tab('Gantt').disabled).toBe(false);
    expect(localStorage.getItem('plan.view')).toBeNull();
  });

  it('switching back to the file then shows the Gantt', async () => {
    await show('demo.plan');
    expect(shown()).toBe('Gantt');
    await show('estimate.plan');
    expect(shown()).toBe('Gantt');
  });

  it('within a file, a view that becomes unavailable falls back by rank', async () => {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const line = view.state.doc.line(3);
    view.dispatch({ changes: { from: line.from, to: line.to + 1 }, userEvent: 'delete' });
    await settle();
    expect(shown()).toBe('Tree');
  });
});
