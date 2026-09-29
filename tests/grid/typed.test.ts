// @vitest-environment jsdom
// Typed cell editors and duration normalisation (spec §4b.6.5).

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/core';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';
import { normaliseDuration } from '../../src/grid/typed';

const EST = 2;
const TYPED = '---\nprofile: plan\ncolumns: est:duration unit=h hpd=8 dpw=5 | size:enum[S, M, L] | due:date | ok:bool\n---\n';
const [SIZE, DUE, OK] = [3, 4, 5];

let buffer: InMemoryBuffer;
let grid: GridEditor | null = null;
let host: HTMLElement;

function open(text: string): void {
  host = document.createElement('div');
  document.body.append(host);
  buffer = new InMemoryBuffer(text);
  grid = mountGrid(buffer, host, { onCursorLine: () => {} });
  const mounted = grid;
  buffer.onChange(() => mounted.update(analyze(buffer.text())));
  mounted.update(analyze(buffer.text()));
}

afterEach(() => {
  grid?.destroy();
  grid = null;
  host?.remove();
});

const row = (line: number) => host.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`)!;
const cell = (line: number, column: number) => row(line).querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const lineOf = (line: number) => buffer.text().split('\n')[line - 1];

function edit(line: number, column: number, value: string): void {
  click(cell(line, column), 'dblclick');
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>('tbody .cell-input')!;
  input.value = value;
  press(input, 'Enter');
}

describe('normaliseDuration', () => {
  it.each([
    ['4 Hours', '4h'],
    ['1.5 days', '1.5d'],
    ['2 wks 3d', '2w 3d'],
    ['90 mins', '90m'],
    ['1 hr 30 min', '1h 30m'],
    ['3 WEEKS', '3w'],
    ['+1 day', '+1d'],
    ['2d4h', '2d 4h'],
    ['  4 h  ', '4h'],
  ])('%s → %s', (typed, written) => expect(normaliseDuration(typed)).toBe(written));

  it.each(['soon', '4', '2 d 2 days', '4 parsecs', '1,5d', ''])('%s is left as typed', (typed) => expect(normaliseDuration(typed)).toBe(typed));
});

describe('duration cells', () => {
  it.each([
    ['4 Hours', '4h'],
    ['1.5 days', '1.5d'],
    ['2 wks 3d', '2w 3d'],
    ['90 mins', '90m'],
  ])('%s commits as %s', (typed, written) => {
    open('A | 1h\n');
    edit(1, EST, typed);
    expect(buffer.text()).toBe(`A | ${written}\n`);
  });

  it('writes soon as typed, and shows its warning', () => {
    open('A | 1h\n');
    edit(1, EST, 'soon');
    expect(buffer.text()).toBe('A | soon\n');
    expect(cell(1, EST).classList.contains('warning')).toBe(true);
    expect(cell(1, EST).title).toBe('"soon" is not a valid duration; the text is kept.');
  });

  it('keeps a bare number as written when the column has unit=', () => {
    open('A | 1h\n');
    edit(1, EST, '4');
    expect(buffer.text()).toBe('A | 4\n');
  });

  it('never changes a cell the user did not edit', () => {
    const text = 'A | 4 hours | alice\nB | 1h\n';
    open(text);
    edit(2, EST, '2 hours');
    expect(buffer.text()).toBe('A | 4 hours | alice\nB | 2h\n');
    edit(1, EST + 1, 'bob');
    expect(lineOf(1)).toBe('A | 4 hours | bob');
    // Opening the invalid cell and committing it unchanged writes nothing either.
    const before = buffer.text();
    edit(1, EST, '4 hours');
    expect(buffer.text()).toBe(before);
  });
});

describe('typed editors', () => {
  it('edits an enum with a dropdown of the declared values, and an empty choice clears it', () => {
    open(`${TYPED}A | 1h | S\n`);
    click(cell(5, SIZE), 'dblclick');
    const select = host.querySelector<HTMLSelectElement>('tbody select.cell-input')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'S', 'M', 'L']);
    expect(select.value).toBe('S');
    select.value = 'L';
    press(select, 'Enter');
    expect(lineOf(5)).toBe('A | 1h | L');
    edit(5, SIZE, '');
    expect(lineOf(5)).toBe('A | 1h');
  });

  it('keeps an undeclared enum value choosable, and a typed key picks the first value it starts', () => {
    open(`${TYPED}A | 1h | XL\n`);
    click(cell(5, SIZE), 'dblclick');
    const select = host.querySelector<HTMLSelectElement>('tbody select.cell-input')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'S', 'M', 'L', 'XL']);
    press(select, 'Escape');
    click(cell(5, SIZE));
    press(cell(5, SIZE), 'm');
    expect(host.querySelector<HTMLSelectElement>('tbody select.cell-input')!.value).toBe('M');
  });

  it('edits a date as typed YYYY-MM-DD, with a date picker beside it', () => {
    open(`${TYPED}A | 1h | S | 2026-10-01\n`);
    click(cell(5, DUE), 'dblclick');
    const [text, picker] = [...cell(5, DUE).querySelectorAll('input')];
    expect([text.value, text.placeholder, picker.type]).toEqual(['2026-10-01', 'YYYY-MM-DD', 'date']);
    // The calendar button opens the picker on the typed date, without ending the edit.
    const button = cell(5, DUE).querySelector<HTMLButtonElement>('button.date-button')!;
    expect(button.getAttribute('aria-label')).toBe('Pick a date');
    text.dispatchEvent(new FocusEvent('blur', { relatedTarget: button }));
    button.click();
    expect(picker.value).toBe('2026-10-01');
    expect(buffer.text()).toContain('A | 1h | S | 2026-10-01');
    // Picking a date fills the input and keeps the edit open; Enter commits it.
    picker.value = '2026-11-02';
    picker.dispatchEvent(new Event('change'));
    expect(text.value).toBe('2026-11-02');
    press(text, 'Enter');
    expect(lineOf(5)).toBe('A | 1h | S | 2026-11-02');
  });

  it('shows a bool as a checkbox that the click and Space toggle', () => {
    open(`${TYPED}A | 1h | S | 2026-10-01 | false\nB\n`);
    const box = () => cell(5, OK).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box().checked).toBe(false);
    click(box());
    box().checked = true;
    box().dispatchEvent(new Event('change'));
    expect(lineOf(5)).toBe('A | 1h | S | 2026-10-01 | true');
    click(cell(5, OK));
    press(cell(5, OK), ' ');
    expect(lineOf(5)).toBe('A | 1h | S | 2026-10-01 | false');
    // A row that doesn't set it gets it by name.
    click(cell(6, OK));
    press(cell(6, OK), ' ');
    expect(lineOf(6)).toBe('B | ok=true');
  });

  it('shows a bool that is not true or false as text, so it can be corrected', () => {
    open(`${TYPED}A | 1h | S | 2026-10-01 | yes\n`);
    expect(cell(5, OK).querySelector('input')).toBeNull();
    expect(cell(5, OK).classList.contains('warning')).toBe(true);
    edit(5, OK, 'true');
    expect(lineOf(5)).toBe('A | 1h | S | 2026-10-01 | true');
  });
});
