// Test implementation of PlanBuffer: a string and an undo stack of inverse
// edits. Shares its test suite with CodeMirrorBuffer.

import type { BufferChange, PlanBuffer, TextEdit } from './types';

/** Edits sorted by position, so applying and mapping can walk them in order. */
function ordered(edits: readonly TextEdit[]): TextEdit[] {
  return [...edits].sort((a, b) => a.from - b.from);
}

function mapper(edits: readonly TextEdit[]): (pos: number) => number {
  return (pos) => {
    let delta = 0;
    for (const e of edits) {
      // An edit starting at or after pos leaves it alone; an insertion at pos
      // keeps it on the near side, as CodeMirror's default association does.
      if (e.from >= pos) break;
      if (e.to <= pos) delta += e.insert.length - (e.to - e.from);
      else return e.from + e.insert.length;
    }
    return pos + delta;
  };
}

export class InMemoryBuffer implements PlanBuffer {
  private doc: string;
  private readonly undone: TextEdit[][] = [];
  private readonly redone: TextEdit[][] = [];
  private readonly listeners = new Set<(change: BufferChange) => void>();

  constructor(doc = '') {
    this.doc = doc;
  }

  text(): string {
    return this.doc;
  }

  apply(edits: readonly TextEdit[], origin: string): void {
    const inverse = this.run(edits, origin);
    this.redone.length = 0;
    // Loading a file replaces the document; the old history no longer describes it.
    if (origin === 'load') this.undone.length = 0;
    else this.undone.push(inverse);
  }

  undo(): void {
    const edits = this.undone.pop();
    if (edits) this.redone.push(this.run(edits, 'undo'));
  }

  redo(): void {
    const edits = this.redone.pop();
    if (edits) this.undone.push(this.run(edits, 'redo'));
  }

  onChange(listener: (change: BufferChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply, notify, and return the edits that undo this change. */
  private run(edits: readonly TextEdit[], origin: string): TextEdit[] {
    const sorted = ordered(edits);
    const inverse: TextEdit[] = [];
    let text = this.doc;
    let delta = 0;
    for (const e of sorted) {
      inverse.push({ from: e.from + delta, to: e.from + delta + e.insert.length, insert: this.doc.slice(e.from, e.to) });
      delta += e.insert.length - (e.to - e.from);
    }
    for (const e of [...sorted].reverse()) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
    this.doc = text;
    const change: BufferChange = { text, edits: sorted, mapPos: mapper(sorted), origin };
    for (const listener of [...this.listeners]) listener(change);
    return inverse;
  }
}
