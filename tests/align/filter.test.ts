// @vitest-environment jsdom
// Task 41: every pane filtered by `carol` on examples/demo.plan shows exactly the matches (UX
// wireframes, Web app, User guide, Training) and their ancestors (Design, Build, Docs), dimmed; and
// the Gantt following each editor stays level with it. Injected measurements (tests/support/layout.ts).

import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import { connectPanes, followerChannel } from '../../src/app/align';
import { trackFilter } from '../../src/app/filter';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { filterRows } from '../../src/core';
import type { Model, RenderContext, Visible } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import { mountGrid } from '../../src/grid';
import { treeRenderer } from '../../src/plugins/estimate/renderers/tree';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import { editorLayout, mockResizeObserver, stackLayout } from '../support/layout';
import { frames } from '../support/panes';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-02' }));

/** The demo's lines that `carol` shows, in order, and those of them dimmed: from the fixture and Task 41's table. */
const SHOWN = [11, 13, 15, 17, 27, 28, 29];
const TITLES = ['Design', 'UX wireframes', 'Build', 'Web app', 'Docs', 'User guide', 'Training'];
const DIMMED = [11, 15, 27];

function carol(buffer: CodeMirrorBuffer): { model: Model; visible: Visible } {
  const model = analyze(buffer.text(), { filename: 'demo.plan', version: buffer.version() });
  const visible = trackFilter(model, filterRows(model, 'carol'), () => buffer.text()).visible(model);
  return { model, visible };
}

const ROW = 22;
const leaf = (el: Element): number | undefined => {
  if (el.classList.contains('sheet-toolbar')) return 20;
  if (el.classList.contains('settings-banner')) return (el as HTMLElement).hidden ? 0 : 30;
  if (el instanceof HTMLDetailsElement) return 20;
  if (el instanceof HTMLTableRowElement) return ROW;
  if (el.previousElementSibling instanceof HTMLDetailsElement) return parseFloat((el as HTMLElement).style.height) || 0;
  return undefined;
};

let cleanup: (() => void)[] = [];
let resize: ReturnType<typeof mockResizeObserver>;
beforeEach(() => (resize = mockResizeObserver()));
afterEach(() => {
  cleanup.reverse().forEach((f) => f());
  cleanup = [];
  resize.restore();
});

/** An editor leading the Gantt, as the shell connects them; the Gantt rendered with the filter. */
function withGantt(editor: Parameters<typeof connectPanes>[0]['leads'] & object, model: Model, visible: Visible) {
  const host = document.createElement('div');
  document.body.append(host);
  const channel = followerChannel();
  const disconnect = connectPanes({ leads: editor }, { follows: channel.follower });
  cleanup.push(() => (disconnect(), host.remove()));
  const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, filter: visible, ...channel.context };
  ganttRenderer.render(model, host, ctx);
  let layout = { rows: [] as { at: { line: number } | null; top: number; height: number }[] };
  editor.onRowLayout((l) => (layout = l as typeof layout));
  const body = host.querySelector<HTMLElement>('.gantt-body')!;
  /** The Gantt's mark rows: line, top from the pane's top, dimmed. */
  const gantt = () =>
    [...host.querySelectorAll<HTMLElement>('.gantt-row')]
      .map((r) => [Number(r.dataset.line), parseFloat(body.style.top) + parseFloat(r.style.top) - body.scrollTop, r.classList.contains('filter-context')] as const)
      .sort((a, b) => a[0] - b[0]);
  return { host, layout: () => layout, gantt };
}

describe('the text editor filtered by carol, with the Gantt following it', () => {
  it('shows only the matches and their ancestors, dimmed, and the Gantt draws them level', async () => {
    const pane = document.createElement('div');
    document.body.append(pane);
    const restore = editorLayout(pane, () => 20);
    const buffer = new CodeMirrorBuffer(demo);
    const editor = mountTextEditor(buffer, pane, { onCursorLine: () => {}, onSave: () => {}, root: 'demo.plan' });
    cleanup.push(() => (editor.destroy(), restore(), pane.remove()));
    const { model, visible } = carol(buffer);
    editor.setFilter(visible);
    editor.update(model);
    const { layout, gantt } = withGantt(editor, model, visible);
    await frames();
    editor.update(model);

    const view = EditorView.findFromDOM(pane.querySelector('.cm-editor')!)!;
    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')];
    expect(lines.map((l) => l.textContent!.trim().split(/ {2,}| \{/)[0])).toEqual(TITLES);
    expect(lines.filter((l) => l.classList.contains('cm-filter-context')).map((l) => l.textContent!.trim().split(' {')[0])).toEqual(['Design', 'Build', 'Docs']);

    // The leader's rows: only the lines shown, each 20px, one under the other.
    expect(layout().rows.map((r) => [r.at?.line, r.top, r.height])).toEqual(SHOWN.map((line, i) => [line, i * 20, 20]));
    // The Gantt: a mark row on each, at the editor's row's top on screen, the ancestors dimmed.
    expect(gantt().map(([line]) => line)).toEqual(SHOWN);
    expect(gantt().filter(([, , dim]) => dim).map(([line]) => line)).toEqual(DIMMED);
    const editorTop = (line: number) => view.lineBlockAt(view.state.doc.line(line).from).top + view.documentTop - pane.getBoundingClientRect().top;
    for (const [line, top] of gantt()) expect(top).toBe(editorTop(line));
    // Both start their bodies below the Gantt's scale, 54px, the taller header; then 20px a row.
    expect(gantt().map(([, top]) => top)).toEqual(SHOWN.map((_, i) => 54 + i * 20));
  });
});

describe('the grid filtered by carol, with the Gantt following it', () => {
  it('draws only the matches and their ancestors, dimmed, keeps the new-task row, totals the whole plan, and the Gantt draws level', () => {
    const pane = document.createElement('div');
    document.body.append(pane);
    const restore = stackLayout(pane, leaf);
    const buffer = new CodeMirrorBuffer(demo);
    const grid = mountGrid(buffer, pane, { onCursorLine: () => {} });
    cleanup.push(() => (grid.destroy(), restore(), pane.remove()));
    const { model, visible } = carol(buffer);
    const total = () => [...pane.querySelector('tfoot tr')!.querySelectorAll('td')].map((td) => td.textContent);
    grid.update(model);
    const unfiltered = total();
    grid.setFilter(visible);
    const { gantt } = withGantt(grid, model, visible);

    const body = [...pane.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    expect(body.map((tr) => (tr.classList.contains('new-task') ? 'new-task' : Number(tr.dataset.line)))).toEqual([...SHOWN, 'new-task']);
    expect(body.filter((tr) => tr.classList.contains('filter-context')).map((tr) => Number(tr.dataset.line))).toEqual(DIMMED);
    // The total row still sums the whole plan, and says so.
    expect(total()).toEqual(unfiltered.map((text, i) => (text === 'Total' ? 'Total (all rows)' : text)));
    expect(total()).toContain('Total (all rows)');

    expect(gantt().map(([line]) => line)).toEqual(SHOWN);
    expect(gantt().filter(([, , dim]) => dim).map(([line]) => line)).toEqual(DIMMED);
    for (const [line, top] of gantt()) expect(top).toBe(pane.querySelector(`tbody tr[data-line="${line}"]`)!.getBoundingClientRect().top);
    // The grid's body starts at 62 (toolbar, problems list, header), a row every 22px.
    expect(gantt().map(([, top]) => top)).toEqual(SHOWN.map((_, i) => 62 + i * ROW));
  });
});

describe('the views filtered by carol', () => {
  const buffer = new CodeMirrorBuffer(demo);
  const { model, visible } = carol(buffer);
  const draw = (renderer: typeof treeRenderer, filter: Visible | null) => {
    const host = document.createElement('div');
    renderer.render(model, host, { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, filter });
    return host;
  };
  const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];

  for (const renderer of [treeRenderer, scheduleRenderer]) {
    it(`${renderer.label}: only the matches and their ancestors, the ancestors dimmed, each row as unfiltered`, () => {
      const all = draw(renderer, null);
      const host = draw(renderer, visible);
      expect(rows(host).map((tr) => Number(tr.dataset.line))).toEqual(SHOWN);
      expect(rows(host).map((tr) => tr.cells[1].textContent)).toEqual(TITLES);
      expect(rows(host).filter((tr) => tr.classList.contains('filter-context')).map((tr) => Number(tr.dataset.line))).toEqual(DIMMED);
      // Display only: each row shows what it shows unfiltered, and so does the total row.
      for (const tr of rows(host)) expect(tr.textContent).toBe(all.querySelector(`tbody tr[data-line="${tr.dataset.line}"]`)!.textContent);
      expect(host.querySelector('tfoot')?.textContent).toBe(all.querySelector('tfoot')?.textContent);
    });
  }
});
