// @vitest-environment jsdom
// Task 32: the grid's pinned total row, its current-row band, and hover across panes (spec §4b.1,
// §3.4).

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';

const WBS = -1;
const TITLE = 1;
const NOTES = 4;

let buffer: InMemoryBuffer;
let grid: GridEditor;
let host: HTMLElement;

function open(text: string): void {
  host = document.createElement('div');
  document.body.append(host);
  buffer = new InMemoryBuffer(text);
  grid = mountGrid(buffer, host, { onCursorLine: () => {} });
  buffer.onChange(() => grid.update(analyze(buffer.text())));
  grid.update(analyze(buffer.text()));
}

afterEach(() => {
  grid.destroy();
  host.remove();
});

const row = (line: number) => host.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`)!;
const cell = (line: number, column: number) => row(line).querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const key = (k: string, init: KeyboardEventInit = {}) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const newTask = () => host.querySelector<HTMLInputElement>('tr.new-task input')!;
const banded = (className: string) => [...host.querySelectorAll<HTMLTableRowElement>(`tbody tr.${className}`)].map((tr) => tr.dataset.line);

const plan = 'Auth | 2d\n    ~Login | 4h\n// later\nAdmin | 1d\n';

describe('the total row and the new-task row', () => {
  it('puts the new-task row last in the body, and the total row alone in the footer', () => {
    open(plan);
    const body = [...host.querySelector('tbody')!.rows];
    expect(body[body.length - 1].className).toBe('new-task');
    expect([...host.querySelector('tfoot')!.rows].map((tr) => tr.className)).toEqual(['total']);
  });

  it('keeps the keys: Enter on the last item and Tab off its last cell reach the new-task row, ArrowUp comes back', () => {
    open(plan);
    click(cell(4, TITLE));
    key('Enter');
    expect(document.activeElement).toBe(newTask());
    key('ArrowUp');
    expect(document.activeElement).toBe(cell(4, TITLE));
    click(cell(4, NOTES));
    key('Tab');
    expect(document.activeElement).toBe(newTask());
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(cell(4, NOTES));
  });
});

describe('the current-row band', () => {
  it('bands the row of the focused cell, and moves with the focus', () => {
    open(plan);
    expect(banded('at-cursor')).toEqual([]);
    click(cell(1, TITLE));
    expect(banded('at-cursor')).toEqual(['1']);
    key('ArrowDown');
    expect(banded('at-cursor')).toEqual(['2']);
    key('ArrowDown');
    expect(banded('at-cursor')).toEqual(['3']);
  });

  it('keeps it on a done row, and on a selected row beside its own style', () => {
    open(plan);
    click(cell(2, TITLE));
    expect(row(2).classList.contains('done')).toBe(true);
    expect(banded('at-cursor')).toEqual(['2']);
    click(cell(2, WBS));
    expect(banded('at-cursor')).toEqual(['2']);
    expect(banded('selected')).toEqual(['2']);
  });

  it('keeps it across a rebuild', () => {
    open(plan);
    click(cell(1, TITLE));
    grid.update(analyze(buffer.text()));
    expect(banded('at-cursor')).toEqual(['1']);
  });
});

describe('hover across panes', () => {
  it('reports the line of the row under the pointer, comment rows too, and null off the rows', () => {
    open(plan);
    const lines: (number | null)[] = [];
    grid.onHoverLine((line) => lines.push(line));
    over(cell(1, TITLE));
    over(cell(1, WBS)); // the same row: nothing new
    over(row(3).cells[1]);
    over(newTask());
    over(cell(4, TITLE));
    over(host.querySelector('tfoot td')!);
    over(cell(4, TITLE));
    host.querySelector('table')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(lines).toEqual([1, 3, null, 4, null, 4, null]);
  });

  it('bands the line hovered in the other pane, keeps it across a rebuild, and clears it', () => {
    open(plan);
    grid.setHoverLine(3);
    expect(banded('hover')).toEqual(['3']);
    grid.update(analyze(buffer.text()));
    expect(banded('hover')).toEqual(['3']);
    grid.setHoverLine(9);
    expect(banded('hover')).toEqual([]);
    grid.setHoverLine(1);
    grid.setHoverLine(null);
    expect(banded('hover')).toEqual([]);
  });
});
