// The piece map of a composed text (plan spec §3.7, §4.5): which file, and which range of it, each
// run of the composed text comes from. The composed text is the root file's text with each mounted
// file's text placed after its mount row's subtree, as a segment; mounts nest, so a file can appear
// as several pieces around the segments inside it. Pure: no CodeMirror, no DOM.
//
// The rules at the edges:
// - Pieces break at line starts. A segment goes at the start of the line after its mount row's
//   subtree extent (§4.2, `subtreeEndLine`); several at one place go innermost first.
// - A file that doesn't end with a newline, and is followed by another piece, is followed by a
//   **joint**: a newline that belongs to no file. A joint stays while its segment stays, even when
//   the file gains a final newline, so the line the cursor is on never vanishes under it.
// - A position on a boundary belongs to the piece that starts there. The position just before a
//   joint belongs to the file that ends there; the joint is one character that belongs to no file.
// - So `toComposed(toFile(c)) === c` for every composed position c, and `toFile(toComposed(p))` is
//   p for every file position except the end of a file that ends with a newline and is followed
//   by another piece: that position is the next piece's start. An insertion there goes to the next
//   piece.
// - An edit that crosses from one piece into another, touches a joint, or would leave a piece
//   ending inside a line when another file's piece follows it (deleting the newline that ends it)
//   is refused.

import { subtreeEndLine } from '../editing/lines';
import { matches } from './lineDiff';
import type { TextEdit } from './types';

/** A mount row that composes its file: the row's file and line, and the file it shows. */
export interface Mount {
  file: string;
  line: number;
  target: string;
}

/** What to compose. */
export interface Composition {
  root: string;
  text(file: string): string;
  /** Only the rows whose file is shown here (`ItemNode.composes`). */
  mounts: readonly Mount[];
  /** A file's comment marker, for its subtree extents. */
  comment(file: string): string;
  /** Files that keep the joint they already have. */
  joints?: ReadonlySet<string>;
}

/** A run of the composed text: a range of one file, or a joint after one. */
export interface Run {
  readonly joint: boolean;
  readonly file: string;
  /** In the file's own offsets; a joint's are both the file's end. */
  readonly from: number;
  readonly to: number;
  /** Where it starts in the composed text. */
  readonly at: number;
  /** 0 for the root file, 1 for a file it mounts, and so on. */
  readonly depth: number;
}

/** A mounted file's segment: its runs, `first` to `last` inclusive, nested segments and joint included. */
export interface Segment {
  readonly file: string;
  readonly depth: number;
  /** Its mount row. */
  readonly mount: { file: string; line: number };
  readonly first: number;
  readonly last: number;
}

/** A position in one file. */
export interface Place {
  file: string;
  offset: number;
}

/** A change to one file, in its own offsets, and the run it falls in. */
export interface FileEdit extends TextEdit {
  file: string;
  run: number;
}

const size = (r: Run): number => (r.joint ? 1 : r.to - r.from);
const end = (r: Run): number => r.at + size(r);

export class PieceMap {
  private byFile: Map<string, number[]> | null = null;

  private constructor(
    readonly runs: readonly Run[],
    readonly segments: readonly Segment[],
    /** The composed text's length. */
    readonly length: number,
  ) {}

  /** A map of one file, with no segments. */
  static single(file: string, length: number): PieceMap {
    return new PieceMap([{ joint: false, file, from: 0, to: length, at: 0, depth: 0 }], [], length);
  }

  /** Builds the composed text and its map. */
  static build(c: Composition): { map: PieceMap; text: string } {
    const protos: { file: string; from: number; to: number; depth: number }[] = [];
    const segs: { file: string; depth: number; mount: { file: string; line: number }; first: number; last: number }[] = [];
    const lastOf = new Map<string, number>();
    const visiting = new Set<string>();

    const emit = (file: string, depth: number): void => {
      visiting.add(file);
      const text = c.text(file);
      const lines = text.split('\n');
      const starts = [0];
      for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
      const comment = c.comment(file);
      const here = c.mounts
        .filter((m) => m.file === file && !visiting.has(m.target))
        .map((m) => {
          const line = Math.min(m.line, lines.length);
          const last = subtreeEndLine(lines.length, (n) => lines[n - 1], line, comment) ?? line;
          return { m, offset: Math.min(starts[last], text.length) };
        })
        // Innermost first: of rows whose extents end together, the later row is the deeper one.
        .sort((a, b) => a.offset - b.offset || b.m.line - a.m.line);
      let cursor = 0;
      const piece = (to: number): void => {
        protos.push({ file, from: cursor, to, depth });
        lastOf.set(file, protos.length - 1);
        cursor = to;
      };
      for (const { m, offset } of here) {
        if (offset > cursor) piece(offset);
        const first = protos.length;
        emit(m.target, depth + 1);
        segs.push({ file: m.target, depth: depth + 1, mount: { file, line: m.line }, first, last: protos.length - 1 });
      }
      // An empty file still has a piece, so its segment has a place.
      if (text.length > cursor || !lastOf.has(file)) piece(text.length);
      visiting.delete(file);
    };
    emit(c.root, 0);

    // Joints, now that it is known what follows each file's last piece.
    const jointAfter = new Set<number>();
    for (const [file, i] of lastOf) {
      if (i === protos.length - 1) continue;
      const text = c.text(file);
      if (!text.endsWith('\n') || c.joints?.has(file)) jointAfter.add(i);
    }
    const runs: Run[] = [];
    const index: number[] = [];
    const parts: string[] = [];
    let at = 0;
    protos.forEach((p, i) => {
      index.push(runs.length);
      runs.push({ joint: false, ...p, at });
      parts.push(c.text(p.file).slice(p.from, p.to));
      at += p.to - p.from;
      if (jointAfter.has(i)) {
        runs.push({ joint: true, file: p.file, from: p.to, to: p.to, at, depth: p.depth });
        parts.push('\n');
        at++;
      }
    });
    const segments = segs
      .map((s) => ({ ...s, first: index[s.first], last: index[s.last] + (jointAfter.has(s.last) ? 1 : 0) }))
      .sort((a, b) => a.first - b.first || b.last - a.last);
    return { map: new PieceMap(runs, segments, at), text: parts.join('') };
  }

  /** The files in it, the root first, each once. */
  files(): string[] {
    return [...this.pieces().keys()];
  }

  /** Where a segment starts and ends in the composed text. */
  range(segment: Segment): { from: number; to: number } {
    return { from: this.runs[segment.first].at, to: end(this.runs[segment.last]) };
  }

  /** The innermost segment the position's run is in, or null in the root's text. */
  segmentAt(pos: number): Segment | null {
    const i = this.runFor(pos);
    let found: Segment | null = null;
    for (const s of this.segments) if (s.first <= i && i <= s.last && (!found || s.depth > found.depth)) found = s;
    return found;
  }

  /** The index of the run a position belongs to, by the rules above. */
  runFor(pos: number): number {
    const i = this.lastAtOrBefore(pos);
    return this.runs[i].joint && this.runs[i].at === pos ? i - 1 : i;
  }

  toFile(pos: number): Place {
    const r = this.runs[this.runFor(pos)];
    return { file: r.file, offset: r.from + (pos - r.at) };
  }

  /** The file and offset of the character at `pos`, or 'joint'. */
  charAt(pos: number): Place | 'joint' {
    const r = this.runs[this.lastAtOrBefore(pos)];
    return r.joint ? 'joint' : this.toFile(pos);
  }

  toComposed(file: string, offset: number): number {
    const list = this.pieces().get(file);
    if (!list) throw new Error(`${file} isn't composed here`);
    for (const i of list) {
      const r = this.runs[i];
      if (r.from <= offset && offset < r.to) return r.at + (offset - r.from);
    }
    const last = this.runs[list[list.length - 1]];
    if (offset === last.to) return end(last);
    throw new Error(`${offset} is outside ${file}`);
  }

  /**
   * Splits composed changes (sorted, in the composed text's coordinates) into changes to files,
   * or null when any of them is refused. `charAt` reads the composed text.
   */
  split(changes: readonly TextEdit[], charAt: (pos: number) => string): FileEdit[] | null {
    const out: FileEdit[] = [];
    for (const { from, to, insert } of changes) {
      if (from === to) {
        const run = this.runFor(from);
        const r = this.runs[run];
        out.push({ file: r.file, run, from: r.from + (from - r.at), to: r.from + (from - r.at), insert });
        continue;
      }
      const run = this.lastAtOrBefore(from);
      const r = this.runs[run];
      if (r.joint || to > end(r)) return null;
      const next = this.runs[run + 1];
      if (to === end(r) && next && !next.joint) {
        // What the piece would end with: it must still end a line, or be empty.
        const last = insert.length > 0 ? insert[insert.length - 1] : from > r.at ? charAt(from - 1) : '\n';
        if (last !== '\n') return null;
      }
      out.push({ file: r.file, run, from: r.from + (from - r.at), to: r.from + (to - r.at), insert });
    }
    return out;
  }

  /** The map after file changes, each in the run `split` or `place` gave it. */
  apply(edits: readonly FileEdit[]): PieceMap {
    const delta = new Map<number, number>();
    for (const e of edits) delta.set(e.run, (delta.get(e.run) ?? 0) + e.insert.length - (e.to - e.from));
    const shift = new Map<string, number>();
    let atShift = 0;
    const runs = this.runs.map((r, i): Run => {
      const own = shift.get(r.file) ?? 0;
      const d = delta.get(i) ?? 0;
      const next = { ...r, at: r.at + atShift, from: r.from + own, to: r.to + own + (r.joint ? 0 : d) };
      shift.set(r.file, own + d);
      atShift += d;
      return next;
    });
    return new PieceMap(runs, this.segments, this.length + atShift);
  }

  /**
   * Moves changes off the boundaries where they would be ambiguous to undo (sorted, in composed
   * coordinates): a change that ends where another file's piece starts, taking or adding a whole
   * line at its piece's end, is moved back one character, to before that piece's final newline.
   * The text it makes is the same, but its inverse is then inside the piece; on the boundary, an
   * undo's insertion would go to the next file. `charAt` reads the composed text before the
   * changes. Null when no change moves.
   */
  settle(changes: readonly TextEdit[], charAt: (pos: number) => string): TextEdit[] | null {
    let moved = false;
    const out = changes.map((c, i) => {
      const run = c.from === c.to ? this.runFor(c.from) : this.lastAtOrBefore(c.from);
      const shifted = this.shift(run, c, charAt);
      // Never onto the change before it.
      if (!shifted || (i > 0 && changes[i - 1].to > shifted.from)) return c;
      moved = true;
      return shifted;
    });
    return moved ? out : null;
  }

  /** `change`, in run `run`, moved back one character as `settle` describes; null when it stays. */
  private shift(run: number, change: TextEdit, charAt: (pos: number) => string): TextEdit | null {
    const r = this.runs[run];
    const next = this.runs[run + 1];
    const { from, to, insert } = change;
    if (r.joint || to !== end(r) || !next || next.joint || from <= r.at) return null;
    if (charAt(from - 1) !== '\n' || charAt(to - 1) !== '\n') return null;
    if (insert !== '' ? !insert.endsWith('\n') : from === to) return null;
    return { from: from - 1, to: to - 1, insert: insert === '' ? '' : `\n${insert.slice(0, -1)}` };
  }

  /**
   * Places changes made to one file in its own offsets (sorted): each goes in the run it falls in,
   * and a change that spans pieces of the file is split around the segments between them.
   * `composed` gives each change's composed coordinates, before any of them. With `charAt`, the
   * composed text, changes are moved off the boundaries as `settle` moves them.
   */
  place(file: string, edits: readonly TextEdit[], charAt?: (pos: number) => string): { edits: FileEdit[]; composed: TextEdit[] } {
    const list = this.pieces().get(file);
    if (!list) throw new Error(`${file} isn't composed here`);
    const out: FileEdit[] = [];
    const composed: TextEdit[] = [];
    const push = (run: number, from: number, to: number, insert: string): void => {
      const r = this.runs[run];
      const at = { from: r.at + (from - r.from), to: r.at + (to - r.from), insert };
      const prev = composed[composed.length - 1];
      const shifted = charAt ? this.shift(run, at, charAt) : null;
      if (shifted && !(prev && prev.to > shifted.from)) {
        out.push({ file, run, from: from - 1, to: to - 1, insert: shifted.insert });
        composed.push(shifted);
        return;
      }
      out.push({ file, run, from, to, insert });
      composed.push(at);
    };
    for (const { from, to, insert } of edits) {
      if (from === to) {
        const run = list.find((i) => this.runs[i].from <= from && from < this.runs[i].to) ?? list[list.length - 1];
        push(run, from, from, insert);
        continue;
      }
      let rest = insert;
      for (const i of list) {
        const r = this.runs[i];
        const s = Math.max(from, r.from);
        const e = Math.min(to, r.to);
        if (s >= e) continue;
        push(i, s, e, rest);
        rest = '';
      }
    }
    return { edits: out, composed };
  }

  /**
   * True when every piece followed by another file's piece ends a line, or is empty: the composed
   * text still breaks between files at line starts. `text` gives each file's text.
   */
  aligned(text: (file: string) => string): boolean {
    return this.runs.every((r, i) => {
      const next = this.runs[i + 1];
      return r.joint || !next || next.joint || r.from === r.to || text(r.file)[r.to - 1] === '\n';
    });
  }

  /** One label per line of the composed text: where it starts, and its text with its terminator. */
  labels(text: string): string[] {
    const out: string[] = [];
    let pos = 0;
    for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const at = this.toFile(pos);
      out.push(`${at.file}\0${at.offset}\0${line}`);
      pos += line.length;
    }
    return out;
  }

  private lastAtOrBefore(pos: number): number {
    let lo = 0;
    let hi = this.runs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.runs[mid].at <= pos) lo = mid;
      else hi = mid - 1;
    }
    // A zero-length run (an empty file at the end) shares its start with nothing after it.
    return lo;
  }

  private pieces(): Map<string, number[]> {
    if (!this.byFile) {
      this.byFile = new Map();
      this.runs.forEach((r, i) => {
        if (r.joint) return;
        const list = this.byFile!.get(r.file);
        if (list) list.push(i);
        else this.byFile!.set(r.file, [i]);
      });
    }
    return this.byFile;
  }
}

/**
 * The change from one composed text to another, line by line, matching the lines that start at
 * the same place in the same file with the same text: segments come and go, and every line kept
 * stays untouched. In `before`'s coordinates.
 */
export function recomposition(before: { map: PieceMap; text: string }, after: { map: PieceMap; text: string }): TextEdit[] {
  const a = before.map.labels(before.text);
  const b = after.map.labels(after.text);
  const lines = after.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const starts = [0];
  for (const label of a) starts.push(starts[starts.length - 1] + label.slice(label.indexOf('\0', label.indexOf('\0') + 1) + 1).length);
  const edits: TextEdit[] = [];
  let i = 0;
  let j = 0;
  for (const [mi, mj] of [...matches(a, b), [a.length, b.length]]) {
    if (mi > i || mj > j) edits.push({ from: starts[i], to: starts[mi], insert: lines.slice(j, mj).join('') });
    i = mi + 1;
    j = mj + 1;
  }
  return edits;
}
