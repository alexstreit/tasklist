// The Gantt with a portfolio (Task 35), until Task 36: following an editor, it shows the root file's
// rows only, and a mount row's bracket still spans its whole plan; standalone, it shows every row of
// the composed tree. Units are days: dayWidth 1.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import type { RowLayout } from '../../src/core';
import { ganttGeometry } from '../../src/plugins/schedule/renderers/gantt/geometry';
import { naturalLayout } from '../../src/ui/row-layout';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

const model = analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve });

describe('the Gantt with a portfolio', () => {
  it('following an editor: the root file’s rows only, by line; Product A’s bracket spans alpha’s plan', () => {
    // The text editor's rows: the five lines of front matter and comment, then the three rows.
    const leader: RowLayout = {
      version: model.version,
      bodyTop: 0,
      contentHeight: 8 * 20,
      scrollTop: 0,
      rows: Array.from({ length: 8 }, (_, i) => ({ at: { line: i + 1 }, top: i * 20, height: 20 })),
    };
    const chart = ganttGeometry(model, leader, 1, '2026-10-01');
    expect(chart.rows.map((r) => ({ line: r.line, file: r.file, mark: r.mark }))).toEqual([
      { line: 6, file: 'portfolio.plan', mark: { kind: 'summary', x: 2, width: 5 } },
      { line: 7, file: 'portfolio.plan', mark: { kind: 'summary', x: 7, width: 4 } },
      { line: 8, file: 'portfolio.plan', mark: { kind: 'milestone', x: 11 } },
    ]);
  });

  it('standalone: every row of the composed tree, each with its file', () => {
    const natural = naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 0, height: 1000, rowHeight: 20 });
    expect(natural.rows.map((r) => r.at)).toEqual([
      { line: 6 },
      { line: 6, file: 'teams/alpha.plan' },
      { line: 7, file: 'teams/alpha.plan' },
      { line: 7 },
      { line: 7, file: 'teams/beta.plan' },
      { line: 8, file: 'teams/beta.plan' },
      { line: 8 },
    ]);
    const chart = ganttGeometry(model, natural, 1, '2026-10-01');
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
