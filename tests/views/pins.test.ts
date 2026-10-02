// @vitest-environment jsdom
// Task 30: the pin review, written from the task's lists (and Task 28's hand-worked schedule for
// the derived values), never from output.

import { describe, expect, it, vi } from 'vitest';
import { analyze, renderers } from '../../src/app/registry';
import type { RenderContext } from '../../src/core';
import { pinsView } from '../../src/views/pins';
import example from '../../examples/example.plan?raw';
import fixture from '../../examples/schedule.plan?raw';

function review(text: string, ctx: Partial<RenderContext> = {}) {
  const host = document.createElement('div');
  const model = analyze(text, { filename: 'a.plan' });
  pinsView.render(model, host, { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, ...ctx });
  const rows = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  return { host, rows, cells: rows.map((r) => [...r.cells].map((c) => c.firstChild?.textContent ?? '')) };
}

describe('the pin review', () => {
  it('is always available', () => {
    expect(pinsView.requires).toEqual([]);
    expect(renderers).toContain(pinsView);
  });

  it('lists exactly the fixture’s four pins: the Wireframes, API and UI starts and Docs’ duration', () => {
    const { cells, rows } = review(fixture);
    expect(cells).toEqual([
      ['1.1', 'Wireframes', 'Start', 'Mon 5 Oct', 'Mon 5 Oct', 'Mon 5 Oct'],
      ['2.1', 'API', 'Start', 'Mon 5 Oct', 'Tue 6 Oct', 'Tue 6 Oct'],
      ['2.2', 'UI', 'Start', 'Mon 12 Oct', 'Tue 6 Oct', 'Mon 12 Oct'],
      ['3', 'Docs', 'Duration', '3d', '1d', '3d'],
    ]);
    // API's start floor had no effect.
    expect(rows.map((r) => r.classList.contains('differs'))).toEqual([false, true, false, false]);
  });

  it('lists exactly Auth’s est override and OAuth (Google)’s additive est in the example, and no leaf estimate', () => {
    const { cells, rows } = review(example);
    expect(cells).toEqual([
      ['1', 'Auth', 'est', '2d', '2d 7h', '2d'],
      ['1.3', 'OAuth (Google)', 'est', '+1d', '5h', '1d 5h'],
    ]);
    // Adding is what an additive pin is for: it never differs.
    expect(rows.map((r) => r.classList.contains('differs'))).toEqual([false, false]);
  });

  it('shows a pinned number column’s plain value, not hours', () => {
    const { cells } = review('---\ncolumns: est:duration | pts:number\n---\nA | | 5\n    B | | 2\n    C | | 4\n');
    expect(cells).toEqual([['1', 'A', 'pts', '5', '6', '5']]);
  });

  it('says "No pins" when there are none', () => {
    expect(review('A\n    B | 4h\n').host.textContent).toBe('No pins');
  });

  it('moves the cursor to a row’s line on a click, and bands the cursor row', () => {
    const setCursorLine = vi.fn();
    const { rows } = review(fixture, { setCursorLine, cursorLine: { file: 'a.plan', line: 10 }, cursorItem: { file: 'a.plan', line: 10, exact: true } });
    rows[1].click();
    expect(setCursorLine).toHaveBeenCalledWith({ file: 'a.plan', line: 10 });
    expect(rows.map((r) => r.classList.contains('at-cursor'))).toEqual([false, true, false, false]);
  });
});
