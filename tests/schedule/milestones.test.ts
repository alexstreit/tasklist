// @vitest-environment jsdom
// Task 38: dated milestones. Every expected value below is copied from the table in TASKS.md, which
// was worked out by hand: project-start Mon 5 Oct 2026 is hour 0, 8 hours a day, so Fri 23 Oct is
// day 14 (its end hour 120) and Mon 26 Oct day 15 (its end hour 128). Never regenerate them from
// output; a disagreement is a question about the rules.

import { applyEdits } from 'rows';
import { describe, expect, it } from 'vitest';
import { analyze, registry } from '../../src/app/registry';
import { createAnalyzer } from '../../src/core';
import type { ItemNode, Model, RenderContext } from '../../src/core';
import { finish, late, start } from '../../src/plugins/schedule/fields';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { ganttGeometry } from '../../src/plugins/schedule/renderers/gantt/geometry';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import { naturalLayout } from '../../src/ui/row-layout';
import { pinsView } from '../../src/views/pins';
import fixture from '../fixtures/milestones.plan?raw';

interface Expected {
  start: number;
  finish: number;
  /** The schedule table's start and finish cells. */
  shown: [string, string];
  late: boolean;
  /** Gantt x and width, in days. */
  gantt: { kind: 'bar' | 'milestone'; x: number; width?: number };
}

// Row → start / finish, shown, Gantt x (days), as the task's table gives them.
const expected: Record<string, Expected> = {
  Prep: { start: 0, finish: 128, shown: ['Mon 5 Oct', 'Mon 26 Oct'], late: false, gantt: { kind: 'bar', x: 0, width: 16 } },
  'Show A': { start: 120, finish: 120, shown: ['Fri 23 Oct', 'Fri 23 Oct'], late: false, gantt: { kind: 'milestone', x: 15 } },
  'Show B': { start: 128, finish: 128, shown: ['Mon 26 Oct', 'Mon 26 Oct'], late: false, gantt: { kind: 'milestone', x: 16 } },
  'Show C': { start: 128, finish: 128, shown: ['Mon 26 Oct', 'Mon 26 Oct'], late: true, gantt: { kind: 'milestone', x: 16 } },
  'Show D': { start: 120, finish: 120, shown: ['Fri 23 Oct', 'Fri 23 Oct'], late: false, gantt: { kind: 'milestone', x: 15 } },
  'Some task': { start: 0, finish: 0, shown: ['Mon 5 Oct', 'Mon 5 Oct'], late: false, gantt: { kind: 'milestone', x: 0 } },
  'After A': { start: 120, finish: 128, shown: ['Mon 26 Oct', 'Mon 26 Oct'], late: false, gantt: { kind: 'bar', x: 15, width: 1 } },
};

const items = (model: Model): ItemNode[] => {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
};
const read = (text: string) => analyze(text, { filename: 'milestones.plan' });
const model = read(fixture);
const node = (title: string, m = model) => items(m).find((n) => n.title === title)!;
const titleAt = (line: number, m = model) => items(m).find((n) => n.line === line)?.title;
const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {} };

function table(m: Model): HTMLTableRowElement[] {
  const host = document.createElement('div');
  scheduleRenderer.render(m, host, ctx);
  return [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];
}
const row = (title: string, m = model) => table(m).find((tr) => tr.cells[1].textContent === title)!;
/** The date itself, without a muted derived value beside it. */
const own = (td: HTMLTableCellElement) => td.firstChild!.textContent;

describe('the dated milestones fixture (tests/fixtures/milestones.plan)', () => {
  it('has exactly the rows of the table', () => {
    expect(items(model).map((n) => n.title)).toEqual(Object.keys(expected));
  });

  it.each(Object.entries(expected))('%s: start, finish and lateness', (title, want) => {
    const n = node(title);
    expect({ start: model.get(n, start)!.effective, finish: model.get(n, finish), late: model.get(n, late) }).toEqual({ start: want.start, finish: want.finish, late: want.late });
  });

  it.each(Object.entries(expected))('%s: shown in the schedule table', (title, want) => {
    const tr = row(title);
    expect([own(tr.cells[2]), own(tr.cells[3])]).toEqual(want.shown);
    expect(tr.classList.contains('late')).toBe(want.late);
  });

  it.each(Object.entries(expected))('%s: Gantt geometry', (title, want) => {
    const layout = naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 0, height: 1000, rowHeight: 22 });
    const mark = ganttGeometry(model, layout, { dayWidth: 1, tiers: 'day' }, '2026-10-07').rows.find((r) => r.line === node(title).line)!.mark;
    expect({ kind: mark.kind, x: mark.x, ...('width' in mark ? { width: mark.width } : {}) }).toEqual(want.gantt);
  });

  it("gives exactly the table's diagnostics, each with its code, row and severity", () => {
    expect(model.diagnostics.map((d) => ({ row: titleAt(d.line), code: d.code, severity: d.severity, source: d.source }))).toEqual([
      { row: 'Show B', code: 'schedule-pin-no-effect', severity: 'info', source: 'schedule' },
      { row: 'Show C', code: 'schedule-pin-no-effect', severity: 'info', source: 'schedule' },
      { row: 'Show C', code: 'schedule-late', severity: 'warning', source: 'schedule' },
      { row: 'Show D', code: 'schedule-milestone-nonworking', severity: 'info', source: 'schedule' },
      { row: 'Some task', code: 'schedule-milestone-undated', severity: 'info', source: 'schedule' },
    ]);
  });

  it('words the two new infos as the task does, and gives a milestone’s date at its own edge', () => {
    const message = (title: string, code: string) => model.diagnostics.find((d) => d.code === code && titleAt(d.line) === title)!.message;
    expect(message('Show D', 'schedule-milestone-nonworking')).toBe("Show D falls on Sat 24 Oct, so it's shown on Fri 23 Oct.");
    expect(message('Some task', 'schedule-milestone-undated')).toBe('Some task has no date or dependency, so it sits at the project start.');
    expect(message('Show B', 'schedule-pin-no-effect')).toBe("the start column's date has no effect; the row starts Mon 26 Oct");
    expect(message('Show C', 'schedule-late')).toBe('finishes Mon 26 Oct, after its deadline Fri 23 Oct');
  });

  it("puts the nonworking info on the start cell, and the undated fix on Some task's row", () => {
    const nonworking = model.diagnostics.find((d) => d.code === 'schedule-milestone-nonworking')!;
    expect(fixture.slice(nonworking.span!.from, nonworking.span!.to)).toBe('2026-10-24');
    const undated = model.diagnostics.find((d) => d.code === 'schedule-milestone-undated')!;
    expect(undated.fixes!.map((f) => [f.label, f.tier])).toEqual([['Use its due date as its date', 'click']]);
  });

  it('applying the fix writes start=2027-11-29 on Some task’s row, which then sits at the end of Mon 29 Nov 2027 and loses the info', () => {
    const fix = model.diagnostics.find((d) => d.code === 'schedule-milestone-undated')!.fixes![0];
    const text = applyEdits(fixture, fix.edits);
    const changed = text.split('\n').filter((line, i) => line !== fixture.split('\n')[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^\^Some task\s.*start=2027-11-29/);
    expect(changed[0]).toContain('due=2027-11-29');
    const after = read(text);
    // Mon 29 Nov 2027 is 60 weeks after Mon 5 Oct 2026: day 300, whose end is hour 301 × 8.
    expect(after.get(node('Some task', after), start)!.effective).toBe(2408);
    expect(own(row('Some task', after).cells[2])).toBe('Mon 29 Nov 2027');
    expect(after.diagnostics.some((d) => d.code === 'schedule-milestone-undated')).toBe(false);
  });
});

describe('the undated fix is offered only when it can write', () => {
  const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n';
  const undated = (m: Model) => m.diagnostics.filter((d) => d.code === 'schedule-milestone-undated');

  it('is absent when the row has no due', () => {
    const found = undated(read(`${HEAD}---\n^Launch\n`));
    expect(found).toHaveLength(1);
    expect(found[0].fixes).toBeUndefined();
  });

  it('is absent when no column is bound to start', () => {
    const found = undated(read(`${HEAD}columns: est:duration unit=h hpd=8 dpw=5 | due:date\n---\n^Launch | due=2026-10-09\n`));
    expect(found).toHaveLength(1);
    expect(found[0].fixes).toBeUndefined();
  });

  it('counts a dependency or a pin of its own, or an ancestor with either, as a date', () => {
    const text = `${HEAD}---\nA {#a} | 1d\nPhase | deps=#a\n    ^Inside\nPinned | start=2026-10-07\n    ^Under\n^Linked | deps=#a\n^Alone\n`;
    expect(undated(read(text)).map((d) => titleAt(d.line, read(text)))).toEqual(['Alone']);
  });

  it('is not given to a row that is not a milestone', () => {
    expect(undated(read(`${HEAD}---\nA | 1d\n`))).toEqual([]);
  });
});

describe('a pinned milestone’s date in the views, at its own edge', () => {
  it('the pin review shows Show A’s pin as Fri 23 Oct, and a task’s pin still at the start edge', () => {
    const host = document.createElement('div');
    pinsView.render(read(`${fixture}Task | 1d | start=2026-10-07\n`), host, ctx);
    const cells = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((r) => [...r.cells].slice(1).map((c) => c.firstChild?.textContent ?? ''));
    expect(cells.find((c) => c[0] === 'Show A')).toEqual(['Show A', 'Start', 'Fri 23 Oct', 'Mon 5 Oct', 'Fri 23 Oct']);
    expect(cells.find((c) => c[0] === 'Task')).toEqual(['Task', 'Start', 'Wed 7 Oct', 'Mon 5 Oct', 'Wed 7 Oct']);
  });

  it('the schedule table shows Show B’s derived date muted at the same edge, as it shows every pinned start’s', () => {
    expect(row('Show B').cells[2].textContent).toBe('Mon 26 Oct⟨Mon 26 Oct⟩');
    expect(row('Show A').cells[2].textContent).toBe('Fri 23 Oct⟨Mon 5 Oct⟩');
  });

  it('the Gantt tooltip gives Show A’s date', () => {
    const host = document.createElement('div');
    ganttRenderer.render(model, host, ctx);
    const tip = host.querySelector<HTMLElement>(`.gantt-row[data-line="${node('Show A').line}"] > :first-child`)!.title;
    expect(tip.split('\n').slice(0, 3)).toEqual(['Show A', 'Fri 23 Oct', 'milestone']);
  });
});

describe('ctx.cellEdit on a mounted row (PLUGINS.md §5)', () => {
  const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n';
  const team = `${HEAD}^Review | due=2026-10-09\n`;
  const master = `${HEAD}Team | mount=t.plan\n`;
  const compose = createAnalyzer(registry);
  const files = new Map([['t.plan', team]]);
  const m = compose(master, { filename: 'm.plan', files, resolve: (_from, ref) => ref });

  it('builds the fix in the mounted file’s offsets, carried by the diagnostic’s file', () => {
    const d = m.diagnostics.find((x) => x.code === 'schedule-milestone-undated')!;
    expect(d.file).toBe('t.plan');
    expect(d.line).toBe(5);
    const edits = d.fixes![0].edits;
    expect(edits.every((e) => e.from >= HEAD.length && e.to <= team.length)).toBe(true);
    expect(applyEdits(team, edits).split('\n')[4]).toContain('start=2026-10-09');
  });

  it('changes nothing in the model or the file until the fix is applied', () => {
    expect(m.files.get('t.plan')!.doc.text).toBe(team);
    expect(files.get('t.plan')).toBe(team);
    expect(m.doc.text).toBe(master);
  });
});
