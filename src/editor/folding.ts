// Indent-based folding on items with children. Spec §4.2.

import { foldService } from '@codemirror/language';
import { lineKind } from './lines';
import { subtreeEnd } from './subtree';

export const planFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  if (lineKind(line.text) !== 'item') return null;
  const end = subtreeEnd(state.doc, line);
  return end ? { from: line.to, to: end.to } : null;
});
