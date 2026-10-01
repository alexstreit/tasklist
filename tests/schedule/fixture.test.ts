// @vitest-environment jsdom
// The schedule reference fixture (Task 28): every expected value below is copied from the table in
// TASKS.md, which was worked out by hand. Never regenerate it from output; a disagreement is a
// question about the rules.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { ItemNode, Model, Pinnable, RenderContext } from '../../src/core';
import { critical, duration, finish, late, lateFinish, lateStart, projectFinish, slack, start } from '../../src/plugins/schedule/fields';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import fixture from '../../examples/schedule.plan?raw';

interface Expected {
  start: Pinnable<number>;
  duration?: Pinnable<number>;
  finish: number;
  lateStart?: number;
  lateFinish?: number;
  slack: number;
  critical: boolean;
  late: boolean;
  shown: [string, string];
}

// Row → start (derived / pin / effective), duration, finish, late start, late finish, slack, flags, shown dates.
const expected: Record<string, Expected> = {
  Wireframes: {
    start: { derived: 0, pin: 0, effective: 0, mode: 'pinned' },
    duration: { derived: 8, effective: 8, mode: 'derived' },
    finish: 8, lateStart: 12, lateFinish: 20, slack: 12, critical: false, late: false,
    shown: ['Mon 5 Oct', 'Mon 5 Oct'],
  },
  Review: {
    start: { derived: 8, effective: 8, mode: 'derived' },
    duration: { derived: 4, effective: 4, mode: 'derived' },
    finish: 12, lateStart: 20, lateFinish: 24, slack: 12, critical: false, late: false,
    shown: ['Tue 6 Oct', 'Tue 6 Oct'],
  },
  API: {
    start: { derived: 12, pin: 0, effective: 12, mode: 'pinned' },
    duration: { derived: 24, effective: 24, mode: 'derived' },
    finish: 36, lateStart: 24, lateFinish: 48, slack: 12, critical: false, late: false,
    shown: ['Tue 6 Oct', 'Fri 9 Oct'],
  },
  UI: {
    start: { derived: 12, pin: 40, effective: 40, mode: 'pinned' },
    duration: { derived: 16, effective: 16, mode: 'derived' },
    finish: 56, lateStart: 32, lateFinish: 48, slack: -8, critical: true, late: false,
    shown: ['Mon 12 Oct', 'Tue 13 Oct'],
  },
  'Beta ready': {
    start: { derived: 56, effective: 56, mode: 'derived' },
    duration: { derived: 0, effective: 0, mode: 'derived' }, // a milestone
    finish: 56, lateStart: 48, lateFinish: 48, slack: -8, critical: true, late: true,
    shown: ['Tue 13 Oct', 'Tue 13 Oct'],
  },
  Docs: {
    start: { derived: 20, effective: 20, mode: 'derived' },
    duration: { derived: 8, pin: 24, effective: 24, mode: 'pinned' },
    finish: 44, lateStart: 32, lateFinish: 56, slack: 12, critical: false, late: false,
    shown: ['Wed 7 Oct', 'Mon 12 Oct'],
  },
  // Summaries: no duration, late start or late finish.
  Design: {
    start: { derived: 0, effective: 0, mode: 'derived' },
    finish: 12, slack: 12, critical: false, late: false,
    shown: ['Mon 5 Oct', 'Tue 6 Oct'],
  },
  Build: {
    start: { derived: 0, effective: 12, mode: 'derived' },
    finish: 56, slack: -8, critical: true, late: false,
    shown: ['Tue 6 Oct', 'Tue 13 Oct'],
  },
};

function items(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}

const model = analyze(fixture, { filename: 'schedule.plan' });
const node = (title: string) => items(model).find((n) => n.title === title)!;

describe('the schedule fixture (examples/schedule.plan)', () => {
  it('has exactly the rows of the table', () => {
    expect(items(model).map((n) => n.title).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('%s', (title, row) => {
    const n = node(title);
    expect({
      start: model.get(n, start),
      duration: model.get(n, duration),
      finish: model.get(n, finish),
      lateStart: model.get(n, lateStart),
      lateFinish: model.get(n, lateFinish),
      slack: model.get(n, slack),
      critical: model.get(n, critical),
      late: model.get(n, late),
    }).toEqual({ ...row, shown: undefined });
  });

  it('finishes the project at hour 56, shown as Tue 13 Oct', () => {
    expect(model.value(projectFinish)).toBe(56);
    expect(model.calendar!.toDate(56, 'end')).toBe('2026-10-13');
  });

  it('gives exactly the diagnostics of the table, from the schedule plugin', () => {
    const titleAt = (line: number) => items(model).find((n) => n.line === line)?.title;
    expect(model.diagnostics.map((d) => ({ row: titleAt(d.line), code: d.code, severity: d.severity, source: d.source }))).toEqual([
      { row: 'Wireframes', code: 'schedule-pin-equals-derived', severity: 'info', source: 'schedule' },
      { row: 'API', code: 'schedule-pin-no-effect', severity: 'info', source: 'schedule' },
      { row: 'Beta ready', code: 'schedule-late', severity: 'warning', source: 'schedule' },
    ]);
    // The deadline, 12 Oct, is hour 48.
    expect(model.calendar!.fromDate('2026-10-12', 'end')).toBe(48);
    expect(model.diagnostics[2].message).toBe('finishes 2026-10-13, after its deadline 2026-10-12');
  });

  it('shows the dates of the table in the schedule table', () => {
    const host = document.createElement('div');
    const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {} };
    scheduleRenderer.render(model, host, ctx);
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['#', '', 'start', 'finish', 'duration', 'slack']);
    // The date itself, without a muted derived value beside it.
    const own = (td: HTMLTableCellElement) => td.firstChild!.textContent;
    const shown = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => [tr.cells[1].textContent, [own(tr.cells[2]), own(tr.cells[3])]]);
    expect(Object.fromEntries(shown)).toEqual(Object.fromEntries(Object.entries(expected).map(([title, row]) => [title, row.shown])));
  });
});
