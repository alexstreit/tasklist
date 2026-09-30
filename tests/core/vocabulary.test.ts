// The vocabulary (PLUGINS.md §3, §5–§6): bindVocabulary's diagnostics, the runner skipping a stage
// whose required role or key is missing, and what StageContext reads through the bindings.

import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/app/registry';
import { createAnalyzer, createRegistry } from '../../src/core';
import type { Plugin, Stage, StageContext } from '../../src/core';
import { estimatePlugin } from '../../src/plugins/estimate';
import example from '../../examples/example.plan?raw';

const probe = (stage: Partial<Stage> & { run?: Stage['run'] }): Plugin => ({
  id: 'probe',
  requires: [],
  fields: [],
  stages: [{ id: 'probe.stage', reads: [], writes: [], run: () => {}, ...stage }],
});
const withProbe = (stage: Partial<Stage> = {}) => createAnalyzer(createRegistry([estimatePlugin, probe(stage)]));
const vocabularyCodes = new Set(['unknown-key', 'unknown-role', 'unknown-marker', 'missing-plugin', 'role-type', 'key-type']);
const found = (text: string) =>
  withProbe()(text)
    .diagnostics.filter((d) => vocabularyCodes.has(d.code))
    .map(({ line, severity, code, span, message }) => ({ line, severity, code, at: span && text.slice(span.from, span.to), message }));

describe('bindVocabulary', () => {
  it('reports a bare key outside the vocabulary, but not rows keys, x- keys or project-start', () => {
    expect(found('---\nprofile: plan\ncolums: est\nx-team: core\nproject-start: 2026-10-05\n---\nA\n')).toEqual([
      { line: 3, severity: 'info', code: 'unknown-key', at: 'colums', message: 'unknown frontmatter key "colums"' },
    ]);
  });

  it("reports a qualified key whose plugin isn't registered, and not one whose plugin is", () => {
    expect(found('---\npropricer.rate-table: t1\nprobe.setting: on\n---\nA\n')).toEqual([
      { line: 2, severity: 'info', code: 'missing-plugin', at: 'propricer.rate-table', message: 'frontmatter key "propricer.rate-table" needs the propricer plugin' },
    ]);
  });

  it('reports an unknown bare role, and a qualified role whose plugin is not registered', () => {
    expect(found('---\nroles: size=est propricer.labour=owner probe.who=owner effort=est\n---\nA\n')).toEqual([
      { line: 2, severity: 'info', code: 'unknown-role', at: 'size=est', message: 'unknown role "size"' },
      { line: 2, severity: 'info', code: 'missing-plugin', at: 'propricer.labour=owner', message: 'role "propricer.labour" needs the propricer plugin' },
    ]);
  });

  it('reports an unknown marker', () => {
    expect(found('---\nmarkers: done=~ blocked=!\n---\n!A\n')).toEqual([
      { line: 2, severity: 'info', code: 'unknown-marker', at: 'blocked', message: 'unknown marker "blocked"' },
    ]);
  });

  it('warns on a role the file binds to a column of the wrong type, and leaves it unbound', () => {
    const text = '---\nroles: effort=owner\n---\nA | 2h | sam\n';
    expect(found(text)).toEqual([
      { line: 2, severity: 'warning', code: 'role-type', at: 'effort=owner', message: "the effort role's column owner is text, not a duration or number" },
    ]);
    expect(analyze(text).bindings.roles.has('effort')).toBe(false);
  });

  it("leaves a profile's role on the file's column of the wrong type unbound, with no diagnostic", () => {
    const text = '---\ncolumns: est:text | owner\n---\nA | soon\n';
    expect(found(text)).toEqual([]);
    expect(analyze(text).bindings.mistyped).toEqual(new Map([['effort', "the effort role's column est is text, not a duration or number"]]));
  });

  it('warns on a project-start that is not a date, and treats the key as absent', () => {
    const text = '---\nproject-start: 2026-02-30\n---\nA\n';
    expect(found(text)).toEqual([
      { line: 2, severity: 'warning', code: 'key-type', at: '2026-02-30', message: 'project-start "2026-02-30" is not a date; it is ignored' },
    ]);
    const model = analyze(text);
    expect(model.bindings.keys.has('project-start')).toBe(false);
    expect(model.calendar).toBeUndefined();
  });

  it('binds the plan profile with no diagnostics', () => {
    const model = analyze(example);
    expect(model.bindings.roles).toEqual(new Map([['effort', 'est']]));
    expect(model.bindings.markers).toEqual(new Set(['done']));
    expect(model.diagnostics.filter((d) => vocabularyCodes.has(d.code))).toEqual([]);
  });
});

describe('required roles and keys', () => {
  const effortStage = { roles: { required: ['effort'] } };

  it('runs a stage requiring effort on the §2.10 example', () => {
    const run = vi.fn();
    const model = withProbe({ ...effortStage, run })(example);
    expect(run).toHaveBeenCalledTimes(1);
    expect(model.inactive).toEqual([]);
  });

  it("skips it, with the reason, on a file whose own columns have no est", () => {
    const run = vi.fn();
    const model = withProbe({ ...effortStage, run })('---\ncolumns: size:duration unit=h | owner\n---\nA | 2h\n');
    expect(run).not.toHaveBeenCalled();
    expect(model.inactive).toEqual([{ stage: 'probe.stage', reason: 'needs a column with the effort role' }]);
  });

  it("names the column when the role's column has the wrong type", () => {
    expect(withProbe(effortStage)('---\ncolumns: est:text | owner\n---\nA | soon\n').inactive).toEqual([
      { stage: 'probe.stage', reason: "the effort role's column est is text, not a duration or number" },
    ]);
    expect(withProbe(effortStage)('---\nroles: effort=owner\n---\nA\n').inactive).toEqual([
      { stage: 'probe.stage', reason: "the effort role's column owner is text, not a duration or number" },
    ]);
  });

  it('skips a stage requiring project-start without it, and gives it the calendar with it', () => {
    let seen: StageContext['calendar'];
    const stage = { keys: { required: ['project-start'] }, run: (ctx: StageContext) => void (seen = ctx.calendar) };
    expect(withProbe(stage)('A\n').inactive).toEqual([{ stage: 'probe.stage', reason: 'needs project-start' }]);
    expect(seen).toBeUndefined();
    const model = withProbe(stage)('---\nprofile: plan\nproject-start: 2026-10-05\n---\nA\n');
    expect(model.inactive).toEqual([]);
    expect(seen?.start).toBe('2026-10-05');
    expect(model.calendar).toBe(seen);
  });
});

describe('the stage context', () => {
  const read = (text: string, look: (ctx: StageContext, node: StageContext['model']['roots'][number]) => unknown) => {
    const seen: unknown[] = [];
    withProbe({ roles: { optional: ['effort', 'start'] }, markers: ['done', 'milestone'], run: (ctx) => ctx.model.roots.forEach((r) => seen.push(look(ctx, r))) })(text);
    return seen;
  };

  it("cell reads the typed value in a role's column, and is undefined when the role is unbound or the cell empty", () => {
    expect(read('A | 2d\nB\n', (ctx, node) => ctx.cell(node, 'effort'))).toEqual([{ type: 'duration', sign: null, terms: { d: 2 }, bare: false }, undefined]);
    expect(read('A | 2d\n', (ctx, node) => ctx.cell(node, 'start'))).toEqual([undefined]);
  });

  it("marked reads the row's own marker or NAME=true cell, and is false for a marker the file doesn't use", () => {
    expect(read('~A\nB | done=true\nC\n', (ctx, node) => ctx.marked(node, 'done'))).toEqual([true, true, false]);
    expect(read('~A\n', (ctx, node) => ctx.marked(node, 'milestone'))).toEqual([false]);
  });

  it('bindings are the model bindings', () => {
    expect(read('A\n', (ctx) => ctx.bindings.roles.get('effort'))).toEqual(['est']);
  });
});

describe('the calendar in the model', () => {
  it("takes its day from the effort column's hpd", () => {
    const model = analyze('---\nproject-start: 2026-10-05\ncolumns: est:duration unit=h hpd=6 dpw=5\n---\nA | 1d\n');
    expect(model.calendar!.hoursPerDay).toBe(6);
    expect(model.calendar!.toDate(6, 'start')).toBe('2026-10-06');
    expect(analyze('---\nproject-start: 2026-10-05\ncolumns: size:number\n---\nA\n').calendar!.hoursPerDay).toBe(8);
  });
});

describe('analysis never reads the clock', () => {
  const text = '---\nprofile: plan\nproject-start: 2026-10-05\n---\n' + example.split('---\n')[2];
  /** Everything the model holds that doesn't carry a function. */
  const snapshot = () => {
    const model = analyze(text);
    return {
      diagnostics: model.diagnostics,
      inactive: model.inactive,
      bindings: model.bindings,
      lines: model.lines,
      dates: [0, 8, 40, -8].map((t) => [model.calendar!.toDate(t, 'start'), model.calendar!.toDate(t, 'end')]),
      fromDate: model.calendar!.fromDate('2026-10-12', 'start'),
    };
  };

  it('gives the same model for the same text on different days', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
      const first = snapshot();
      vi.setSystemTime(new Date('2027-03-15T23:59:00Z'));
      expect(snapshot()).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
