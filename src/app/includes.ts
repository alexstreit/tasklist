// The include loop (PLUGINS.md §6): the shell gathers included files before analysis, so analyze
// stays synchronous and never sees the workspace. With the single-file workspace every read fails,
// so until M3 the snapshot is always empty.

import { includesOf } from '../core';
import type { Workspace } from '../core';

export interface Includes {
  /**
   * The last snapshot gathered, by resolved path. When the open file's include paths differ from
   * the last set gathered, it also starts a new gather, which calls `onGathered` when it finishes.
   */
  snapshot(path: string | null, text: string): ReadonlyMap<string, string>;
}

/**
 * Gathers only when the set of paths changes, so a failed read isn't retried on every keystroke. A
 * gather overtaken by a newer one is dropped. When one finishes, the shell re-analyzes the current
 * buffer with it (`onGathered`), not the text that started it.
 */
export function createIncludes(workspace: Pick<Workspace, 'read' | 'resolve'>, onGathered: () => void): Includes {
  let gathered: string | null = null; // the last set of paths, as a key
  let files: ReadonlyMap<string, string> = new Map();
  let generation = 0;

  // includesOf over each newly read file until no new path appears. A path already seen isn't
  // read twice, so a cycle stops; the open file is never read, since the buffer is its text.
  const gather = async (open: string, paths: string[], mine: number): Promise<void> => {
    const out = new Map<string, string>();
    const seen = new Set([open]);
    let next = paths;
    while (next.length > 0) {
      const found: string[] = [];
      for (const path of next) {
        if (seen.has(path)) continue;
        seen.add(path);
        try {
          const text = await workspace.read(path);
          out.set(path, text);
          found.push(...includesOf(text).map((ref) => workspace.resolve(path, ref)));
        } catch {
          // Left out of the snapshot: the reference is the rows error it already is.
        }
      }
      next = found;
    }
    if (mine !== generation) return;
    files = out;
    onGathered();
  };

  return {
    snapshot(path, text) {
      const open = path ?? '';
      const paths = [...new Set(includesOf(text).map((ref) => workspace.resolve(open, ref)))].sort();
      const key = paths.join('\n');
      if (key !== gathered) {
        gathered = key;
        generation++;
        if (paths.length === 0) files = new Map();
        else void gather(open, paths, generation);
      }
      return files;
    },
  };
}
