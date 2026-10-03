// Task 30: the Gantt geometry on the schedule fixture, written from the task's table (worked out by
// hand, like Task 28's), never from output. Units are days: dayWidth 1, with Day's tiers (Task 39).

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { ItemNode, Model } from '../../src/core';
import { deadline } from '../../src/plugins/schedule/fields';
import { ganttGeometry } from '../../src/plugins/schedule/renderers/gantt/geometry';
import type { GanttRow } from '../../src/plugins/schedule/renderers/gantt/geometry';
import { naturalLayout } from '../../src/ui/row-layout';
import fixture from '../../examples/schedule.plan?raw';

const model = analyze(fixture, { filename: 'schedule.plan' });
const natural = naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 0, height: 1000, rowHeight: 22 });
const chart = (today = '2026-10-07') => ganttGeometry(model, natural, { dayWidth: 1, tiers: 'day' }, today);

function titled(m: Model, title: string): ItemNode {
  const found: ItemNode[] = [];
  const visit = (n: ItemNode): void => void ((n.title === title && found.push(n)), n.children.forEach(visit));
  m.roots.forEach(visit);
  return found[0];
}

/** A row as the task's table describes it. */
const describeRow = (row: GanttRow) => ({
  mark: [row.mark.kind, ...(row.critical ? ['critical'] : []), ...(row.late ? ['late'] : []), ...(row.pinned ? ['pinned'] : [])].join(', '),
  x: row.mark.x,
  width: 'width' in row.mark ? row.mark.width : undefined,
  pinX: row.pinX,
});
const rowOf = (title: string) => describeRow(chart().rows.find((r) => r.line === titled(model, title).line)!);

describe('Gantt geometry on the schedule fixture', () => {
  it.each([
    ['Design', 'summary', 0, 1.5, undefined],
    ['Wireframes', 'bar, pinned', 0, 1, 0],
    ['Review', 'bar', 1, 0.5, undefined],
    ['Build', 'summary, critical', 1.5, 5.5, undefined],
    ['API', 'bar, pinned', 1.5, 3, 0],
    ['UI', 'bar, critical, pinned', 5, 2, 5],
    ['Beta ready', 'milestone, critical, late', 7, undefined, undefined],
    ['Docs', 'bar', 2.5, 3, undefined],
  ])('%s: %s at %s, width %s, pinX %s', (title, mark, x, width, pinX) => {
    expect(rowOf(title)).toEqual({ mark, x, width, pinX });
  });

  it('has a mark for every row, in document order, each at its layout row', () => {
    const rows = chart().rows;
    expect(rows.map((r) => r.line)).toEqual(natural.rows.map((r) => r.at!.line));
    expect(rows.map((r) => [r.top, r.height])).toEqual(natural.rows.map((r) => [r.top, r.height]));
  });

  it('puts Beta ready’s deadline field at 48, and its marker at 6', () => {
    const beta = titled(model, 'Beta ready');
    expect(model.get(beta, deadline)).toBe(48);
    expect(chart().rows.find((r) => r.line === beta.line)!.deadlineX).toBe(6);
  });

  it('has the deadline line at 6 (12 Oct), the project finish at 7 and an extent of 8', () => {
    const g = chart();
    expect(g.deadlines).toEqual([{ x: 6, label: 'Mon 12 Oct' }]);
    expect(g.finish).toBe(7);
    expect(g.width).toBe(8);
  });

  // Task 39: at 1px a day the labels overlap, so each tier keeps only its first; the separators stay.
  it('has week separators at 0 and 5 and a tick each day; one label a tier, as the rest overlap', () => {
    const g = chart();
    expect(g.lines).toEqual([0, 5]);
    expect(g.ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(g.top).toEqual([{ x: 0, label: 'Mon 5 Oct' }]);
    expect(g.bottom).toEqual([{ x: 0, label: 'M' }]);
  });

  it('at Day, labels the weeks Mon 5 Oct and Mon 12 Oct, and the day letters every 24px', () => {
    const g = ganttGeometry(model, natural, 'day', '2026-10-07');
    expect(g.top).toEqual([
      { x: 0, label: 'Mon 5 Oct' },
      { x: 120, label: 'Mon 12 Oct' },
    ]);
    expect(g.bottom).toEqual([...'MTWTFMTW'].map((label, d) => ({ x: d * 24, label })));
  });

  it('draws today at 2 on 2026-10-07, and not at all outside the chart', () => {
    expect(chart('2026-10-07').today).toBe(2);
    expect(chart('2026-09-30').today).toBeUndefined();
    expect(chart('2026-11-30').today).toBeUndefined();
  });

  it('scales with dayWidth', () => {
    const g = ganttGeometry(model, natural, { dayWidth: 24, tiers: 'day' }, '2026-10-07');
    expect(describeRow(g.rows.find((r) => r.line === titled(model, 'UI').line)!)).toEqual({ mark: 'bar, critical, pinned', x: 120, width: 48, pinX: 120 });
    expect([g.width, g.finish, g.today]).toEqual([192, 168, 48]);
  });
});

describe('Gantt geometry against a leader’s layout', () => {
  // The fixture as the text editor shows it with Design folded: front matter (lines 1–4), the
  // comment (5), Design (6) with Wireframes (7) and Review (8) folded away, a draft row, then Build (9).
  const layout = {
    version: model.version,
    bodyTop: 4,
    contentHeight: 300,
    scrollTop: 0,
    rows: [
      ...[1, 2, 3, 4, 5].map((line, i) => ({ at: { file: 'schedule.plan', line }, top: i * 20, height: 20 })),
      { at: { file: 'schedule.plan', line: 6 }, top: 100, height: 20 },
      { at: null, top: 120, height: 20 },
      { at: { file: 'schedule.plan', line: 9 }, top: 140, height: 40 },
    ],
  };
  const g = ganttGeometry(model, layout, { dayWidth: 1, tiers: 'day' }, '2026-10-07');

  it('gives comment, front matter and draft rows no mark, nor a folded parent’s children', () => {
    expect(g.rows.map((r) => r.line)).toEqual([6, 9]);
  });

  it('spans a folded parent’s bracket over its children’s dates', () => {
    expect(g.rows[0].mark).toMatchObject({ kind: 'summary', x: 0, width: 1.5 });
  });

  it('takes each mark’s top and height from the layout', () => {
    expect(g.rows.map((r) => [r.top, r.height])).toEqual([
      [100, 20],
      [140, 40],
    ]);
  });

  it('still draws every deadline line and the finish, whichever rows are shown', () => {
    expect(g.deadlines.map((d) => d.x)).toEqual([6]);
    expect(g.finish).toBe(7);
  });
});

