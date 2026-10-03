// @vitest-environment jsdom
// Task 39: the Gantt's scale picker, which it places in the preview toolbar through ctx.toolbar.
// Positions are the geometry's (gantt-zoom.test.ts); these tests check the control, what it
// remembers, the scroll kept across a switch, and Fit's resizing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followerChannel } from '../../src/app/align';
import { analyze } from '../../src/app/registry';
import type { Model, RenderContext } from '../../src/core';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { mockResizeObserver } from '../support/layout';
import fixture from '../../examples/schedule.plan?raw';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-07' }));

const model: Model = analyze(fixture, { filename: 'schedule.plan' });

function setup() {
  const host = document.createElement('div');
  const bar = document.createElement('div');
  document.body.append(bar, host);
  const channel = followerChannel();
  const headers: number[] = [];
  channel.follower.onHeaderHeight((px) => headers.push(px));
  const toolbar = (el: HTMLElement) => (bar.append(el), () => el.remove());
  const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: vi.fn(), toolbar, ...channel.context };
  const render = () => ganttRenderer.render(model, host, ctx);
  const radios = () => [...bar.querySelectorAll<HTMLButtonElement>('.gantt-zoom [role="radio"]')];
  const checked = () => radios().find((r) => r.getAttribute('aria-checked') === 'true')!.textContent;
  const choose = (label: string) => radios().find((r) => r.textContent === label)!.click();
  const body = () => host.querySelector<HTMLElement>('.gantt-body')!;
  /** UI's bar, on line 11: at Day 120px, width 48. */
  const ui = () => host.querySelector<HTMLElement>('.gantt-row[data-line="11"] > :first-child')!;
  return { host, bar, headers, render, radios, checked, choose, body, ui };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the scale picker', () => {
  it('offers Day, Week, Month and Fit in the toolbar, as a radio group with one tab stop, Fit by default', () => {
    const { host, bar, render, radios, checked } = setup();
    render();
    expect(bar.querySelector('.gantt-zoom')!.getAttribute('role')).toBe('radiogroup');
    expect(host.querySelector('.gantt-zoom')).toBeNull();
    expect(radios().map((r) => r.textContent)).toEqual(['Day', 'Week', 'Month', 'Fit']);
    expect(checked()).toBe('Fit');
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('places one picker however often it renders, and takes it away when the chart is mounted afresh', () => {
    const { host, bar, render } = setup();
    render();
    render();
    expect(bar.querySelectorAll('.gantt-zoom')).toHaveLength(1);
    // Another view drew in the host; the Gantt comes back to it.
    host.replaceChildren();
    const old = bar.querySelector('.gantt-zoom');
    render();
    expect(bar.querySelectorAll('.gantt-zoom')).toHaveLength(1);
    expect(bar.querySelector('.gantt-zoom')).not.toBe(old);
  });

  it('switches scale on a click', () => {
    const { render, choose, checked, ui } = setup();
    render();
    choose('Week');
    expect(checked()).toBe('Week');
    expect([ui().style.left, ui().style.width]).toEqual(['30px', '12px']);
  });

  it('moves between the options with the arrow keys, wrapping, and keeps focus on the chosen one', () => {
    const { render, radios, checked } = setup();
    render();
    const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    radios()[3].focus();
    press('ArrowRight');
    expect(checked()).toBe('Day');
    expect(document.activeElement).toBe(radios()[0]);
    press('ArrowDown');
    expect(checked()).toBe('Week');
    press('ArrowLeft');
    press('ArrowUp');
    expect(checked()).toBe('Fit');
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('draws a bar at least 2px wide, and a summary narrower than its caps as a bar', () => {
    const { host, render, choose } = setup();
    render();
    choose('Month');
    // Review, line 8: 0.75px at Month. Design, line 6: 2.25px.
    expect(host.querySelector<HTMLElement>('.gantt-row[data-line="8"] > :first-child')!.style.width).toBe('2px');
    const design = host.querySelector<HTMLElement>('.gantt-row[data-line="6"] > :first-child')!;
    expect(design.className).toBe('gantt-summary as-bar');
    expect(design.style.width).toBe('2.25px');
  });

  it('draws the tiers’ labels in their rows, and Month’s ticks', () => {
    const { host, render, choose } = setup();
    render();
    choose('Month');
    const text = (selector: string) => [...host.querySelectorAll(selector)].map((e) => e.textContent);
    expect(text('.gantt-scale-top .gantt-top')).toEqual(['2026']);
    expect(text('.gantt-scale-bottom .gantt-bottom')).toEqual(['Oct']);
    expect(text('.gantt-scale-deadlines .gantt-deadline-label')).toEqual(['Mon 12 Oct']);
    expect([...host.querySelectorAll<HTMLElement>('.gantt-scale-bottom .gantt-tick')].map((e) => e.style.left)).toEqual(['0px']);
  });
});

describe('the header', () => {
  it('holds only its three rows, the deadlines’ dates alone in theirs, so nothing covers a date at the right edge', () => {
    const { host, render } = setup();
    render();
    expect([...host.querySelector('.gantt-scale')!.children].map((e) => e.className)).toEqual(['gantt-scale-inner']);
    expect([...host.querySelector('.gantt-scale-inner')!.children].map((e) => e.className)).toEqual(['gantt-scale-deadlines', 'gantt-scale-top', 'gantt-scale-bottom']);
    expect([...host.querySelector('.gantt-scale-deadlines')!.children].map((e) => [e.className, e.textContent])).toEqual([['gantt-deadline-label', 'Mon 12 Oct']]);
  });

  it('keeps the same height at every scale', () => {
    const { headers, render, choose } = setup();
    for (const label of ['Day', 'Week', 'Month', 'Fit']) {
      render();
      choose(label);
      render();
    }
    expect(new Set(headers)).toEqual(new Set([54]));
  });
});

describe('remembering the scale', () => {
  it('survives a reload', () => {
    const first = setup();
    first.render();
    first.choose('Month');
    expect(localStorage.getItem('plan.gantt-scale')).toBe('month');
    const second = setup();
    second.render();
    expect(second.checked()).toBe('Month');
    expect(second.ui().style.left).toBe('7.5px');
  });

  it('falls back to Fit when nothing is stored, the value is unknown, or storage can’t be read', () => {
    const fresh = setup();
    fresh.render();
    expect(fresh.checked()).toBe('Fit');
    localStorage.setItem('plan.gantt-scale', 'quarter');
    const unknown = setup();
    unknown.render();
    expect(unknown.checked()).toBe('Fit');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const denied = setup();
    denied.render();
    expect(denied.checked()).toBe('Fit');
    denied.choose('Week');
    expect(denied.checked()).toBe('Week');
  });
});

describe('switching keeps your place', () => {
  it('Day to Month keeps the date at the left edge: Mon 12 Oct, day 5, is 120px at Day and 7.5px at Month', () => {
    const { host, render, choose, body } = setup();
    render();
    choose('Day');
    body().scrollLeft = 120;
    choose('Month');
    expect(body().scrollLeft).toBe(7.5);
    expect(host.querySelector<HTMLElement>('.gantt-scale-inner')!.style.transform).toBe('translateX(-7.5px)');
    choose('Week');
    expect(body().scrollLeft).toBe(30);
  });

  it('Fit starts at the left edge, since everything shows', () => {
    const { render, choose, body } = setup();
    render();
    choose('Day');
    body().scrollLeft = 120;
    choose('Fit');
    expect(body().scrollLeft).toBe(0);
  });
});

describe('Fit and resizing', () => {
  it('recomputes when the pane is resized: Day’s 24px with no width, 60px a day at 480px', () => {
    const resize = mockResizeObserver();
    try {
      const { render, body, ui } = setup();
      // jsdom lays nothing out, so the pane's width is 0 until the test says otherwise.
      render();
      let width = 0;
      Object.defineProperty(body(), 'clientWidth', { configurable: true, get: () => width });
      expect([ui().style.left, ui().style.width]).toEqual(['120px', '48px']);
      width = 480;
      resize.fire();
      expect([ui().style.left, ui().style.width]).toEqual(['300px', '120px']);
    } finally {
      resize.restore();
    }
  });

  it('ignores a resize at a named scale', () => {
    const resize = mockResizeObserver();
    try {
      const { render, choose, body, ui } = setup();
      render();
      choose('Week');
      Object.defineProperty(body(), 'clientWidth', { configurable: true, get: () => 480 });
      resize.fire();
      expect(ui().style.left).toBe('30px');
    } finally {
      resize.restore();
    }
  });
});
