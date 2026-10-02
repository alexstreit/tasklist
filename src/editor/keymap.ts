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
import { piecesOf, refuse } from '../buffer/composed';
import { commentOf } from './language';
import { indentOf, lineKind } from './lines';
import { subtreeEnd } from './subtree';

/** The lines touched by the selection. */
function selectedLines(state: EditorState): LineRange {
  const { from, to } = state.selection.main;
  return { fromLine: state.doc.lineAt(from).number, toLine: state.doc.lineAt(to).number };
}

/**
 * In a composed text (spec §4.5), true when lines `fromLine` to `toLine` are in more than one
 * piece: a line operation over them would cross from one file into another, so it is refused,
 * and the status line says so.
 */
function crosses(state: EditorState, fromLine: number, toLine: number): boolean {
  const pieces = piecesOf(state);
  if (!pieces) return false;
  const first = pieces.runFor(state.doc.line(fromLine).from);
  for (let n = fromLine + 1; n <= toLine; n++) {
    if (pieces.runFor(state.doc.line(n).from) === first) continue;
    refuse(state);
    return true;
  }
  return false;
}

/**
 * Runs a line operation on the text of the piece the lines are in (the whole document when it
 * isn't composed), so its edits stay inside that file's text and never touch a joint.
 */
function onPiece(state: EditorState, range: LineRange, op: (text: string, range: LineRange) => TextEdit[]): TextEdit[] {
  const pieces = piecesOf(state);
  if (!pieces) return op(state.doc.toString(), range);
  const r = pieces.runs[pieces.runFor(state.doc.line(range.fromLine).from)];
  const from = r.at;
  const to = r.at + (r.to - r.from);
  const skip = state.doc.lineAt(from).number - 1;
  return op(state.doc.sliceString(from, to), { fromLine: range.fromLine - skip, toLine: range.toLine - skip }).map((e) => ({ from: e.from + from, to: e.to + from, insert: e.insert }));
}

function lineCommand(op: (text: string, range: LineRange, state: EditorState) => TextEdit[], userEvent: string): StateCommand {
  return ({ state, dispatch }) => {
    const range = selectedLines(state);
    if (crosses(state, range.fromLine, range.toLine)) return true;
    const edits = onPiece(state, range, (text, local) => op(text, local, state));
    if (edits.length > 0) dispatch(state.update({ changes: edits, userEvent }));
    return true;
  };
}

/**
 * Moving lines leaves the selection's own text untouched, so the selection
 * has to be shifted past the line that jumped over it. In a composed text the
 * line jumped over must be in the same piece.
 */
function moveCommand(direction: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    const range = selectedLines(state);
    const swappedLine = direction < 0 ? range.fromLine - 1 : range.toLine + 1;
    if (swappedLine < 1 || swappedLine > state.doc.lines) return true;
    if (crosses(state, Math.min(range.fromLine, swappedLine), Math.max(range.toLine, swappedLine))) return true;
    const edits = onPiece(state, range, direction < 0 ? moveUp : moveDown);
    if (edits.length === 0) return true;
    const swapped = state.doc.line(direction < 0 ? range.fromLine - 1 : range.toLine + 1);
    const shift = (swapped.text.length + 1) * direction;
    const { anchor, head } = state.selection.main;
    dispatch(state.update({ changes: edits, selection: { anchor: anchor + shift, head: head + shift }, userEvent: 'move.line' }));
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
