// @vitest-environment jsdom
// Flat table renderer: one row per item with a level column, numbers identical to the tree.

import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/core';
import type { RenderContext, Renderer } from '../../src/core';
import { cursorItemFor, itemLines } from '../../src/app/cursor';
import { ganttRenderer } from '../../src/renderers/gantt';
import { tableRenderer } from '../../src/renderers/table';
import { treeRenderer } from '../../src/renderers/tree';
import example from '../../examples/example.plan?raw';

function render(renderer: Renderer, text: string, cursorLine: number | null = null, setCursorLine = (_line: number) => {}) {
  const host = document.createElement('div');
  const model = analyze(text);
  const ctx: RenderContext = { cursorLine, cursorItem: cursorItemFor(itemLines(model), cursorLine), scrollToCursor: false, setCursorLine };
  renderer.render(model, host, ctx);
  return { host, rows: [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')], total: host.querySelector<HTMLTableRowElement>('tfoot tr')! };
}

describe('table renderer', () => {
  it('declares no requirements', () => {
    expect(tableRenderer.requires).toEqual([]);
  });

  it('renders one flat row per item with its level', () => {
    const { rows } = render(tableRenderer, example);
    expect(rows.map((r) => [r.cells[0].textContent, r.cells[1].textContent])).toEqual([
      ['1', 'Auth'], ['2', 'Login page'], ['2', 'Password reset'], ['2', 'OAuth (Google)'],
      ['3', 'Consent screen'], ['3', 'Token refresh'], ['1', 'Admin'], ['2', 'User list'],
    ]);
    expect(rows.every((r) => r.cells[1].style.paddingLeft === '')).toBe(true);
  });

  it('shows the same numbers as the tree for the §2.10 example', () => {
    const tree = render(treeRenderer, example);
    const table = render(tableRenderer, example);
    const values = (rows: HTMLTableRowElement[], offset: number) => rows.map((r) => [...r.cells].slice(offset).map((c) => c.textContent));
    expect(values(table.rows, 2)).toEqual(values(tree.rows, 1));
    expect([...table.total.cells].slice(2).map((c) => c.textContent)).toEqual([...tree.total.cells].slice(1).map((c) => c.textContent));
    expect(table.total.cells[2].firstChild!.textContent).toBe('3d');
  });

  it('marks done rows and the cursor row, and clicks through to the line', () => {
    const setCursorLine = vi.fn();
    const { rows } = render(tableRenderer, example, 13, setCursorLine);
    expect(rows[1].classList.contains('done')).toBe(true);
    expect(rows[7].classList.contains('near-cursor')).toBe(true);
    rows[4].click();
    expect(setCursorLine).toHaveBeenCalledWith(9);
  });
});

describe('gantt stub', () => {
  it('requires a date column and refuses to render', () => {
    expect(ganttRenderer.requires).toEqual([{ type: 'date' }]);
    expect(() => ganttRenderer.render(analyze(''), document.createElement('div'), {} as RenderContext)).toThrow();
  });
});
