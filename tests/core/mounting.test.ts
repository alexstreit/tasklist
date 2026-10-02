// Task 37: mounting from the grid. The path a mount cell names (`relativePath`, the inverse of the
// workspace's resolve) and why a file can't be mounted on a row (`mountRefusal`, by composition's
// own rules).

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { mountRefusal, relativePath } from '../../src/core';
import type { ItemNode, Model } from '../../src/core';
import { portfolio, portfolioFiles, resolve } from '../support/portfolio';

describe('relativePath', () => {
  const cases: [string, string, string][] = [
    ['portfolio.plan', 'teams/beta.plan', 'teams/beta.plan'],
    ['teams/alpha.plan', 'teams/beta.plan', 'beta.plan'],
    ['teams/alpha.plan', 'portfolio.plan', '../portfolio.plan'],
    ['teams/alpha.plan', 'other/x/y.plan', '../other/x/y.plan'],
    ['a/b/c.plan', 'a/d.plan', '../d.plan'],
    ['a/b/c.plan', 'e.plan', '../../e.plan'],
    ['a/b/c.plan', 'a/b/c/d.plan', 'c/d.plan'],
    ['a/b.plan', 'a/b.plan', 'b.plan'],
    // A folder named like the file is still a folder.
    ['plan.plan', 'plan/plan.plan', 'plan/plan.plan'],
  ];

  it.each(cases)('from %s to %s is %s', (from, to, expected) => {
    expect(relativePath(from, to)).toBe(expected);
  });

  it.each(cases)('resolves back: resolve(%s, relativePath(…, %s)) is the file', (from, to) => {
    expect(resolve(from, relativePath(from, to))).toBe(to);
  });

  it('resolves back for every pair of files in a small tree', () => {
    const files = ['top.plan', 'a/one.plan', 'a/two.plan', 'a/b/three.plan', 'c/four.plan', 'c/d/e/five.plan'];
    for (const from of files) for (const to of files) expect(resolve(from, relativePath(from, to))).toBe(to);
  });
});

describe('mountRefusal', () => {
  const model: Model = analyze(portfolio, { filename: 'portfolio.plan', files: portfolioFiles(), resolve });
  const find = (file: string, title: string): ItemNode => {
    let found: ItemNode | undefined;
    const visit = (n: ItemNode): void => void ((n.file === file && n.title === title && (found = n)) || n.children.forEach(visit));
    model.roots.forEach(visit);
    return found!;
  };
  const none = () => undefined;

  it('refuses the row’s own file', () => {
    expect(mountRefusal(model, find('teams/alpha.plan', 'Design'), 'teams/alpha.plan', none)).toBe("teams/alpha.plan is this row's own file; a file can't mount itself");
  });

  it('refuses a file above the row, as composition’s mount-loop says it', () => {
    expect(mountRefusal(model, find('teams/alpha.plan', 'Design'), 'portfolio.plan', none)).toBe('portfolio.plan mounts this file, directly or through other files');
  });

  it('refuses a file whose own mounts reach a file above the row', () => {
    const mountsOf = (path: string) => (path === 'teams/loop.plan' ? ['teams/via.plan'] : path === 'teams/via.plan' ? ['portfolio.plan'] : undefined);
    expect(mountRefusal(model, find('teams/alpha.plan', 'Design'), 'teams/loop.plan', mountsOf)).toBe('teams/loop.plan mounts this file, directly or through other files');
  });

  it('refuses a file shown elsewhere, as composition’s mount-overlap says it, but not what the row itself shows', () => {
    expect(mountRefusal(model, find('teams/alpha.plan', 'Design'), 'teams/beta.plan', none)).toBe('teams/beta.plan is already mounted elsewhere in the plan');
    // Product B shows beta now: changing its mount doesn't count beta as shown elsewhere.
    expect(mountRefusal(model, find('portfolio.plan', 'Product B'), 'teams/beta.plan', none)).toBeNull();
  });

  it('allows a file that is shown nowhere and mounts nothing above', () => {
    expect(mountRefusal(model, find('portfolio.plan', 'Tradeshow'), 'teams/gamma.plan', () => ['teams/delta.plan'])).toBeNull();
  });
});
