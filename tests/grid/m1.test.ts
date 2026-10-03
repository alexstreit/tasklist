// @vitest-environment jsdom
// The M1 test (Task 31): a scripted grid session, with no text-editor input, builds the plan of
// examples/schedule.plan from a file holding only its frontmatter. Its schedule must then match
// Task 28's table cell for cell. Every expected value below is copied from that table in TASKS.md,
// which was worked out by hand. Never regenerate it from output; a disagreement is a question
// about the rules.

import { describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountGrid } from '../../src/grid';
import type { ItemNode, Model, Pinnable } from '../../src/core';
import { formatDate } from '../../src/core';
import { critical, duration, finish, late, lateFinish, lateStart, projectFinish, slack, start } from '../../src/plugins/schedule/fields';
import example from '../../examples/schedule.plan?raw';

// Cell columns, as the grid numbers them, in a `profile: schedule` file.
const MILESTONE = -2;
const TITLE = 1;
const [EST, DUR, START, DEPS, DUE] = [2, 3, 4, 5, 6];

const FRONTMATTER = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n';

/** Builds the plan in the grid alone, the way a user would, and returns the text it wrote. */
function session(): string {
  const host = document.createElement('div');
  document.body.append(host);
  const buffer = new InMemoryBuffer(FRONTMATTER);
  const grid = mountGrid(buffer, host, { onCursorLine: () => {} });
  buffer.onChange(() => grid.update(analyze(buffer.text())));
  grid.update(analyze(buffer.text()));

  const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  const line = (title: string) => {
    const tr = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.item')].find((r) => r.querySelector('td.title')!.textContent === title);
    if (!tr) throw new Error(`no row titled ${title}`);
    return Number(tr.dataset.line);
  };
  const cell = (title: string, column: number) => host.querySelector<HTMLTableCellElement>(`tr[data-line="${line(title)}"] td[data-column="${column}"]`)!;
  /** Types a title into the new-task row, then indents or outdents it with Alt+Shift+Right or Left. */
  const add = (title: string, shift: 'indent' | 'outdent' | null = null) => {
    const adder = host.querySelector<HTMLInputElement>('tr.new-task input')!;
    adder.value = title;
    press(adder, 'Enter');
    if (shift) press(cell(title, TITLE), shift === 'indent' ? 'ArrowRight' : 'ArrowLeft', { altKey: true, shiftKey: true });
  };
  /** Double-clicks a cell, types and commits with Enter. */
  const type = (title: string, column: number, value: string) => {
    click(cell(title, column), 'dblclick');
    const input = host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
    input.value = value;
    press(input, 'Enter');
  };

  // Rows and indents.
  add('Design');
  add('Wireframes', 'indent');
  add('Review');
  add('Build', 'outdent');
  add('API', 'indent');
  add('UI');
  add('Beta ready');
  add('Docs', 'outdent');
  // Estimates, the dur pin, start pins, dependencies as outline numbers (with the 1-day lag), the deadline.
  type('Wireframes', EST, '1d');
  type('Wireframes', START, '2026-10-05');
  type('Review', EST, '4h');
  type('Review', DEPS, '1.1');
  type('API', EST, '3d');
  type('API', START, '2026-10-05');
  type('API', DEPS, '1.2');
  type('UI', EST, '2d');
  type('UI', START, '2026-10-12');
  type('UI', DEPS, '1.2');
  type('Beta ready', DEPS, '2.1, 2.2');
  type('Beta ready', DUE, '2026-10-12');
  type('Docs', EST, '1d');
  type('Docs', DUR, '3d');
  type('Docs', DEPS, '1.2 1d');
  // The milestone toggle.
  const toggle = cell('Beta ready', MILESTONE).querySelector<HTMLInputElement>('input')!;
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));

  const text = buffer.text();
  grid.destroy();
  host.remove();
  return text;
}

function items(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}

/**
 * What the file says about each row, by outline number, with references by their target's title,
 * so minted IDs and cell spacing don't count: the text may differ from the example only in those.
 */
function plan(model: Model) {
  const titleOf = new Map(items(model).map((n) => [n.row, n.title]));
  const columns = model.doc.schema.columns;
  return items(model).map((n) => ({
    outline: n.outlineNumber,
    title: n.title,
    markers: n.row.markers.map((m) => m.name),
    cells: Object.fromEntries(
      ['est', 'dur', 'start', 'due', 'owner', 'notes'].map((name) => [name, n.row.cells[columns.find((c) => c.name === name)!.index]?.text ?? null]),
    ),
    deps: (() => {
      const value = n.row.cells[columns.find((c) => c.name === 'deps')!.index]?.value;
      return value?.type === 'ref' ? value.refs.map((r) => [r.target && titleOf.get(r.target), r.qualifier]) : null;
    })(),
  }));
}

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

// Task 28's table: start (derived / pin / effective), duration, finish, late start, late finish,
// slack with its flags, and the dates shown (a milestone's in both columns). A summary's blank cells are absent.
const TABLE: Record<string, Expected> = {
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
    // Task 38: a milestone's start shows at the end edge.
    start: { derived: 56, effective: 56, mode: 'derived', edge: 'end' },
    duration: { derived: 0, effective: 0, mode: 'derived' }, // 0, a milestone
    finish: 56, lateStart: 48, lateFinish: 48, slack: -8, critical: true, late: true,
    shown: ['Tue 13 Oct', 'Tue 13 Oct'],
  },
  Docs: {
    start: { derived: 20, effective: 20, mode: 'derived' },
    duration: { derived: 8, pin: 24, effective: 24, mode: 'pinned' }, // derived 8, pinned 24
    finish: 44, lateStart: 32, lateFinish: 56, slack: 12, critical: false, late: false,
    shown: ['Wed 7 Oct', 'Mon 12 Oct'],
  },
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

describe('the M1 test: the schedule fixture built in the grid alone', () => {
  const text = session();
  const model = analyze(text);
  const node = (title: string) => items(model).find((n) => n.title === title)!;

  it('builds the plan of examples/schedule.plan, differing only in minted IDs and cell spacing', () => {
    expect(plan(model)).toEqual(plan(analyze(example, { filename: 'schedule.plan' })));
  });

  it.each(Object.entries(TABLE))('schedules %s as Task 28 worked it out', (title, row) => {
    const n = node(title);
    const calendar = model.calendar!;
    const shown = [calendar.toDate(model.get(n, start)!.effective, 'start'), calendar.toDate(model.get(n, finish)!, 'end')].map((d) => formatDate(d, calendar));
    // A milestone shows its date at the end edge in both columns (spec §5.4).
    if (model.get(n, duration)?.effective === 0) shown[0] = shown[1];
    expect({
      start: model.get(n, start),
      duration: model.get(n, duration),
      finish: model.get(n, finish),
      lateStart: model.get(n, lateStart),
      lateFinish: model.get(n, lateFinish),
      slack: model.get(n, slack),
      critical: model.get(n, critical),
      late: model.get(n, late),
      shown,
    }).toEqual(row);
  });

  it('finishes the project at hour 56, Tue 13 Oct', () => {
    expect(model.value(projectFinish)).toBe(56);
    expect(model.calendar!.toDate(56, 'end')).toBe('2026-10-13');
  });

  it("gives exactly the table's diagnostics", () => {
    const titleAt = (line: number) => items(model).find((n) => n.line === line)?.title;
    expect(model.diagnostics.map((d) => ({ row: titleAt(d.line), code: d.code, severity: d.severity }))).toEqual([
      { row: 'Wireframes', code: 'schedule-pin-equals-derived', severity: 'info' },
      { row: 'API', code: 'schedule-pin-no-effect', severity: 'info' },
      { row: 'Beta ready', code: 'schedule-late', severity: 'warning' },
    ]);
    // The deadline, 12 Oct, is hour 48.
    expect(model.calendar!.fromDate('2026-10-12', 'end')).toBe(48);
  });
});
