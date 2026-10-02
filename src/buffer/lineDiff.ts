// The edits that turn one text into another, a whole line at a time, touching only the lines that
// differ. A file changed on disk is applied to its buffer this way (spec §6), so a cursor or an undo
// entry on an unchanged line stays where it is.

import type { TextEdit } from './types';

/** Lines with their terminators, so joining them gives the text back. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * The longest common subsequence of `a` and `b`, as pairs of indices in ascending order (Myers'
 * O((N+M)D) algorithm, so a small change to a long file stays cheap).
 */
function matches(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= n + m && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // Walk back from the end, collecting each diagonal (a run of equal lines).
  const out: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : prev[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) out.push([--x, --y]);
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/** Edits, in `before`'s coordinates, that turn `before` into `after`. Lines in both are left alone. */
export function lineDiff(before: string, after: string): TextEdit[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const starts = [0];
  for (const line of a) starts.push(starts[starts.length - 1] + line.length);
  const edits: TextEdit[] = [];
  let i = 0;
  let j = 0;
  // A sentinel match past both ends flushes the last run of differing lines.
  for (const [mi, mj] of [...matches(a, b), [a.length, b.length]]) {
    if (mi > i || mj > j) edits.push({ from: starts[i], to: starts[mi], insert: b.slice(j, mj).join('') });
    i = mi + 1;
    j = mj + 1;
  }
  return edits;
}
