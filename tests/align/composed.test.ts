// @vitest-environment jsdom
// Task 36: the Gantt following the composed text editor on the portfolio. The editor's rows are
// keyed by file and line, so the Gantt draws all seven rows of the three plans, each where its line
// is: a segment comes right under its mount line, its header (Task 37). Measurements are injected
// (tests/support/layout.ts): 20px a line.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPanes, followerChannel } from '../../src/app/align';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { ComposedBuffer } from '../../src/buffer/composed';
import type { ItemNode, Model, RowLayout } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import { ganttRenderer } from '../../src/plugins/schedule/renderers/gantt';
import { editorLayout } from '../support/layout';
import { frames } from '../support/panes';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const own = new Map<string, CodeMirrorBuffer>([['portfolio.plan', new CodeMirrorBuffer(portfolio)], ...[...portfolioFiles()].map(([p, t]) => [p, new CodeMirrorBuffer(t!)] as [string, CodeMirrorBuffer])]);
const composed = new ComposedBuffer('portfolio.plan', { buffer: (p) => own.get(p) });
const pane = document.createElement('div');
const host = document.createElement('div');
let restore: () => void;
let disconnect: () => void;
let editor: ReturnType<typeof mountTextEditor>;
let latest: RowLayout | null = null;

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
  restore = editorLayout(pane, () => 20);
  editor = mountTextEditor(composed, pane, { onCursorLine: () => {}, onSave: () => {} });
  const channel = followerChannel();
  disconnect = connectPanes({ leads: editor }, { follows: channel.follower });
  editor.onRowLayout((layout) => (latest = layout));
  const model = analyzeAll();
  editor.update(model);
  await frames();
  ganttRenderer.render(model, host, { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, ...channel.context });
  editor.update(model);
  await frames();
});

afterAll(() => {
  disconnect();
  editor.destroy();
  composed.destroy();
  restore();
});

describe('the Gantt following the composed text editor', () => {
  it('publishes rows keyed by file and line, each segment right under its mount line (Task 37: no header block)', () => {
    const rows = latest!.rows.map((r) => [r.at?.file, r.at?.line, r.top, r.height]);
    // The master's line 6, Product A, is alpha's header; alpha's line 1 is right below it.
    expect(rows.slice(5, 8)).toEqual([
      ['portfolio.plan', 6, 100, 20],
      ['teams/alpha.plan', 1, 120, 20],
      ['teams/alpha.plan', 2, 140, 20],
    ]);
    // Alpha's seven lines end at 260, where the master's line 7 is; beta follows it directly.
    expect(rows.find((r) => r[0] === 'portfolio.plan' && r[1] === 7)).toEqual(['portfolio.plan', 7, 260, 20]);
    expect(rows.find((r) => r[0] === 'teams/beta.plan' && r[1] === 1)).toEqual(['teams/beta.plan', 1, 280, 20]);
  });

  it('draws all seven rows, each at its line', () => {
    const marks = [...host.querySelectorAll<HTMLElement>('.gantt-row')].map((r) => [r.dataset.file, Number(r.dataset.line), r.style.top]);
    expect(marks).toEqual([
      ['portfolio.plan', 6, '100px'],
      ['teams/alpha.plan', 6, '220px'],
      ['teams/alpha.plan', 7, '240px'],
      ['portfolio.plan', 7, '260px'],
      ['teams/beta.plan', 7, '400px'],
      ['teams/beta.plan', 8, '420px'],
      ['portfolio.plan', 8, '440px'],
    ]);
  });
});
