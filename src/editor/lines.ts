// Stateless line classification shared by the language mode, folding and
// keymap. Mirrors spec §2.2 for everything except front matter, which needs
// document position and is handled by the language mode's parser state.

export { indentOf } from '../editing/lines';

export type LineKind = 'blank' | 'comment' | 'reserved' | 'item';

export function lineKind(text: string): LineKind {
  const trimmed = text.trim();
  if (trimmed === '') return 'blank';
  if (trimmed.startsWith('//') || (trimmed.startsWith('<!--') && trimmed.endsWith('-->'))) return 'comment';
  if (trimmed.startsWith('#')) return 'reserved';
  return 'item';
}

