// @vitest-environment jsdom
// The grid editor over a buffer. Spec §4b.1–4b.3. The shell's job — analyze
// on every buffer change and hand the model back — is done synchronously here.

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/core';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';
import example from '../../examples/example.plan?raw';

// Cell columns, as the grid numbers them.
const DONE = 0;
const TITLE = 1;
const EST = 2;
const NOTES = 4;

let buffer: InMemoryBuffer;
let grid: GridEditor;
let host: HTMLElement;
let cursorLines: number[] = [];

function open(text: string): void {
  host = document.createElement('div');
  document.body.append(host);
  cursorLines = [];
  buffer = new InMemoryBuffer(text);
  grid = mountGrid(buffer, host, { onCursorLine: (line) => cursorLines.push(line) });
  buffer.onChange(() => grid.update(analyze(buffer.text())));
  grid.update(analyze(buffer.text()));
}

afterEach(() => {
  grid.destroy();
  host.remove();
});

const row = (line: number) => host.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
const cell = (line: number, column: number) => row(line)!.cells[column + 1];
const input = () => host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

/** Double-click a cell, type, and commit with Enter. */
function edit(line: number, column: number, value: string): void {
  click(cell(line, column), 'dblclick');
  input().value = value;
  press(input(), 'Enter');
}

describe('rows', () => {
  it('shows one row per item with its outline number, title and computed values', () => {
    open(example);
    const titles = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((r) => r.cells[TITLE + 1].textContent);
    expect(titles).toEqual(['Auth', 'Login page', 'Password reset', 'OAuth (Google)', 'Consent screen', 'Token refresh', 'Admin', 'User list']);
    expect(row(5)!.cells[0].textContent).toBe('1');
    // Auth overrides its children, so the cell carries the child sum alongside.
    expect(cell(5, EST).textContent).toBe('2d⟨Σ 2d 7h⟩');
  });

  it('shows the document total and the done total', () => {
    open(example);
    const total = host.querySelector<HTMLTableRowElement>('tr.total')!;
    expect(total.cells[EST + 1].textContent).toBe('3ddone 4h');
  });

  it('checks and disables the box on a child of a done parent', () => {
    open('~Auth\n    Login\n');
    const parent = cell(1, DONE).querySelector('input')!;
    const child = cell(2, DONE).querySelector('input')!;
    expect([parent.checked, parent.disabled]).toEqual([true, false]);
    expect([child.checked, child.disabled]).toEqual([true, true]);
  });
});

describe('cell editing', () => {
  it('edits a title', () => {
    open('Auth | 2d\n');
    edit(1, TITLE, 'Authentication');
    expect(buffer.text()).toBe('Authentication | 2d\n');
  });

  it('edits an existing estimate', () => {
    open('Auth                        | 2d\n');
    edit(1, EST, '3d');
    expect(buffer.text()).toBe('Auth                        | 3d\n');
  });

  it('adds the field to a line with no pipes', () => {
    open('Auth\n');
    edit(1, EST, '4h');
    expect(buffer.text()).toBe('Auth | 4h\n');
  });

  it('pads a title-only line when a later column is edited, and trims the padding when it is cleared', () => {
    open('Auth\n');
    edit(1, NOTES, 'later');
    expect(buffer.text()).toBe('Auth | | | later\n');
    edit(1, NOTES, '');
    expect(buffer.text()).toBe('Auth\n');
  });

  it('shows the raw text when editing, not the formatted value', () => {
    open('Auth | 2d 4h\n');
    expect(cell(1, EST).textContent).toBe('2d 4h');
    click(cell(1, EST), 'dblclick');
    expect(input().value).toBe('2d 4h');
    press(input(), 'Escape');
    expect(buffer.text()).toBe('Auth | 2d 4h\n');
  });

  it('Escape leaves the buffer untouched', () => {
    open('Auth | 2d\n');
    click(cell(1, EST), 'dblclick');
    input().value = '9d';
    press(input(), 'Escape');
    expect(buffer.text()).toBe('Auth | 2d\n');
    expect(cell(1, EST).textContent).toBe('2d');
  });

  it('turns a derived parent into an override and back', () => {
    open('Auth\n    Login | 4h\n    Reset | 6h\n');
    expect(cell(1, EST).textContent).toBe('1d 2h');
    expect(cell(1, EST).classList.contains('derived')).toBe(true);
    edit(1, EST, '2d');
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\n    Reset | 6h\n');
    expect(cell(1, EST).textContent).toBe('2d⟨Σ 1d 2h⟩');
    expect(cell(1, EST).querySelector('.muted')!.textContent).toBe('⟨Σ 1d 2h⟩');
    edit(1, EST, '');
    expect(buffer.text()).toBe('Auth\n    Login | 4h\n    Reset | 6h\n');
    expect(cell(1, EST).classList.contains('derived')).toBe(true);
  });

  it('does not open an editor on an additive cell', () => {
    open('Auth | +1d\n    Login | 4h\n');
    click(cell(1, EST), 'dblclick');
    expect(host.querySelector('tbody input.cell-input')).toBeNull();
  });

  it('toggles done with the checkbox', () => {
    open('Auth\n    Login | 4h\n');
    const box = cell(2, DONE).querySelector('input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(buffer.text()).toBe('Auth\n    ~Login | 4h\n');
    const again = cell(2, DONE).querySelector('input')!;
    again.checked = false;
    again.dispatchEvent(new Event('change', { bubbles: true }));
    expect(buffer.text()).toBe('Auth\n    Login | 4h\n');
  });

  it('focuses a row when the preview asks for a line, without reporting it as a user move', () => {
    open('Auth\n    Login | 4h\n');
    click(cell(1, TITLE));
    grid.setCursorLine(2);
    expect(document.activeElement).toBe(cell(2, TITLE));
  });

  it('reports the line of the cell that was clicked', () => {
    open('Auth\n    Login | 4h\n');
    click(cell(2, TITLE));
    expect(cursorLines.at(-1)).toBe(2);
  });
});

describe('focus', () => {
  it('stays on the same cell across an edit and an undo', () => {
    open('Auth | 2d\n    Login | 4h\n');
    edit(2, EST, '5h');
    expect(document.activeElement).toBe(cell(2, EST));
    buffer.undo();
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\n');
    expect(document.activeElement).toBe(cell(2, EST));
  });

  it('follows the line when another edit inserts a line above it', () => {
    open('Auth | 2d\n    Login | 4h\n');
    click(cell(2, TITLE));
    expect(document.activeElement).toBe(cell(2, TITLE));
    buffer.apply([{ from: 10, to: 10, insert: '    Reset | 1h\n' }], 'grid');
    // Login is now line 3, and the focus went with it.
    expect(row(3)!.cells[TITLE + 1].textContent).toBe('Login');
    expect(document.activeElement).toBe(cell(3, TITLE));
  });
});

describe('new task row', () => {
  it('creates a line at the indent of the last item and focuses its title', () => {
    open('Auth | 2d\n    Login | 4h\n');
    const adder = host.querySelector<HTMLInputElement>('tr.new-task input')!;
    adder.value = 'Reset';
    press(adder, 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\n    Reset\n');
    expect(adder.value).toBe('');
    expect(document.activeElement).toBe(cell(3, TITLE));
  });

  it('ignores an empty new task', () => {
    open('Auth | 2d\n');
    const adder = host.querySelector<HTMLInputElement>('tr.new-task input')!;
    press(adder, 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n');
  });
});
