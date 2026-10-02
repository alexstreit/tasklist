// Mounting a file on a row (spec §4b.7): the path to write, and why a file can't be mounted there.
// The reasons follow composition's own rules (compose.ts, spec §2.12), so an editor offering files
// to mount never repeats them.

import { mountWhy } from './compose';
import type { ItemNode, Model } from './types';

/**
 * The path from the file `from` to the file `to`, both relative to the workspace's folder, as a
 * mount cell in `from` names it: the inverse of the workspace's `resolve(from, ref)`.
 */
export function relativePath(from: string, to: string): string {
  const dir = from.split('/').slice(0, -1);
  const target = to.split('/');
  let common = 0;
  while (common < dir.length && common < target.length - 1 && dir[common] === target[common]) common++;
  return [...dir.slice(common).map(() => '..'), ...target.slice(common)].join('/');
}

/**
 * Why `target` can't be mounted on `row`, or null when it can: the row's own file; a file above the
 * row (composition would report `mount-loop`); a file shown elsewhere in the composed plan
 * (`mount-overlap`), not counting what the row itself shows now; and a file whose own mounts,
 * followed through `mountsOf` (resolved paths; undefined when unknown), reach a file above the row.
 */
export function mountRefusal(model: Model, row: ItemNode, target: string, mountsOf: (path: string) => readonly string[] | undefined): string | null {
  if (target === row.file) return `${target} is this row's own file; a file can't mount itself`;
  // The files above the row: its own, then each file's mount row's file, up to the root.
  const composer = new Map<string, string>();
  const shownUnder = (node: ItemNode, into: Set<string>): void => {
    if (node.composes !== undefined) into.add(node.composes);
    node.children.forEach((child) => shownUnder(child, into));
  };
  const visit = (node: ItemNode): void => {
    if (node.composes !== undefined) composer.set(node.composes, node.file);
    node.children.forEach(visit);
  };
  model.roots.forEach(visit);
  const above: string[] = [];
  for (let file: string | undefined = row.file; file !== undefined && !above.includes(file); file = composer.get(file)) above.push(file);
  if (above.includes(target)) return mountWhy.loop(target);
  // What the row shows now goes when its mount changes, so it is no overlap.
  const own = new Set<string>();
  shownUnder(row, own);
  if (model.files.has(target) && !own.has(target)) return mountWhy.overlap(target);
  const seen = new Set([target]);
  for (const path of seen) {
    for (const next of mountsOf(path) ?? []) {
      if (above.includes(next)) return mountWhy.loop(target);
      seen.add(next);
    }
  }
  return null;
}
