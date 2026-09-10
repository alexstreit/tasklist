// Resolve the editor cursor to the item a renderer should highlight.

import type { CursorItem, Model, ModelNode } from '../core';

/** Item line numbers in document order. */
export function itemLines(model: Model): number[] {
  const out: number[] = [];
  const visit = (n: ModelNode): void => {
    out.push(n.line);
    n.children.forEach(visit);
  };
  model.roots.forEach(visit);
  return out;
}

/** The item on `cursorLine`, else the nearest item before it; null when none precedes it. */
export function cursorItemFor(lines: number[], cursorLine: number | null): CursorItem | null {
  if (cursorLine === null) return null;
  let before: number | null = null;
  for (const line of lines) {
    if (line === cursorLine) return { line, exact: true };
    if (line > cursorLine) break;
    before = line;
  }
  return before === null ? null : { line: before, exact: false };
}
