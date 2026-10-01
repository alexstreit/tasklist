// The text editor: a CodeMirror view mounted on the shared buffer.

import { foldGutter, indentUnit } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { CodeMirrorBuffer } from '../buffer';
import type { Model } from '../core';
import { layoutPublisher } from '../ui/row-layout';
import type { Leader, RowLayout } from '../ui/row-layout';
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

/** The text editor leads (spec §3.4): its rows are CodeMirror's line blocks. */
export interface TextEditor extends Leader {
  /** A fresh model for the buffer's current text; also republishes the row layout. */
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

/** CodeMirror's own .cm-content top padding, kept unless setMinBodyTop asks for more. */
const CONTENT_PADDING = 4;

export function mountTextEditor(buffer: CodeMirrorBuffer, parent: HTMLElement, hooks: TextEditorHooks): TextEditor {
  let fromApi = false;
  let cursorLine = 0;

  /** Line blocks cover wrapped lines; a folded line's block covers it and its folded lines, which have none. */
  function measure(): RowLayout {
    const scrollTop = view.scrollDOM.scrollTop;
    const { doc } = view.state;
    return {
      version: buffer.version(),
      bodyTop: view.documentTop - parent.getBoundingClientRect().top + scrollTop,
      contentHeight: view.contentHeight - view.documentPadding.top,
      scrollTop,
      rows: view.viewportLineBlocks.map((block) => ({ at: { line: doc.lineAt(block.from).number }, top: block.top, height: block.height })),
    };
  }
  const layout = layoutPublisher(measure);
  const bodyTopPadding = new Compartment();
  let minBodyTop = 0;
  let padding = 0; // the top padding set for minBodyTop; 0 for CodeMirror's own

  /**
   * The content's top padding is what moves the body; the scroller may sit below the pane's top.
   * Nothing is measured while nothing subscribes; with no minimum, the padding goes. CodeMirror
   * measures a new padding, and the update that follows republishes.
   */
  function fitPadding(): void {
    if (minBodyTop > 0 && !layout.listened()) return;
    const want = minBodyTop === 0 ? 0 : minBodyTop - (view.scrollDOM.getBoundingClientRect().top - parent.getBoundingClientRect().top);
    const next = want > CONTENT_PADDING ? want : 0;
    if (next === padding) return;
    padding = next;
    view.dispatch({ effects: bodyTopPadding.reconfigure(next > 0 ? EditorView.contentAttributes.of({ style: `padding-top: ${next}px` }) : []) });
  }

  const view = buffer.createView(parent, [
    keymap.of([
      { key: 'Mod-s', run: () => (hooks.onSave(), true) },
      { key: 'Mod-z', run: () => (buffer.undo(), true) },
      { key: 'Mod-y', run: () => (buffer.redo(), true) },
      { key: 'Mod-Shift-z', run: () => (buffer.redo(), true) },
    ]),
    planEditor(),
    bodyTopPadding.of([]),
    EditorView.updateListener.of((update) => {
      // An edit, a fold, a newly measured height or a resize of the editor.
      if (update.docChanged || update.viewportChanged || update.heightChanged || update.geometryChanged) layout.publish();
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      if (line === cursorLine) return;
      cursorLine = line;
      hooks.onCursorLine(line, fromApi);
    }),
  ]);
  cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  hooks.onCursorLine(cursorLine, true);
  view.scrollDOM.addEventListener('scroll', layout.publish);
  // The pane, so a resize from outside the editor counts too. jsdom has no ResizeObserver.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(layout.publish) : null;
  resize?.observe(parent);

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
      layout.publish();
    },
    onRowLayout(cb) {
      const off = layout.onRowLayout(cb);
      fitPadding();
      return off;
    },
    scrollTo(top) {
      view.scrollDOM.scrollTop = top;
    },
    setMinBodyTop(px) {
      minBodyTop = px;
      fitPadding();
    },
    destroy() {
      resize?.disconnect();
      view.scrollDOM.removeEventListener('scroll', layout.publish);
      buffer.destroyView();
    },
  };
}
