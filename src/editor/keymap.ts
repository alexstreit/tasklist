// Keymap. Spec §4.3. Ctrl+S is added in Task 4.
//
// Tab is captured, so keyboard users need the escape hatch that
// @codemirror/view provides: Escape puts the editor in tab-focus mode for
// two seconds, during which Tab is left to the browser and moves focus.

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  toggleLineComment,
} from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import type { StateCommand } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { indentOf, lineKind } from './lines';
import { subtreeEnd } from './subtree';

/** Extend the selection to the smallest enclosing subtree that is larger than it. */
export const selectSubtree: StateCommand = ({ state, dispatch }) => {
  const { doc } = state;
  const { from, to } = state.selection.main;
  let limit = Infinity;
  for (let n = doc.lineAt(from).number; n >= 1; n--) {
    const line = doc.line(n);
    if (lineKind(line.text) !== 'item') continue;
    const indent = indentOf(line.text);
    if (indent >= limit) continue;
    limit = indent;
    const end = subtreeEnd(doc, line)?.to ?? line.to;
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
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  { key: 'Tab', run: indentMore, shift: indentLess },
  { key: 'Mod-/', run: toggleLineComment },
  { key: 'Ctrl-Shift-ArrowUp', run: selectSubtree },
  ...historyKeymap,
  ...foldKeymap,
  ...baseKeymap,
];

export const planKeys = [history(), keymap.of(planKeymap)];
