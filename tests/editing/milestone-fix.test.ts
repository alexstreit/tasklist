// @vitest-environment jsdom
// Task 38: "Use its due date as its date", the undated milestone's click fix, applied in the text
// editor and the grid, on a file of its own and on a mounted file through applyFile, each undone
// by one Ctrl+Z.

import { forEachDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { ItemNode, Model } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import { mountGrid } from '../../src/grid';

const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n';
const PLAN = `${HEAD}Prep | 1d\n^Some task | due=2027-11-29\n`;
const LABEL = 'Use its due date as its date';
const TEAM = `${HEAD}Build | 2d\n^Review | due=2026-10-09\n`;
const MASTER = `${HEAD}Team | mount=t.plan\nWrap | 1d\n`;

/** The fix wrote `start=date` on `line`'s row, and changed nothing else in `text`. */
function expectFixed(written: string, text: string, line: string, date: string): void {
  const at = text.split('\n').indexOf(line);
  const out = written.split('\n');
  expect(out.filter((_, i) => i !== at)).toEqual(text.split('\n').filter((_, i) => i !== at));
  for (const part of line.split(' | ')) expect(out[at]).toContain(part);
  expect(out[at]).toContain(`start=${date}`);
}

beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => document.body.replaceChildren());

const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const actions = (): Diagnostic[] => {
  const out: Diagnostic[] = [];
  forEachDiagnostic(view().state, (d) => out.push(d));
  return out.filter((d) => d.actions?.some((a) => a.name === LABEL));
};
const ctrlZ = (target: EventTarget) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
/** Ctrl+Z in the grid, on a selected row. */
const gridUndo = (host: HTMLElement) => {
  const wbs = host.querySelector<HTMLElement>('tbody tr[data-line] td[data-column="-1"]')!;
  wbs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  ctrlZ(wbs);
};
const fixButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.problems button.fix')].filter((b) => b.textContent === LABEL);

describe('on a file of its own', () => {
  it('the text editor applies it as one edit, and one Ctrl+Z restores the row', () => {
    const buffer = new CodeMirrorBuffer(PLAN);
    const editor = mountTextEditor(buffer, document.body, { onCursorLine: () => {}, onSave: () => {} });
    buffer.onChange(() => editor.update(analyze(buffer.text(), { filename: 'a.plan' })));
    editor.update(analyze(buffer.text(), { filename: 'a.plan' }));
    const d = actions();
    expect(d).toHaveLength(1);
    d[0].actions!.find((a) => a.name === LABEL)!.apply(view(), d[0].from, d[0].to);
    expectFixed(buffer.text(), PLAN, '^Some task | due=2027-11-29', '2027-11-29');
    expect(actions()).toEqual([]);
    ctrlZ(view().contentDOM);
    expect(buffer.text()).toBe(PLAN);
    editor.destroy();
  });

  it('the grid applies it from the problems list, and one Ctrl+Z restores the row', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const buffer = new InMemoryBuffer(PLAN);
    const grid = mountGrid(buffer, host, { onCursorLine: () => {} });
    buffer.onChange(() => grid.update(analyze(buffer.text(), { filename: 'a.plan' })));
    grid.update(analyze(buffer.text(), { filename: 'a.plan' }));
    expect(fixButtons()).toHaveLength(1);
    fixButtons()[0].click();
    expectFixed(buffer.text(), PLAN, '^Some task | due=2027-11-29', '2027-11-29');
    expect(fixButtons()).toEqual([]);
    gridUndo(host);
    expect(buffer.text()).toBe(PLAN);
    grid.destroy();
  });
});

describe('on a mounted file, through applyFile', () => {
  let own: Map<string, CodeMirrorBuffer>;
  let composed: ComposedBuffer;

  /** As the shell analyzes: each file's own text, then the segments the model composes. */
  function analyzeAll(): Model {
    const files = new Map([['t.plan', own.get('t.plan')!.text()]]);
    const model = analyze(own.get('m.plan')!.text(), { filename: 'm.plan', files, resolve: (_from, ref) => ref, version: composed.version() });
    const mounts: { file: string; line: number; target: string }[] = [];
    const visit = (n: ItemNode): void => void (n.composes && mounts.push({ file: n.file, line: n.line, target: n.composes }), n.children.forEach(visit));
    model.roots.forEach(visit);
    if (composed.recompose(mounts, () => '//')) return analyzeAll();
    return model;
  }

  beforeEach(() => {
    own = new Map([
      ['m.plan', new CodeMirrorBuffer(MASTER)],
      ['t.plan', new CodeMirrorBuffer(TEAM)],
    ]);
    composed = new ComposedBuffer('m.plan', { buffer: (p) => own.get(p) });
  });
  afterEach(() => composed.destroy());

  it('the composed text editor writes the team file only, and one Ctrl+Z restores it', () => {
    const editor = mountTextEditor(composed, document.body, { onCursorLine: () => {}, onSave: () => {} });
    editor.update(analyzeAll());
    const d = actions();
    expect(d).toHaveLength(1);
    // Nothing is written until the fix is applied.
    expect(own.get('t.plan')!.text()).toBe(TEAM);
    d[0].actions!.find((a) => a.name === LABEL)!.apply(view(), d[0].from, d[0].to);
    editor.update(analyzeAll());
    expectFixed(own.get('t.plan')!.text(), TEAM, '^Review | due=2026-10-09', '2026-10-09');
    expect(own.get('m.plan')!.text()).toBe(MASTER);
    expect(actions()).toEqual([]);
    ctrlZ(view().contentDOM);
    expect(own.get('t.plan')!.text()).toBe(TEAM);
    editor.destroy();
  });

  it('the composed grid writes the team file only, and one Ctrl+Z restores it', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const grid = mountGrid(composed, host, { onCursorLine: () => {} });
    grid.update(analyzeAll());
    expect(fixButtons()).toHaveLength(1);
    expect(own.get('t.plan')!.text()).toBe(TEAM);
    fixButtons()[0].click();
    grid.update(analyzeAll());
    expectFixed(own.get('t.plan')!.text(), TEAM, '^Review | due=2026-10-09', '2026-10-09');
    expect(own.get('m.plan')!.text()).toBe(MASTER);
    expect(fixButtons()).toEqual([]);
    gridUndo(host);
    expect(own.get('t.plan')!.text()).toBe(TEAM);
    grid.destroy();
  });
});
