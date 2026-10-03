// @vitest-environment jsdom
// Task 41: the shown lines are followed through edits with mapPos until the filter is computed again.
// On examples/demo.plan, `carol web` shows Web app (line 17) and its ancestor Build (line 15),
// dimmed; every other line is hidden.

import { describe, expect, it } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import { trackFilter } from '../../src/app/filter';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { filterRows } from '../../src/core';
import type { Model, Visible } from '../../src/core';

function setup(query = 'carol web') {
  const buffer = new CodeMirrorBuffer(demo);
  const read = () => analyze(buffer.text(), { filename: 'demo.plan', version: buffer.version() });
  const model = read();
  const tracker = trackFilter(model, filterRows(model, query), () => buffer.text());
  buffer.onChange((change) => tracker.map('demo.plan', change));
  /** The file's lines, by number, for which `pick` is true. */
  const lines = (pick: (v: Visible, line: number) => boolean) => () => {
    const now: Model = read();
    const visible = tracker.visible(now);
    return now.lines.map((n) => n.line).filter((line) => pick(visible, line));
  };
  /** Where line `n` starts, and where it ends. */
  const line = (n: number) => {
    const all = buffer.text().split('\n');
    const from = all.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0);
    return { from, to: from + all[n - 1].length };
  };
  return { buffer, shown: lines((v, line) => v.shows({ file: 'demo.plan', line })), dimmed: lines((v, line) => v.dims({ file: 'demo.plan', line })), line };
}

describe('following the shown lines through edits', () => {
  it('starts with the matches and their ancestors, the ancestors dimmed', () => {
    const { shown, dimmed } = setup();
    expect(shown()).toEqual([15, 17]);
    expect(dimmed()).toEqual([15]);
  });

  it('keeps a row being edited, though it no longer matches', () => {
    const { buffer, shown, line } = setup();
    const from = line(17).from + 4;
    buffer.apply([{ from, to: from + 'Web app'.length, insert: 'Website' }], 'text-editor');
    expect(buffer.text().split('\n')[16]).toMatch(/^ {4}Website \{#web\}/);
    expect(shown()).toEqual([15, 17]);
  });

  it('shows a new line typed after a shown row; the hidden lines after it move down', () => {
    const { buffer, shown, dimmed, line } = setup();
    buffer.apply([{ from: line(17).to, to: line(17).to, insert: '\n    Mobile app' }], 'text-editor');
    expect(shown()).toEqual([15, 17, 18]);
    expect(dimmed()).toEqual([15]);
  });

  it('shows a new line typed at the start of a shown row that follows hidden lines', () => {
    const { buffer, shown, dimmed, line } = setup();
    buffer.apply([{ from: line(15).from, to: line(15).from, insert: '\n' }], 'text-editor');
    expect(shown()).toEqual([15, 16, 18]);
    expect(dimmed()).toEqual([16]);
  });

  it('keeps a shown row shown when text is typed at its start', () => {
    const { buffer, shown, dimmed, line } = setup();
    buffer.apply([{ from: line(15).from, to: line(15).from, insert: 'The ' }], 'text-editor');
    expect(shown()).toEqual([15, 17]);
    expect(dimmed()).toEqual([15]);
  });

  it('follows deleted hidden lines, and a deleted shown one goes', () => {
    const { buffer, shown, dimmed, line } = setup();
    // API, line 16, is hidden; then Build, line 15, is deleted too.
    buffer.apply([{ from: line(16).from, to: line(17).from, insert: '' }], 'grid');
    expect(shown()).toEqual([15, 16]);
    buffer.apply([{ from: line(15).from, to: line(16).from, insert: '' }], 'grid');
    expect(shown()).toEqual([15]);
    expect(dimmed()).toEqual([]);
  });

  it('shows a line added at the end of the file when the lines before it are hidden', () => {
    // 2026-11 shows Release (24) and Go-live (26); Docs, User guide and Training are hidden, and so is
    // line 30, the empty line after the file's last line break. The new row is line 31.
    const { buffer, shown } = setup('2026-11');
    expect(shown()).toEqual([24, 26]);
    buffer.apply([{ from: buffer.text().length, to: buffer.text().length, insert: '\nRetrospective' }], 'grid');
    expect(shown()).toEqual([24, 26, 31]);
  });
});
