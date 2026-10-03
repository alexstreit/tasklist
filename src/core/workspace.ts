// The workspace (PLUGINS.md §7.1): how the shell reaches files. Only the shell holds one; core and
// plugins get a snapshot of the files instead. The shell asks what a workspace can do, never which
// kind it is.

export interface OpenedFile {
  path: string;
  text: string;
}

/** What a write actually did. `downloaded` is the fallback: nothing was written in place. */
export type WriteResult =
  | { outcome: 'saved'; path: string }
  | { outcome: 'downloaded' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string };

/** A folder picked with `allowEmpty`: open, with no file shown yet. */
export interface OpenedFolder {
  path: null;
}

export interface Workspace {
  /**
   * `saveAs`: whether the user can pick where to save, which creates a file. `create`: whether
   * `create` can make a file at a path.
   */
  readonly can: { list: boolean; watch: boolean; saveInPlace: boolean; saveAs: boolean; create: boolean };
  /**
   * The user picks a file, or a folder and the workspace picks a file in it to show first; null
   * when they cancel. A reason it didn't open, to show the user as is, is thrown as a `Notice`.
   * With `allowEmpty`, a folder is not refused for having no plan files, no file is picked in it, and
   * it isn't remembered yet: a later `open()` of the same workspace finishes opening that folder,
   * picking its file as usual. A folder is remembered only by an open that succeeds.
   */
  open(options?: { allowEmpty?: boolean }): Promise<OpenedFile | OpenedFolder | null>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<WriteResult>;
  saveAs(text: string, suggested: string): Promise<WriteResult>;
  /** Makes a new file at `path`, and its folders; fails, writing nothing, when the file exists. */
  create(path: string, text: string): Promise<WriteResult>;
  /** Single-file: just the open file. */
  list(): Promise<string[]>;
  /** An include path, relative to a file. Throws, with a plain reason, for a path outside the workspace. */
  resolve(from: string, ref: string): string;
  watch?(path: string, onChange: () => void): () => void;
}

/** Why opening didn't happen, worded for the user: the shell shows the message as it is. */
export class Notice extends Error {}
