// Keymap. Spec §4.3. The line operations themselves live in src/editing/ and
// are shared with the grid; the commands here only translate the selection
// into a line range and dispatch the edits.
//
// Tab is captured, so keyboard users need the escape hatch that
// @codemirror/view provides: Escape puts the editor in tab-focus mode for
// two seconds, during which Tab is left to the browser and moves focus.

import { defaultKeymap } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import type { EditorState, StateCommand } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { indent, moveDown, moveUp, outdent, toggleComment } from '../editing';
import type { LineRange } from '../editing';
import type { TextEdit } from '../buffer';
import { piecesOf, placeInFile, refuse } from '../buffer/composed';
import { commentOf } from './language';
import { indentOf, lineKind } from './lines';
import { subtreeEnd } from './subtree';

/** The lines touched by the selection. */
function selectedLines(state: EditorState): LineRange {
  const { from, to } = state.selection.main;
  return { fromLine: state.doc.lineAt(from).number, toLine: state.doc.lineAt(to).number };
}

/**
 * In a composed text (spec §4.5), the file the lines `range` covers are all in, with its own text
 * and the range in its own lines: line operations act on that file's lines, not on composed
 * lines. Null when the lines are in more than one file: the operation would cross from one file
 * into another, so it is refused, and the status line says so. Undefined for a plain text.
 */
function inFile(state: EditorState, range: LineRange): { file: string; text: string; range: LineRange } | null | undefined {
  const pieces = piecesOf(state);
  if (!pieces) return undefined;
  const at = (n: number) => pieces.toFile(state.doc.line(n).from);
  const first = at(range.fromLine);
  for (let n = range.fromLine + 1; n <= range.toLine; n++) {
    if (at(n).file === first.file) continue;
    refuse(state);
    return null;
  }
  const doc = state.doc;
  const text = pieces.runs
    .filter((r) => !r.joint && r.file === first.file)
    .map((r) => doc.sliceString(r.at, r.at + r.to - r.from))
    .join('');
  const lineIn = (offset: number) => {
    let line = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
    return line;
  };
  return { file: first.file, text, range: { fromLine: lineIn(first.offset), toLine: lineIn(at(range.toLine).offset) } };
}

function lineCommand(op: (text: string, range: LineRange, state: EditorState) => TextEdit[], userEvent: string): StateCommand {
  return ({ state, dispatch }) => {
    const range = selectedLines(state);
    const own = inFile(state, range);
    if (own === null) return true;
    if (own === undefined) {
      const edits = op(state.doc.toString(), range, state);
      if (edits.length > 0) dispatch(state.update({ changes: edits, userEvent }));
      return true;
    }
    const edits = op(own.text, own.range, state);
    if (edits.length > 0) dispatch(state.update({ ...placeInFile(state, own.file, edits), userEvent }));
    return true;
  };
}

/**
 * Moving lines leaves the selection's own text untouched, so the selection has to be shifted past
 * the line that jumped over it. In a composed text the move swaps with the previous or next line
 * of the same file, wherever it is shown, and the segments recompose after it; at a file's first
 * or last line it does nothing, as at the edge of a single file.
 */
function moveCommand(direction: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    const range = selectedLines(state);
    const own = inFile(state, range);
    if (own === null) return true;
    if (own === undefined) {
      const swappedLine = direction < 0 ? range.fromLine - 1 : range.toLine + 1;
      if (swappedLine < 1 || swappedLine > state.doc.lines) return true;
      const edits = (direction < 0 ? moveUp : moveDown)(state.doc.toString(), range);
      if (edits.length === 0) return true;
      const swapped = state.doc.line(swappedLine);
      const shift = (swapped.text.length + 1) * direction;
      const { anchor, head } = state.selection.main;
      dispatch(state.update({ changes: edits, selection: { anchor: anchor + shift, head: head + shift }, userEvent: 'move.line' }));
      return true;
    }
    // The empty text after a file's final newline is no line of it (spec §3.2): its last line has none below.
    const last = own.text.split('\n').length - (own.text.endsWith('\n') ? 1 : 0);
    if (direction > 0 && own.range.toLine >= last) return true;
    const edits = (direction < 0 ? moveUp : moveDown)(own.text, own.range);
    if (edits.length === 0) return true;
    const { changes, annotations } = placeInFile(state, own.file, edits);
    const set = state.changes(changes);
    // The selection's text stays; mapped so it stays on the lines that moved, not on those they jumped.
    const { anchor, head } = state.selection.main;
    dispatch(state.update({ changes: set, selection: { anchor: set.mapPos(anchor, direction), head: set.mapPos(head, direction) }, annotations, userEvent: 'move.line' }));
    return true;
  };
}

export const indentLines = lineCommand(indent, 'input.indent');
export const outdentLines = lineCommand(outdent, 'delete.dedent');
// The comment marker is the document's own (spec §3.8): in a composed text, the file's at the selection.
export const toggleCommentLines = lineCommand((text, range, state) => toggleComment(text, range, commentOf(state, state.selection.main.from)), 'input.comment');
export const moveLinesUp = moveCommand(-1);
export const moveLinesDown = moveCommand(1);

/** Extend the selection to the smallest enclosing subtree that is larger than it. */
export const selectSubtree: StateCommand = ({ state, dispatch }) => {
  const { doc } = state;
  const { from, to } = state.selection.main;
  const comment = commentOf(state, from);
  let limit = Infinity;
  for (let n = doc.lineAt(from).number; n >= 1; n--) {
    const line = doc.line(n);
    if (lineKind(line.text, comment) !== 'item') continue;
    const indent = indentOf(line.text);
    if (indent >= limit) continue;
    limit = indent;
    const end = subtreeEnd(doc, line, comment)?.to ?? line.to;
    if (line.from < from || end > to) {
      dispatch(state.update({ selection: { anchor: line.from, head: end }, userEvent: 'select' }));
      return true;
    }
  }
  return false;
};

// Alt+Left/Right are browser back/forward on Windows and Linux (spec §4.3).
const baseKeymap = defaultKeymap.filter((b) => b.key !== 'Alt-ArrowLeft' && b.key !== 'Alt-ArrowRight');

export const planKeymap: readonly KeyBinding[] = [
  { key: 'Alt-ArrowUp', run: moveLinesUp },
  { key: 'Alt-ArrowDown', run: moveLinesDown },
  { key: 'Tab', run: indentLines, shift: outdentLines },
  { key: 'Mod-/', run: toggleCommentLines },
  { key: 'Ctrl-Shift-ArrowUp', run: selectSubtree },
  ...foldKeymap,
  ...baseKeymap,
];

export const planKeys = keymap.of(planKeymap);
