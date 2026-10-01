// Each plugin stands alone (PLUGINS.md §6): with only estimate registered nothing estimate computes
// changes, and with only schedule registered the fixture still schedules. And analysis never reads
// the clock: the model is the same on any day, and today's date is never in it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/app/registry';
import { createAnalyzer, createRegistry } from '../../src/core';
import type { FieldKey, ItemNode, Model } from '../../src/core';
import { estimatePlugin } from '../../src/plugins/estimate';
import { doneSum, hasValue, rollup, totals } from '../../src/plugins/estimate/fields';
import { schedulePlugin } from '../../src/plugins/schedule';
import * as schedule from '../../src/plugins/schedule/fields';
import scheduleFixture from '../../examples/schedule.plan?raw';

const files = import.meta.glob(['../fixtures/*.plan', '../../examples/*.plan'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function items(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}

const estimateOf = (model: Model) => ({
  nodes: items(model).map((n) => [model.get(n, rollup), model.get(n, hasValue), model.get(n, doneSum)]),
  totals: model.value(totals),
  diagnostics: model.diagnostics.filter((d) => d.source !== 'schedule'),
});

const scheduleKeys: FieldKey<unknown>[] = [schedule.start, schedule.duration, schedule.finish, schedule.lateStart, schedule.lateFinish, schedule.slack, schedule.critical, schedule.late, schedule.milestone];
const scheduleOf = (model: Model) => ({
  nodes: items(model).map((n) => scheduleKeys.map((key) => model.get(n, key))),
  finish: model.value(schedule.projectFinish),
  diagnostics: model.diagnostics.filter((d) => d.source === 'schedule'),
});

describe('each plugin alone', () => {
  const estimateOnly = createAnalyzer(createRegistry([estimatePlugin]));
  const scheduleOnly = createAnalyzer(createRegistry([schedulePlugin]));

  it.each(Object.entries(files))('with only estimate registered, %s is unchanged', (path, text) => {
    const name = path.split('/').pop()!;
    expect(estimateOf(estimateOnly(text, name))).toEqual(estimateOf(analyze(text, name)));
  });

  it('with only schedule registered, the fixture still schedules', () => {
    const alone = scheduleOnly(scheduleFixture, 'schedule.plan');
    expect(alone.inactive).toEqual([]);
    expect(scheduleOf(alone)).toEqual(scheduleOf(analyze(scheduleFixture, 'schedule.plan')));
    expect(alone.value(schedule.projectFinish)).toBe(56);
  });
});

describe('analysis never reads the clock', () => {
  afterEach(() => vi.useRealTimers());

  const texts = [scheduleFixture, '---\nprofile: schedule\n---\nA | 1d\n', '---\nprofile: schedule\nproject-start: soon\n---\nA | 1d\n'];
  const on = (day: Date, text: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(day);
    const model = analyze(text, 'a.plan');
    vi.useRealTimers();
    return model;
  };

  it.each(texts.map((t) => [t.split('\n')[2], t]))('gives the same model on different days (%s)', (_, text) => {
    const [a, b] = [on(new Date(2026, 8, 29, 12), text), on(new Date(2031, 1, 3, 12), text)];
    expect(JSON.stringify(a.diagnostics)).toBe(JSON.stringify(b.diagnostics));
    expect(scheduleOf(a)).toEqual(scheduleOf(b));
    // Neither day reaches the output; the fixes leave the date for the editor to fill in.
    const output = JSON.stringify(a.diagnostics);
    for (const day of ['2026-09-29', '2031-02-03']) expect(output).not.toContain(day);
  });
});
