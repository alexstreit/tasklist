// @vitest-environment jsdom
// Errors and repair in the grid (spec §4b.6): level-based structure
// operations, auto repairs in the same change as the edit, nothing written on
// read, and the problems list.

import { afterEach, describe, expect, it } from 'vitest';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import type { PlanBuffer } from '../../src/buffer';
import { analyze } from '../../src/core';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';
import cases from '../fixtures/repair-cases.plan?raw';

const WBS = -1;
const TITLE = 1;
const EST = 2;

let buffer: PlanBuffer;
let grid: GridEditor;
let host: HTMLElement;
let origins: string[];

function open(text: string, make: (text: string) => PlanBuffer = (t) => new InMemoryBuffer(t)): void {
  host = document.createElement('div');
  document.body.append(host);
  buffer = make(text);
  origins = [];
  grid = mountGrid(buffer, host, { onCursorLine: () => {} });
  // The shell's job, done synchronously.
  buffer.onChange((change) => {
    origins.push(change.origin);
    grid.update(analyze(buffer.text()));
  });
  grid.update(analyze(buffer.text()));
}

afterEach(() => {
  grid.destroy();
  host.remove();
});

const row = (line: number) => host.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
const cell = (line: number, column: number) => row(line)!.querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
const button = (id: string) => host.querySelector<HTMLButtonElement>(`.sheet-toolbar button[data-action="${id}"]`)!;
const select = (line: number) => click(cell(line, WBS));
function edit(line: number, column: number, value: string): void {
  click(cell(line, column), 'dblclick');
  const input = host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
  input.value = value;
  press(input, 'Enter');
}
const valid = () => expect(analyze(buffer.text()).diagnostics).toEqual([]);

describe('structure operations work in levels (spec §4b.6.4)', () => {
  it('Insert above the third row of a 0 / 8 / 4 file succeeds, and rewrites that row in the same undo step', () => {
    const text = 'A\n        B\n    C\n';
    open(text);
    select(3);
    button('insert').click();
    const draft = host.querySelector<HTMLInputElement>('tr.draft input')!;
    expect(draft.closest('td')!.style.paddingLeft).toBe('3em'); // the draft shows at C's level, indent 8
    draft.value = 'X';
    press(draft, 'Enter');
    expect(buffer.text()).toBe('A\n        B\n        X\n        C\n');
    valid();
    expect(document.activeElement).toBe(cell(3, TITLE));
    buffer.undo();
    expect(buffer.text()).toBe(text);
  });

  it('a first child moves above its parent by outdent, then move up, and gives a valid file', () => {
    open('Auth\n    Login | 4h\n');
    select(2);
    expect(button('up').disabled).toBe(true);
    button('outdent').click();
    button('up').click();
    expect(buffer.text()).toBe('Login | 4h\nAuth\n');
    valid();
    expect(row(1)!.classList.contains('selected')).toBe(true);
  });

  it('A / B / C / D (ext §6.2): deleting B gives a valid file, A with children C and D', () => {
    open('A\n        B\n    C\n    D\n');
    select(2);
    button('delete').click();
    expect(buffer.text()).toBe('A\n    C\n    D\n');
    valid();
    const outline = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.item')].map((r) => r.cells[0].textContent);
    expect(outline).toEqual(['1', '1.1', '1.2']);
  });

  it('indent and outdent a row with its children', () => {
    open('A\nB\n    C\nD\n');
    select(2);
    button('indent').click();
    expect(buffer.text()).toBe('A\n    B\n        C\nD\n');
    button('outdent').click();
    expect(buffer.text()).toBe('A\nB\n    C\nD\n');
  });

  it('first rewrites a row whose indent fits no level', () => {
    open('A\n        B\n    C\n');
    select(3);
    button('outdent').click();
    expect(buffer.text()).toBe('A\n        B\nC\n');
    valid();
  });

  it('keeps comment rows on the raw line operations', () => {
    open('A\n// note\nB\n');
    select(2);
    button('indent').click();
    expect(buffer.text()).toBe('A\n    // note\nB\n');
  });

  it('never moves a row into the front matter', () => {
    open('---\nprofile: plan\n---\nA\nB\n');
    select(4);
    expect(button('up').disabled).toBe(true);
  });
});

describe('auto repairs go with the grid edit that touches the row (spec §4b.6.1)', () => {
  const broken = 'Login | 4h | alice | "call Bob | then Alice\n';

  it('an edit to a row with an unterminated quote in another cell leaves that text and removes the error', () => {
    open(broken);
    edit(1, EST, '5h');
    expect(buffer.text()).toBe('Login | 5h | alice | "call Bob | then Alice"\n');
    expect(analyze(buffer.text()).roots[0].cells[2]).toMatchObject({ value: 'call Bob | then Alice' });
    valid();
  });

  it('an edit and its repairs undo with one Ctrl+Z', () => {
    open(broken, (text) => new CodeMirrorBuffer(text));
    edit(1, EST, '5h');
    expect(origins).toEqual(['grid']);
    press(cell(1, EST), 'z', { ctrlKey: true });
    expect(buffer.text()).toBe(broken);
  });

  it('the title edit of a heading row writes the title itself, quoted, and snaps its indent', () => {
    open('A\n        B\n    # C | 1h\n');
    edit(3, TITLE, '# D');
    expect(buffer.text()).toBe('A\n        B\n        "# D" | 1h\n');
    valid();
  });

  it('a toggle of done on a row with a heading title leaves it valid: the marker comes first', () => {
    open('# Foo | 1h\n');
    click(cell(1, 0).querySelector('input')!);
    expect(buffer.text()).toBe('~# Foo | 1h\n');
    expect(analyze(buffer.text()).roots[0]).toMatchObject({ title: '# Foo', done: true });
    valid();
  });
});

describe('nothing is repaired on read (spec §4b.6.1)', () => {
  it('opening a file with errors, or receiving a remote change, writes nothing', () => {
    open(cases);
    expect(origins).toEqual([]);
    buffer.apply([{ from: buffer.text().length, to: buffer.text().length, insert: '    # Remote\n' }], 'remote');
    expect(origins).toEqual(['remote']);
    expect(buffer.text()).toBe(cases + '    # Remote\n');
  });
});

describe('the problems list (spec §4b.6.3)', () => {
  const entries = () => [...host.querySelectorAll<HTMLLIElement>('.problems li')];

  it('lists every diagnostic of a file with one of each case, in document order, and a click focuses its row', () => {
    open(cases);
    const diagnostics = analyze(cases).diagnostics;
    expect(host.querySelector('.problems summary')!.textContent).toBe(`Problems (${diagnostics.length})`);
    expect(host.querySelector<HTMLDetailsElement>('.problems')!.open).toBe(false);
    const listed = entries().map((li) => `${li.dataset.line} ${li.querySelector('.message')!.textContent}`);
    expect([...listed].sort()).toEqual(diagnostics.map((d) => `${d.line} ${d.message}`).sort());
    const lines = entries().map((li) => Number(li.dataset.line));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    for (const code of ['bad-indent', 'parent-mismatch', 'parent-cycle', 'unterminated-quote', 'text-after-quote', 'unknown-escape', 'too-many-cells', 'unnamed-after-named', 'invalid-cell-name', 'column-set-twice', 'invalid-value', 'row-begins-with-delimiter', 'heading-line', 'repeated-marker', 'html-comment', 'unconvertible-duration', 'duplicate-column-name', 'malformed-type', 'unsupported-format', 'duplicate-id', 'id-case-conflict', 'unresolved-ref']) {
      expect(diagnostics.some((d) => d.code === code), code).toBe(true);
    }

    let focused = 0;
    for (const li of entries()) {
      const line = li.dataset.line!;
      click(li.querySelector('.problem')!);
      if (!row(Number(line))) continue; // the front matter has no row to focus
      expect((document.activeElement as HTMLElement).closest('tr')!.dataset.line, li.textContent!).toBe(line);
      focused++;
    }
    expect(focused).toBe(diagnostics.filter((d) => d.line > 5).length);
  });

  it('focuses the cell a spanned diagnostic is in, and the row selector otherwise', () => {
    open('A | 4 hours\n    ~~B\n');
    const [invalid, repeated] = entries();
    click(invalid.querySelector('.problem')!);
    expect(document.activeElement).toBe(cell(1, EST));
    expect(invalid.querySelector('.where')!.textContent).toBe('A');
    click(repeated.querySelector('.problem')!);
    expect(document.activeElement).toBe(cell(2, TITLE));
  });

  it('shows the unclosed front matter case', () => {
    open('---\nprofile: plan\nA\n');
    expect(entries().map((li) => li.querySelector('.message')!.textContent)).toContain(analyze('---\nprofile: plan\nA\n').diagnostics[0].message);
    expect(entries()[0].querySelector('.where')!.textContent).toBe('Line 1');
  });

  it('applies auto and click fixes on a click', () => {
    open('A\n        B\n    C\n~~D\n');
    const fix = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.problems .fix')].find((b) => b.textContent === label)!;
    fix('Rewrite the indent').click();
    expect(buffer.text()).toBe('A\n        B\n        C\n~~D\n');
    fix('Remove extra marker').click();
    expect(buffer.text()).toBe('A\n        B\n        C\n~D\n');
    expect(host.querySelector('.problems summary')!.textContent).toBe('Problems (0)');
  });

  it('shows a confirm fix’s change first; cancelling writes nothing', () => {
    const text = 'A\n    <!-- note -->\n';
    open(text);
    const fixButton = host.querySelector<HTMLButtonElement>('.problems .fix')!;
    fixButton.click();
    expect(buffer.text()).toBe(text);
    const preview = host.querySelector('.problems .fix-preview')!;
    expect(preview.querySelector('pre')!.textContent).toBe('-     <!-- note -->\n+     // note');
    const [apply, cancel] = [...preview.querySelectorAll<HTMLButtonElement>('button')];
    cancel.click();
    expect(host.querySelector('.problems .fix-preview')).toBeNull();
    expect(buffer.text()).toBe(text);
    fixButton.click();
    host.querySelector<HTMLButtonElement>('.problems .fix-preview button')!.click();
    expect(buffer.text()).toBe('A\n    // note\n');
    expect(apply.textContent).toBe('Apply');
  });
});
