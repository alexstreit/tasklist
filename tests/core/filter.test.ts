// Task 41: the filter's matching. Every expected value below is copied from the hand-worked table in
// TASKS.md (Task 41). Never take one from output; a disagreement is a question about the rules.

import { describe, expect, it } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import { trackFilter } from '../../src/app/filter';
import { analyze } from '../../src/app/registry';
import { filterRows } from '../../src/core';
import type { FileLine, Model } from '../../src/core';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

/** The titles of the rows on these lines. */
function titles(model: Model, lines: FileLine[]): string[] {
  return lines.map(({ file, line }) => {
    const node = model.files.get(file)!.lines[line - 1];
    if (node.kind !== 'item') throw new Error(`${file}:${line} is not an item`);
    return node.title;
  });
}

/** What the box says while the filter is active. */
const countOf = (found: { count: number; total: number }) => `Showing ${found.count} of ${found.total} tasks`;

describe('filterRows on examples/demo.plan', () => {
  const model = analyze(demo, { filename: 'demo.plan' });
  const cases: [string, string[], string[], string][] = [
    ['carol', ['UX wireframes', 'Web app', 'User guide', 'Training'], ['Design', 'Build', 'Docs'], 'Showing 4 of 23 tasks'],
    ['carol web', ['Web app'], ['Build'], 'Showing 1 of 23 tasks'],
    ['CAROL', ['UX wireframes', 'Web app', 'User guide', 'Training'], ['Design', 'Build', 'Docs'], 'Showing 4 of 23 tasks'],
    ['2026-11', ['Go-live'], ['Release'], 'Showing 1 of 23 tasks'],
    ['zzz', [], [], 'Showing 0 of 23 tasks'],
  ];
  for (const [query, matches, ancestors, count] of cases) {
    it(`${query}: ${count}`, () => {
      const found = filterRows(model, query);
      expect(titles(model, found.matches)).toEqual(matches);
      expect(titles(model, found.ancestors)).toEqual(ancestors);
      expect(countOf(found)).toBe(count);
    });
  }

  it('does not search ref cells: web matches Web app, not User guide, whose deps are #web', () => {
    expect(titles(model, filterRows(model, 'web').matches)).toEqual(['Web app']);
  });

  it('does not search anchors or outline numbers', () => {
    // Web app's anchor is {#web}; Integrations is 4.3.
    expect(filterRows(model, '#web').matches).toEqual([]);
    expect(filterRows(model, 'integ').matches).toHaveLength(1);
    expect(filterRows(model, '4.3').matches).toEqual([]);
  });

  it('keys each row by its file and its line', () => {
    expect(filterRows(model, 'carol web').matches).toEqual([{ file: 'demo.plan', line: 17 }]);
  });
});

describe('filterRows on examples/portfolio/', () => {
  const model = analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve });

  it('code matches Code in beta, with Product B as its ancestor: Showing 1 of 7 tasks', () => {
    const found = filterRows(model, 'code');
    expect(found.matches).toEqual([{ file: 'teams/beta.plan', line: 8 }]);
    expect(titles(model, found.matches)).toEqual(['Code']);
    expect(titles(model, found.ancestors)).toEqual(['Product B']);
    expect(countOf(found)).toBe('Showing 1 of 7 tasks');
  });
});

describe('filtering a 5,000-line composition', () => {
  // A root mounting ten files of 500 lines each: 5,000 lines of tasks below the mount rows.
  const team = (n: number) =>
    ['---', 'profile: plan', '---', ...Array.from({ length: 497 }, (_, i) => (i % 10 === 0 ? `Phase ${n}.${i}` : `    Task ${n}.${i} | ${(i % 5) + 1}d | owner${i % 7}`))].join('\n');
  const files = new Map<string, string | null>(Array.from({ length: 10 }, (_, n) => [`teams/t${n}.plan`, team(n)]));
  const root = ['---', 'profile: plan', '---', ...Array.from({ length: 10 }, (_, n) => `Team ${n} | mount=teams/t${n}.plan`)].join('\n');
  const model = analyze(root, { filename: 'root.plan', files, resolve });

  const textOf = (file: string) => (file === 'root.plan' ? root : files.get(file)!);
  /** The shell's part: matching, then the lines shown, as each pane is handed them. */
  const filtering = () => trackFilter(model, filterRows(model, 'owner3 task'), textOf).visible(model);

  it('takes under 20 ms (median of 21 runs), matching and the lines shown', () => {
    expect([...model.files.values()].reduce((sum, f) => sum + f.lines.length, 0)).toBe(5013);
    filtering();
    const median = (run: () => unknown) => {
      const times = Array.from({ length: 21 }, () => {
        const t0 = performance.now();
        run();
        return performance.now() - t0;
      }).sort((a, b) => a - b);
      return times[10];
    };
    const whole = median(filtering);
    console.info(`5,000-line composition: filterRows median ${median(() => filterRows(model, 'owner3 task')).toFixed(2)} ms; with the lines shown ${whole.toFixed(2)} ms`);
    expect(whole).toBeLessThan(20);
  });
});
