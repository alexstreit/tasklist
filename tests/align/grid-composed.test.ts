// @vitest-environment jsdom
// Task 37: the Gantt following the composed grid on the portfolio. The grid's rows are its table's
// body rows in composed order, keyed by file and line, so the Gantt draws all seven rows of the
// three plans beside them. A mounted file's header is its mount row, so there are no rows without a line between them. Measurements are injected (tests/support/layout.ts), as in Task 29:
// 22px a body row, 20px the toolbar, the problems list and the header row.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPanes, followerChannel } from '../../src/app/align';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { ItemNode, Model, RowLayout } from '../../src/core';
import { mountGrid } from '../../src/grid';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { mockResizeObserver, stackLayout } from '../support/layout';
import { frames } from '../support/panes';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const own = new Map<string, CodeMirrorBuffer>([
  ['portfolio.plan', new CodeMirrorBuffer(portfolio)],
  ...[...portfolioFiles()].map(([p, t]) => [p, new CodeMirrorBuffer(t!)] as [string, CodeMirrorBuffer]),
]);
const composed = new ComposedBuffer('portfolio.plan', { buffer: (p) => own.get(p) });
const pane = document.createElement('div');
const host = document.createElement('div');
let restore: () => void;
let resize: ReturnType<typeof mockResizeObserver>;
let disconnect: () => void;
let grid: ReturnType<typeof mountGrid>;
let latest: RowLayout | null = null;

const leaf = (el: Element): number | undefined => {
  if (el.classList.contains('sheet-toolbar')) return 20;
  if (el.classList.contains('settings-banner')) return (el as HTMLElement).hidden ? 0 : 30;
  if (el instanceof HTMLDetailsElement) return 20;
  if (el instanceof HTMLTableRowElement) return el.parentElement?.tagName === 'THEAD' ? 20 : 22;
  if (el.previousElementSibling instanceof HTMLDetailsElement) return parseFloat((el as HTMLElement).style.height) || 0;
  return undefined;
};

/** As the shell analyzes: each file's own text, then the segments the model composes. */
function analyzeAll(): Model {
  const files = new Map([...own].filter(([p]) => p !== 'portfolio.plan').map(([p, b]) => [p, b.text()]));
  const model = analyze(own.get('portfolio.plan')!.text(), { filename: 'portfolio.plan', files, resolve, version: composed.version() });
  const mounts: { file: string; line: number; target: string }[] = [];
  const visit = (n: ItemNode): void => void (n.composes && mounts.push({ file: n.file, line: n.line, target: n.composes }), n.children.forEach(visit));
  model.roots.forEach(visit);
  if (composed.recompose(mounts, () => '//')) return analyzeAll();
  return model;
}

beforeAll(async () => {
  document.body.append(pane, host);
  resize = mockResizeObserver();
  restore = stackLayout(pane, leaf);
  grid = mountGrid(composed, pane, { onCursorLine: () => {} });
  const channel = followerChannel();
  disconnect = connectPanes({ leads: grid }, { follows: channel.follower });
  grid.onRowLayout((layout) => (latest = layout));
  const model = analyzeAll();
  grid.update(model);
  await frames();
  ganttRenderer.render(model, host, { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, ...channel.context });
  grid.update(model);
  await frames();
});

afterAll(() => {
  disconnect();
  grid.destroy();
  composed.destroy();
  restore();
  resize.restore();
});

describe('the Gantt following the composed grid', () => {
  it('publishes the grid’s body rows in composed order, keyed by file and line, with no header rows', () => {
    expect(latest!.rows.map((r) => (r.at ? `${r.at.file}:${r.at.line} ${r.top}` : `null ${r.top}`))).toEqual([
      'portfolio.plan:1 0',
      'portfolio.plan:5 22',
      // Product A is the header of alpha's segment: alpha's rows follow it directly.
      'portfolio.plan:6 44',
      'teams/alpha.plan:1 66',
      'teams/alpha.plan:5 88',
      'teams/alpha.plan:6 110',
      'teams/alpha.plan:7 132',
      'portfolio.plan:7 154',
      'teams/beta.plan:1 176',
      'teams/beta.plan:6 198',
      'teams/beta.plan:7 220',
      'teams/beta.plan:8 242',
      'portfolio.plan:8 264',
      // The new-task row: the only row with no line.
      'null 286',
    ]);
  });

  it('draws all seven rows, each beside its grid row, with no empty rows between them', () => {
    const marks = [...host.querySelectorAll<HTMLElement>('.gantt-row')].map((r) => [r.dataset.file, Number(r.dataset.line), r.style.top]);
    expect(marks).toEqual([
      ['portfolio.plan', 6, '44px'],
      ['teams/alpha.plan', 6, '110px'],
      ['teams/alpha.plan', 7, '132px'],
      ['portfolio.plan', 7, '154px'],
      ['teams/beta.plan', 7, '220px'],
      ['teams/beta.plan', 8, '242px'],
      ['portfolio.plan', 8, '264px'],
    ]);
  });
});
