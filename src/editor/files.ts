// Which file each part of the text editor's document is in (spec §4.5). Over a composed buffer that
// is its piece map's answer; over a plain buffer the whole document is the one file, `rootFile`.
// Lines are numbered in their own file, so the cursor, the row layout, the gutter and diagnostics
// all speak `{ file, line }`.

import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { piecesOf } from '../buffer/composed';
import type { Place } from '../buffer/pieces';
import type { FileLine } from '../core';

/** Names the file a plain buffer holds: the root file's path, from its latest model. */
export const setRootFile = StateEffect.define<string>();

/** The path of the file a plain buffer holds; '' for a new document. */
export const rootFileField = StateField.define<string>({
  create: () => '',
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setRootFile) ? e.value : v), value),
});

const rootFile = { of: (state: EditorState) => state.field(rootFileField, false) ?? '' };

/** A stretch of the document holding one file's text, from its offset `from` to `to`, starting at `at`. */
export interface Stretch {
  file: string;
  from: number;
  to: number;
  at: number;
}

/** Every stretch of file text, in document order; joints are in none. */
export function stretches(state: EditorState): Stretch[] {
  const pieces = piecesOf(state);
  if (!pieces) return [{ file: rootFile.of(state), from: 0, to: state.doc.length, at: 0 }];
  return pieces.runs.filter((r) => !r.joint).map(({ file, from, to, at }) => ({ file, from, to, at }));
}

export function placeAt(state: EditorState, pos: number): Place {
  return piecesOf(state)?.toFile(pos) ?? { file: rootFile.of(state), offset: pos };
}

/** Where a file's offset is in the document; null when the file isn't shown in it. */
export function toDoc(state: EditorState, file: string, offset: number): number | null {
  const pieces = piecesOf(state);
  if (!pieces) return file === rootFile.of(state) && offset <= state.doc.length ? offset : null;
  try {
    return pieces.toComposed(file, offset);
  } catch {
    return null;
  }
}

/** Each of a file's pieces, with the number in its file of the line it starts on. */
function piecesWithLines(state: EditorState, file: string): { at: number; end: number; line: number }[] {
  const { doc } = state;
  const out: { at: number; end: number; line: number }[] = [];
  let line = 1;
  for (const s of stretches(state)) {
    if (s.file !== file) continue;
    const end = s.at + (s.to - s.from);
    out.push({ at: s.at, end, line });
    // A piece ends at a line start, except the file's last, which has no successor to count for.
    line += doc.lineAt(end).number - doc.lineAt(s.at).number;
  }
  return out;
}

/** The file and the line in it of the document line at `pos`. */
export function fileLineAt(state: EditorState, pos: number): FileLine {
  const pieces = piecesOf(state);
  const docLine = state.doc.lineAt(pos);
  if (!pieces) return { file: rootFile.of(state), line: docLine.number };
  const { file } = pieces.toFile(docLine.from);
  const piece = piecesWithLines(state, file).find((p) => p.at <= docLine.from && docLine.from <= p.end)!;
  return { file, line: piece.line + (docLine.number - state.doc.lineAt(piece.at).number) };
}

/** Where a file's line starts in the document; null when it isn't shown. */
export function lineStart(state: EditorState, { file, line }: FileLine): number | null {
  const pieces = piecesOf(state);
  const { doc } = state;
  if (!pieces) return file === rootFile.of(state) && line >= 1 && line <= doc.lines ? doc.line(line).from : null;
  const list = piecesWithLines(state, file);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (line < p.line) continue;
    const n = doc.lineAt(p.at).number + (line - p.line);
    if (n > doc.lines) return null;
    const from = doc.line(n).from;
    // Past this piece's last line: the line isn't in the file.
    if (from > p.end || (from === p.end && i < list.length - 1)) return null;
    return from;
  }
  return null;
}
