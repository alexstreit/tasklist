// The text editor: a CodeMirror view mounted on the shared buffer.

import { foldGutter, indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { CodeMirrorBuffer } from '../buffer';
import type { Model } from '../core';
import { planDiagnostics, showDiagnostics } from './diagnostics';
import { planFolding } from './folding';
import { planKeys } from './keymap';
import { plan, showSyntax } from './language';
import { convertTabsOnPaste } from './pasteTabs';
import { planTheme } from './theme';

export { showSyntax } from './language';
export { planKeymap, selectSubtree, indentLines, outdentLines, moveLinesUp, moveLinesDown, toggleCommentLines } from './keymap';
export { showDiagnostics, toLintDiagnostics } from './diagnostics';

export function planEditor(): Extension {
  return [
    plan(),
    planFolding,
    foldGutter(),
    lineNumbers(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    planKeys,
    convertTabsOnPaste,
    planDiagnostics,
    planTheme(),
  ];
}

export interface TextEditor {
  /** A fresh model for the buffer's current text. */
  update(model: Model): void;
  /** Put the cursor on a line; reported back through `onCursorLine` as not editor-driven. */
  setCursorLine(line: number): void;
  destroy(): void;
}

export interface TextEditorHooks {
  /** `fromApi` is true when the move came from setCursorLine rather than the user. */
  onCursorLine(line: number, fromApi: boolean): void;
  onSave(): void;
}

export function mountTextEditor(buffer: CodeMirrorBuffer, parent: HTMLElement, hooks: TextEditorHooks): TextEditor {
  let fromApi = false;
  let cursorLine = 0;
  const view = buffer.createView(parent, [
    keymap.of([
      { key: 'Mod-s', run: () => (hooks.onSave(), true) },
      { key: 'Mod-z', run: () => (buffer.undo(), true) },
      { key: 'Mod-y', run: () => (buffer.redo(), true) },
      { key: 'Mod-Shift-z', run: () => (buffer.redo(), true) },
    ]),
    planEditor(),
    EditorView.updateListener.of((update) => {
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      if (line === cursorLine) return;
      cursorLine = line;
      hooks.onCursorLine(line, fromApi);
    }),
  ]);
  cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  hooks.onCursorLine(cursorLine, true);

  return {
    setCursorLine(line) {
      const { doc } = view.state;
      if (line > doc.lines) return;
      fromApi = true;
      view.dispatch({ selection: { anchor: doc.line(line).from }, scrollIntoView: true });
      fromApi = false;
      view.focus();
    },
    update(model) {
      showSyntax(view, model);
      showDiagnostics(view, model.diagnostics, (edits) => buffer.apply(edits, 'text-editor'));
    },
    destroy() {
      buffer.destroyView();
    },
  };
}
