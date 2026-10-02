// Stateless line classification shared by folding and the keymap: rows'
// body line kinds (base §1), with the document's comment marker. Front matter
// needs document position and is the highlighter's business.

export { indentOf, lineKind } from '../editing/lines';
export type { LineKind } from '../editing/lines';
