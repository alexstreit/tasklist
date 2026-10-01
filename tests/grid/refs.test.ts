// @vitest-environment jsdom
// Dependencies, IDs and milestones in the grid (Task 31; spec §4b.1, §4b.2 and §4b.4): ref cells
// shown and typed as outline numbers, IDs minted as needed, marker toggles, IDs on hover, and the
// confirm before deleting a row others refer to.

import { afterEach, describe, expect, it } from 'vitest';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import type { PlanBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';

// Cell columns, as the grid numbers them, in a `profile: schedule` file.
const WBS = -1;
const MILESTONE = -2; // the toggle after done: the schedule profile's only other marker
const TITLE = 1;
const DEPS = 5;

const HEAD = '---\nprofile: schedule\nproject-start: 2026-10-05\n---\n';
// Lines 5–10: Design 1, Wireframes 1.1, Review 1.2, Build 2, API 2.1, UI 2.2.
const PLAN = `${HEAD}Design\n    Wireframes | 1d\n    Review | 4h\nBuild\n    API | 3d\n    UI | 2d\n`;

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
const input = () => host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
function edit(line: number, column: number, value: string): void {
  click(cell(line, column), 'dblclick');
  input().value = value;
  press(input(), 'Enter');
}
const lineOf = (n: number) => buffer.text().split('\n')[n - 1];
const note = () => host.querySelector('.sheet-notice')?.textContent ?? null;
/** The model's references from a row's deps cell, by target ID, with each lag as written. */
const deps = (title: string) => {
  const model = analyze(buffer.text());
  const r = model.doc.rows.find((x) => x.lead.text === title)!;
  const deps = model.doc.schema.columns.find((c) => c.name === 'deps')!;
  const value = r.cells[deps.index]?.value;
  return value?.type === 'ref' ? value.refs.map((ref) => [ref.id, ref.target?.lead.text ?? null]) : null;
};

describe('ref cells', () => {
  it('typing 1.1 into Review gives Wireframes an anchor and Review the reference, undone with one Ctrl+Z', () => {
    open(PLAN, (t) => new CodeMirrorBuffer(t));
    edit(7, DEPS, '1.1');
    expect(lineOf(6)).toBe('    Wireframes {#wireframes} | 1d');
    expect(lineOf(7)).toBe('    Review | 4h | deps=#wireframes');
    expect(deps('Review')).toEqual([['wireframes', 'Wireframes']]);
    expect(cell(7, DEPS).textContent).toBe('1.1');
    expect(origins).toEqual(['grid']);
    press(cell(7, DEPS), 'z', { ctrlKey: true });
    expect(buffer.text()).toBe(PLAN);
  });

  it('writes 1.1, 2.1 +1d as two references with a lag on the second, and shows exactly that', () => {
    open(PLAN);
    edit(10, DEPS, '1.1, 2.1 +1d');
    expect(lineOf(10)).toBe('    UI | 2d | deps=#wireframes, #api +1d');
    expect(deps('UI')).toEqual([['wireframes', 'Wireframes'], ['api', 'API']]);
    expect(cell(10, DEPS).textContent).toBe('1.1, 2.1 +1d');
    expect(analyze(buffer.text()).diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('reuses a target that already has an anchor, writing no second one', () => {
    open(PLAN.replace('    Wireframes | 1d', '    Wireframes {#wire} | 1d'));
    edit(7, DEPS, '1.1');
    edit(9, DEPS, '1.1, 1.2');
    expect(lineOf(6)).toBe('    Wireframes {#wire} | 1d');
    expect(lineOf(7)).toBe('    Review {#review} | 4h | deps=#wire');
    expect(lineOf(9)).toBe('    API | 3d | deps=#wire, #review');
    expect(buffer.text().match(/\{#/g)).toHaveLength(2);
  });

  it('mints distinct IDs for two targets with one title in one edit', () => {
    open(`${HEAD}Review\nReview\nShip\n`);
    edit(7, DEPS, '1, 2');
    expect(buffer.text()).toBe(`${HEAD}Review {#review}\nReview {#review-2}\nShip | deps=#review, #review-2\n`);
  });

  it('takes #id as written, and a duration lag normalised as a typed duration is', () => {
    open(PLAN.replace('    Review | 4h', '    Review {#review} | 4h'));
    edit(9, DEPS, '#review 1 day');
    expect(lineOf(9)).toBe('    API | 3d | deps=#review 1d');
    expect(cell(9, DEPS).textContent).toBe('1.2 1d');
  });

  it('shows a reference that does not resolve as written, with its warning', () => {
    open(`${HEAD}A | deps=#missing\n`);
    expect(cell(5, DEPS).textContent).toBe('#missing');
    expect(cell(5, DEPS).classList.contains('warning')).toBe(true);
  });

  it('edits the outline-number form, not the raw #id text, and writes nothing when it is committed unchanged', () => {
    open(PLAN.replace('    Review | 4h', '    Review | 4h | deps=#wire').replace('Wireframes', 'Wireframes {#wire}'));
    click(cell(7, DEPS), 'dblclick');
    expect(input().value).toBe('1.1');
    press(input(), 'Enter');
    expect(origins).toEqual([]);
  });

  it('clears the cell when it is emptied', () => {
    open(PLAN.replace('    Review | 4h', '    Review | 4h | deps=#wire').replace('Wireframes', 'Wireframes {#wire}'));
    edit(7, DEPS, '');
    expect(lineOf(7)).toBe('    Review | 4h');
  });

  it('writes a dependency on a parent or on the row itself, and the schedule reports it', () => {
    open(PLAN);
    edit(9, DEPS, '1, 2.1');
    expect(lineOf(5)).toBe('Design {#design}');
    expect(lineOf(9)).toBe('    API {#api} | 3d | deps=#design, #api');
    const codes = analyze(buffer.text()).diagnostics.map((d) => d.code);
    expect(codes).toContain('schedule-dep-on-summary');
    expect(codes).toContain('schedule-dep-cycle');
  });

  it('after Alt+Up moves rows, shows the new outline numbers, and the references in the file are unchanged', () => {
    open(PLAN);
    edit(10, DEPS, '2.1');
    const before = lineOf(10);
    click(cell(10, TITLE));
    press(cell(10, TITLE), 'ArrowUp', { altKey: true });
    // UI is now 2.1 on line 9, and API 2.2.
    expect(lineOf(9)).toBe(before);
    expect(cell(9, WBS).textContent).toBe('2.1');
    expect(cell(9, DEPS).textContent).toBe('2.2');
    expect(deps('UI')).toEqual([['api', 'API']]);
  });

  describe('refusals leave the cell and buffer as they were, with a plain note', () => {
    it.each([
      ['a number that matches no row', PLAN, '4.7', "There's no task 4.7."],
      ['several targets in a column without many', PLAN.replace(HEAD, `${HEAD.replace('---\n', '---\ncolumns: est:duration unit=h hpd=8 dpw=5 | deps:ref\n')}`), '1.1, 2.1', 'The "deps" column holds only one task.'],
      ['a qualifier the column does not declare', PLAN.replace(HEAD, `${HEAD.replace('---\n', '---\ncolumns: est:duration unit=h hpd=8 dpw=5 | deps:ref many\n')}`), '1.1 1d', 'The "deps" column takes only task numbers, with nothing after them.'],
    ])('%s', (_, text, typed, message) => {
      open(text);
      const column = analyze(text).columns.findIndex((c) => c.name === 'deps') + 2;
      const shown = cell(7, column).textContent;
      edit(7, column, typed);
      expect(buffer.text()).toBe(text);
      expect(origins).toEqual([]);
      expect(cell(7, column).textContent?.replace(message, '')).toBe(shown);
      expect(note()).toBe(message);
    });

    it('the first anchor while a row sets id by name: the whole edit is refused', () => {
      const text = `${HEAD}A\nB | notes=x | id=b\nC\n`;
      open(text);
      edit(7, DEPS, '1');
      expect(buffer.text()).toBe(text);
      expect(note()).toBe('Another task has a cell written as id=…, which would start to mean a task ID. Change that cell first.');
    });
  });

  it('works the same for any ref column, scheduling or not', () => {
    open('---\nprofile: plan\ncolumns: est:duration unit=h | see:ref many\n---\nSpec\nBuild\n');
    edit(6, 3, '1');
    expect(buffer.text()).toBe('---\nprofile: plan\ncolumns: est:duration unit=h | see:ref many\n---\nSpec {#spec}\nBuild | see=#spec\n');
    expect(cell(6, 3).textContent).toBe('1');
  });
});

describe('marker toggles', () => {
  it('shows a toggle for each marker after done, headed by its glyph', () => {
    open(PLAN);
    expect([...host.querySelectorAll('thead th')].slice(0, 4).map((th) => th.textContent)).toEqual(['#', '', '^', 'Task']);
    expect(cell(6, MILESTONE).querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('a toggle on ^ writes and removes the marker, and Space toggles it', () => {
    open(PLAN);
    const box = () => cell(10, MILESTONE).querySelector<HTMLInputElement>('input')!;
    box().checked = true;
    box().dispatchEvent(new Event('change'));
    expect(lineOf(10)).toBe('    ^UI | 2d');
    expect(box().checked).toBe(true);
    click(cell(10, MILESTONE));
    press(cell(10, MILESTONE), ' ');
    expect(lineOf(10)).toBe('    UI | 2d');
    press(cell(10, MILESTONE), ' ');
    expect(lineOf(10)).toBe('    ^UI | 2d');
  });

  it('leaves a file whose only marker is done as it was', () => {
    open('Auth\n');
    expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['#', '', 'Task', 'est', 'owner', 'notes']);
  });
});

describe('IDs on hover', () => {
  it("shows a row's ID on its WBS cell, and nothing on a row without one", () => {
    open(PLAN.replace('    Review | 4h', '    Review {#review} | 4h'));
    expect(cell(7, WBS).title).toBe('#review');
    expect(cell(6, WBS).title).toBe('');
  });
});

describe('deleting a row others refer to', () => {
  const REFERRED = `${HEAD}Design\n    Wireframes {#wire} | 1d\n    Review {#review} | 4h | deps=#wire\nBuild\n    API {#api} | 3d | deps=#review\n    UI | 2d | deps="#api, #review 1d"\n`;
  const confirmBox = () => host.querySelector('.sheet-confirm')!;
  const buttons = () => [...confirmBox().querySelectorAll<HTMLButtonElement>('button.fix')];
  const remove = (line: number) => {
    click(cell(line, WBS));
    press(cell(line, WBS), 'Delete');
  };

  it('asks first, naming both rows, with a preview', () => {
    open(REFERRED);
    remove(7);
    expect(origins).toEqual([]);
    expect(confirmBox().querySelector('.fix-warning')!.textContent).toBe('Delete Review? API and UI refer to it in deps; those references will be removed.');
    expect(confirmBox().querySelector('pre')!.textContent).toContain('-     Review {#review} | 4h | deps=#wire');
    expect(buttons().map((b) => b.textContent)).toEqual(['Apply', 'Cancel']);
  });

  it('Apply removes the row and the two references, with no reference left dangling, and one Ctrl+Z restores it all', () => {
    open(REFERRED, (t) => new CodeMirrorBuffer(t));
    remove(7);
    buttons()[0].click();
    expect(buffer.text()).toBe(`${HEAD}Design\n    Wireframes {#wire} | 1d\nBuild\n    API {#api} | 3d\n    UI | 2d | deps=#api\n`);
    expect(origins).toEqual(['grid']);
    expect(analyze(buffer.text()).diagnostics.filter((d) => d.code === 'unresolved-ref')).toEqual([]);
    expect(confirmBox().childElementCount).toBe(0);
    // The grid takes the focus back from the panel.
    expect(host.querySelector('table')!.contains(document.activeElement)).toBe(true);
    press(cell(6, WBS), 'z', { ctrlKey: true });
    expect(buffer.text()).toBe(REFERRED);
  });

  it('Cancel writes nothing, and puts the focus back on the row it was opened from', () => {
    open(REFERRED);
    remove(7);
    expect(confirmBox().contains(document.activeElement)).toBe(true);
    buttons()[1].click();
    expect(buffer.text()).toBe(REFERRED);
    expect(origins).toEqual([]);
    expect(confirmBox().childElementCount).toBe(0);
    expect(document.activeElement).toBe(cell(7, WBS));
  });

  it('names one reference, and references from several columns, by column', () => {
    open(REFERRED);
    remove(9);
    expect(confirmBox().querySelector('.fix-warning')!.textContent).toBe('Delete API? UI refers to it in deps; that reference will be removed.');
    const two = `---\nprofile: schedule\nproject-start: 2026-10-05\ncolumns: est:duration unit=h hpd=8 dpw=5 | deps:ref many | related:ref\n---\nSpec {#spec}\nAPI | | #spec\nUI | | | #spec\nDocs | | #spec | #spec\n`;
    grid.destroy();
    host.remove();
    open(two);
    remove(6);
    expect(confirmBox().querySelector('.fix-warning')!.textContent).toBe('Delete Spec? API and Docs in deps, UI and Docs in related refer to it; those references will be removed.');
  });

  it('deletes a row nothing refers to at once, as before', () => {
    open(REFERRED);
    remove(10);
    expect(origins).toEqual(['grid']);
    expect(confirmBox().childElementCount).toBe(0);
  });

  it('a change to the buffer drops the confirm, so it never applies to other text', () => {
    open(REFERRED);
    remove(7);
    buffer.apply([{ from: buffer.text().length, to: buffer.text().length, insert: 'Docs\n' }], 'remote');
    expect(confirmBox().childElementCount).toBe(0);
  });
});
