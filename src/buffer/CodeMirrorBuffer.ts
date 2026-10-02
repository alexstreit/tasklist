// Production PlanBuffer. Wraps an EditorState and its history; the text
// editor mounts its view on that same state, so every edit — typed, undone,
// or applied by another editor — arrives here. Spec §3.7.
//
// This file, the composed buffer (./composed.ts) and src/editor/ are the only places that may
// import CodeMirror.
// EditorState, Transaction and ChangeSet never leave it.

import { history, redo, undo } from '@codemirror/commands';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { BufferChange, PlanBuffer, TextEdit } from './types';

export class CodeMirrorBuffer implements PlanBuffer {
  protected state: EditorState;
  private view: EditorView | null = null;
  /** Extensions of whichever editor is mounted; empty when none is. */
  private readonly mounted = new Compartment();
  private readonly historyConfig = new Compartment();
  private readonly listeners = new Set<(change: BufferChange) => void>();
  private origin = 'text-editor';
  private changes = 0;

  /** `extensions` are the buffer's own, kept whichever editor is mounted (the composed buffer's). */
  constructor(doc: string, extensions: Extension = []) {
    this.state = EditorState.create({ doc, extensions: [this.historyConfig.of(history()), this.mounted.of([]), extensions] });
  }

  text(): string {
    return this.state.doc.toString();
  }

  version(): number {
    return this.changes;
  }

  apply(edits: readonly TextEdit[], origin: string): void {
    // Loading a file replaces the document, so the old history no longer
    // describes it. Dropping the field and adding it back clears it.
    if (origin === 'load') {
      this.dispatch(this.state.update({ effects: this.historyConfig.reconfigure([]) }));
      this.dispatch(this.state.update({ effects: this.historyConfig.reconfigure(history()) }));
    }
    this.as(origin, (dispatch) =>
      dispatch(
        this.state.update({
          changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })),
          // A remote change (the file changed on disk) stays out of the history too, which maps the
          // entries before it through it, so an undo never reverts it.
          annotations: origin === 'load' || origin === 'remote' ? [Transaction.addToHistory.of(false)] : [],
        }),
      ),
    );
  }

  undo(): void {
    this.as('undo', (dispatch) => undo({ state: this.state, dispatch }));
  }

  redo(): void {
    this.as('redo', (dispatch) => redo({ state: this.state, dispatch }));
  }

  onChange(listener: (change: BufferChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Mount an editor's view on this buffer's state. Its transactions come back
   * through `dispatch` like any other edit.
   */
  createView(parent: HTMLElement, extensions: Extension): EditorView {
    this.dispatch(this.state.update({ effects: this.mounted.reconfigure(extensions) }));
    this.view = new EditorView({
      state: this.state,
      parent,
      dispatchTransactions: (trs) => trs.forEach((tr) => this.dispatch(tr)),
    });
    return this.view;
  }

  /** Unmount the current editor's view, leaving the document and its history intact. */
  destroyView(): void {
    if (!this.view) return;
    const view = this.view;
    this.view = null;
    this.dispatch(this.state.update({ effects: this.mounted.reconfigure([]) }));
    view.destroy();
  }

  protected as(origin: string, body: (dispatch: (tr: Transaction) => void) => void): void {
    this.origin = origin;
    try {
      body((tr) => this.dispatch(tr));
    } finally {
      this.origin = 'text-editor';
    }
  }

  protected dispatch(tr: Transaction): void {
    this.state = tr.state;
    // Counted before the view updates, so the text editor's listeners see the new version.
    if (tr.docChanged) this.changes++;
    this.view?.update([tr]);
    if (!tr.docChanged) return;
    const edits: TextEdit[] = [];
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
    const change: BufferChange = {
      text: tr.state.doc.toString(),
      edits,
      mapPos: (pos) => tr.changes.mapPos(pos),
      origin: this.origin,
    };
    for (const listener of [...this.listeners]) listener(change);
  }
}
