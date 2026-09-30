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

export interface Workspace {
  readonly can: { list: boolean; watch: boolean; saveInPlace: boolean };
  /** The user picks a file (or a folder, later); null when they cancel. */
  open(): Promise<OpenedFile | null>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<WriteResult>;
  saveAs(text: string, suggested: string): Promise<WriteResult>;
  /** Single-file: just the open file. */
  list(): Promise<string[]>;
  /** An include path, relative to a file. */
  resolve(from: string, ref: string): string;
  watch?(path: string, onChange: () => void): () => void;
}
