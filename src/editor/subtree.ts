// Indent-based subtree extent, used by folding and the subtree selection command.

import type { Line, Text } from '@codemirror/state';
import { indentOf, lineKind } from './lines';

/**
 * Last line of the subtree rooted at `line` (an item line), or null when the
 * item has no child items. Comments indented deeper than the item are part of
 * the subtree; blank lines never extend it.
 */
export function subtreeEnd(doc: Text, line: Line, comment: string): Line | null {
  const indent = indentOf(line.text);
  let lastItem: Line | null = null;
  let lastContent: Line | null = null;
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const next = doc.line(n);
    const kind = lineKind(next.text, comment);
    if (kind === 'blank') continue;
    if (kind === 'item') {
      if (indentOf(next.text) <= indent) break;
      lastItem = lastContent = next;
    } else if (indentOf(next.text) > indent) {
      lastContent = next;
    }
  }
  return lastItem ? lastContent : null;
}
