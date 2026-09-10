// @vitest-environment jsdom
// Tree renderer against the §2.10 example. Spec §5.

import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/core';
import type { RenderContext } from '../../src/core';
import { treeRenderer } from '../../src/renderers/tree';
import example from '../../examples/example.plan?raw';

function render(text: string, cursorLine: number | null = null, setCursorLine = (_line: number) => {}) {
  const host = document.createElement('div');
  const ctx: RenderContext = { cursorLine, setCursorLine };
  treeRenderer.render(analyze(text), host, ctx);
  const rows = [...host.querySelectorAll('tbody tr')] as HTMLTableRowElement[];
  const total = host.querySelector('tfoot tr') as HTMLTableRowElement;
  return { host, rows, total, row: (title: string) => rows.find((r) => r.cells[0].textContent === title)! };
}

describe('tree renderer', () => {
  it('declares no requirements', () => {
    expect(treeRenderer.requires).toEqual([]);
  });

  it('renders one row per item and nothing for comments or blank lines', () => {
    const { rows } = render(example + '\n// trailing comment\n');
    expect(rows.map((r) => r.cells[0].textContent)).toEqual([
      'Auth', 'Login page', 'Password reset', 'OAuth (Google)', 'Consent screen', 'Token refresh', 'Admin', 'User list',
    ]);
  });

  it('indents titles by depth', () => {
    const { row } = render(example);
    const indent = (title: string) => parseFloat(row(title).cells[0].style.paddingLeft);
    expect(indent('Login page')).toBeGreaterThan(indent('Auth'));
    expect(indent('Consent screen')).toBeGreaterThan(indent('OAuth (Google)'));
    expect(indent('Admin')).toBe(indent('Auth'));
  });

  it('shows effective, with childSum muted for override and additive', () => {
    const { row } = render(example);
    const est = (title: string) => row(title).cells[1];
    expect(est('Auth').firstChild!.textContent).toBe('2d');
    expect(est('Auth').querySelector('.muted')!.textContent).toBe('⟨Σ 2d 7h⟩');
    expect(est('OAuth (Google)').firstChild!.textContent).toBe('1d 5h');
    expect(est('OAuth (Google)').querySelector('.muted')!.textContent).toBe('⟨Σ 5h⟩');
    expect(est('Admin').textContent).toBe('1d');
    expect(est('Admin').querySelector('.muted')).toBeNull();
    expect(est('Login page').textContent).toBe('4h');
  });

  it('shows text cells as entered', () => {
    const { row } = render(example);
    expect(row('Login page').cells[2].textContent).toBe('alice');
    expect(row('OAuth (Google)').cells[3].textContent).toBe('may not need for v1');
  });

  it('leaves an unestimated leaf blank rather than 0h', () => {
    const { row } = render('A\n    B | 2h\n    C\n');
    expect(row('C').cells[1].textContent).toBe('');
    expect(row('A').cells[1].textContent).toBe('2h');
  });

  it('marks done rows', () => {
    const { row } = render(example);
    expect(row('Login page').classList.contains('done')).toBe(true);
    expect(row('Password reset').classList.contains('done')).toBe(false);
  });

  it('shows the document total: 3d effective, 4h done', () => {
    const { total } = render(example);
    expect(total.cells[1].firstChild!.textContent).toBe('3d');
    expect(total.cells[1].querySelector('.muted')!.textContent).toBe('done 4h');
    expect(total.cells[2].textContent).toBe('');
  });

  it('highlights the row under the cursor', () => {
    const { rows, row } = render(example, 7);
    expect(row('Password reset').classList.contains('at-cursor')).toBe(true);
    expect(rows.filter((r) => r.classList.contains('at-cursor'))).toHaveLength(1);
  });

  it('asks the context to move the cursor when a row is clicked', () => {
    const setCursorLine = vi.fn();
    const { row } = render(example, null, setCursorLine);
    row('Consent screen').click();
    expect(setCursorLine).toHaveBeenCalledWith(9);
  });

  it('renders a 500-line file', () => {
    const text = Array.from({ length: 500 }, (_, i) => (i % 5 === 0 ? `Item ${i} | 1d` : `    Sub ${i} | 2h`)).join('\n');
    const { rows } = render(text);
    expect(rows).toHaveLength(500);
  });
});
