// Pasted or dropped text with tabs is converted to 4-space indentation, so
// the buffer never contains tabs (spec §2.1).

import { EditorSelection, EditorState } from '@codemirror/state';

export const convertTabsOnPaste = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'))) return tr;
  let hasTab = false;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (text.includes('\t')) hasTab = true;
    changes.push({ from, to, insert: text.replace(/\t/g, '    ') });
  });
  if (!hasTab) return tr;
  const changeSet = tr.startState.changes(changes);
  return {
    changes: changeSet,
    selection: EditorSelection.create(
      changes.map((c) => EditorSelection.cursor(changeSet.mapPos(c.to, 1))),
      tr.startState.selection.mainIndex,
    ),
    userEvent: 'input.paste',
    scrollIntoView: true,
  };
});
