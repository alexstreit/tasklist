// @vitest-environment jsdom
// Task 32: scrolled to the end, the grid's last rows are clear of its pinned total row, and the
// Gantt following it reaches the same end. The total row is in the grid's content, so its
// contentHeight includes it, and the Gantt's canvas is that tall. Injected block layout
// (tests/support/layout.ts), as in Task 29's grid tests: a 400px pane, both panes' hosts level.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectPanes, followerChannel } from '../../src/app/align';
import { analyze } from '../../src/app/registry';
import { InMemoryBuffer } from '../../src/buffer';
import type { RenderContext } from '../../src/core';
import { mountGrid } from '../../src/grid';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { mockResizeObserver, stackLayout } from '../support/layout';

const PANE = 400;
const ROW = 22;
// The toolbar (20), the closed problems list (20) and the header row (22): the grid's body starts at 62.
const leaf = (el: Element): number | undefined => {
  if (el.classList.contains('sheet-toolbar')) return 20;
  if (el.classList.contains('settings-banner')) return (el as HTMLElement).hidden ? 0 : 30;
  if (el instanceof HTMLDetailsElement) return 20;
  if (el instanceof HTMLTableRowElement) return ROW;
  if (el.previousElementSibling instanceof HTMLDetailsElement) return parseFloat((el as HTMLElement).style.height) || 0;
  return undefined;
};

// Front matter on lines 1–4, one grid row; then 30 tasks on lines 5–34.
const TEXT = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n' + Array.from({ length: 30 }, (_, i) => `Task ${i + 1} | 1d\n`).join('');

let cleanup: () => void;
let resize: ReturnType<typeof mockResizeObserver>;
beforeEach(() => (resize = mockResizeObserver()));
afterEach(() => {
  cleanup();
  resize.restore();
});

describe('the end of the scroll', () => {
  it('shows the last rows in the grid clear of the total row, and in the Gantt level with them', () => {
    const pane = document.createElement('div');
    const host = document.createElement('div');
    document.body.append(pane, host);
    const restore = stackLayout(pane, leaf);
    const buffer = new InMemoryBuffer(TEXT);
    const grid = mountGrid(buffer, pane, { onCursorLine: () => {} });
    const channel = followerChannel();
    const disconnect = connectPanes({ leads: grid }, { follows: channel.follower });
    cleanup = () => (disconnect(), grid.destroy(), restore(), pane.remove(), host.remove());
    const model = analyze(buffer.text(), { filename: 'a.plan', version: buffer.version() });
    grid.update(model);
    const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, ...channel.context };
    ganttRenderer.render(model, host, ctx);
    let layout = { contentHeight: 0, scrollTop: 0, bodyTop: 0 };
    grid.onRowLayout((l) => (layout = l));

    // Body: the front matter row, 30 tasks and the new-task row; then the total row, in the content too.
    expect(layout.bodyTop).toBe(62);
    expect(layout.contentHeight).toBe(32 * ROW + ROW);
    pane.scrollTop = pane.scrollHeight - PANE;
    pane.dispatchEvent(new Event('scroll'));
    expect(layout.scrollTop).toBe(62 + 33 * ROW - PANE);

    // The grid: the last task and the new-task row end above the total row, pinned at the pane's bottom.
    const screen = (el: Element) => el.getBoundingClientRect();
    const last = pane.querySelector('tr[data-line="34"]')!;
    const adder = pane.querySelector('tr.new-task')!;
    expect(screen(adder).top).toBe(screen(last).bottom);
    expect(screen(adder).bottom).toBe(PANE - ROW);

    // The Gantt: its canvas is the grid's content, so it can scroll as far, and its last row is where the grid's is.
    const body = host.querySelector<HTMLElement>('.gantt-body')!;
    const canvas = host.querySelector<HTMLElement>('.gantt-canvas')!;
    expect(parseFloat(canvas.style.height)).toBe(layout.contentHeight);
    expect(body.scrollTop).toBe(layout.scrollTop);
    expect(parseFloat(canvas.style.height) - (PANE - parseFloat(body.style.top))).toBe(layout.scrollTop);
    const band = host.querySelector<HTMLElement>('.gantt-band[data-line="34"]')!;
    const bandTop = parseFloat(body.style.top) + parseFloat(band.style.top) - body.scrollTop;
    expect(bandTop).toBe(screen(last).top);
    expect(bandTop + parseFloat(band.style.height)).toBeLessThanOrEqual(PANE);
    expect(host.querySelector('.gantt-row[data-line="34"] .gantt-bar')).not.toBeNull();
  });
});
