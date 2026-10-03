// Task 39: the Gantt's scales, written from the task's hand-worked values, never from output. On
// examples/schedule.plan (extent 8 days) and tests/fixtures/long.plan (one 400d row, extent 401).

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { ItemNode, Model } from '../../src/core';
import { ganttGeometry, labelWidth } from '../../src/plugins/schedule/renderers/gantt/geometry';
import type { GanttLabel, Scale } from '../../src/plugins/schedule/renderers/gantt/geometry';
import { naturalLayout } from '../../src/ui/row-layout';
import fixture from '../../examples/schedule.plan?raw';
import long from '../fixtures/long.plan?raw';

const TODAY = '2026-10-07';
const read = (text: string, filename: string) => {
  const model = analyze(text, { filename });
  return { model, layout: naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 0, height: 1000, rowHeight: 22 }) };
};
const schedule = read(fixture, 'schedule.plan');
const longPlan = read(long, 'long.plan');
const at = (plan: typeof schedule, scale: Scale, chartWidth = 0) => ganttGeometry(plan.model, plan.layout, scale, TODAY, chartWidth);

function titled(m: Model, title: string): ItemNode {
  const found: ItemNode[] = [];
  const visit = (n: ItemNode): void => void ((n.title === title && found.push(n)), n.children.forEach(visit));
  m.roots.forEach(visit);
  return found[0];
}
const markOf = (scale: Scale, title: string) => at(schedule, scale).rows.find((r) => r.line === titled(schedule.model, title).line)!.mark;

describe('Week on the schedule fixture', () => {
  const g = at(schedule, 'week');

  it('is 6px a working day', () => {
    expect(g.dayWidth).toBe(6);
    expect(g.tiers).toBe('week');
  });

  it('places Wireframes at 0, width 6; UI at 30, width 12; Beta ready at 42; the deadline at 36', () => {
    expect(markOf('week', 'Wireframes')).toMatchObject({ kind: 'bar', x: 0, width: 6 });
    expect(markOf('week', 'UI')).toMatchObject({ kind: 'bar', x: 30, width: 12 });
    expect(markOf('week', 'Beta ready')).toEqual({ kind: 'milestone', x: 42 });
    expect(g.deadlines.map((d) => d.x)).toEqual([36]);
  });

  it('labels Oct 2026 at 0 above 5 at 0 and 12 at 30', () => {
    expect(g.top).toEqual([{ x: 0, label: 'Oct 2026' }]);
    expect(g.bottom).toEqual([
      { x: 0, label: '5' },
      { x: 30, label: '12' },
    ]);
  });

  it('keeps the deadline’s label, in its own row, beside Oct 2026: neither drops the other', () => {
    expect(g.deadlines).toEqual([{ x: 36, label: 'Mon 12 Oct' }]);
  });
});

describe('Month on the schedule fixture', () => {
  const g = at(schedule, 'month');

  it('places UI at 7.5, width 3', () => {
    expect(markOf('month', 'UI')).toMatchObject({ kind: 'bar', x: 7.5, width: 3, drawn: 3 });
  });

  it('draws Review’s 0.5 days, 0.75px, at the minimum 2px', () => {
    expect(markOf('month', 'Review')).toMatchObject({ kind: 'bar', width: 0.75, drawn: 2 });
  });

  it('labels 2026 at 0 above Oct at 0', () => {
    expect(g.top).toEqual([{ x: 0, label: '2026' }]);
    expect(g.bottom).toEqual([{ x: 0, label: 'Oct' }]);
  });

  it('draws a summary narrower than its two 3px caps as a bar: Design’s 2.25px, not Build’s 8.25px', () => {
    expect(markOf('month', 'Design')).toMatchObject({ kind: 'summary', width: 2.25, asBar: true });
    expect(markOf('month', 'Build')).toMatchObject({ kind: 'summary', width: 8.25, asBar: false });
    expect(markOf('day', 'Design')).toMatchObject({ kind: 'summary', width: 36, asBar: false });
  });
});

describe('Fit', () => {
  it('at 480px on the schedule fixture is 60px a day, nearest Day (2.5×, against Week’s 10×), with Day’s tiers', () => {
    const g = at(schedule, 'fit', 480);
    expect([g.dayWidth, g.tiers]).toEqual([60, 'day']);
    expect(g.top).toEqual([
      { x: 0, label: 'Mon 5 Oct' },
      { x: 300, label: 'Mon 12 Oct' },
    ]);
  });

  it('at 802px on long.plan is 2px a day, nearest Month (1.33×, against Week’s 3×), with Month’s tiers', () => {
    const g = at(longPlan, 'fit', 802);
    expect([g.dayWidth, g.tiers]).toEqual([2, 'month']);
  });

  it('takes the coarser tiers on a tie: 12px a day is Week, 3px is Month', () => {
    // The fixture's extent is 8 days: 96px gives 12 (2× Week, 2× Day), 24px gives 3 (2× Month, 2× Week).
    expect(at(schedule, 'fit', 96)).toMatchObject({ dayWidth: 12, tiers: 'week' });
    expect(at(schedule, 'fit', 24)).toMatchObject({ dayWidth: 3, tiers: 'month' });
  });

  it('with no width is Day', () => {
    expect(at(schedule, 'fit', 0)).toEqual(at(schedule, 'day'));
    expect(at(schedule, 'fit', -5)).toEqual(at(schedule, 'day'));
  });
});

describe('the named scales', () => {
  it.each([
    ['day', 24],
    ['week', 6],
    ['month', 1.5],
  ] as const)('%s is the same as its explicit pair, %spx a day', (name, dayWidth) => {
    expect(at(schedule, name)).toEqual(at(schedule, { dayWidth, tiers: name }));
    expect(at(longPlan, name)).toEqual(at(longPlan, { dayWidth, tiers: name }));
  });

  it('read the chart width only for Fit', () => {
    expect(at(schedule, 'week', 480)).toEqual(at(schedule, 'week'));
  });
});

describe('long.plan', () => {
  it('has an extent of 401 days', () => {
    const g = at(longPlan, { dayWidth: 1, tiers: 'day' });
    expect(g.width).toBe(401);
  });

  describe('at Month', () => {
    const g = at(longPlan, 'month');

    it('labels Oct at 0, Nov at 30 (2 Nov is day 20), Dec at 61.5 (1 Dec is day 41), Jan at 96 (1 Jan 2027 is day 64)', () => {
      expect(g.bottom.slice(0, 4)).toEqual([
        { x: 0, label: 'Oct' },
        { x: 30, label: 'Nov' },
        { x: 61.5, label: 'Dec' },
        { x: 96, label: 'Jan' },
      ]);
    });

    it('labels 2026 at 0 and 2027 at 96', () => {
      expect(g.top.slice(0, 2)).toEqual([
        { x: 0, label: '2026' },
        { x: 96, label: '2027' },
      ]);
    });

    it('draws full-height lines at the years, 0 and 96, and header ticks at the months', () => {
      expect(g.lines.slice(0, 2)).toEqual([0, 96]);
      expect(g.ticks.slice(0, 4)).toEqual([0, 30, 61.5, 96]);
    });
  });

  it('at Week labels the 2 Nov week at 120', () => {
    expect(at(longPlan, 'week').bottom).toContainEqual({ x: 120, label: '2' });
  });
});

describe('label overlap', () => {
  // Month's tiers at 0.5px a day on long.plan, against the same labels at 100px a day, where none
  // overlap: those are every period's label, at 200 times the position.
  const tight = at(longPlan, { dayWidth: 0.5, tiers: 'month' });
  const wide = at(longPlan, { dayWidth: 100, tiers: 'month' });
  const overlaps = (a: GanttLabel, b: GanttLabel) => b.x < a.x + labelWidth(a.label);

  it.each(['top', 'bottom'] as const)('%s tier: no two labels overlap, and each dropped label is the later of a clashing pair', (tier) => {
    const kept = tight[tier];
    const all = wide[tier].map((l) => ({ x: l.x / 200, label: l.label }));
    for (let i = 1; i < kept.length; i++) expect(overlaps(kept[i - 1], kept[i])).toBe(false);
    for (const label of all) {
      if (kept.some((k) => k.x === label.x && k.label === label.label)) continue;
      const before = kept.filter((k) => k.x < label.x).at(-1)!;
      expect(overlaps(before, label)).toBe(true);
    }
    expect(kept[0]).toEqual(all[0]);
  });

  it('drops some months at 0.5px a day', () => {
    expect(tight.bottom.length).toBeLessThan(wide.bottom.length);
    // Every period still has its full-height line or tick.
    expect(tight.ticks).toHaveLength(wide.ticks.length);
  });
});
