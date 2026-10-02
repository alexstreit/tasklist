// @vitest-environment jsdom
// Task 37: how the grid names a mounted file. By its last path segment, unless two files in the
// composed plan share it; those are named by their path in the folder. Shown here in the refusal a
// cell gives when its file has no column for it, the milestone toggle's tooltip, and the status
// line on a delete.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { ItemNode, Model } from '../../src/core';
import { mountGrid } from '../../src/grid';
import { fileLabel } from '../../src/grid/edits';
import { resolve } from '../support/portfolio';

const MILESTONE = -2;
const NOTES = 8; // the root is a schedule file: est, dur, start, deps, due, owner, notes

// Each team file has its own columns, with no notes column, and the plan profile (no milestone marker).
const team = (task: string) => `---\nprofile: plan\ncolumns: work:duration unit=h hpd=8 dpw=5\nroles: effort=work\n---\n${task} | 1d\n`;
const texts = new Map([
  ['master.plan', '---\nprofile: schedule\n---\nOne | mount=one/plan.plan\nTwo | mount=two/plan.plan\nThree | mount=three/other.plan\n'],
  ['one/plan.plan', team('Alpha')],
  ['two/plan.plan', team('Beta')],
  ['three/other.plan', team('Gamma')],
]);
const own = new Map([...texts].map(([p, t]) => [p, new CodeMirrorBuffer(t)]));
const composed = new ComposedBuffer('master.plan', { buffer: (p) => own.get(p) });
const host = document.createElement('div');
const status: string[] = [];
let grid: ReturnType<typeof mountGrid>;
let model: Model;

function analyzeAll(): Model {
  const files = new Map([...own].filter(([p]) => p !== 'master.plan').map(([p, b]) => [p, b.text()]));
  const next = analyze(own.get('master.plan')!.text(), { filename: 'master.plan', files, resolve, version: composed.version() });
  const mounts: { file: string; line: number; target: string }[] = [];
  const visit = (n: ItemNode): void => void (n.composes && mounts.push({ file: n.file, line: n.line, target: n.composes }), n.children.forEach(visit));
  next.roots.forEach(visit);
  return composed.recompose(mounts, () => '//') ? analyzeAll() : next;
}

beforeAll(() => {
  document.body.append(host);
  grid = mountGrid(composed, host, { onCursorLine: () => {}, status: (message) => status.push(message) });
  composed.onChange(() => grid.update((model = analyzeAll())));
  grid.update((model = analyzeAll()));
});

afterAll(() => {
  grid.destroy();
  composed.destroy();
  host.remove();
});

const row = (file: string, line: number) => host.querySelector<HTMLTableRowElement>(`tbody tr[data-file="${file}"][data-line="${line}"]`)!;
const cell = (file: string, line: number, column: number) => row(file, line).querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const notice = () => host.querySelector('.sheet-notice')?.textContent ?? null;

describe('naming a mounted file', () => {
  it('uses the path for the two plan.plan files, and the last segment for the other', () => {
    expect(fileLabel(model, 'one/plan.plan')).toBe('one/plan.plan');
    expect(fileLabel(model, 'two/plan.plan')).toBe('two/plan.plan');
    expect(fileLabel(model, 'three/other.plan')).toBe('other.plan');
  });

  it('names them so in a refused cell and in the milestone toggle’s tooltip', () => {
    cell('one/plan.plan', 6, NOTES).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(notice()).toBe('one/plan.plan has no column for notes.');
    cell('three/other.plan', 6, NOTES).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(notice()).toBe('other.plan has no column for notes.');
    expect(cell('two/plan.plan', 6, MILESTONE).title).toBe('two/plan.plan has no milestone marker.');
  });

  it('names them so on the status line when a task is deleted', () => {
    const wbs = cell('two/plan.plan', 6, -1);
    wbs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    wbs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(status).toEqual(['Deleted Beta from two/plan.plan.']);
    expect(own.get('two/plan.plan')!.text()).toBe('---\nprofile: plan\ncolumns: work:duration unit=h hpd=8 dpw=5\nroles: effort=work\n---\n');
  });
});
