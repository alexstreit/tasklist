// Stateless line classification shared by folding and the keymap: rows'
// body line kinds (base §1), with the document's comment marker. Front matter
// needs document position and is the highlighter's business.

export { indentOf } from '../editing/lines';

export type LineKind = 'blank' | 'comment' | 'item';

export function lineKind(text: string, comment: string): LineKind {
  const trimmed = text.trimStart();
  if (trimmed.trimEnd() === '') return 'blank';
  return trimmed.startsWith(comment) ? 'comment' : 'item';
}
