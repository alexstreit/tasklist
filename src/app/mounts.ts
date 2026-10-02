// Gathering mounted files (spec §6, PLUGINS.md §6): the shell reads them before analysis, so analyze
// stays synchronous and never sees the workspace. The paths the root mounts come from its model; a
// mounted file's own mounts come from parsing it once, cached by its text. A file open in the store
// gives its current text, unsaved edits included; any other is read from disk once, and kept while
// it stays mounted.

import { readMounts } from '../core';
import type { Workspace } from '../core';
import { normalise } from './files';

export interface MountSource {
  workspace: Pick<Workspace, 'read' | 'resolve'>;
  /** The current text of a file open in the store; undefined when it isn't open. */
  openText(path: string): string | undefined;
}

export interface Mounts {
  /**
   * The texts to analyze `root` with, by resolved path, following mounts until no new path
   * appears: null for a file that can't be read. `refs` are the root's mounts as written. A path
   * not read yet is left out and read, and `onGathered` is called when the read finishes.
   */
  snapshot(root: string, refs: readonly string[]): Map<string, string | null>;
  /** Forgets what was read from disk, so the next snapshot reads each file again (focus, Refresh). */
  reread(): void;
}

export function createMounts(source: MountSource, onGathered: () => void): Mounts {
  const { workspace } = source;
  /** Read from disk: the normalised text, or null when the read failed. */
  const disk = new Map<string, string | null>();
  /** Each gathered file's mounts, kept while its text is the same. */
  const parsed = new Map<string, { text: string; refs: string[] }>();
  const reading = new Set<string>();
  let generation = 0;

  const refsOf = (path: string, text: string): string[] => {
    const hit = parsed.get(path);
    if (hit?.text === text) return hit.refs;
    const refs = readMounts(text, path);
    parsed.set(path, { text, refs });
    return refs;
  };
  // A path outside the folder is never read; analysis reports it on its mount row.
  const resolved = (from: string, refs: readonly string[]): string[] =>
    refs.flatMap((ref) => {
      try {
        return [workspace.resolve(from, ref)];
      } catch {
        return [];
      }
    });

  const read = (path: string): void => {
    const mine = generation;
    reading.add(path);
    void workspace.read(path).then(normalise, () => null).then((text) => {
      // A reread overtook it, and reads the file again itself.
      if (mine !== generation) return;
      reading.delete(path);
      disk.set(path, text);
      onGathered();
    });
  };

  return {
    snapshot(root, refs) {
      const out = new Map<string, string | null>();
      // The root is never read: its text is the buffer. A path already seen stops a loop.
      const seen = new Set([root]);
      let next = resolved(root, refs);
      while (next.length > 0) {
        const found: string[] = [];
        for (const path of next) {
          if (seen.has(path)) continue;
          seen.add(path);
          const text = source.openText(path) ?? disk.get(path);
          if (text === undefined) {
            if (!reading.has(path)) read(path);
            continue;
          }
          out.set(path, text);
          if (text !== null) found.push(...resolved(path, refsOf(path, text)));
        }
        next = found;
      }
      // A file no longer mounted is dropped, so mounting it again reads it again.
      for (const path of disk.keys()) if (!seen.has(path)) disk.delete(path);
      for (const path of parsed.keys()) if (!seen.has(path)) parsed.delete(path);
      return out;
    },

    reread() {
      generation++;
      disk.clear();
      reading.clear();
    },
  };
}
