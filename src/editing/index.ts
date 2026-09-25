// Structural edits as pure functions over text. Spec §3.8. Both the text
// editor's keymap and the grid call these; neither reimplements them.
//
// Every operation returns edits in the coordinates of the text it was given,
// and returns no edits at all when it does not apply.

import { indentOf, lines } from './lines';
import type { LineRange } from './lines';
import type { TextEdit } from '../buffer';

export type { LineRange } from './lines';

const UNIT = '    ';
const COMMENT = '//';

export function indent(text: string, range: LineRange): TextEdit[] {
  return lines(text)
    .slice(range.fromLine - 1, range.toLine)
    .map((line) => ({ from: line.from, to: line.from, insert: UNIT }));
}

export function outdent(text: string, range: LineRange): TextEdit[] {
  return lines(text)
    .slice(range.fromLine - 1, range.toLine)
    .map((line) => ({ line, width: Math.min(UNIT.length, indentOf(line.text)) }))
    .filter(({ width }) => width > 0)
    .map(({ line, width }) => ({ from: line.from, to: line.from + width, insert: '' }));
}

/**
 * Swap the range with the line above it. Expressed as "lift the line above out
 * and drop it below the range" so that positions inside the range are
 * untouched and map straight through.
 */
export function moveUp(text: string, range: LineRange): TextEdit[] {
  if (range.fromLine <= 1) return [];
  const all = lines(text);
  const previous = all[range.fromLine - 2];
  const last = all[range.toLine - 1];
  const after = all[range.toLine];
  return [
    { from: previous.from, to: all[range.fromLine - 1].from, insert: '' },
    after
      ? { from: after.from, to: after.from, insert: `${previous.text}\n` }
      : { from: last.to, to: last.to, insert: `\n${previous.text}` },
  ];
}

export function moveDown(text: string, range: LineRange): TextEdit[] {
  const all = lines(text);
  const next = all[range.toLine];
  if (!next) return [];
  const first = all[range.fromLine - 1];
  const following = all[range.toLine + 1];
  return [
    { from: first.from, to: first.from, insert: `${next.text}\n` },
    following
      ? { from: next.from, to: following.from, insert: '' }
      : { from: all[range.toLine - 1].to, to: next.to, insert: '' },
  ];
}

/** A new line above the range, carrying `content`. */
export function insertLineAbove(text: string, range: LineRange, content = ''): TextEdit[] {
  const { from } = lines(text)[range.fromLine - 1];
  return [{ from, to: from, insert: `${content}\n` }];
}

/**
 * Delete the range's lines with their line breaks. Children of a deleted
 * parent keep their indentation and so re-attach to the previous shallower
 * item; that falls out of the format and needs no special handling here.
 */
export function deleteLines(text: string, range: LineRange): TextEdit[] {
  const all = lines(text);
  const after = all[range.toLine];
  const from = after || range.fromLine === 1 ? all[range.fromLine - 1].from : all[range.fromLine - 2].to;
  const to = after ? after.from : all[range.toLine - 1].to;
  return from === to ? [] : [{ from, to, insert: '' }];
}

/**
 * Toggle `// ` on the range. Commenting inserts at the shallowest indent in
 * the range so the block stays aligned, and skips blank lines unless the
 * range is a single line. Uncommenting wins when every non-blank line in the
 * range is already commented.
 */
export function toggleComment(text: string, range: LineRange): TextEdit[] {
  const block = lines(text).slice(range.fromLine - 1, range.toLine);
  const content = block.filter((line) => line.text.trim() !== '');
  if (content.length === 0) {
    return block.length > 1 ? [] : [{ from: block[0].from, to: block[0].from, insert: `${COMMENT} ` }];
  }

  if (content.every((line) => line.text.trimStart().startsWith(COMMENT))) {
    return content.map((line) => {
      const start = line.from + indentOf(line.text);
      const rest = line.text.slice(indentOf(line.text) + COMMENT.length);
      return { from: start, to: start + COMMENT.length + (rest.startsWith(' ') ? 1 : 0), insert: '' };
    });
  }
  const column = Math.min(...content.map((line) => indentOf(line.text)));
  return content.map((line) => ({
    from: line.from + column,
    to: line.from + column,
    insert: `${COMMENT} `,
  }));
}
