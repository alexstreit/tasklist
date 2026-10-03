// Composition (Task 35): the mount diagnostics, each on its mount row in the file that holds it;
// mapping columns across files; and a mounted file's own diagnostics, which keep their file.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { ItemNode, Model } from '../../src/core';
import { rollup, totals } from '../../src/plugins/estimate/fields';
import { start } from '../../src/plugins/schedule/fields';
import { resolve } from '../support/portfolio';

const compose = (text: string, files: Record<string, string | null>, filename = 'root.plan') =>
  analyze(text, { filename, files: new Map(Object.entries(files)), resolve });
const mounts = (model: Model) =>
  model.diagnostics.filter((d) => d.code.startsWith('mount-')).map(({ line, severity, code, file }) => ({ line, severity, code, ...(file ? { file } : {}) }));
function items(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => (out.push(n), n.children.forEach(visit));
  model.roots.forEach(visit);
  return out;
}
const titles = (model: Model) => items(model).map((n) => `${n.outlineNumber} ${n.title}`);

describe('mount diagnostics', () => {
  it('mount-missing: the file isn’t found or can’t be read', () => {
    const model = compose('A\nB | mount=gone.plan\n', { 'gone.plan': null });
    expect(mounts(model)).toEqual([{ line: 2, severity: 'warning', code: 'mount-missing' }]);
    expect(titles(model)).toEqual(['1 A', '2 B']);
  });

  it('mount-loop: three files mounting each other, reported once, on the mount that closes it', () => {
    const model = compose('A | mount=b.plan\n', { 'b.plan': 'B | mount=c.plan\n', 'c.plan': 'X\nC | mount=a.plan\n' }, 'a.plan');
    expect(mounts(model)).toEqual([{ line: 2, severity: 'error', code: 'mount-loop', file: 'c.plan' }]);
    expect(titles(model)).toEqual(['1 A', '1.1 B', '1.1.1 X', '1.1.2 C']);
  });

  it('mount-loop: a file mounting itself', () => {
    expect(mounts(compose('A | mount=./root.plan\n', {}))).toEqual([{ line: 1, severity: 'error', code: 'mount-loop' }]);
  });

  it('mount-outside: the path resolves outside the folder', () => {
    const model = compose('A\n    B | mount=../../x.plan\n', {}, 'teams/root.plan');
    expect(mounts(model)).toEqual([{ line: 2, severity: 'error', code: 'mount-outside' }]);
    expect(model.diagnostics.find((d) => d.code === 'mount-outside')!.message).toBe('../../x.plan from teams/root.plan is outside the folder');
  });

  it('mount-overlap: the first mount in document order wins, the second shows nothing', () => {
    const model = compose('A\n    A1 | mount=t.plan\nB | mount=t.plan\n', { 't.plan': 'T | 1h\n' });
    expect(mounts(model)).toEqual([{ line: 3, severity: 'warning', code: 'mount-overlap' }]);
    expect(titles(model)).toEqual(['1 A', '1.1 A1', '1.1.1 T', '2 B']);
  });

  it('mount-overlap counts composed order: a mount nested in a mounted file comes before a later root row’s', () => {
    const model = compose('A | mount=m.plan\nB | mount=t.plan\n', { 'm.plan': 'M | mount=t.plan\n', 't.plan': 'T\n' });
    expect(mounts(model)).toEqual([{ line: 2, severity: 'warning', code: 'mount-overlap' }]);
    expect(titles(model)).toEqual(['1 A', '1.1 M', '1.1.1 T', '2 B']);
  });

  it('mount-part-unsupported: a #part mount shows nothing for now', () => {
    const model = compose('A {#a} | mount=t.plan#backend\n', { 't.plan': 'T\n' });
    expect(mounts(model)).toEqual([{ line: 1, severity: 'info', code: 'mount-part-unsupported' }]);
    expect(titles(model)).toEqual(['1 A']);
  });

  it('mount-needs-folder: in the single-file workspace, every mount says to open the folder', () => {
    const model = analyze('A | mount=t.plan\nB | mount=u.plan\n', { filename: 'root.plan' });
    expect(mounts(model)).toEqual([
      { line: 1, severity: 'info', code: 'mount-needs-folder' },
      { line: 2, severity: 'info', code: 'mount-needs-folder' },
    ]);
    expect(model.diagnostics[0].message).toBe('Open the folder to see mounted plans.');
  });

  it('a file not gathered yet shows nothing, with nothing to report', () => {
    const model = compose('A | mount=t.plan\n', {});
    expect(mounts(model)).toEqual([]);
    expect(titles(model)).toEqual(['1 A']);
  });

  it('spans the path, and the part with it', () => {
    const text = 'A | mount=x/t.plan#p\n';
    const d = compose(text, {}).diagnostics[0];
    expect(text.slice(d.span!.from, d.span!.to)).toBe('x/t.plan#p');
  });
});

describe('composition', () => {
  it('puts a mount row’s own children first, then the mounted file’s roots; mounts nest', () => {
    const model = compose('A | mount=t.plan\n    Own\n', { 't.plan': 'T1\nT2 | mount=u.plan\n', 'u.plan': 'U\n' });
    expect(titles(model)).toEqual(['1 A', '1.1 Own', '1.2 T1', '1.3 T2', '1.3.1 U']);
    expect(items(model).map((n) => n.file)).toEqual(['root.plan', 'root.plan', 't.plan', 't.plan', 'u.plan']);
    expect(items(model)[0].mount).toBe('t.plan');
  });

  it('resolves a nested mount relative to the file that holds it', () => {
    const model = compose('A | mount=teams/t.plan\n', { 'teams/t.plan': 'T | mount=../shared/u.plan\n', 'shared/u.plan': 'U\n' });
    expect(items(model).map((n) => n.file)).toEqual(['root.plan', 'teams/t.plan', 'shared/u.plan']);
  });

  it('keeps the root file’s doc and lines, and lists every file with its own', () => {
    const model = compose('// c\nA | mount=t.plan\n', { 't.plan': 'T\n' });
    expect(model.lines.map((l) => l.kind)).toEqual(['comment', 'item']);
    expect([...model.files.keys()]).toEqual(['root.plan', 't.plan']);
    expect(model.files.get('t.plan')!.lines.map((l) => l.kind)).toEqual(['item']);
    expect(model.files.get('t.plan')!.lines[0]).toBe(items(model)[1]);
  });

  it('a done mount row makes its mounted rows done: it is an ordinary parent', () => {
    const model = compose('~A | mount=t.plan\n', { 't.plan': 'T\n' });
    expect(items(model).map((n) => n.done)).toEqual([true, true]);
  });

  it('an estimate on the mount row is the master’s figure, compared with the team’s', () => {
    const model = compose('A | 2d | mount=t.plan\n', { 't.plan': 'T | 3d\n' });
    expect(model.get(model.roots[0], rollup)!.get('est')).toEqual({ derived: 24, pin: 16, effective: 16, mode: 'pinned' });
    expect(model.diagnostics.map((d) => d.code)).toEqual(['override-differs']);
  });
});

describe('columns across files', () => {
  const est = (model: Model) => model.columns.findIndex((c) => c.name === 'est');
  const notes = (model: Model) => model.columns.findIndex((c) => c.name === 'notes');

  it('a mounted column matched by name only, with no role, maps', () => {
    const team = '---\ncolumns: est:duration unit=h hpd=8 dpw=5 | notes:text\nroles: effort=\n---\nT | 1d | hello\n';
    const model = compose('A | mount=t.plan\n', { 't.plan': team });
    const t = items(model)[1];
    expect(model.field(t, est(model))!.amount).toBe(8);
    expect(model.field(t, notes(model))!.text).toBe('hello');
    expect(model.value(totals)!.get('est')!.effective).toBe(8);
  });

  it('a root column matched by neither shows blank, with no diagnostic', () => {
    const team = '---\ncolumns: work:duration unit=h hpd=8 dpw=5 | remark:text\nroles: effort=work\n---\nT | 1d | hello\n';
    const model = compose('A | mount=t.plan\n', { 't.plan': team });
    const t = items(model)[1];
    expect(model.field(t, notes(model))).toBeNull();
    expect(model.field(t, est(model))!.amount).toBe(8);
    expect(model.diagnostics).toEqual([]);
  });

  it('matches by role first, then by name among the columns not taken, so no value counts twice', () => {
    // The root's est has the effort role; its work column has none. The team's work is its effort.
    const root = '---\ncolumns: est:duration unit=h hpd=8 dpw=5 | work:duration unit=h hpd=8 dpw=5\n---\nA | | | mount=t.plan\n';
    const team = '---\ncolumns: work:duration unit=h hpd=8 dpw=5\nroles: effort=work\n---\nT | 1d\n';
    const model = compose(root, { 't.plan': team });
    const t = items(model)[1];
    const work = model.columns.findIndex((c) => c.name === 'work');
    expect(model.field(t, est(model))!.amount).toBe(8);
    expect(model.field(t, work)).toBeNull();
    expect([...model.value(totals)!].map(([name, total]) => [name, total.effective])).toEqual([
      ['est', 8],
      ['work', 0],
    ]);
  });

  it('reads a mounted file’s summable cells with its own column’s hpd', () => {
    const team = '---\ncolumns: est:duration unit=h hpd=6 dpw=5\n---\nT | 1d\n';
    const model = compose('A | mount=t.plan\n', { 't.plan': team });
    expect(model.get(model.roots[0], rollup)!.get('est')!.effective).toBe(6);
  });
});

describe('a mounted file’s diagnostics', () => {
  const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n';

  it('keep its file, with lines in it; a stage’s warning lands on the mounted row, not the root’s line of the same number', () => {
    // Line 5 of each file: the root's A, and the team's milestone with an estimate, and no date or dependency (Task 38).
    const model = compose(`${HEAD}A | mount=t.plan\n`, { 't.plan': `${HEAD}^M | 1d\n` });
    expect(model.diagnostics.map(({ line, code, file, source }) => ({ line, code, file, source }))).toEqual([
      { line: 5, code: 'schedule-milestone-effort', file: 't.plan', source: 'schedule' },
      { line: 5, code: 'schedule-milestone-undated', file: 't.plan', source: 'schedule' },
    ]);
    const d = model.diagnostics[0];
    expect(model.files.get('t.plan')!.doc.text.slice(d.span!.from, d.span!.to)).toBe('1d');
  });

  it('come after the root file’s, file by file in composed order', () => {
    const model = compose('A | mount=t.plan\nB | 1x\n', { 't.plan': 'T | 1x\n' });
    expect(model.diagnostics.map(({ line, file }) => ({ line, file }))).toEqual([{ line: 2 }, { line: 1, file: 't.plan' }]);
  });

  it('a mounted file’s own markers decide what is a milestone', () => {
    // The team's file is a plan: it has no milestone marker, so ^M is a title.
    const model = compose(`${HEAD}A | mount=t.plan\n`, { 't.plan': '^M | 1d\n' });
    expect(items(model)[1].title).toBe('^M');
    expect(model.get(items(model)[1], start)!.effective).toBe(0);
  });
});
