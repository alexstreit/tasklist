// Production PlanBuffer. Wraps an EditorState and its history; the text
// editor mounts its view on that same state, so every edit — typed, undone,
// or applied by another editor — arrives here. Spec §3.7.
//
// This file and src/editor/ are the only places that may import CodeMirror.
// EditorState, Transaction and ChangeSet never leave it.

import { history, redo, undo } from '@codemirror/commands';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { BufferChange, PlanBuffer, TextEdit } from './types';

export class CodeMirrorBuffer implements PlanBuffer {
  private state: EditorState;
  private view: EditorView | null = null;
  /** Extensions of whichever editor is mounted; empty when none is. */
  private readonly mounted = new Compartment();
  private readonly historyConfig = new Compartment();
  private readonly listeners = new Set<(change: BufferChange) => void>();
  private origin = 'text-editor';

  constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [this.historyConfig.of(history()), this.mounted.of([])] });
  }

  text(): string {
    return this.state.doc.toString();
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
          annotations: origin === 'load' ? [Transaction.addToHistory.of(false)] : [],
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

  private as(origin: string, body: (dispatch: (tr: Transaction) => void) => void): void {
    this.origin = origin;
    try {
      body((tr) => this.dispatch(tr));
    } finally {
      this.origin = 'text-editor';
    }
  }

  private dispatch(tr: Transaction): void {
    this.state = tr.state;
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
