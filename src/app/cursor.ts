// Resolve the editor cursor to the item a renderer should highlight.

import type { CursorItem, FileLine, ItemNode, Model } from '../core';

/** Each file's item line numbers, in document order. */
export function itemLines(model: Model): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const visit = (n: ItemNode): void => {
    const lines = out.get(n.file);
    if (lines) lines.push(n.line);
    else out.set(n.file, [n.line]);
    n.children.forEach(visit);
  };
  model.roots.forEach(visit);
  for (const lines of out.values()) lines.sort((a, b) => a - b);
  return out;
}

/** The item on the cursor's line, else the nearest item of the same file before it; null when none precedes it. */
export function cursorItemFor(lines: ReadonlyMap<string, number[]>, cursor: FileLine | null): CursorItem | null {
  if (cursor === null) return null;
  const { file } = cursor;
  let before: number | null = null;
  for (const line of lines.get(file) ?? []) {
    if (line === cursor.line) return { file, line, exact: true };
    if (line > cursor.line) break;
    before = line;
  }
  return before === null ? null : { file, line: before, exact: false };
}
