// Indent-based subtree extent, used by folding and the subtree selection command.

import type { Line, Text } from '@codemirror/state';
import { subtreeEndLine } from '../editing/lines';

/**
 * Last line of the subtree rooted at `line` (an item line), or null when the
 * item has no child items. Comments indented deeper than the item are part of
 * the subtree; blank lines never extend it. The rule is `subtreeEndLine`'s.
 */
export function subtreeEnd(doc: Text, line: Line, comment: string): Line | null {
  const end = subtreeEndLine(doc.lines, (n) => doc.line(n).text, line.number, comment);
  return end === null ? null : doc.line(end);
}
