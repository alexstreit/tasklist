// @vitest-environment jsdom
// The schedule table (spec §5.4): dates, days and hours, pinned values with the derived one muted,
// critical and late rows, and the cursor rules it shares through RenderContext.

import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/app/registry';
import { cursorItemFor, itemLines } from '../../src/app/cursor';
import type { RenderContext } from '../../src/core';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import fixture from '../../examples/schedule.plan?raw';

Element.prototype.scrollIntoView = vi.fn();

function render(text: string, cursorLine: number | null = null, setCursorLine = (_line: number) => {}) {
  const model = analyze(text, 'a.plan');
  const host = document.createElement('div');
  const ctx: RenderContext = { cursorLine, cursorItem: cursorItemFor(itemLines(model), cursorLine), scrollToCursor: false, setCursorLine };
  scheduleRenderer.render(model, host, ctx);
  const rows = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  return { rows, row: (title: string) => rows.find((r) => r.cells[1].textContent === title)! };
}

const cells = (tr: HTMLTableRowElement) => [...tr.cells].slice(2).map((td) => td.textContent);

describe('schedule table', () => {
  it('shows durations and slack in days and hours, and a pinned value with the derived one muted', () => {
    const { row } = render(fixture);
    expect(cells(row('Wireframes'))).toEqual(['Mon 5 Oct⟨Mon 5 Oct⟩', 'Mon 5 Oct', '1d', '1d 4h']);
    expect(cells(row('API'))).toEqual(['Tue 6 Oct⟨Tue 6 Oct⟩', 'Fri 9 Oct', '3d', '1d 4h']);
    expect(cells(row('UI'))).toEqual(['Mon 12 Oct⟨Tue 6 Oct⟩', 'Tue 13 Oct', '2d', '−1d']);
    expect(cells(row('Docs'))).toEqual(['Wed 7 Oct', 'Mon 12 Oct', '3d⟨1d⟩', '1d 4h']);
    expect(row('UI').cells[2].querySelector('.muted')!.textContent).toBe('⟨Tue 6 Oct⟩');
  });

  it('shows a milestone as a point, and a summary with no duration', () => {
    const { row } = render(fixture);
    expect(cells(row('Beta ready'))).toEqual(['Tue 13 Oct', 'Tue 13 Oct', 'milestone', '−1d']);
    expect(cells(row('Build'))).toEqual(['Tue 6 Oct', 'Tue 13 Oct', '', '−1d']);
  });

  it('marks critical rows and outlines late ones', () => {
    const { rows } = render(fixture);
    expect(rows.filter((r) => r.classList.contains('critical')).map((r) => r.cells[1].textContent)).toEqual(['Build', 'UI', 'Beta ready']);
    expect(rows.filter((r) => r.classList.contains('late')).map((r) => r.cells[1].textContent)).toEqual(['Beta ready']);
  });

  it("shows the year when it isn't project-start's", () => {
    // Wed 30 Dec, then Thu 31 Dec, Fri 1 Jan and Mon 4 Jan: the naive calendar has no holidays.
    const { row } = render('---\nprofile: schedule\nproject-start: 2026-12-30\n---\nA | 4d\n');
    expect(cells(row('A')).slice(0, 2)).toEqual(['Wed 30 Dec', 'Mon 4 Jan 2027']);
  });

  it('highlights the cursor row and moves the cursor on a click', () => {
    const setCursorLine = vi.fn();
    const { row } = render(fixture, 10, setCursorLine);
    expect(row('API').classList.contains('at-cursor')).toBe(true);
    row('Docs').click();
    expect(setCursorLine).toHaveBeenCalledWith(13);
  });
});
