// The Gantt with a portfolio (Tasks 35 and 36): following the composed text editor, it draws every
// row of every plan where the editor's rows are, keyed by file and line; standalone, it shows every
// row of the composed tree. Units are days: dayWidth 1.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { RowLayout } from '../../src/core';
import { ganttGeometry } from '../../src/plugins/schedule/renderers/gantt/geometry';
import { naturalLayout } from '../../src/ui/row-layout';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const model = analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve });

describe('the Gantt with a portfolio', () => {
  it('following the composed text editor: every row of every plan, keyed by file and line (Task 36)', () => {
    // The composed text editor's rows: the master's lines 1–6, alpha's 1–7, the master's 7, beta's 1–8, the master's 8.
    const lines = [
      ...[1, 2, 3, 4, 5, 6].map((line) => ({ file: 'portfolio.plan', line })),
      ...[1, 2, 3, 4, 5, 6, 7].map((line) => ({ file: 'teams/alpha.plan', line })),
      { file: 'portfolio.plan', line: 7 },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((line) => ({ file: 'teams/beta.plan', line })),
      { file: 'portfolio.plan', line: 8 },
    ];
    const leader: RowLayout = {
      version: model.version,
      bodyTop: 0,
      contentHeight: lines.length * 20,
      scrollTop: 0,
      rows: lines.map((at, i) => ({ at, top: i * 20, height: 20 })),
    };
    const chart = ganttGeometry(model, leader, { dayWidth: 1, tiers: 'day' }, '2026-10-01');
    expect(chart.rows.map((r) => [r.file, r.line, r.mark.kind, r.mark.x, r.top])).toEqual([
      ['portfolio.plan', 6, 'summary', 2, 100],
      ['teams/alpha.plan', 6, 'bar', 2, 220],
      ['teams/alpha.plan', 7, 'bar', 4, 240],
      ['portfolio.plan', 7, 'summary', 7, 260],
      ['teams/beta.plan', 7, 'bar', 7, 400],
      ['teams/beta.plan', 8, 'bar', 7, 420],
      ['portfolio.plan', 8, 'milestone', 11, 440],
    ]);
    expect(chart.bands).toHaveLength(lines.length);
  });

  it('standalone: every row of the composed tree, each with its file', () => {
    const natural = naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 0, height: 1000, rowHeight: 20 });
    expect(natural.rows.map((r) => r.at)).toEqual([
      { line: 6, file: 'portfolio.plan' },
      { line: 6, file: 'teams/alpha.plan' },
      { line: 7, file: 'teams/alpha.plan' },
      { line: 7, file: 'portfolio.plan' },
      { line: 7, file: 'teams/beta.plan' },
      { line: 8, file: 'teams/beta.plan' },
      { line: 8, file: 'portfolio.plan' },
    ]);
    const chart = ganttGeometry(model, natural, { dayWidth: 1, tiers: 'day' }, '2026-10-01');
    expect(chart.rows.map((r) => [r.file, r.line, r.mark.kind, r.mark.x])).toEqual([
      ['portfolio.plan', 6, 'summary', 2],
      ['teams/alpha.plan', 6, 'bar', 2],
      ['teams/alpha.plan', 7, 'bar', 4],
      ['portfolio.plan', 7, 'summary', 7],
      ['teams/beta.plan', 7, 'bar', 7],
      ['teams/beta.plan', 8, 'bar', 7],
      ['portfolio.plan', 8, 'milestone', 11],
    ]);
  });
});
