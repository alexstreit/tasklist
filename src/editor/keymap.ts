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
import { commentOf } from './language';
import { indentOf, lineKind } from './lines';
import { subtreeEnd } from './subtree';

/** The lines touched by the selection. */
function selectedLines(state: EditorState): LineRange {
  const { from, to } = state.selection.main;
  return { fromLine: state.doc.lineAt(from).number, toLine: state.doc.lineAt(to).number };
}

function lineCommand(op: (text: string, range: LineRange, state: EditorState) => TextEdit[], userEvent: string): StateCommand {
  return ({ state, dispatch }) => {
    const edits = op(state.doc.toString(), selectedLines(state), state);
    if (edits.length > 0) dispatch(state.update({ changes: edits, userEvent }));
    return true;
  };
}

/**
 * Moving lines leaves the selection's own text untouched, so the selection
 * has to be shifted past the line that jumped over it.
 */
function moveCommand(direction: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    const range = selectedLines(state);
    const edits = (direction < 0 ? moveUp : moveDown)(state.doc.toString(), range);
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
// The comment marker is the document's own (spec §3.8).
export const toggleCommentLines = lineCommand((text, range, state) => toggleComment(text, range, commentOf(state)), 'input.comment');
export const moveLinesUp = moveCommand(-1);
export const moveLinesDown = moveCommand(1);

/** Extend the selection to the smallest enclosing subtree that is larger than it. */
export const selectSubtree: StateCommand = ({ state, dispatch }) => {
  const { doc } = state;
  const { from, to } = state.selection.main;
  const comment = commentOf(state);
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
