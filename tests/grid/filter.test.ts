// @vitest-environment jsdom
// Task 41, in review: the grid while filtered by `carol` on examples/demo.plan. Rows can't be
// reordered or re-levelled, since hidden rows would move with them unseen; Insert and Delete stay.
// A problem on a hidden row is marked, and clicking it clears the filter and focuses its row.
// Go-live (line 26) is late, and `carol` hides it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import { trackFilter } from '../../src/app/filter';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { filterRows } from '../../src/core';
import { mountGrid } from '../../src/grid';
import type { GridEditor, GridHooks } from '../../src/grid';

let pane: HTMLElement;
let buffer: CodeMirrorBuffer;
let grid: GridEditor;

function open(hooks: Partial<GridHooks> = {}): void {
  pane = document.createElement('div');
  document.body.append(pane);
  buffer = new CodeMirrorBuffer(demo);
  grid = mountGrid(buffer, pane, { onCursorLine: () => {}, ...hooks });
  const model = analyze(buffer.text(), { filename: 'demo.plan', version: buffer.version() });
  grid.setFilter(trackFilter(model, filterRows(model, 'carol'), () => buffer.text()).visible(model));
  grid.update(model);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  grid.destroy();
  pane.remove();
  vi.useRealTimers();
});

const toolbar = (id: string) => pane.querySelector<HTMLButtonElement>(`.sheet-toolbar button[data-action="${id}"]`)!;
const wbs = (line: number) => pane.querySelector<HTMLTableCellElement>(`tbody tr[data-line="${line}"] td[data-column="-1"]`)!;
const select = (line: number) => wbs(line).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const lines = () => [...pane.querySelectorAll<HTMLTableRowElement>('tbody tr[data-line]')].map((tr) => Number(tr.dataset.line));
const problem = (where: string) => [...pane.querySelectorAll<HTMLLIElement>('.problems li')].find((li) => li.querySelector('.where')?.textContent === where)!;

describe('reordering while filtered', () => {
  it('disables Move up, Move down, Indent and Outdent, saying why; Insert row and Delete row stay', () => {
    open();
    // Training (29), Docs' last child, could otherwise move up and outdent.
    select(29);
    for (const id of ['up', 'down', 'indent', 'outdent']) expect([id, toolbar(id).disabled, toolbar(id).title]).toEqual([id, true, 'Clear the filter to reorder rows.']);
    expect([toolbar('insert').disabled, toolbar('delete').disabled]).toEqual([false, false]);
  });

  it('gives the note for their keys, and changes nothing', () => {
    open();
    select(29);
    const before = buffer.text();
    for (const [k, shiftKey] of [
      ['ArrowUp', false],
      ['ArrowDown', false],
      ['ArrowRight', true],
      ['ArrowLeft', true],
    ] as const) {
      key(wbs(29), k, { altKey: true, shiftKey });
      expect(pane.querySelector('.sheet-notice')?.textContent).toBe('Clear the filter to reorder rows.');
    }
    expect(buffer.text()).toBe(before);
  });

  it('enables them again when the filter is cleared', () => {
    open();
    select(29);
    grid.setFilter(null);
    expect(['up', 'outdent'].map((id) => toolbar(id).disabled)).toEqual([false, false]);
  });
});

describe('problems on hidden rows', () => {
  it('are marked "hidden by filter"; problems on shown rows aren’t', () => {
    open();
    expect(problem('Go-live').querySelector('.filter-hidden')?.textContent).toBe('hidden by filter');
    expect(pane.querySelectorAll('.problems .filter-hidden')).toHaveLength(pane.querySelectorAll('.problems li').length - shownProblems());
  });

  it('clicking one asks the shell to clear the filter, then focuses its row', () => {
    const clearFilter = vi.fn(() => grid.setFilter(null));
    open({ clearFilter });
    problem('Go-live').querySelector<HTMLButtonElement>('button.problem')!.click();
    expect(clearFilter).toHaveBeenCalledTimes(1);
    // Every row again: the front matter's one row, then lines 5–29.
    expect(lines()).toHaveLength(26);
    expect(document.activeElement!.closest('tr')!.dataset.line).toBe('26');
    expect(pane.querySelectorAll('.problems .filter-hidden')).toHaveLength(0);
  });

  it('with no shell to clear it, the grid drops its own filter and focuses the row', () => {
    open();
    problem('Go-live').querySelector<HTMLButtonElement>('button.problem')!.click();
    // Every row again: the front matter's one row, then lines 5–29.
    expect(lines()).toHaveLength(26);
    expect(document.activeElement!.closest('tr')!.dataset.line).toBe('26');
  });
});

/** How many problems are on rows `carol` shows: lines 11, 13, 15, 17, 27, 28 and 29 of the demo. */
function shownProblems(): number {
  return [...pane.querySelectorAll<HTMLLIElement>('.problems li')].filter((li) => [11, 13, 15, 17, 27, 28, 29].includes(Number(li.dataset.line))).length;
}
