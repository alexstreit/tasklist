// @vitest-environment jsdom
// The portfolio reference fixture (Task 35): every expected value below is copied from the table in
// TASKS.md, which was worked out by hand. Never regenerate it from output; a disagreement is a
// question about the rules.

import { describe, expect, it } from 'vitest';
import { createAnalyzer, createRegistry, defineField } from '../../src/core';
import type { ItemNode, Model, Plugin, RenderContext } from '../../src/core';
import { estimatePlugin } from '../../src/plugins/estimate';
import { hasValue, rollup, totals } from '../../src/plugins/estimate/fields';
import { treeRenderer } from '../../src/plugins/estimate/renderers/tree';
import { schedulePlugin } from '../../src/plugins/schedule';
import { critical, finish, late, lateFinish, projectFinish, slack, start } from '../../src/plugins/schedule/fields';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

// A probe plugin: what ctx.targets gives each row's deps cell, by title.
const targets = defineField<string[]>('probe', 'targets', 'node');
const probe: Plugin = {
  id: 'probe',
  requires: [],
  fields: [targets],
  stages: [
    {
      id: 'probe.targets',
      roles: { optional: ['deps'] },
      reads: [],
      writes: [targets],
      run(ctx) {
        const visit = (n: ItemNode): void => (ctx.set(n, targets, ctx.targets(n, 'deps').map((t) => t.title)), n.children.forEach(visit));
        ctx.model.roots.forEach(visit);
      },
    },
  ],
};
const analyze = createAnalyzer(createRegistry([estimatePlugin, schedulePlugin, probe]));
const model = analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve });

interface Expected {
  outline: string;
  file: string;
  /** The est roll-up in hours (5d is 40); null when it has no value. */
  est: number | null;
  /** As the tree shows it: 40h reads 1w, as every whole week does. */
  tree: string;
  start: number;
  finish: number;
  lateFinish?: number;
  slack: number;
  shown: [string, string];
  critical: boolean;
}

// Hours from Mon 5 Oct, 8 a day: 16 is Wed 7, 56 is Wed 14 (a start) or Tue 13 (a finish), 88 is Mon 19.
const P = 'portfolio.plan';
const A = 'teams/alpha.plan';
const B = 'teams/beta.plan';
const expected: Record<string, Expected> = {
  'Product A': { outline: '1', file: P, est: 40, tree: '1w', start: 16, finish: 56, slack: 0, shown: ['Wed 7 Oct', 'Tue 13 Oct'], critical: true },
  Design: { outline: '1.1', file: A, est: 16, tree: '2d', start: 16, finish: 32, lateFinish: 32, slack: 0, shown: ['Wed 7 Oct', 'Thu 8 Oct'], critical: true },
  Build: { outline: '1.2', file: A, est: 24, tree: '3d', start: 32, finish: 56, lateFinish: 56, slack: 0, shown: ['Fri 9 Oct', 'Tue 13 Oct'], critical: true },
  'Product B': { outline: '2', file: P, est: 40, tree: '1w', start: 56, finish: 88, slack: 0, shown: ['Wed 14 Oct', 'Mon 19 Oct'], critical: true },
  Spec: { outline: '2.1', file: B, est: 8, tree: '1d', start: 56, finish: 64, lateFinish: 88, slack: 24, shown: ['Wed 14 Oct', 'Wed 14 Oct'], critical: false },
  Code: { outline: '2.2', file: B, est: 32, tree: '4d', start: 56, finish: 88, lateFinish: 88, slack: 0, shown: ['Wed 14 Oct', 'Mon 19 Oct'], critical: true },
  Tradeshow: { outline: '3', file: P, est: null, tree: '', start: 88, finish: 88, lateFinish: 88, slack: 0, shown: ['Mon 19 Oct', 'Mon 19 Oct'], critical: true },
};

function items(m: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  m.roots.forEach(visit);
  return out;
}
const node = (title: string) => items(model).find((n) => n.title === title)!;
const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, openFile: () => {} };
/** Each body row's title and its cells, from a rendered view. `own` is a cell's first text, without a muted value or a badge. */
function rendered(render: (host: HTMLElement) => void): Record<string, string[]> {
  const host = document.createElement('div');
  render(host);
  const own = (td: HTMLTableCellElement) => td.firstChild?.textContent ?? '';
  return Object.fromEntries([...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => [own(tr.cells[1]), [...tr.cells].map(own)]));
}

describe('the portfolio fixture (examples/portfolio/)', () => {
  it('composes one tree in the order of the table, with no diagnostics', () => {
    expect(items(model).map((n) => n.title)).toEqual(Object.keys(expected));
    expect(model.diagnostics).toEqual([]);
  });

  it.each(Object.entries(expected))('%s', (title, row) => {
    const n = node(title);
    expect({
      outline: n.outlineNumber,
      file: n.file,
      est: model.get(n, hasValue)!.get('est') ? model.get(n, rollup)!.get('est')!.effective : null,
      start: model.get(n, start)!.effective,
      finish: model.get(n, finish),
      lateFinish: model.get(n, lateFinish),
      slack: model.get(n, slack),
      critical: model.get(n, critical),
    }).toEqual({ ...row, tree: undefined, shown: undefined });
    expect(model.get(n, late)).toBe(false);
  });

  it('keeps each row’s line within its own file', () => {
    expect(['Product A', 'Design', 'Build', 'Spec', 'Code'].map((t) => node(t).line)).toEqual([6, 6, 7, 7, 8]);
  });

  it('totals 10d, and finishes the project at hour 88', () => {
    expect(model.value(totals)!.get('est')).toEqual({ effective: 80, doneSum: 0 });
    expect(model.value(projectFinish)).toBe(88);
  });

  it('rolls Product B up by role, from beta’s work column', () => {
    expect(model.get(node('Product B'), rollup)!.get('est')).toEqual({ derived: 40, effective: 40, mode: 'derived' });
    expect(model.field(node('Spec'), model.columns.findIndex((c) => c.name === 'est'))!.text).toBe('1d');
  });

  it('is not late: Product A’s deadline is hour 80 and the Tradeshow’s 120', () => {
    expect(model.calendar!.fromDate('2026-10-16', 'end')).toBe(80);
    expect(model.calendar!.fromDate('2026-10-23', 'end')).toBe(120);
  });

  it('resolves references within each row’s own file: #design in alpha, nothing in beta', () => {
    expect(model.get(node('Build'), targets)).toEqual(['Design']);
    expect(model.get(node('Product B'), targets)).toEqual(['Product A']);
    expect(['Spec', 'Code'].map((t) => model.get(node(t), targets))).toEqual([[], []]);
  });

  it('shows the dates of the table in the schedule table', () => {
    const rows = rendered((host) => scheduleRenderer.render(model, host, ctx));
    expect(Object.fromEntries(Object.entries(rows).map(([title, cells]) => [title, [cells[2], cells[3]]]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([title, row]) => [title, row.shown])),
    );
  });

  it('shows the roll-ups of the table in the tree', () => {
    const rows = rendered((host) => treeRenderer.render(model, host, ctx));
    const est = 2 + model.columns.findIndex((c) => c.name === 'est');
    expect(Object.fromEntries(Object.entries(rows).map(([title, cells]) => [title, cells[est]]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([title, row]) => [title, row.tree])),
    );
  });
});
