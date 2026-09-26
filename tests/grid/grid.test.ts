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
const WBS = -1;
const DONE = 0;
const TITLE = 1;
const EST = 2;
const OWNER = 3;
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
// Cells are addressed the way the grid addresses them: a comment or blank row
// has only a WBS cell and one raw cell, so positions do not line up.
const cell = (line: number, column: number) =>
  row(line)!.querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const input = () => host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

/** Double-click a cell, type, and commit with Enter. */
function edit(line: number, column: number, value: string): void {
  click(cell(line, column), 'dblclick');
  input().value = value;
  press(input(), 'Enter');
}

describe('rows', () => {
  it('shows one row per item with its outline number, title and computed values', () => {
    open(example);
    const titles = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.item')].map((r) => r.cells[TITLE + 1].textContent);
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
    // Committing by leaving the cell, which keeps the place (Enter moves down; §4b.4).
    click(cell(2, EST), 'dblclick');
    input().value = '5h';
    input().dispatchEvent(new FocusEvent('blur'));
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 5h\n');
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

// Structure and selection. Spec §4b.4–4b.5; the edits are src/editing's.
describe('rows and structure', () => {
  const select = (line: number) => click(cell(line, WBS));
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`.sheet-toolbar button[data-action="${id}"]`)!;
  const draft = () => host.querySelector<HTMLInputElement>('tr.draft input')!;
  const outline = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.item')].map((r) => r.cells[0].textContent);

  function insert(title: string): void {
    button('insert').click();
    draft().value = title;
    press(draft(), 'Enter');
  }

  it('selects a row through its WBS cell', () => {
    open('Auth\n    Login | 4h\n');
    select(2);
    expect(row(2)!.classList.contains('selected')).toBe(true);
    // Focusing a cell in another row moves the selection off it.
    click(cell(1, TITLE));
    expect(host.querySelectorAll('tr.selected')).toHaveLength(0);
  });

  it('inserts a sibling above a parent, which keeps its children', () => {
    open('Auth\n    Login | 4h\nAdmin\n');
    select(1);
    insert('Setup');
    expect(buffer.text()).toBe('Setup\nAuth\n    Login | 4h\nAdmin\n');
    expect(outline()).toEqual(['1', '2', '2.1', '3']);
    // The place lands on the row that was just created.
    expect(document.activeElement).toBe(cell(1, TITLE));
  });

  it('inserts a new first child above a first child', () => {
    open('Auth\n    Login | 4h\n');
    select(2);
    insert('Design');
    expect(buffer.text()).toBe('Auth\n    Design\n    Login | 4h\n');
    expect(outline()).toEqual(['1', '1.1', '1.2']);
  });

  it('leaves the buffer alone when the draft is abandoned', () => {
    open('Auth\n');
    select(1);
    button('insert').click();
    press(draft(), 'Escape');
    expect(buffer.text()).toBe('Auth\n');
    expect(host.querySelector('tr.draft')).toBeNull();
  });

  it('deletes a row and re-attaches its children to the previous item', () => {
    open('Auth\n    Login | 4h\n        Deep | 1h\nAdmin\n');
    select(2);
    button('delete').click();
    expect(buffer.text()).toBe('Auth\n        Deep | 1h\nAdmin\n');
    expect(outline()).toEqual(['1', '1.1', '2']);
    // The selection lands on the row that took the deleted line.
    expect(row(2)!.cells[TITLE + 1].textContent).toBe('Deep');
    expect(row(2)!.classList.contains('selected')).toBe(true);
  });

  it('indents and outdents a row, and disables the buttons where they would do nothing', () => {
    open('Auth\n    Login | 4h\n    Reset | 1h\n');
    select(1);
    // Nothing above the first root row to become its parent.
    expect(button('indent').disabled).toBe(true);
    expect(button('outdent').disabled).toBe(true);
    select(3);
    expect(button('indent').disabled).toBe(false);
    button('indent').click();
    expect(buffer.text()).toBe('Auth\n    Login | 4h\n        Reset | 1h\n');
    expect(outline()).toEqual(['1', '1.1', '1.1.1']);
    button('outdent').click();
    button('outdent').click();
    expect(buffer.text()).toBe('Auth\n    Login | 4h\nReset | 1h\n');
    expect(button('outdent').disabled).toBe(true);
  });

  it('a row directly below its parent cannot indent further', () => {
    open('Auth\n    Login | 4h\n');
    select(2);
    expect(button('indent').disabled).toBe(true);
  });

  it('moves a row with children by itself, and the selection goes with it', () => {
    open('Auth\n    Login | 4h\nAdmin\n');
    select(1);
    button('down').click();
    expect(buffer.text()).toBe('    Login | 4h\nAuth\nAdmin\n');
    expect(row(2)!.cells[TITLE + 1].textContent).toBe('Auth');
    expect(row(2)!.classList.contains('selected')).toBe(true);
    button('up').click();
    expect(buffer.text()).toBe('Auth\n    Login | 4h\nAdmin\n');
    expect(row(1)!.classList.contains('selected')).toBe(true);
  });

  it('disables move up on the first line and move down on the last', () => {
    open('Auth\nAdmin');
    select(1);
    expect([button('up').disabled, button('down').disabled]).toEqual([true, false]);
    select(2);
    expect([button('up').disabled, button('down').disabled]).toEqual([false, true]);
  });

  it('toggles done from the toolbar, and refuses on a row done through its parent', () => {
    open('~Auth\n    Login | 4h\n');
    select(2);
    expect(button('done').disabled).toBe(true);
    select(1);
    button('done').click();
    expect(buffer.text()).toBe('Auth\n    Login | 4h\n');
  });

  it('disables every button when nothing is selected', () => {
    open('Auth\n');
    for (const id of ['insert', 'delete', 'indent', 'outdent', 'up', 'down', 'done']) {
      expect(button(id).disabled).toBe(true);
    }
  });
});

// The key table, spec §4b.4. One describe per row of the table.
describe('keys', () => {
  const select = (line: number) => click(cell(line, WBS));
  const focus = (line: number, column: number) => click(cell(line, column));
  const key = (k: string, init: KeyboardEventInit = {}) => press(document.activeElement!, k, init);
  const plan = 'Auth | 2d\n    Login | 4h\nAdmin | 1d\n';
  const newTaskInput = () => host.querySelector<HTMLInputElement>('tr.new-task input')!;

  it('Enter moves down a row, reaches the new-task row, and does nothing on a selected row', () => {
    open(plan);
    focus(1, EST);
    key('Enter');
    expect(document.activeElement).toBe(cell(2, EST));
    key('Enter');
    expect(document.activeElement).toBe(cell(3, EST));
    // The file ends with a newline, which leaves no line after it: the last row is line 3.
    key('Enter');
    expect(document.activeElement).toBe(newTaskInput());
    select(1);
    key('Enter');
    expect(document.activeElement).toBe(cell(1, WBS));
  });

  it('Enter in the new-task row commits and creates the line', () => {
    open(plan);
    newTaskInput().value = 'Ops';
    press(newTaskInput(), 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\nAdmin | 1d\nOps\n');
  });

  it('comes back off the new-task row with ArrowUp and Shift+Tab', () => {
    open(plan);
    focus(3, TITLE); // the last row
    key('ArrowDown');
    expect(document.activeElement).toBe(newTaskInput());
    key('ArrowUp');
    expect(document.activeElement).toBe(cell(3, TITLE));
    key('ArrowDown');
    key('Tab', { shiftKey: true });
    // Shift+Tab mirrors the forward wrap: the last cell of the last row.
    expect(document.activeElement).toBe(cell(3, NOTES));
  });

  it('commits from the new-task row when leaving it with text typed', () => {
    open(plan);
    newTaskInput().focus();
    newTaskInput().value = 'Ops';
    key('ArrowUp');
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\nAdmin | 1d\nOps\n');
    expect(document.activeElement).toBe(cell(4, TITLE));
  });

  it('keeps exactly one cell in the tab order, and moves it with the place', () => {
    open(plan);
    const stops = () => [...host.querySelectorAll<HTMLElement>('td[tabindex="0"]')];
    // Nothing placed yet: the way in is the first row's selector.
    expect(stops()).toEqual([cell(1, WBS)]);
    focus(2, EST);
    expect(stops()).toEqual([cell(2, EST)]);
    key('ArrowDown');
    expect(stops()).toEqual([cell(3, EST)]);
    // And it survives a rebuild.
    key('Delete');
    expect(stops()).toEqual([cell(3, EST)]);
  });

  it('takes the place from a cell the keyboard focuses directly', () => {
    open(plan);
    cell(1, WBS).focus();
    expect(row(1)!.classList.contains('selected')).toBe(true);
    key('ArrowDown');
    expect(row(2)!.classList.contains('selected')).toBe(true);
  });

  it('keeps the checkboxes out of the tab order, so Tab does not walk their column', () => {
    open(plan);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('td.check input')];
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.tabIndex)).toEqual([-1, -1, -1]);
  });

  it('Tab walks the cells and wraps across rows; Shift+Tab wraps back', () => {
    open(plan);
    focus(1, DONE);
    key('Tab');
    expect(document.activeElement).toBe(cell(1, TITLE));
    focus(1, NOTES); // the last declared column
    key('Tab');
    expect(document.activeElement).toBe(cell(2, DONE));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(cell(1, NOTES));
    // Not bound on a selected row: that is how the keyboard leaves the grid.
    select(1);
    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('Tab and Insert do not fall through to the browser', () => {
    open(plan);
    focus(1, TITLE);
    expect(key('Tab').defaultPrevented).toBe(true);
    focus(1, TITLE);
    expect(key('Insert').defaultPrevented).toBe(true);
    focus(1, TITLE);
    expect(key('ArrowRight', { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    focus(1, TITLE);
    expect(key('ArrowLeft', { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  });

  it('a printable key starts editing with the content replaced; F2 keeps it, caret at the end', () => {
    open(plan);
    focus(1, EST);
    key('5');
    expect(input().value).toBe('5');
    press(input(), 'Escape');
    focus(1, EST);
    key('F2');
    expect(input().value).toBe('2d');
    expect([input().selectionStart, input().selectionEnd]).toEqual([2, 2]);
  });

  it('Enter and Tab commit an open editor, then move on', () => {
    open(plan);
    focus(1, EST);
    key('3');
    expect(input().value).toBe('3');
    input().value = '3d';
    press(input(), 'Enter');
    expect(buffer.text()).toBe('Auth | 3d\n    Login | 4h\nAdmin | 1d\n');
    expect(document.activeElement).toBe(cell(2, EST));
    key('F2');
    input().value = '5h';
    press(input(), 'Tab');
    expect(buffer.text()).toBe('Auth | 3d\n    Login | 5h\nAdmin | 1d\n');
    expect(document.activeElement).toBe(cell(2, OWNER));
  });

  it('Escape cancels an edit and clears a selection', () => {
    open(plan);
    focus(1, EST);
    key('9');
    press(input(), 'Escape');
    expect(buffer.text()).toBe(plan);
    // Auth overrides its child, so the display carries the child sum back.
    expect(cell(1, EST).textContent).toBe('2d⟨Σ 4h⟩');
    select(1);
    key('Escape');
    expect(host.querySelectorAll('tr.selected')).toHaveLength(0);
    expect(host.querySelector<HTMLButtonElement>('button[data-action="delete"]')!.disabled).toBe(true);
  });

  it('Delete clears a cell, and deletes the line of a selected row', () => {
    open(plan);
    focus(1, EST);
    key('Delete');
    expect(buffer.text()).toBe('Auth\n    Login | 4h\nAdmin | 1d\n');
    select(1);
    key('Delete');
    expect(buffer.text()).toBe('    Login | 4h\nAdmin | 1d\n');
  });

  it('Insert opens a draft above the row, from a cell or a selected row', () => {
    open(plan);
    focus(2, TITLE);
    key('Insert');
    const draft = host.querySelector<HTMLInputElement>('tr.draft input')!;
    expect(document.activeElement).toBe(draft);
    draft.value = 'Design';
    press(draft, 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n    Design\n    Login | 4h\nAdmin | 1d\n');
  });

  it('Alt+Shift+Right/Left indent and outdent the row', () => {
    open(plan);
    focus(3, TITLE);
    key('ArrowRight', { altKey: true, shiftKey: true });
    expect(buffer.text()).toBe('Auth | 2d\n    Login | 4h\n    Admin | 1d\n');
    key('ArrowLeft', { altKey: true, shiftKey: true });
    expect(buffer.text()).toBe(plan);
  });

  it('Alt+Up/Down move the row line', () => {
    open(plan);
    select(3);
    key('ArrowUp', { altKey: true });
    expect(buffer.text()).toBe('Auth | 2d\nAdmin | 1d\n    Login | 4h\n');
    key('ArrowDown', { altKey: true });
    expect(buffer.text()).toBe(plan);
  });

  it('Space toggles done on the checkbox cell only', () => {
    open(plan);
    focus(2, DONE);
    key(' ');
    expect(buffer.text()).toBe('Auth | 2d\n    ~Login | 4h\nAdmin | 1d\n');
    key(' ');
    expect(buffer.text()).toBe(plan);
    // On another cell it is an ordinary printable key.
    focus(2, TITLE);
    key(' ');
    expect(input()).not.toBeNull();
    press(input(), 'Escape');
  });

  it('Ctrl+Z and Ctrl+Y undo and redo the buffer, but Ctrl+Z in an editor cancels the edit', () => {
    open(plan);
    focus(1, EST);
    key('Delete');
    expect(buffer.text()).toBe('Auth\n    Login | 4h\nAdmin | 1d\n');
    key('z', { ctrlKey: true });
    expect(buffer.text()).toBe(plan);
    key('y', { ctrlKey: true });
    expect(buffer.text()).toBe('Auth\n    Login | 4h\nAdmin | 1d\n');
    key('z', { ctrlKey: true });
    // Now with an editor open: the edit is cancelled, the buffer is left alone.
    focus(2, EST);
    key('8');
    expect(input().value).toBe('8');
    press(input(), 'z', { ctrlKey: true });
    expect(host.querySelector('tbody input.cell-input')).toBeNull();
    expect(buffer.text()).toBe(plan);
  });

  it('arrow keys move the focused cell and the selected row', () => {
    open(plan);
    focus(1, TITLE);
    key('ArrowDown');
    expect(document.activeElement).toBe(cell(2, TITLE));
    key('ArrowRight');
    expect(document.activeElement).toBe(cell(2, EST));
    key('ArrowLeft');
    key('ArrowLeft');
    key('ArrowLeft');
    // Left of the checkbox is the WBS cell, which is the row selector.
    expect(document.activeElement).toBe(cell(2, WBS));
    expect(row(2)!.classList.contains('selected')).toBe(true);
    key('ArrowUp');
    expect(row(1)!.classList.contains('selected')).toBe(true);
    expect(row(2)!.classList.contains('selected')).toBe(false);
  });
});

// Comment, blank and front matter rows, and diagnostics on cells. Spec §4b.1–4b.2.
describe('non-item rows', () => {
  const select = (line: number) => click(cell(line, WBS));
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`.sheet-toolbar button[data-action="${id}"]`)!;
  const raw = (line: number) => row(line)!.querySelector<HTMLTableCellElement>('td.raw')!;

  it('shows a comment line as one full-width row of raw text, with no outline number', () => {
    open('Auth | 2d\n    // dropped for now\nAdmin | 1d\n');
    expect(row(2)!.classList.contains('line')).toBe(true);
    expect(raw(2).textContent).toBe('    // dropped for now');
    expect(cell(2, WBS).textContent).toBe('');
    expect(raw(2).colSpan).toBe(2 + 3);
  });

  it('turns a comment row into an item row when the // goes, and back again', () => {
    open('Auth | 2d\n    // Audit log | 2d\n');
    click(cell(2, TITLE), 'dblclick');
    expect(input().value).toBe('    // Audit log | 2d');
    input().value = '    Audit log | 2d';
    press(input(), 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n    Audit log | 2d\n');
    expect(row(2)!.classList.contains('item')).toBe(true);
    expect(cell(2, WBS).textContent).toBe('1.1');
    expect(cell(2, EST).textContent).toBe('2d');
    // And back: the row becomes a comment again.
    click(cell(2, TITLE), 'dblclick');
    input().value = '    // Audit log | 2d';
    press(input(), 'Enter');
    expect(row(2)!.classList.contains('line')).toBe(true);
  });

  it('deletes exactly the comment line', () => {
    open('Auth | 2d\n// note\nAdmin | 1d\n');
    select(2);
    button('delete').click();
    expect(buffer.text()).toBe('Auth | 2d\nAdmin | 1d\n');
  });

  it('renders a blank line between two items, and deletes it', () => {
    open('Auth | 2d\n\nAdmin | 1d\n');
    expect(row(2)!.classList.contains('blank')).toBe(true);
    select(2);
    button('delete').click();
    expect(buffer.text()).toBe('Auth | 2d\nAdmin | 1d\n');
  });

  it('inserts directly above the item, not above the blank line before it', () => {
    open('Auth | 2d\n\nAdmin | 1d\n');
    select(3);
    button('insert').click();
    const draft = host.querySelector<HTMLInputElement>('tr.draft input')!;
    draft.value = 'Ops';
    press(draft, 'Enter');
    expect(buffer.text()).toBe('Auth | 2d\n\nOps\nAdmin | 1d\n');
  });

  it('moves a comment row like any other row', () => {
    open('Auth | 2d\n// note\nAdmin | 1d\n');
    select(2);
    button('down').click();
    expect(buffer.text()).toBe('Auth | 2d\nAdmin | 1d\n// note\n');
  });

  it('collapses the front matter into one read-only row', () => {
    open('---\ncolumns: est:duration | owner:text | notes:text\n---\nAuth | 2d\n');
    const front = host.querySelector<HTMLTableRowElement>('tr.front-matter')!;
    expect(front.querySelector('td.raw')!.textContent).toBe('--- columns: est:duration | owner:text | notes:text ---');
    // Not a row the grid navigates or edits.
    expect(front.querySelectorAll('[data-column]')).toHaveLength(0);
    expect(row(4)!.classList.contains('item')).toBe(true);
  });
});

describe('diagnostics', () => {
  it('outlines the offending cell and shows the message on hover, and clears when it is fixed', () => {
    open('Auth | 4 hours\n');
    const est = cell(1, EST);
    expect(est.classList.contains('warning')).toBe(true);
    expect(est.title).toBe(analyze('Auth | 4 hours\n').diagnostics[0].message);
    click(est, 'dblclick');
    input().value = '4h';
    press(input(), 'Enter');
    expect(cell(1, EST).classList.contains('warning')).toBe(false);
    expect(cell(1, EST).title).toBe('');
  });

  it('marks an override that differs from its children as info, on the cell it belongs to', () => {
    open('Auth | 2d\n    Login | 4h\n');
    expect(cell(1, EST).classList.contains('info')).toBe(true);
    expect(cell(1, EST).title).toBe('override differs from children (2d vs 4h)');
  });

  it('puts a diagnostic on an overflow cell on the row WBS cell', () => {
    open('Auth | 2d | bob | note | extra\n');
    // "too many cells" spans a cell beyond the declared columns.
    expect(cell(1, WBS).classList.contains('error')).toBe(true);
    expect(cell(1, WBS).title).toBe(analyze('Auth | 2d | bob | note | extra\n').diagnostics[0].message);
  });

  it('shows the unclosed front matter error on the front matter row, and keeps the rows after it', () => {
    open('---\ncolumns: est:duration\nAuth | 2d\n');
    const front = host.querySelector<HTMLTableRowElement>('tr.front-matter')!.querySelector<HTMLTableCellElement>('td.raw')!;
    expect(front.classList.contains('error')).toBe(true);
    expect(front.title).toBe(analyze('---\ncolumns: est:duration\nAuth | 2d\n').diagnostics[0].message);
    expect([row(2)!.classList.contains('item'), row(3)!.classList.contains('item')]).toEqual([true, true]);
  });

  it('marks a heading line, which is an item, on its title cell', () => {
    open('# heading\nAuth | 2d\n');
    expect(cell(1, TITLE).classList.contains('error')).toBe(true);
    expect(cell(1, TITLE).title).toBe(analyze('# heading\nAuth | 2d\n').diagnostics[0].message);
  });
});
