// Indent-based folding on items with children. Spec §4.2. In a composed text (§4.5) an item folds
// its own file's subtree by that file's indentation, with the segments inside it; a mount row folds
// its own children and its segment together.

import { foldService } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { piecesOf } from '../buffer/composed';
import { fileLineAt } from './files';
import { commentOf } from './language';
import { indentOf, lineKind } from './lines';
import { subtreeEnd } from './subtree';

export const planFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const comment = commentOf(state, lineStart);
  if (lineKind(line.text, comment) !== 'item') return null;
  if (!piecesOf(state)) {
    const end = subtreeEnd(state.doc, line, comment);
    return end ? { from: line.to, to: end.to } : null;
  }
  const to = composedEnd(state, line.number, comment);
  return to !== null && to > line.to ? { from: line.to, to } : null;
});

/** Where the fold of the item on document line `n` ends, in a composed text; null when nothing folds. */
function composedEnd(state: EditorState, n: number, comment: string): number | null {
  const pieces = piecesOf(state)!;
  const { doc } = state;
  const file = pieces.toFile(doc.line(n).from).file;
  const indent = indentOf(doc.line(n).text);
  // The file's own subtree, by §4.2's rule over its own lines; other files' lines are segments.
  let lastItem: number | null = null;
  let lastContent: number | null = null;
  for (let m = n + 1; m <= doc.lines; m++) {
    const next = doc.line(m);
    const run = pieces.runs[pieces.runFor(next.from)];
    if (run.file !== file) {
      // Past the rest of this other file's piece in one step.
      m = Math.max(m, doc.lineAt(Math.max(run.at + (run.joint ? 1 : run.to - run.from) - 1, next.from)).number);
      continue;
    }
    const kind = lineKind(next.text, comment);
    if (kind === 'blank') continue;
    if (kind === 'item') {
      if (indentOf(next.text) <= indent) break;
      lastItem = lastContent = m;
    } else if (indentOf(next.text) > indent) lastContent = m;
  }
  let to = lastItem === null ? null : doc.line(lastContent!).to;
  // The segments of this row and of the rows in its subtree.
  const first = fileLineAt(state, doc.line(n).from).line;
  const last = lastItem === null ? first : fileLineAt(state, doc.line(lastContent!).from).line;
  for (const s of pieces.segments) {
    if (s.mount.file !== file || s.mount.line < first || s.mount.line > last) continue;
    const end = doc.lineAt(Math.max(pieces.range(s).to - 1, 0)).to;
    if (to === null || end > to) to = end;
  }
  return to;
}
