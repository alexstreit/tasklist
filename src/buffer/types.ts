// The one document buffer every editor writes to. Spec §3.7.
// The buffer knows characters only; lines and nodes are analyze()'s business.

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface BufferChange {
  /** The document after the change. */
  text: string;
  /** What changed, in the coordinates of the document before the change. */
  edits: readonly TextEdit[];
  /** Position before the change -> position after it. Text inserted at `pos` goes after it, or before it with `assoc` 1. */
  mapPos(pos: number, assoc?: -1 | 1): number;
  /** "text-editor" | "grid" | "undo" | "redo" | "load" | "remote" (the file changed on disk; not undoable) */
  origin: string;
}

export interface PlanBuffer {
  text(): string;
  /** How many changes the buffer has had: every edit, undo, redo and load. */
  version(): number;
  apply(edits: readonly TextEdit[], origin: string): void;
  undo(): void;
  redo(): void;
  /** Returns an unsubscribe function. */
  onChange(listener: (change: BufferChange) => void): () => void;
}
