// The composed buffer (plan spec §3.7, §4.5): one CodeMirror state holding a root file's text with
// every file it mounts in a segment, and one undo history for all of them. Each file's text is
// held by its own buffer in the open files; this buffer only shows them together.
//
// - An edit is split by the piece map and lands in the file it falls in: that file's own buffer
//   gets it as `remote`, outside its own history. Undo and redo are routed the same way.
// - A transaction with any change that crosses from one piece into another, touches a joint, or
//   would join a line of one file to another's is refused whole (a change filter).
// - A change made to a file's own buffer elsewhere arrives here as `remote`, placed exactly by
//   the piece map, outside this history.
// - When the mounts change, `recompose` inserts or removes segments as one `compose` change,
//   outside this history.
//
// Like CodeMirrorBuffer, its public types never mention CodeMirror.

import { isolateHistory } from '@codemirror/commands';
import { Annotation, EditorState, Facet, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { AnnotationType } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { CodeMirrorBuffer } from './CodeMirrorBuffer';
import { PieceMap, recomposition } from './pieces';
import type { FileEdit, Mount } from './pieces';
import type { BufferChange, PlanBuffer, TextEdit } from './types';

/** Where the composed buffer finds each file's text: the open files' own buffers. */
export interface ComposedFiles {
  buffer(path: string): PlanBuffer | undefined;
}

const setPieces = StateEffect.define<PieceMap>();
/** The file edits a transaction makes, when they were placed in files' own offsets (`applyFile`). */
const placed = Annotation.define<FileEdit[]>();
/** A change that came from the files (remote) or from recomposing: it is routed nowhere. */
const fromFiles = Annotation.define<true>();

/** Called when an edit is refused because it would cross from one file into another. */
export const refusals = Facet.define<() => void>();

const charIn = (doc: Text) => (pos: number) => doc.sliceString(pos, pos + 1);

/** The composed text's piece map, followed through every change. Absent from a plain buffer's state. */
export const pieceField = StateField.define<PieceMap>({
  create: () => PieceMap.single('', 0),
  update(map, tr) {
    for (const e of tr.effects) if (e.is(setPieces)) return e.value;
    if (!tr.docChanged) return map;
    const edits = tr.annotation(placed) ?? map.split(changesOf(tr), charIn(tr.startState.doc));
    return edits ? map.apply(edits) : map;
  },
});

/** The piece map of an editor state, or null for a plain buffer's. */
export function piecesOf(state: EditorState): PieceMap | null {
  return state.field(pieceField, false) ?? null;
}

/** Tell whoever listens that an edit was refused: the text editor's line operations use it too. */
export function refuse(state: EditorState): void {
  for (const cb of state.facet(refusals)) cb();
}

function changesOf(tr: Transaction): TextEdit[] {
  const out: TextEdit[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => out.push({ from, to, insert: inserted.toString() }));
  return out;
}

/** The edits of one file, in its own offsets, out of a list for several. */
function byFile(edits: readonly FileEdit[]): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>();
  for (const { file, from, to, insert } of edits) {
    const list = out.get(file);
    if (list) list.push({ from, to, insert });
    else out.set(file, [{ from, to, insert }]);
  }
  return out;
}

export class ComposedBuffer extends CodeMirrorBuffer {
  readonly root: string;
  private readonly files: ComposedFiles;
  private readonly refusedListeners = new Set<() => void>();
  /** Each composed file's subscription to its own buffer. */
  private readonly following = new Map<string, () => void>();
  /** True while this buffer writes to the files' own buffers, so it doesn't hear itself. */
  private routing = false;
  private mounts: readonly Mount[] = [];
  private comment: (file: string) => string = () => '//';

  constructor(root: string, files: ComposedFiles) {
    const own = files.buffer(root);
    if (!own) throw new Error(`${root} isn't open`);
    const text = own.text();
    const hooks = { refused: () => {} };
    super(text, [
      pieceField.init(() => PieceMap.single(root, text.length)),
      refusals.of(() => hooks.refused()),
      EditorState.changeFilter.of((tr) => {
        if (tr.annotation(fromFiles) || tr.annotation(placed)) return true;
        const map = tr.startState.field(pieceField);
        if (map.split(changesOf(tr), charIn(tr.startState.doc))) return true;
        hooks.refused();
        return false;
      }),
      // An accepted change that ends on a boundary is moved off it, so its undo can't land in the
      // next file (PieceMap.settle). The text is the same; so are the selection and annotations.
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.annotation(fromFiles) || tr.annotation(placed)) return tr;
        const moved = tr.startState.field(pieceField).settle(changesOf(tr), charIn(tr.startState.doc));
        if (!moved) return tr;
        const kept = [Transaction.userEvent, Transaction.addToHistory, Transaction.remote, isolateHistory].flatMap((type) => {
          const value = tr.annotation(type as AnnotationType<unknown>);
          return value === undefined ? [] : [(type as AnnotationType<unknown>).of(value)];
        });
        return { changes: moved, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView, annotations: kept };
      }),
    ]);
    hooks.refused = () => this.refusedListeners.forEach((cb) => cb());
    this.root = root;
    this.files = files;
    this.follow();
  }

  pieces(): PieceMap {
    return this.state.field(pieceField);
  }

  /** Edits given in one file's own offsets, made through this buffer, in its history. */
  applyFile(file: string, edits: readonly TextEdit[], origin: string): void {
    if (edits.length === 0) return;
    const { edits: fileEdits, composed } = this.pieces().place(file, [...edits].sort((a, b) => a.from - b.from), charIn(this.state.doc));
    this.as(origin, (dispatch) =>
      dispatch(this.state.update({ changes: composed, annotations: [placed.of(fileEdits), ...(origin === 'remote' ? [Transaction.addToHistory.of(false)] : [])] })),
    );
  }

  /**
   * Shows the segments `mounts` asks for: those no longer mounted go, new ones come, as one change
   * outside the history. `comment` gives each file's comment marker. True when the text changed.
   */
  recompose(mounts: readonly Mount[], comment: (file: string) => string): boolean {
    this.mounts = mounts.filter((m) => this.files.buffer(m.target));
    this.comment = comment;
    return this.rebuild(null);
  }

  onRefused(cb: () => void): () => void {
    this.refusedListeners.add(cb);
    return () => this.refusedListeners.delete(cb);
  }

  /** Stops following the files' own buffers. */
  destroy(): void {
    for (const off of this.following.values()) off();
    this.following.clear();
  }

  protected override dispatch(tr: Transaction): void {
    const route = tr.docChanged && !tr.annotation(fromFiles) ? (tr.annotation(placed) ?? tr.startState.field(pieceField).split(changesOf(tr), charIn(tr.startState.doc))) : null;
    super.dispatch(tr);
    if (!route) return;
    this.routing = true;
    try {
      for (const [file, edits] of byFile(route)) this.files.buffer(file)?.apply(edits, 'remote');
    } finally {
      this.routing = false;
    }
  }

  /**
   * Builds the composition from the files' texts and moves this text to it, line by line. With
   * `change`, a file's own change is placed in it first, when that keeps the files apart at line starts.
   */
  private rebuild(change: { file: string; edits: readonly TextEdit[] } | null): boolean {
    const map = this.pieces();
    const text = (file: string) => this.files.buffer(file)!.text();
    if (change) {
      const { edits, composed } = map.place(change.file, change.edits);
      const next = map.apply(edits);
      if (next.aligned(text)) {
        this.as('remote', (dispatch) =>
          dispatch(this.state.update({ changes: composed, effects: setPieces.of(next), annotations: [fromFiles.of(true), Transaction.addToHistory.of(false)], filter: false })),
        );
        return true;
      }
    }
    const joints = new Set(map.runs.filter((r) => r.joint).map((r) => r.file));
    const built = PieceMap.build({ root: this.root, text, mounts: this.mounts, comment: this.comment, joints });
    const current = this.state.doc.toString();
    // The map before a change of the file's is its own: its labels read the text as it was.
    const edits = recomposition({ map, text: current }, built);
    const same = JSON.stringify([built.map.runs, built.map.segments]) === JSON.stringify([map.runs, map.segments]);
    if (edits.length === 0 && same) return false;
    this.as(change ? 'remote' : 'compose', (dispatch) =>
      dispatch(this.state.update({ changes: edits, effects: setPieces.of(built.map), annotations: [fromFiles.of(true), Transaction.addToHistory.of(false)], filter: false })),
    );
    this.follow();
    return edits.length > 0;
  }

  /** Follows the own buffer of every file composed here, and no other. */
  private follow(): void {
    const files = new Set(this.pieces().files());
    for (const [file, off] of this.following) {
      if (files.has(file)) continue;
      off();
      this.following.delete(file);
    }
    for (const file of files) {
      if (this.following.has(file)) continue;
      const own = this.files.buffer(file);
      if (!own) continue;
      this.following.set(
        file,
        own.onChange((change: BufferChange) => {
          if (!this.routing) this.rebuild({ file, edits: change.edits });
        }),
      );
    }
  }
}

/**
 * One file of a composed buffer, as a PlanBuffer: its own text and changes, with edits made through
 * the composed buffer's history. The grid edits the root file's rows through it.
 */
export function fileBuffer(composed: ComposedBuffer, file: string, own: PlanBuffer): PlanBuffer {
  return {
    text: () => own.text(),
    version: () => composed.version(),
    apply: (edits, origin) => composed.applyFile(file, edits, origin),
    undo: () => composed.undo(),
    redo: () => composed.redo(),
    onChange: (listener) => own.onChange(listener),
  };
}
