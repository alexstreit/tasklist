// The schedule plugin's rules (spec §2.11), each diagnostic with its line and severity, parent rows,
// cycles, and how it degrades. Columns of the schedule profile: est | dur | start | deps | due.
// Hour 0 is Monday 5 October 2026; days are 8 hours.

import { applyEdits } from 'rows';
import { describe, expect, it } from 'vitest';
import { analyze, registry } from '../../src/app/registry';
import { unmetReason, resolveFix } from '../../src/core';
import type { ItemNode, Model } from '../../src/core';
import { critical, duration, finish, lateFinish, lateStart, slack, start } from '../../src/plugins/schedule/fields';
import { scheduleRenderer } from '../../src/plugins/schedule/renderers/table';
import example from '../../examples/example.plan?raw';

const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n'; // rows start on line 5
const run = (body: string) => analyze(HEAD + body, { filename: 'a.plan' });

function items(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}
const node = (model: Model, title: string) => items(model).find((n) => n.title === title)!;
const found = (model: Model, code: string) => model.diagnostics.filter((d) => d.code === code).map(({ line, severity, source }) => ({ line, severity, source }));
const at = (model: Model, code: string) => model.diagnostics.filter((d) => d.code === code).map((d) => d.span && model.doc.text.slice(d.span.from, d.span.to));
const scheduleCodes = (model: Model) => model.diagnostics.filter((d) => d.code.startsWith('schedule-') || d.code === 'no-project-start');

describe('diagnostics', () => {
  it('schedule-no-duration: a leaf with no effort or duration that is not a milestone', () => {
    const model = run('A\n^M\nB | 1d\n');
    expect(found(model, 'schedule-no-duration')).toEqual([{ line: 5, severity: 'info', source: 'schedule' }]);
    expect(model.get(node(model, 'A'), duration)).toEqual({ derived: 0, effective: 0, mode: 'derived' });
  });

  it('schedule-milestone-effort: a filled est or dur on a milestone, which is ignored', () => {
    const model = run('^M | 1d | 2d\n');
    expect(found(model, 'schedule-milestone-effort')).toEqual([
      { line: 5, severity: 'warning', source: 'schedule' },
      { line: 5, severity: 'warning', source: 'schedule' },
    ]);
    expect(at(model, 'schedule-milestone-effort')).toEqual(['1d', '2d']);
    expect(model.get(node(model, 'M'), duration)).toEqual({ derived: 0, effective: 0, mode: 'derived' });
    expect(model.get(node(model, 'M'), finish)).toBe(0);
  });

  it('schedule-milestone-parent: the row is treated as a summary', () => {
    const model = run('^P\n    A | 1d\n');
    expect(found(model, 'schedule-milestone-parent')).toEqual([{ line: 5, severity: 'warning', source: 'schedule' }]);
    expect(model.get(node(model, 'P'), duration)).toBeUndefined();
    expect(model.get(node(model, 'P'), finish)).toBe(8);
  });

  it('schedule-summary-duration: a dur pin on a parent is ignored', () => {
    const model = run('P | | 3d\n    A | 1d\n');
    expect(found(model, 'schedule-summary-duration')).toEqual([{ line: 5, severity: 'info', source: 'schedule' }]);
    expect(at(model, 'schedule-summary-duration')).toEqual(['3d']);
    expect(model.get(node(model, 'P'), finish)).toBe(8);
  });

  it('schedule-pin-no-effect: the start pin is earlier than the derived start', () => {
    const model = run('A {#a} | 2d\nB | 1d | | 2026-10-06 | #a\n');
    expect(found(model, 'schedule-pin-no-effect')).toEqual([{ line: 6, severity: 'info', source: 'schedule' }]);
    expect(at(model, 'schedule-pin-no-effect')).toEqual(['2026-10-06']);
    expect(model.get(node(model, 'B'), start)).toEqual({ derived: 16, pin: 8, effective: 16, mode: 'pinned' });
  });

  it('schedule-pin-equals-derived: a start or duration pin equal to its derived value', () => {
    const model = run('A | 1d | 1d | 2026-10-05\nB | 1d | 2d | 2026-10-06\n');
    expect(found(model, 'schedule-pin-equals-derived')).toEqual([
      { line: 5, severity: 'info', source: 'schedule' },
      { line: 5, severity: 'info', source: 'schedule' },
    ]);
    expect(at(model, 'schedule-pin-equals-derived').sort()).toEqual(['1d', '2026-10-05']);
  });

  it('schedule-negative-lag: treated as zero', () => {
    const model = run('A {#a} | 1d\nB | 1d | | | #a -1d\n');
    expect(found(model, 'schedule-negative-lag')).toEqual([{ line: 6, severity: 'warning', source: 'schedule' }]);
    expect(model.get(node(model, 'B'), start)!.effective).toBe(8);
  });

  it('a lag is calendar time: a day is the calendar day, a week five of them', () => {
    const model = run('A {#a} | 1d\nB | 1d | | | #a 1w 2h\n');
    expect(model.get(node(model, 'B'), start)!.effective).toBe(8 + 40 + 2);
  });

  it('a dependency on a parent waits for its latest descendant, plus the lag (Task 35)', () => {
    const model = run('P {#p}\n    A | 1d\n    C | 2d\nB | 1d | | | #p 1d\n');
    expect(scheduleCodes(model)).toEqual([]);
    expect(model.get(node(model, 'B'), start)!.effective).toBe(16 + 8);
  });

  it('schedule-late: the finish passes the row’s own deadline', () => {
    const model = run('A | 2d | | | | 2026-10-05\n');
    expect(found(model, 'schedule-late')).toEqual([{ line: 5, severity: 'warning', source: 'schedule' }]);
    expect(model.diagnostics.find((d) => d.code === 'schedule-late')!.message).toBe('finishes 2026-10-06, after its deadline 2026-10-05');
  });

  it('a row that finishes at the end of its deadline day is not late', () => {
    expect(found(run('A | 1d | | | | 2026-10-05\n'), 'schedule-late')).toEqual([]);
  });

  it('no-project-start: core reports it on line 1 when a scheduling role is bound, with the fix', () => {
    const text = '---\nprofile: schedule\n---\nA | 1d\n';
    const model = analyze(text, { filename: 'a.plan' });
    expect(found(model, 'no-project-start')).toEqual([{ line: 1, severity: 'info', source: undefined }]);
    const d = model.diagnostics.find((x) => x.code === 'no-project-start')!;
    expect(d.message).toBe('Set a project start to compute the schedule');
    expect(d.span).toBeUndefined();
    const fixed = applyEdits(text, resolveFix(d.fixes![0], '2026-10-05').edits);
    expect(fixed).toBe('---\nprofile: schedule\nproject-start: 2026-10-05\n---\nA | 1d\n');
    expect(scheduleCodes(analyze(fixed, { filename: 'a.plan' }))).toEqual([]);
  });

  it('only key-type, not no-project-start, when project-start is not a date', () => {
    const model = analyze('---\nprofile: schedule\nproject-start: soon\n---\nA | 1d\n', { filename: 'a.plan' });
    expect(model.diagnostics.map((d) => d.code)).toEqual(['key-type']);
    expect(model.inactive).toEqual([
      { stage: 'schedule.forward', reason: "project-start isn't a date" },
      { stage: 'schedule.backward', reason: "project-start isn't a date" },
    ]);
  });

  it('source: the plugin for a stage diagnostic, unset for core', () => {
    const model = analyze('---\nprofile: schedule\ncolums: x\n---\nA | 2h\n    B | 1h\n', { filename: 'a.plan' });
    expect(model.diagnostics.map((d) => [d.code, d.source])).toEqual([
      ['no-project-start', undefined],
      ['unknown-key', undefined],
      ['override-differs', 'estimate'],
    ]);
  });
});

describe('dependency cycles', () => {
  const summary = (model: Model) =>
    Object.fromEntries(
      items(model).map((n) => [
        n.title,
        { cycle: model.diagnostics.some((d) => d.code === 'schedule-dep-cycle' && d.line === n.line), start: model.get(n, start)!.effective, finish: model.get(n, finish) },
      ]),
    );

  it('ignores the dependencies in a cycle, and marks each row in it with an error', () => {
    const model = run('A {#a} | 1d | | | #b\nB {#b} | 1d | | | #a\nC {#c} | 1d | | | #a\n');
    expect(found(model, 'schedule-dep-cycle')).toEqual([
      { line: 5, severity: 'error', source: 'schedule' },
      { line: 6, severity: 'error', source: 'schedule' },
    ]);
    expect(summary(model)).toEqual({
      A: { cycle: true, start: 0, finish: 8 },
      B: { cycle: true, start: 0, finish: 8 },
      C: { cycle: false, start: 8, finish: 16 },
    });
  });

  it('gives the same result regardless of row order', () => {
    const rows = ['A {#a} | 1d | | | #b', 'B {#b} | 1d | | | #c', 'C {#c} | 1d | | | #a', 'D {#d} | 1d | | | #a', 'E | 1d | | | #d'];
    const orders = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 4, 0, 3, 1]];
    const results = orders.map((order) => {
      const model = run(order.map((i) => rows[i]).join('\n') + '\n');
      return { rows: summary(model), messages: model.diagnostics.filter((d) => d.code === 'schedule-dep-cycle').map((d) => d.message).sort() };
    });
    expect(results[0].rows).toEqual({
      A: { cycle: true, start: 0, finish: 8 },
      B: { cycle: true, start: 0, finish: 8 },
      C: { cycle: true, start: 0, finish: 8 },
      D: { cycle: false, start: 8, finish: 16 },
      E: { cycle: false, start: 16, finish: 24 },
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('a row depending on itself', () => {
    const model = run('A {#a} | 1d | | | #a\n');
    expect(found(model, 'schedule-dep-cycle')).toEqual([{ line: 5, severity: 'error', source: 'schedule' }]);
    expect(model.get(node(model, 'A'), start)!.effective).toBe(0);
  });

  it('a parent depending on one of its own descendants', () => {
    const model = run('P {#p} | | | | #a\n    A {#a} | 1d\n');
    expect(found(model, 'schedule-dep-cycle').map((d) => d.line)).toEqual([5, 6]);
    expect(model.get(node(model, 'A'), start)!.effective).toBe(0);
  });

  it('a descendant depending on its own parent (Task 35)', () => {
    const model = run('P {#p}\n    M\n        A | 1d | | | #p\n    B | 1d\n');
    expect(found(model, 'schedule-dep-cycle').map((d) => d.line)).toEqual([5, 6, 7]);
    expect(model.diagnostics.find((d) => d.code === 'schedule-dep-cycle' && d.line === 7)!.message).toBe(
      'in a dependency cycle with M, P; the dependencies in the cycle are ignored',
    );
    expect(model.get(node(model, 'A'), start)!.effective).toBe(0);
  });

  it('a parent depending on itself', () => {
    const model = run('P {#p} | | | | #p\n    A | 1d\n');
    expect(found(model, 'schedule-dep-cycle').map((d) => d.line)).toEqual([5, 6]);
    expect(model.get(node(model, 'A'), start)!.effective).toBe(0);
  });
});

describe('parent rows', () => {
  it('a start pin on a parent pushes every descendant', () => {
    const model = run('P | | | 2026-10-07\n    A | 1d\n        A1 | 1d\n    B | 1d\n');
    expect(['A1', 'B'].map((t) => model.get(node(model, t), start))).toEqual([
      { derived: 16, effective: 16, mode: 'derived' },
      { derived: 16, effective: 16, mode: 'derived' },
    ]);
    // The parent: derived is its own floor, effective its earliest descendant start.
    expect(model.get(node(model, 'P'), start)).toEqual({ derived: 0, pin: 16, effective: 16, mode: 'pinned' });
    expect(model.get(node(model, 'P'), finish)).toBe(24);
  });

  it('a dependency on a parent pushes every descendant', () => {
    const model = run('X {#x} | 2d\nP | | | | #x\n    A | 1d\n        A1 | 1d\n    B | 1d\n');
    expect(['A1', 'B'].map((t) => model.get(node(model, t), start)!.effective)).toEqual([16, 16]);
  });

  it('a deadline on a parent limits every descendant’s late finish', () => {
    // P's deadline is the end of Tue 6 Oct, hour 16; Q stretches the project to hour 40.
    const model = run('P | | | | | 2026-10-06\n    A {#a} | 1d\n    B | 1d | | | #a\nQ | 5d\n');
    expect(['A', 'B', 'Q'].map((t) => model.get(node(model, t), lateFinish))).toEqual([8, 16, 40]);
    expect(model.get(node(model, 'P'), slack)).toBe(0);
    expect(model.get(node(model, 'P'), critical)).toBe(true);
  });

  it('a parent as successor: its predecessor must finish by the earliest late start among its descendants', () => {
    // A finishes at 16 and B at 24, the project finish: A's late start is 16, B's 8.
    const model = run('X {#x} | 1d\nP | | | | #x\n    A | 1d\n    B | 2d\n');
    expect(['A', 'B'].map((t) => model.get(node(model, t), lateStart))).toEqual([16, 8]);
    expect(model.get(node(model, 'X'), lateFinish)).toBe(8);
    expect(model.get(node(model, 'X'), slack)).toBe(0);
  });

  it('a parent as predecessor: its successor’s late start, less the lag, limits every descendant’s late finish (Task 35)', () => {
    // A finishes at 8 and B at 16; Y waits for P's finish, 16, plus a day, and finishes at 32.
    const model = run('P {#p}\n    A | 1d\n    B | 2d\nY | 1d | | | #p 1d\nZ | 4d\n');
    expect(model.get(node(model, 'Y'), start)!.effective).toBe(24);
    expect(['A', 'B'].map((t) => model.get(node(model, t), lateFinish))).toEqual([16, 16]);
    expect(['A', 'B', 'P'].map((t) => model.get(node(model, t), slack))).toEqual([8, 0, 0]);
    expect(model.get(node(model, 'P'), critical)).toBe(true);
  });

  it('a parent has no duration, late start or late finish', () => {
    const model = run('P\n    A | 1d\n');
    const p = node(model, 'P');
    expect([model.get(p, duration), model.get(p, lateStart), model.get(p, lateFinish)]).toEqual([undefined, undefined, undefined]);
  });
});

describe('degradation', () => {
  it('an estimate-only file (profile: plan) gets no schedule diagnostics', () => {
    expect(scheduleCodes(analyze(example, { filename: 'example.plan' }))).toEqual([]);
    expect(scheduleCodes(analyze('---\nprofile: plan\n---\n^A\nB | 2h\n', { filename: 'a.plan' }))).toEqual([]);
  });

  it('a profile: schedule file with no project-start gets no-project-start and a greyed schedule table', () => {
    const model = analyze('---\nprofile: schedule\n---\nA | 1d\n', { filename: 'a.plan' });
    expect(scheduleCodes(model).map((d) => d.code)).toEqual(['no-project-start']);
    expect(unmetReason(registry, model, scheduleRenderer.requires)).toBe('needs project-start');
  });

  it('a file with no deps column schedules everything from hour 0', () => {
    const model = analyze('---\nprofile: schedule\nproject-start: 2026-10-05\ncolumns: est:duration unit=h hpd=8 dpw=5 | due:date\n---\nA | 1d\nB | 2d\n', { filename: 'a.plan' });
    expect(model.bindings.roles.has('deps')).toBe(false);
    expect(['A', 'B'].map((t) => [model.get(node(model, t), start)!.effective, model.get(node(model, t), finish)])).toEqual([
      [0, 8],
      [0, 16],
    ]);
    expect(model.inactive).toEqual([]);
  });
});
