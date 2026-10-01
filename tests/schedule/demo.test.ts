// The demo plan (Task 32), for the browser pass. Every expected value below was worked out by
// hand. Never take one from output; a disagreement is a question about the plan or the rules.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { ItemNode, Model } from '../../src/core';
import { critical, finish, late, start } from '../../src/plugins/schedule/fields';
import { formatDate } from '../../src/ui/dates';
import demo from '../../examples/demo.plan?raw';

function node(model: Model, title: string): ItemNode {
  const found: ItemNode[] = [];
  const collect = (n: ItemNode): void => void (n.title === title && found.push(n), n.children.forEach(collect));
  model.roots.forEach(collect);
  expect(found).toHaveLength(1);
  return found[0];
}

/** A row's dates as the views show them: its start's day and its finish's. */
function shown(model: Model, title: string): [string, string] {
  const calendar = model.calendar!;
  const n = node(model, title);
  return [
    formatDate(calendar.toDate(model.get(n, start)!.effective, 'start'), calendar),
    formatDate(calendar.toDate(model.get(n, finish)!, 'end'), calendar),
  ];
}

describe('the demo plan', () => {
  const model = analyze(demo, { filename: 'demo.plan' });

  it('reads with no errors, and only Go-live’s lateness as a warning', () => {
    expect(model.inactive).toEqual([]);
    expect(model.diagnostics.filter((d) => d.severity !== 'info').map((d) => [d.line, d.code])).toEqual([[node(model, 'Go-live').line, 'schedule-late']]);
  });

  it('runs Data migration Mon 19 – Wed 21 Oct, from its start pin, on the critical path', () => {
    expect(shown(model, 'Data migration')).toEqual(['Mon 19 Oct', 'Wed 21 Oct']);
    expect(model.get(node(model, 'Data migration'), critical)).toBe(true);
  });

  it('starts System test on Thu 22 Oct', () => {
    expect(shown(model, 'System test')[0]).toBe('Thu 22 Oct');
  });

  it('runs UAT Fri 30 Oct – Tue 3 Nov, after its 2d lag', () => {
    expect(shown(model, 'UAT')).toEqual(['Fri 30 Oct', 'Tue 3 Nov']);
  });

  it('shows Go-live on Wed 4 Nov, late against 2 Nov', () => {
    expect(shown(model, 'Go-live')[1]).toBe('Wed 4 Nov');
    expect(model.get(node(model, 'Go-live'), late)).toBe(true);
  });

  it('without Data migration’s start pin, shows Go-live on Wed 28 Oct, not late', () => {
    const unpinned = analyze(demo.replace('2026-10-19', '          '), { filename: 'demo.plan' });
    expect(shown(unpinned, 'Go-live')[1]).toBe('Wed 28 Oct');
    expect(unpinned.get(node(unpinned, 'Go-live'), late)).toBe(false);
  });
});
