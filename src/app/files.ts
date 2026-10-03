// The files open in this session (spec §6). Each has its own buffer, so its undo history survives
// switching between files, and remembers the text on disk, so the shell can tell what is unsaved and
// what changed on disk underneath it. Exactly one file is active: the editors and views follow it.
// Every save goes through `save` here, which reads the file again first and asks before
// overwriting a change made outside the app.

import { lineDiff } from '../buffer';
import type { PlanBuffer } from '../buffer';
import type { OpenedFile, Workspace, WriteResult } from '../core';

export interface OpenFile<B extends PlanBuffer = PlanBuffer> {
  readonly buffer: B;
  /** Relative to the workspace; null for a new document that was never saved. */
  path: string | null;
  /** The text as last read from or written to disk; for a new document, the text it started with. */
  disk: string;
  /** The text last read, saved or downloaded: leaving the page loses nothing while the buffer matches it. */
  kept: string;
  /** It changed on disk while it had unsaved changes, so the change wasn't applied. */
  stale: boolean;
  /** It couldn't be read when last read again. */
  missing: boolean;
  /** The user opened it: picked it, chose it in the panel, or created it. False for a file read only to fill a segment. */
  shown: boolean;
}

/** Unsaved: the buffer differs from the file on disk. */
export const isDirty = (file: OpenFile): boolean => file.buffer.text() !== file.disk;

/** What the store asks the user. */
export interface Ask {
  /** The file changed on disk since it was read, or is gone from it: true to write it anyway. */
  overwrite(file: OpenFile, why: 'changed' | 'missing'): Promise<boolean>;
}

/** `kept`: the user chose not to overwrite a change on disk, so nothing was written. */
export type SaveResult = WriteResult | { outcome: 'kept' };

export interface OpenFiles<B extends PlanBuffer = PlanBuffer> {
  readonly workspace: Workspace;
  files(): readonly OpenFile<B>[];
  active(): OpenFile<B>;
  /** The workspace's files as last listed: the open file alone when it can't list. */
  listing(): readonly string[];
  /** Makes the file at `path` active, and shown, reading it the first time. */
  show(path: string): Promise<OpenFile<B>>;
  /**
   * Opens a file already read from disk, as `text`, without making it active: a mounted file a
   * composed view shows (plan spec §4.5). A file already open is returned as it is.
   */
  adopt(path: string, text: string): OpenFile<B>;
  /** Writes the file in place, or picks where with `as` or when it has no path. */
  save(file: OpenFile<B>, as?: boolean): Promise<SaveResult>;
  /** Saves every file with unsaved changes, or those of `only`, one at a time. */
  saveAll(only?: readonly OpenFile<B>[]): Promise<SaveResult[]>;
  /**
   * Closes `file`: it is no longer shown, and the next shown file in the panel's order becomes
   * active, else the one before it. The files in `drop` are forgotten; `file` stays open, unshown,
   * when a segment another file shows still needs it.
   */
  close(file: OpenFile<B>, drop: readonly OpenFile<B>[]): void;
  /** Lists the workspace again, when it can list. */
  relist(): Promise<void>;
  /**
   * Lists the workspace again and reads every open file again. A change on disk is applied as a
   * line diff, outside the undo history, to a file without unsaved changes; a file with them is
   * marked stale instead.
   */
  refresh(): Promise<void>;
  /** Called when the active file, a file's markers or the listing change; not on every edit. */
  onChange(listener: () => void): () => void;
}

const DEFAULT_NAME = 'untitled.plan';

/** Tabs become 4 spaces and line ends LF on load (spec §2.1, §6); a buffer never holds either. */
export const normalise = (text: string): string => text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

/**
 * `buffer` becomes the first file's: the file `opened` is loaded into it, replacing its text and
 * history, or with `opened` null it is a new document as it stands. Later files get `makeBuffer`'s.
 */
export function createOpenFiles<B extends PlanBuffer>(
  workspace: Workspace,
  buffer: B,
  opened: OpenedFile | null,
  options: { makeBuffer(text: string): B; ask: Ask },
): OpenFiles<B> {
  const listeners = new Set<() => void>();
  const changed = (): void => listeners.forEach((listener) => listener());
  const make = (buffer: B, path: string | null, text: string, shown: boolean): OpenFile<B> => ({ buffer, path, disk: text, kept: text, stale: false, missing: false, shown });

  let first: OpenFile<B>;
  if (opened) {
    const text = normalise(opened.text);
    buffer.apply([{ from: 0, to: buffer.text().length, insert: text }], 'load');
    first = make(buffer, opened.path, text, true);
  } else first = make(buffer, null, buffer.text(), true);
  let files: OpenFile<B>[] = [first];
  let active = first;
  let listing: string[] = opened ? [opened.path] : [];
  let refreshing: Promise<void> | null = null;

  /** Read the file again before writing it: true when it is safe to write, or the user said to. */
  const confirmWrite = async (file: OpenFile<B> & { path: string }): Promise<boolean> => {
    let text: string;
    try {
      text = normalise(await workspace.read(file.path));
    } catch {
      file.missing = true;
      changed();
      return options.ask.overwrite(file, 'missing');
    }
    file.missing = false;
    if (text === file.disk || text === file.buffer.text()) return true;
    file.stale = true;
    changed();
    return options.ask.overwrite(file, 'changed');
  };

  const store: OpenFiles<B> = {
    workspace,
    files: () => files,
    active: () => active,
    listing: () => listing,

    async show(path) {
      let file = files.find((f) => f.path === path);
      if (!file) {
        const text = normalise(await workspace.read(path));
        // Another show of the same path may have finished while this one read.
        file = files.find((f) => f.path === path);
        if (!file) files.push((file = make(options.makeBuffer(text), path, text, true)));
      }
      file.shown = true;
      active = file;
      changed();
      return file;
    },

    adopt(path, text) {
      let file = files.find((f) => f.path === path);
      if (!file) {
        files.push((file = make(options.makeBuffer(text), path, text, false)));
        changed();
      }
      return file;
    },

    async save(file, as = false) {
      const text = file.buffer.text();
      let result: WriteResult;
      if (as || file.path === null) {
        if (!workspace.can.saveAs) return { outcome: 'failed', reason: 'Use New… to create a file in this folder.' };
        result = await workspace.saveAs(text, file.path ?? DEFAULT_NAME);
      } else {
        // A download overwrites nothing, so only a write in place checks the disk first.
        if (workspace.can.saveInPlace && !(await confirmWrite(file as OpenFile<B> & { path: string }))) return { outcome: 'kept' };
        result = await workspace.write(file.path, text);
      }
      if (result.outcome === 'saved' || result.outcome === 'downloaded') file.kept = text;
      // Only a write in place changes the file on disk, so only it clears the unsaved marker.
      if (result.outcome === 'saved') Object.assign(file, { path: result.path, disk: text, stale: false, missing: false });
      changed();
      return result;
    },

    async saveAll(only) {
      const results: SaveResult[] = [];
      for (const file of (only ?? files).filter(isDirty)) results.push(await store.save(file));
      return results;
    },

    close(file, drop) {
      // The panel's order: the listing, then any open file not in it.
      const order = [...listing, ...files.flatMap((f) => (f.path === null || listing.includes(f.path) ? [] : [f.path]))];
      const at = order.indexOf(file.path ?? '');
      const shown = (path: string) => files.find((f) => f.path === path && f.shown && f !== file);
      const next = order.slice(at + 1).map(shown).find(Boolean) ?? order.slice(0, Math.max(at, 0)).reverse().map(shown).find(Boolean);
      if (!next) throw new Error('Closing the last open file');
      file.shown = false;
      files = files.filter((f) => !drop.includes(f));
      active = next;
      changed();
    },

    async relist() {
      if (!workspace.can.list) return;
      try {
        listing = await workspace.list();
      } catch {
        // The folder itself is gone; its open files show as missing on the next read.
        listing = [];
      }
      changed();
    },

    refresh() {
      refreshing ??= (async () => {
        await store.relist();
        for (const file of files) {
          if (file.path === null) continue;
          let text: string;
          try {
            text = normalise(await workspace.read(file.path));
          } catch {
            file.missing = true;
            continue;
          }
          file.missing = false;
          if (text === file.disk) {
            file.stale = false;
          } else if (!isDirty(file)) {
            const before = file.buffer.text();
            // Recorded first, so a listener on the buffer already sees the file as saved.
            Object.assign(file, { disk: text, kept: text, stale: false });
            file.buffer.apply(lineDiff(before, text), 'remote');
          } else if (text === file.buffer.text()) {
            Object.assign(file, { disk: text, kept: text, stale: false });
          } else file.stale = true;
        }
        changed();
      })().finally(() => (refreshing = null));
      return refreshing;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}
