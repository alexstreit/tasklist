// The filter's shown lines between recomputations (spec §5.7). The shell computes them with
// `filterRows` and then follows every edit with `mapPos`, in each file's own text: a row being
// edited stays, and lines typed among shown rows show. Only the query, Enter and the active file
// recompute them.

import type { FileLine, Found, Model, Visible } from '../core';
import type { BufferChange } from '../buffer';

/**
 * A stretch of hidden or dimmed lines in one file's text, with one of the line breaks around it, so
 * that text typed at either end of it lands outside it, and deleting its lines leaves it empty:
 * - `after`: from its first line's start to the next line's start (its last line's break included);
 * - `before`: at the end of the file, from the break before its first line to the end;
 * - `whole`: the whole file, which has no break around it.
 */
interface Run {
  from: number;
  to: number;
  edge: 'after' | 'before' | 'whole';
  dimmed: boolean;
}

const lineKey = (at: FileLine): string => `${at.file}\n${at.line}`;

/** Where each line of `text` starts. */
function starts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The runs of consecutive lines (1-based) for which `pick` is true. */
function runsOf(text: string, pick: (line: number) => boolean, dimmed: boolean): Run[] {
  const at = starts(text);
  const n = at.length;
  const out: Run[] = [];
  for (let i = 1; i <= n; i++) {
    if (!pick(i)) continue;
    let j = i;
    while (j < n && pick(j + 1)) j++;
    if (j < n) out.push({ from: at[i - 1], to: at[j], edge: 'after', dimmed });
    else if (i > 1) out.push({ from: at[i - 1] - 1, to: text.length, edge: 'before', dimmed });
    else out.push({ from: 0, to: text.length, edge: 'whole', dimmed });
    i = j;
  }
  return out;
}

/**
 * The lines (1-based) a run holds, given where the text's lines start: those whose start is in it,
 * or, at the end of the file, the break before it. Text typed at the start of its first line, before
 * the run, is on that line, so the line stays in it.
 */
function linesIn(run: Run, at: readonly number[]): number[] {
  const out: number[] = [];
  let k = 0;
  if (run.edge === 'before') {
    while (k < at.length && at[k] <= run.from) k++;
  } else {
    while (k + 1 < at.length && at[k + 1] <= run.from) k++;
  }
  const end = run.edge === 'after' ? run.to : run.to + 1;
  for (; k < at.length && at[k] < end; k++) out.push(k + 1);
  return out;
}

export interface FilterTracker {
  /** Follow a change to `file`'s own text. */
  map(file: string, change: BufferChange): void;
  /** The lines shown now, numbered as in `model`, which was read from the files' current texts. */
  visible(model: Model): Visible;
}

/**
 * Starts following what `filterRows` found in `model`: every line that isn't a match or an
 * ancestor of one is hidden, and the ancestors are dimmed. `textOf` gives a file's current text.
 */
export function trackFilter(model: Model, found: Found, textOf: (file: string) => string): FilterTracker {
  const shown = new Set([...found.matches, ...found.ancestors].map(lineKey));
  const dimmed = new Set(found.ancestors.map(lineKey));
  const runs = new Map<string, Run[]>();
  for (const file of model.files.keys()) {
    const text = textOf(file);
    runs.set(file, [
      ...runsOf(text, (line) => !shown.has(lineKey({ file, line })), false),
      ...runsOf(text, (line) => dimmed.has(lineKey({ file, line })), true),
    ]);
  }
  return {
    map(file, change) {
      const list = runs.get(file);
      if (!list) return;
      const next: Run[] = [];
      for (const run of list) {
        const from = change.mapPos(run.from, 1);
        const to = change.mapPos(run.to, -1);
        // A run whose lines were all deleted holds nothing; only the whole of a file can hold an empty line.
        if (to > from || (to === from && run.edge === 'whole')) next.push({ ...run, from, to });
      }
      runs.set(file, next);
    },
    visible(current) {
      const shown = new Set<string>();
      const dimmed = new Set<string>();
      for (const [file, read] of current.files) {
        const list = runs.get(file) ?? [];
        const at = list.length > 0 ? starts(textOf(file)) : [];
        const hidden = new Set<number>();
        for (const run of list) for (const line of linesIn(run, at)) (run.dimmed ? dimmed.add(lineKey({ file, line })) : hidden.add(line));
        for (let line = 1; line <= read.lines.length; line++) if (!hidden.has(line)) shown.add(lineKey({ file, line }));
      }
      return { version: current.version, shows: (at) => shown.has(lineKey(at)), dims: (at) => shown.has(lineKey(at)) && dimmed.has(lineKey(at)) };
    },
  };
}
