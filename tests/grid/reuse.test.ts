// @vitest-environment jsdom
// Task 37: the grid keeps each row's element across rebuilds and redraws only the cells that
// changed. The property: over seeded sequences of edits made through the grid (cell commits,
// inserts, deletes, moves, indent and outdent, done, unmount and undo), on the portfolio and on
// single files, the kept grid's DOM is identical, after every step, to a grid built afresh from
// the same buffer and model. The place and hover (the tab stop, at-cursor, selected, hover) are
// left out: a fresh grid has none.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import type { PlanBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { ItemNode, Model } from '../../src/core';
import { mountGrid } from '../../src/grid';
import type { ComposedSource, GridEditor } from '../../src/grid';
import example from '../../examples/example.plan?raw';
import schedule from '../../examples/schedule.plan?raw';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const WBS = -1;
const DONE = 0;
const TITLE = 1;

/** A seeded random number generator (mulberry32), so every run makes the same edits. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A grid's table as text: elements, their attributes sorted, checkboxes' state, and text; the place and hover left out. */
function serialise(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return JSON.stringify(node.textContent);
  const el = node as HTMLElement;
  const attrs = [...el.attributes]
    .filter((a) => a.name !== 'tabindex')
    .map((a) => {
      if (a.name !== 'class') return `${a.name}=${JSON.stringify(a.value)}`;
      const kept = a.value.split(/\s+/).filter((c) => c && !['at-cursor', 'selected', 'hover'].includes(c));
      return kept.length > 0 ? `class=${JSON.stringify(kept.join(' '))}` : '';
    })
    .filter(Boolean)
    .sort();
  if (el instanceof HTMLInputElement && el.type === 'checkbox') attrs.push(`checked=${el.checked}`, `disabled=${el.disabled}`);
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${[...el.childNodes].map(serialise).join('')}</${el.tagName.toLowerCase()}>`;
}

/** A plan to edit: its buffer, how the shell analyzes it, and a grid on it. */
interface Subject {
  buffer: PlanBuffer & Partial<ComposedSource>;
  analyze(): Model;
}

function single(text: string, filename: string): Subject {
  const buffer = new InMemoryBuffer(text);
  return { buffer, analyze: () => analyze(buffer.text(), { filename }) };
}

/** The portfolio over a composed buffer, analyzed as the shell does: then the segments its model composes. */
function composedPortfolio(): Subject {
  const own = new Map<string, CodeMirrorBuffer>([
    ['portfolio.plan', new CodeMirrorBuffer(portfolio)],
    ...[...portfolioFiles()].map(([p, t]) => [p, new CodeMirrorBuffer(t!)] as [string, CodeMirrorBuffer]),
  ]);
  const buffer = new ComposedBuffer('portfolio.plan', { buffer: (p) => own.get(p) });
  const run = (): Model => {
    const files = new Map([...own].filter(([p]) => p !== 'portfolio.plan').map(([p, b]) => [p, b.text()]));
    const model = analyze(own.get('portfolio.plan')!.text(), { filename: 'portfolio.plan', files, resolve, version: buffer.version() });
    const mounts: { file: string; line: number; target: string }[] = [];
    const visit = (n: ItemNode): void => void (n.composes && mounts.push({ file: n.file, line: n.line, target: n.composes }), n.children.forEach(visit));
    model.roots.forEach(visit);
    return buffer.recompose(mounts, () => '//') ? run() : model;
  };
  return { buffer, analyze: run };
}

const click = (el: Element, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

const VALUES = ['1d', '2h', '', '3d 4h', 'sam', '#a', '1', 'Spec', 'x | y', '2026-10-12', 'true'];
const OPS = ['commit', 'commit', 'commit', 'insert', 'delete', 'up', 'down', 'indent', 'outdent', 'done', 'unmount', 'undo', 'undo', 'redo'] as const;

/** One edit through the grid's own controls, on a random row. */
function step(host: HTMLElement, next: () => number): string {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const rows = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.item, tbody tr.line')];
  const op = pick(OPS);
  if (rows.length === 0) return 'none';
  const tr = pick(rows);
  const wbs = tr.querySelector<HTMLTableCellElement>(`td[data-column="${WBS}"]`)!;
  const select = () => click(wbs);
  switch (op) {
    case 'commit': {
      const cells = [...tr.querySelectorAll<HTMLTableCellElement>('td[data-column]')].filter((td) => Number(td.dataset.column) >= TITLE);
      const td = pick(cells);
      click(td, 'dblclick');
      const input = host.querySelector<HTMLInputElement | HTMLSelectElement>('tbody tr:not(.new-task):not(.draft) .cell-input');
      if (!input) return `commit refused ${td.dataset.column}`;
      if (input instanceof HTMLInputElement) input.value = pick(VALUES);
      press(input, 'Enter');
      return `commit ${td.dataset.column}`;
    }
    case 'insert': {
      select();
      press(wbs, 'Insert');
      const draft = host.querySelector<HTMLInputElement>('tr.draft input');
      if (!draft) return 'insert none';
      draft.value = pick(['New', 'Step two', '']);
      press(draft, 'Enter');
      return 'insert';
    }
    case 'delete': {
      select();
      press(wbs, 'Delete');
      const apply = [...host.querySelectorAll<HTMLButtonElement>('.sheet-confirm button')].find((b) => b.textContent === 'Apply');
      apply?.click();
      return 'delete';
    }
    case 'up':
    case 'down':
      select();
      press(wbs, op === 'up' ? 'ArrowUp' : 'ArrowDown', { altKey: true });
      return op;
    case 'indent':
    case 'outdent':
      select();
      press(wbs, op === 'indent' ? 'ArrowRight' : 'ArrowLeft', { altKey: true, shiftKey: true });
      return op;
    case 'done': {
      const box = tr.querySelector<HTMLInputElement>(`td[data-column="${DONE}"] input`);
      if (box && !box.disabled) box.click();
      return 'done';
    }
    case 'unmount': {
      select();
      [...host.querySelectorAll<HTMLButtonElement>('.sheet-toolbar button')].find((b) => b.textContent === 'Unmount')!.click();
      return 'unmount';
    }
    case 'undo':
    case 'redo':
      select();
      press(wbs, op === 'undo' ? 'z' : 'y', { ctrlKey: true });
      return op;
  }
}

/** How many steps changed the text, over every sequence of a test. */
let changed = 0;

/** Runs one seeded sequence; returns the first step at which the kept grid differs from a fresh one, or null. */
function sequence(subject: Subject, seed: number, steps: number): string | null {
  const host = document.createElement('div');
  document.body.append(host);
  const grid: GridEditor = mountGrid(subject.buffer, host, { onCursorLine: () => {} });
  let model = subject.analyze();
  grid.update(model);
  const next = random(seed);
  const done: string[] = [];
  try {
    for (let i = 0; i < steps; i++) {
      const before = subject.buffer.text();
      done.push(step(host, next));
      if (subject.buffer.text() !== before) changed++;
      model = subject.analyze();
      grid.update(model);
      const fresh = document.createElement('div');
      document.body.append(fresh);
      const other = mountGrid(subject.buffer, fresh, { onCursorLine: () => {} });
      other.update(model);
      const kept = serialise(host.querySelector('table')!);
      const built = serialise(fresh.querySelector('table')!);
      other.destroy();
      fresh.remove();
      if (kept !== built) return `seed ${seed}, after ${done.join(', ')}`;
    }
    return null;
  } finally {
    grid.destroy();
    host.remove();
  }
}

// About 3 s each alone (40 random edit sequences); under the full suite's parallel load they can pass 5 s.
describe('kept rows draw exactly what a fresh build draws', { timeout: 20_000 }, () => {
  it('on the portfolio, over a composed buffer', () => {
    changed = 0;
    for (let seed = 1; seed <= 40; seed++) expect(sequence(composedPortfolio(), seed, 12)).toBeNull();
    // Most steps edit something (the rest are refused, or undo nothing): the property is about rows that change.
    expect(changed).toBeGreaterThan((40 * 12) / 2);
  });

  it('on single files', () => {
    changed = 0;
    for (let seed = 1; seed <= 20; seed++) expect(sequence(single(example, 'example.plan'), seed, 12)).toBeNull();
    for (let seed = 1; seed <= 20; seed++) expect(sequence(single(schedule, 'schedule.plan'), seed, 12)).toBeNull();
    expect(changed).toBeGreaterThan((40 * 12) / 2);
  });
});
