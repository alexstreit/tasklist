// The text editor: a CodeMirror view mounted on the shared buffer, or on a composed buffer, which
// shows a root file with the files it mounts as segments (spec §4.5).

import { foldGutter, indentUnit } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { setCell } from 'rows';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { CodeMirrorBuffer } from '../buffer';
import { ComposedBuffer } from '../buffer/composed';
import type { FileLine, Model } from '../core';
import { layoutPublisher } from '../ui/row-layout';
import type { Leader, RowLayout } from '../ui/row-layout';
import { planDiagnostics, showDiagnostics, showModelDiagnostics } from './diagnostics';
import { fileLineAt, lineStart, setRootFile } from './files';
import { planFolding } from './folding';
import { planKeys } from './keymap';
import { plan, showSyntax } from './language';
import { convertTabsOnPaste } from './pasteTabs';
import { segments, setUnsaved } from './segments';
import { planTheme } from './theme';

export { showSyntax } from './language';
export { planKeymap, selectSubtree, indentLines, outdentLines, moveLinesUp, moveLinesDown, toggleCommentLines } from './keymap';
export { showDiagnostics, toLintDiagnostics } from './diagnostics';

export function planEditor(): Extension {
  return [
    plan(),
    planFolding,
    foldGutter(),
    // Each file's own line numbers (spec §4.5); a plain buffer's are the document's.
    lineNumbers({ formatNumber: (n, state) => String(fileLineAt(state, state.doc.line(Math.min(n, state.doc.lines)).from).line) }),
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
  /** Put the cursor on a line of a file; reported back through `onCursorLine` as not editor-driven. */
  setCursorLine(at: FileLine): void;
  /** The files with unsaved changes, for the segments' mount lines. */
  showUnsaved(files: ReadonlySet<string>): void;
  destroy(): void;
}

export interface TextEditorHooks {
  /** `fromApi` is true when the move came from setCursorLine rather than the user. */
  onCursorLine(at: FileLine, fromApi: boolean): void;
  onSave(): void;
  /** The path of the file a plain buffer holds, until a model names it; '' for a new document. */
  root?: string;
  /** A segment's mount line's Open: make the file active. */
  onOpenFile?(path: string): void;
}

/** CodeMirror's own .cm-content top padding, kept unless setMinBodyTop asks for more. */
const CONTENT_PADDING = 4;

export function mountTextEditor(buffer: CodeMirrorBuffer, parent: HTMLElement, hooks: TextEditorHooks): TextEditor {
  let fromApi = false;
  let cursorLine: FileLine | null = null;
  const composed = buffer instanceof ComposedBuffer ? buffer : null;

  /**
   * Line blocks cover wrapped lines; a folded line's block covers it and its folded lines, which
   * have none. Each row is keyed by its file and its line in it.
   */
  function measure(): RowLayout {
    const scrollTop = view.scrollDOM.scrollTop;
    const { state } = view;
    return {
      version: buffer.version(),
      bodyTop: view.documentTop - parent.getBoundingClientRect().top + scrollTop,
      contentHeight: view.contentHeight - view.documentPadding.top,
      scrollTop,
      rows: view.viewportLineBlocks.map((block) => ({ at: fileLineAt(state, block.from), top: block.top, height: block.height })),
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
    composed ? segments({ open: (path) => hooks.onOpenFile?.(path), unmount: (at) => unmount(at) }) : [],
    // CodeMirror's own search and replace, over the whole text, composed or not (spec §4.5).
    search({ top: true }),
    keymap.of(searchKeymap),
    bodyTopPadding.of([]),
    EditorView.updateListener.of((update) => {
      // An edit, a fold, a newly measured height or a resize of the editor.
      if (update.docChanged || update.viewportChanged || update.heightChanged || update.geometryChanged) layout.publish();
      const at = fileLineAt(update.state, update.state.selection.main.head);
      if (cursorLine && at.file === cursorLine.file && at.line === cursorLine.line) return;
      cursorLine = at;
      hooks.onCursorLine(at, fromApi);
    }),
  ]);
  if (!composed) view.dispatch({ effects: setRootFile.of(hooks.root ?? '') });

  // The last model, for Unmount: it clears the mount row's `mount=` cell through rows, in the row's own file.
  let latest: Model | null = null;
  /** Unmount on a segment's mount line (spec §4.5): one undo step; nothing while the model trails the file's text. */
  function unmount(at: FileLine): void {
    const read = latest?.files.get(at.file);
    const node = read?.lines[at.line - 1];
    const column = read?.doc.schema.mount?.column;
    if (!composed || !read || node?.kind !== 'item' || !column) return;
    const pieces = composed.pieces();
    const text = pieces.runs
      .filter((r) => !r.joint && r.file === at.file)
      .map((r) => view.state.doc.sliceString(r.at, r.at + r.to - r.from))
      .join('');
    if (text !== read.doc.text) return;
    const result = setCell(read.doc, node.row, column, null);
    if ('edits' in result) composed.applyFile(at.file, result.edits, 'text-editor');
  }
  cursorLine = fileLineAt(view.state, view.state.selection.main.head);
  hooks.onCursorLine(cursorLine, true);
  view.scrollDOM.addEventListener('scroll', layout.publish);
  // The pane, so a resize from outside the editor counts too. jsdom has no ResizeObserver.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(layout.publish) : null;
  resize?.observe(parent);

  return {
    setCursorLine(at) {
      const anchor = lineStart(view.state, at);
      if (anchor === null) return;
      fromApi = true;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      fromApi = false;
      view.focus();
    },
    update(model) {
      latest = model;
      showSyntax(view, model);
      // Every file's diagnostics, each in its own segment, and their fixes go to their files.
      if (composed) showModelDiagnostics(view, model, (file, edits) => composed.applyFile(file, edits, 'text-editor'));
      else showDiagnostics(view, model.diagnostics.filter((d) => d.file === undefined), (edits) => buffer.apply(edits, 'text-editor'));
      layout.publish();
    },
    showUnsaved(files) {
      if (composed) view.dispatch({ effects: setUnsaved.of(files) });
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
