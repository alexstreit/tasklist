// @vitest-environment jsdom
// Task 29: the grid leading the stub follower. Its rows are its table's body rows, measured with
// injected block layout (tests/support/layout.ts): the whole pane scrolls, header included.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockResizeObserver, stackLayout } from '../support/layout';
import { leading } from '../support/panes';
import type { Panes } from '../support/panes';

const TEXT = [
  '---', // 1
  'profile: plan',
  '---',
  '// the build', // 4
  'Build',
  '    Design | 1d', // 6
  '    Code | 2d',
  '',
  'Ship | 1d', // 9
  '',
].join('\n');

// Heights, in px: the toolbar, the problems list closed and open, the header row, a body or footer row.
let sizes = { bar: 20, list: 20, open: 100, head: 20, row: 22 };
const leaf = (el: Element): number | undefined => {
  if (el.classList.contains('sheet-toolbar')) return sizes.bar;
  if (el.classList.contains('settings-banner')) return (el as HTMLElement).hidden ? 0 : 30;
  if (el instanceof HTMLDetailsElement) return el.open ? sizes.open : sizes.list;
  if (el instanceof HTMLTableRowElement) return el.parentElement instanceof HTMLTableSectionElement && el.parentElement.tagName === 'THEAD' ? sizes.head : sizes.row;
  // The spacer setMinBodyTop sizes, after the problems list.
  if (el.previousElementSibling instanceof HTMLDetailsElement) return parseFloat((el as HTMLElement).style.height) || 0;
  return undefined;
};

let panes: Panes;
let resize: ReturnType<typeof mockResizeObserver>;
beforeEach(() => {
  sizes = { bar: 20, list: 20, open: 100, head: 20, row: 22 };
  resize = mockResizeObserver();
});
afterEach(() => {
  panes.destroy();
  resize.restore();
});

function open(text = TEXT, header?: number): Panes {
  panes = leading('grid', text, { measure: (pane) => stackLayout(pane, leaf), header });
  panes.step();
  return panes;
}

const rows = () => panes.stub.last()!.rows.map((r) => [r.line, r.title, r.top, r.height]);
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const wbs = (line: number) => panes.pane.querySelector(`tr[data-line="${line}"] td[data-column="-1"]`)!;

describe('the grid leading', () => {
  it('has comment, blank and front matter rows; front matter is one row on its first line', () => {
    open();
    expect(rows()).toEqual([
      [1, null, 0, 22],
      [4, null, 22, 22],
      [5, 'Build', 44, 22],
      [6, 'Design', 66, 22],
      [7, 'Code', 88, 22],
      [8, null, 110, 22],
      [9, 'Ship', 132, 22],
    ]);
    // Toolbar, closed problems list and the header row; the totals and new-task rows are in the content.
    expect(panes.stub.last()).toMatchObject({ kind: 'render', bodyTop: 60, contentHeight: 7 * 22 + 2 * 22, scrollTop: 0 });
  });

  it('has a draft row as at: null', () => {
    open();
    wbs(6).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    key(wbs(6), 'Insert');
    expect(rows().slice(2, 5)).toEqual([
      [5, 'Build', 44, 22],
      [null, null, 66, 22],
      [6, 'Design', 88, 22],
    ]);
  });

  it('republishes with a larger bodyTop when the problems list opens', () => {
    open();
    panes.pane.querySelector('details')!.open = true;
    resize.fire();
    expect(panes.stub.last()).toMatchObject({ kind: 'position', bodyTop: 60 - 20 + 100 });
    expect(rows()[0]).toEqual([1, null, 0, 22]);
  });

  it('publishes a scroll with the same row tops; only scrollTop differs', () => {
    open();
    const before = panes.stub.last()!;
    panes.pane.scrollTop = 30;
    panes.pane.dispatchEvent(new Event('scroll'));
    const after = panes.stub.last()!;
    expect(after.scrollTop).toBe(30);
    expect({ ...after, scrollTop: 0, kind: 'render' }).toEqual(before);
  });

  it('publishes only the rows on screen', () => {
    open(Array.from({ length: 30 }, (_, i) => `Task ${i + 1}`).join('\n'));
    // 400px of pane: 60 of header, then 340 of rows.
    expect(rows().map(([line]) => line)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    panes.pane.scrollTop = 200;
    panes.pane.dispatchEvent(new Event('scroll'));
    expect(rows()[0]).toEqual([7, 'Task 7', 132, 22]);
  });

  it('keeps the last frame after an Alt+Up move until the model catches up', () => {
    open();
    const drawn = panes.stub.frames.length;
    wbs(7).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    key(wbs(7), 'ArrowUp', { altKey: true });
    expect(panes.buffer.text()).toContain('    Code | 2d\n    Design | 1d');
    // The grid still shows, and publishes, the model it has.
    panes.pane.dispatchEvent(new Event('scroll'));
    expect(panes.stub.last()).toMatchObject({ kind: 'position', version: 0 });
    expect(rows()[3]).toEqual([6, 'Design', 66, 22]);
    // The grid has the new model, the stub doesn't yet: the new layout isn't drawn against the old model.
    const shown = panes.stub.frames.length;
    const model = panes.analyze();
    expect(panes.stub.frames.length).toBe(shown);
    panes.render(model);
    expect(panes.stub.last()).toMatchObject({ kind: 'render', version: 1 });
    expect(rows().slice(3, 5)).toEqual([
      [6, 'Code', 66, 22],
      [7, 'Design', 88, 22],
    ]);
    expect(panes.stub.frames.length).toBe(shown + 1);
    expect(drawn).toBeLessThan(shown);
  });

  it('starts both bodies at the larger header: a 40px grid header and a 64px follower header', () => {
    sizes = { ...sizes, bar: 10, list: 10 };
    open(TEXT, 64);
    expect(panes.stub.last()).toMatchObject({ bodyTop: 64 });
    expect(panes.pane.querySelector('tbody')!.getBoundingClientRect().top).toBe(64);
    // A taller grid header wins, and the space goes again when it shrinks back.
    panes.pane.querySelector('details')!.open = true;
    resize.fire();
    expect(panes.stub.last()).toMatchObject({ bodyTop: 10 + 100 + 20 });
    panes.pane.querySelector('details')!.open = false;
    resize.fire();
    expect(panes.stub.last()).toMatchObject({ bodyTop: 64 });
  });
});
