// @vitest-environment jsdom
// The grid's two notions of a row's level (src/grid/edits.ts `levels`): they
// agree on indented files, and differ for an indent-0 row placed by `parent=`.
// The grid shows such a row at its tree depth, but Indent, Outdent and Insert
// above work in its indentation level, which is what rows' structure edits use.

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';
import { levels } from '../../src/grid/edits';

const PLACED = 'A {#a}\nB | parent=#a\n    C\n';

describe('levels', () => {
  it('agree when indentation alone makes the tree', () => {
    expect([...levels(analyze('A\n    B\n        C\nD\n')).values()]).toEqual([
      { shown: 0, indent: 0 },
      { shown: 1, indent: 1 },
      { shown: 2, indent: 2 },
      { shown: 0, indent: 0 },
    ]);
  });

  it('differ for an indent-0 row whose parent= names another row, and its descendants', () => {
    const level = levels(analyze(PLACED));
    expect([level.get(1), level.get(2), level.get(3)]).toEqual([
      { shown: 0, indent: 0 },
      { shown: 1, indent: 0 },
      { shown: 2, indent: 1 },
    ]);
  });
});

describe('structure operations on a row placed by parent= use its indentation level', () => {
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

  const cell = (line: number, column: number) => host.querySelector<HTMLTableCellElement>(`tr[data-line="${line}"] td[data-column="${column}"]`)!;
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`.sheet-toolbar button[data-action="${id}"]`)!;
  const select = (line: number) => cell(line, -1).dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it('is shown under its parent', () => {
    open(PLACED);
    expect(cell(2, 1).style.paddingLeft).toBe('1.75em'); // one level down, from parent=
  });

  it('Indent makes it a child of the row above by indentation, its children with it', () => {
    open(PLACED);
    select(2);
    expect(button('indent').disabled).toBe(false);
    button('indent').click();
    expect(buffer.text()).toBe('A {#a}\n    B | parent=#a\n        C\n');
    // parent=#a now agrees with the indentation.
    expect(analyze(buffer.text()).diagnostics).toEqual([]);
  });

  it('Outdent is off: at indentation level 0 there is no level to remove', () => {
    open(PLACED);
    select(2);
    expect(button('outdent').disabled).toBe(true);
    // Its child can outdent, to the level of B.
    select(3);
    expect(button('outdent').disabled).toBe(false);
    button('outdent').click();
    expect(buffer.text()).toBe('A {#a}\nB | parent=#a\nC\n');
  });

  it('Insert above writes the new row at its indentation level', () => {
    open(PLACED);
    select(2);
    button('insert').click();
    const draft = host.querySelector<HTMLInputElement>('tr.draft input')!;
    draft.value = 'X';
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(buffer.text()).toBe('A {#a}\nX\nB | parent=#a\n    C\n');
  });
});
