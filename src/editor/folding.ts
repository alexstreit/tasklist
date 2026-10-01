// Indent-based folding on items with children. Spec §4.2.

import { foldService } from '@codemirror/language';
import { commentOf } from './language';
import { lineKind } from './lines';
import { subtreeEnd } from './subtree';

export const planFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const comment = commentOf(state);
  if (lineKind(line.text, comment) !== 'item') return null;
  const end = subtreeEnd(state.doc, line, comment);
  return end ? { from: line.to, to: end.to } : null;
});
