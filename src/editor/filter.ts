// The filter in the text editor (spec §5.7): the hidden lines are replaced by block decorations, so
// their text is untouched; the cursor and selections skip them, an edit can't reach into them, and
// search doesn't land in them. The ancestors shown only for context are dimmed.

import { SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { Visible } from '../core';
import { fileLineAt } from './files';

/** Show only these lines; null shows every line. */
export const setFilter = StateEffect.define<Visible | null>();

/** What stands in for a run of hidden lines: nothing, and no height. */
class HiddenLines extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-filter-hidden';
    return el;
  }
  eq(): boolean {
    return true;
  }
  get estimatedHeight(): number {
    return 0;
  }
}

const hide = Decoration.replace({ block: true, widget: new HiddenLines() });
const dim = Decoration.line({ class: 'cm-filter-context' });

interface Filtered {
  /** Each run of hidden lines, from its first line's start to its last line's end. */
  hidden: DecorationSet;
  dimmed: DecorationSet;
}

const none: Filtered = { hidden: Decoration.none, dimmed: Decoration.none };

function build(state: EditorState, visible: Visible | null): Filtered {
  if (!visible) return none;
  const { doc } = state;
  const hidden = new RangeSetBuilder<Decoration>();
  const dimmed = new RangeSetBuilder<Decoration>();
  // The run of hidden lines so far: its first line's start, its last line's end; -1 when none.
  let from = -1;
  let to = -1;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const at = fileLineAt(state, line.from);
    if (!visible.shows(at)) {
      if (from < 0) from = line.from;
      to = line.to;
      continue;
    }
    if (from >= 0) hidden.add(from, to, hide);
    from = -1;
    if (visible.dims(at)) dimmed.add(line.from, line.from, dim);
  }
  if (from >= 0) hidden.add(from, to, hide);
  return { hidden: hidden.finish(), dimmed: dimmed.finish() };
}

const filtered = StateField.define<Filtered>({
  create: () => none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFilter)) return build(tr.state, e.value);
    return tr.docChanged && value !== none ? { hidden: value.hidden.map(tr.changes), dimmed: value.dimmed.map(tr.changes) } : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (f) => f.hidden),
    EditorView.decorations.from(field, (f) => f.dimmed),
    EditorView.atomicRanges.of((view) => view.state.field(field).hidden),
  ],
});

/** The run of hidden lines `pos` is in, or null. */
export function hiddenAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let out: { from: number; to: number } | null = null;
  state.field(filtered, false)?.hidden.between(pos, pos, (from, to) => {
    out = { from, to };
    return false;
  });
  return out;
}

/**
 * The cursor and selections skip hidden lines. Atomic ranges keep them out of a run's inside; a
 * selection end left on its first line's start or its last line's end (the document's edges, say) goes
 * on to the next line shown, the way it moved, or else back to the line before.
 */
const skip = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  const { hidden } = tr.state.field(filtered);
  if (hidden.size === 0) return tr;
  const length = tr.newDoc.length;
  const was = tr.changes.mapPos(tr.startState.selection.main.head);
  let moved = false;
  const out = (pos: number, forward: boolean): number => {
    let next = pos;
    hidden.between(pos, pos, (a, b) => {
      next = (forward && b < length) || a === 0 ? Math.min(length, b + 1) : a - 1;
      return false;
    });
    if (next !== pos) moved = true;
    return next;
  };
  const ranges = tr.selection.ranges.map((r) => {
    const forward = r.head >= was;
    return EditorSelection.range(out(r.anchor, forward), out(r.head, forward));
  });
  return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }] : tr;
});

/**
 * A typed edit, undo or line operation that would change a hidden line, or join one to another
 * line, is refused whole. Changes that aren't the user's (a file changed on disk, a segment
 * composed in) pass.
 */
const guard = EditorState.changeFilter.of((tr) => {
  if (tr.annotation(Transaction.userEvent) === undefined) return true;
  const { hidden } = tr.startState.field(filtered);
  const doc = tr.newDoc;
  let ok = true;
  hidden.between(0, tr.startState.doc.length, (a, b) => {
    tr.changes.iterChangedRanges((from, to) => {
      if ((from < b && to > a) || (from === to && from > a && from <= b)) ok = false;
    });
    // Still whole lines: a line break, or the document's edge, on either side.
    const start = tr.changes.mapPos(a, 1);
    const end = tr.changes.mapPos(b, -1);
    if ((start > 0 && doc.sliceString(start - 1, start) !== '\n') || (end < doc.length && doc.sliceString(end, end + 1) !== '\n')) ok = false;
    return ok ? undefined : false;
  });
  return ok;
});

/** Search's test: a match in a hidden line isn't one. Its state argument makes it one function for every query. */
function shown(_match: string, state: EditorState, from: number, to: number): boolean {
  let hit = false;
  state.field(filtered, false)?.hidden.between(from, to, (a, b) => {
    if (from <= b && to >= a) hit = true;
    return hit ? false : undefined;
  });
  return !hit;
}

/** The search panel makes its queries without a test; each one set gets ours. */
const searchShown = EditorState.transactionExtender.of((tr) => {
  const query = tr.effects.reduce<SearchQuery | null>((q, e) => (e.is(setSearchQuery) ? e.value : q), null);
  if (!query || query.test === shown) return null;
  const { search, caseSensitive, literal, regexp, replace, wholeWord } = query;
  return { effects: setSearchQuery.of(new SearchQuery({ search, caseSensitive, literal, regexp, replace, wholeWord, test: shown })) };
});

const theme = EditorView.theme({
  '.cm-filter-context': { opacity: 'var(--filter-context-opacity)' },
});

export const planFilter: Extension = [filtered, skip, guard, searchShown, theme];
