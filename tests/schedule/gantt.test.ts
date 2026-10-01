// @vitest-environment jsdom
// Task 30: the Gantt renderer as a follower (Task 29's contract) and its interaction. Positions
// are the geometry's (gantt-geometry.test.ts); these tests check what the renderer does with them.

import { describe, expect, it, vi } from 'vitest';
import { followerChannel } from '../../src/app/align';
import { analyze, registry } from '../../src/app/registry';
import { unmetReason } from '../../src/core';
import type { Model, RenderContext, RowLayout } from '../../src/core';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import fixture from '../../examples/schedule.plan?raw';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-07' }));

const at = (version: number) => analyze(fixture, { filename: 'schedule.plan', version });

function setup() {
  const host = document.createElement('div');
  const channel = followerChannel();
  const headers: number[] = [];
  channel.follower.onHeaderHeight((px) => headers.push(px));
  const setCursorLine = vi.fn();
  const base: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine };
  const render = (model: Model, ctx: Partial<RenderContext> = {}) => ganttRenderer.render(model, host, { ...base, ...channel.context, ...ctx });
  const bands = () => [...host.querySelectorAll<HTMLElement>('.gantt-row')];
  const lines = () => bands().map((b) => Number(b.dataset.line));
  return { host, channel, headers, setCursorLine, render, bands, lines };
}

/** A leader's layout: the fixture's lines 1–15, 20px each, or those given. */
function layoutOf(version: number, lines = Array.from({ length: 15 }, (_, i) => i + 1), scrollTop = 0): RowLayout {
  return { version, bodyTop: 40, contentHeight: 300, scrollTop, rows: lines.map((line, i) => ({ at: { line }, top: i * 20, height: 20 })) };
}

describe('the Gantt renderer', () => {
  it('follows, and requires the schedule fields it reads', () => {
    expect(ganttRenderer.follows).toBe(true);
    expect(ganttRenderer.requires.map((k) => k.name)).toEqual(['start', 'duration', 'finish', 'slack', 'critical', 'late', 'milestone', 'deadline', 'project-finish']);
  });

  it('is greyed out with the schedule’s reason when its stages were skipped', () => {
    const model = analyze('---\nprofile: schedule\n---\nA | 1d\n', { filename: 'a.plan' });
    expect(unmetReason(registry, model, ganttRenderer.requires)).toBe('needs project-start');
  });

  it('reports its scale’s height as its header', () => {
    const { headers, render } = setup();
    render(at(0));
    expect(headers).toEqual([40]);
  });

  it('draws its natural layout with nothing leading: a row per item', () => {
    const { lines, render } = setup();
    render(at(0));
    expect(lines()).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('draws a leader’s layout: rows with no item stay empty, and only rows in the layout are drawn', () => {
    const { channel, lines, render, host } = setup();
    channel.follower.layout(layoutOf(0, [1, 5, 6, 9, 10]));
    render(at(0));
    expect(lines()).toEqual([6, 9, 10]);
    const band = host.querySelector<HTMLElement>('.gantt-row[data-line="9"]')!;
    expect([band.style.top, band.style.height]).toEqual(['60px', '20px']);
    expect(host.querySelector<HTMLElement>('.gantt-body')!.style.top).toBe('40px');
  });

  it('draws only when the layout’s version is the model’s, and keeps its last frame otherwise', () => {
    const { channel, lines, render } = setup();
    channel.follower.layout(layoutOf(0));
    render(at(0));
    const before = lines();
    // The leader has new text; the model hasn't caught up.
    channel.follower.layout(layoutOf(1, [6, 7]));
    expect(lines()).toEqual(before);
    render(at(1));
    expect(lines()).toEqual([6, 7]);
  });

  it('repositions its rows on a new layout, without redrawing them', () => {
    const { channel, host, render } = setup();
    channel.follower.layout(layoutOf(0));
    render(at(0));
    const band = host.querySelector<HTMLElement>('.gantt-row[data-line="10"]')!;
    channel.follower.layout({ ...layoutOf(0), rows: layoutOf(0).rows.map((r) => ({ ...r, top: r.top + 7 })), scrollTop: 30 });
    expect(host.querySelector('.gantt-row[data-line="10"]')).toBe(band);
    expect(band.style.top).toBe(`${9 * 20 + 7}px`);
    expect(host.querySelector<HTMLElement>('.gantt-body')!.scrollTop).toBe(30);
  });

  it('moves the cursor to a row’s line when the row or its mark is clicked', () => {
    const { host, render, setCursorLine } = setup();
    render(at(0));
    host.querySelector<HTMLElement>('.gantt-row[data-line="11"] .gantt-bar')!.click();
    expect(setCursorLine).toHaveBeenLastCalledWith(11);
    host.querySelector<HTMLElement>('.gantt-row[data-line="6"]')!.click();
    expect(setCursorLine).toHaveBeenLastCalledWith(6);
  });

  it('bands the cursor row', () => {
    const { host, render } = setup();
    const model = at(0);
    render(model, { cursorLine: 11, cursorItem: { line: 11, exact: true } });
    expect([...host.querySelectorAll<HTMLElement>('.gantt-band.at-cursor')].map((b) => b.dataset.line)).toEqual(['11']);
    render(model, { cursorLine: 12, cursorItem: { line: 12, exact: false } });
    expect(host.querySelector('.at-cursor')).toBeNull();
    expect(host.querySelector<HTMLElement>('.near-cursor')!.dataset.line).toBe('12');
  });

  it('gives each mark a tooltip with the title, dates, duration and slack, as the schedule table shows them', () => {
    const { host, render } = setup();
    render(at(0));
    const tip = (line: number) => host.querySelector<HTMLElement>(`.gantt-row[data-line="${line}"] > :first-child`)!.title;
    expect(tip(11)).toBe('UI\nMon 12 Oct – Tue 13 Oct\n2d\nslack −1d');
    expect(tip(12)).toBe('Beta ready\nTue 13 Oct\nmilestone\nslack −1d');
    expect(tip(6)).toBe('Design\nMon 5 Oct – Tue 6 Oct\nslack 1d 4h');
  });

  it('draws the marks’ kinds and flags, the lines and the scale', () => {
    const { host, render } = setup();
    render(at(0));
    const mark = (line: number) => host.querySelector<HTMLElement>(`.gantt-row[data-line="${line}"] > :first-child`)!;
    expect(mark(9).className).toBe('gantt-summary critical');
    expect(mark(12).className).toBe('gantt-milestone critical late');
    expect([mark(11).style.left, mark(11).style.width]).toEqual(['120px', '48px']);
    expect(host.querySelector<HTMLElement>('.gantt-row[data-line="10"] .gantt-pin')!.style.left).toBe('0px');
    expect(host.querySelector<HTMLElement>('.gantt-row[data-line="12"] .gantt-deadline-marker')!.style.left).toBe('144px');
    const left = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)].map((e) => e.style.left);
    expect(left('.gantt-deadline')).toEqual(['144px']);
    expect(left('.gantt-finish')).toEqual(['168px']);
    expect(left('.gantt-today')).toEqual(['48px']);
    expect([...host.querySelectorAll('.gantt-week')].map((e) => e.textContent)).toEqual(['Mon 5 Oct', 'Mon 12 Oct']);
    expect([...host.querySelectorAll('.gantt-deadline-label')].map((e) => e.textContent)).toEqual(['Mon 12 Oct']);
  });

  it('dims a done row', () => {
    const { host, render } = setup();
    render(analyze(fixture.replace('    Review {#review}', '    ~Review {#review}'), { filename: 'schedule.plan' }));
    expect(host.querySelector('.gantt-row[data-line="8"]')!.classList.contains('done')).toBe(true);
    expect(host.querySelector('.gantt-row[data-line="7"]')!.classList.contains('done')).toBe(false);
  });

  it('draws, bottom to top, the bands, the week lines, the marks, then the deadline, finish and today lines (Task 32)', () => {
    const { host, render } = setup();
    render(at(0), { cursorLine: 11, cursorItem: { line: 11, exact: true } });
    const order = [...host.querySelectorAll<HTMLElement>('.gantt-band, .gantt-week-line, .gantt-row, .gantt-deadline, .gantt-finish, .gantt-today')].map((e) =>
      e.classList.contains('gantt-band') ? 'band' : e.classList.contains('gantt-row') ? 'marks' : e.classList[1],
    );
    const runs = order.filter((kind, i) => kind !== order[i - 1]);
    expect(runs).toEqual(['band', 'gantt-week-line', 'marks', 'gantt-deadline', 'gantt-finish', 'gantt-today']);
    // Nothing positioned is stacked out of document order.
    expect([...host.querySelectorAll<HTMLElement>('.gantt-canvas *')].every((e) => e.style.zIndex === '')).toBe(true);
  });

  it('bands every layout row with a line, an empty one too, and puts marks only on items (Task 32)', () => {
    const { channel, host, render } = setup();
    channel.follower.layout(layoutOf(0, [1, 5, 6, 9, 10]));
    render(at(0));
    const band = (line: number) => host.querySelector<HTMLElement>(`.gantt-band[data-line="${line}"]`)!;
    expect([...host.querySelectorAll<HTMLElement>('.gantt-band')].map((b) => Number(b.dataset.line))).toEqual([1, 5, 6, 9, 10]);
    expect([band(5).style.top, band(5).style.height]).toEqual(['20px', '20px']);
    expect(band(5).children).toHaveLength(0);
  });

  it('reports the line hovered anywhere on a row, an empty one too, and null on leaving (Task 32)', () => {
    const { channel, host, render } = setup();
    const hovers: (number | null)[] = [];
    channel.follower.layout(layoutOf(0, [1, 5, 6, 9, 10]));
    render(at(0), { setHoverLine: (line) => hovers.push(line) });
    const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    over(host.querySelector('.gantt-row[data-line="10"] .gantt-bar')!);
    over(host.querySelector('.gantt-row[data-line="10"]')!);
    over(host.querySelector('.gantt-band[data-line="5"]')!);
    over(host.querySelector('.gantt-canvas')!);
    over(host.querySelector('.gantt-row[data-line="9"]')!);
    expect(host.querySelector<HTMLElement>('.gantt-band.hover')!.dataset.line).toBe('9');
    // A render, after a click say, replays the other pane's hover, which doesn't clear this one.
    render(at(0), { setHoverLine: (line) => hovers.push(line), onHoverLine: (cb) => cb(null) });
    expect(host.querySelector<HTMLElement>('.gantt-band.hover')!.dataset.line).toBe('9');
    host.querySelector('.gantt-body')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(hovers).toEqual([10, 5, null, 9, null]);
    expect(host.querySelector('.gantt-band.hover')).toBeNull();
  });

  it('bands the line hovered in the other pane, an empty row too, keeps it across a redraw, and clears it (Task 32)', () => {
    const { channel, host, render } = setup();
    let relay: (line: number | null) => void = () => {};
    const ctx: Partial<RenderContext> = { onHoverLine: (cb) => void ((relay = cb), cb(null)) };
    channel.follower.layout(layoutOf(0, [1, 5, 6, 9, 10]));
    render(at(0), ctx);
    const hovered = () => [...host.querySelectorAll<HTMLElement>('.gantt-band.hover')].map((b) => Number(b.dataset.line));
    relay(5);
    expect(hovered()).toEqual([5]);
    relay(9);
    render(at(0), { ...ctx, onHoverLine: (cb) => void ((relay = cb), cb(9)) });
    expect(hovered()).toEqual([9]);
    // The cursor band and the hover band are separate classes, on the same band.
    render(at(0), { ...ctx, cursorItem: { line: 9, exact: true }, onHoverLine: (cb) => void ((relay = cb), cb(9)) });
    expect([...host.querySelector('.gantt-band[data-line="9"]')!.classList].sort()).toEqual(['at-cursor', 'gantt-band', 'hover']);
    relay(null);
    expect(hovered()).toEqual([]);
  });

  it('reports a scroll of its body', () => {
    const { channel, host, render } = setup();
    const scrolls: number[] = [];
    channel.follower.onScroll((top) => scrolls.push(top));
    render(at(0));
    const body = host.querySelector<HTMLElement>('.gantt-body')!;
    body.scrollTop = 25;
    body.dispatchEvent(new Event('scroll'));
    expect(scrolls).toEqual([25]);
  });
});
