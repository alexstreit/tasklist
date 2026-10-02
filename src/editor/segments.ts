// What the text editor adds over a composed buffer (spec §4.5): each segment's lines shaded and
// bordered, with a class for their mount depth and indented by line padding under their mount row;
// and a header above each segment naming its file, with its unsaved marker and an Open button.

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { piecesOf } from '../buffer/composed';
import type { PieceMap, Segment } from '../buffer/pieces';
import { lineStart } from './files';
import { indentOf } from './lines';

/** The files with unsaved changes, for the headers' markers. */
export const setUnsaved = StateEffect.define<ReadonlySet<string>>();

const unsavedField = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setUnsaved) ? e.value : v), value),
});

/** Each segment's padding, in characters: its mount row's own, plus the row's indent, plus one level. */
function paddings(state: EditorState, pieces: PieceMap): Map<Segment, number> {
  const out = new Map<Segment, number>();
  // Outer segments come first, so a mount row inside a segment finds its segment's padding.
  for (const s of pieces.segments) {
    const at = lineStart(state, s.mount);
    const row = at === null ? 0 : indentOf(state.doc.lineAt(at).text);
    const outer = at === null ? null : pieces.segmentAt(at);
    out.set(s, (outer ? (out.get(outer) ?? 0) : 0) + row + 4);
  }
  return out;
}

class HeaderWidget extends WidgetType {
  constructor(
    readonly file: string,
    readonly unsaved: boolean,
    readonly padding: number,
    readonly depth: number,
    readonly open: (file: string) => void,
  ) {
    super();
  }

  eq(other: HeaderWidget): boolean {
    return other.file === this.file && other.unsaved === this.unsaved && other.padding === this.padding && other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('div');
    dom.className = `cm-segment-header cm-segment-depth-${this.depth}`;
    dom.style.marginLeft = `${this.padding - 4}ch`;
    const path = document.createElement('span');
    path.className = 'cm-segment-path';
    path.textContent = this.file;
    dom.append(path);
    if (this.unsaved) {
      const marker = document.createElement('span');
      marker.className = 'cm-segment-unsaved';
      marker.textContent = '●';
      marker.title = 'Unsaved changes';
      dom.append(marker);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-segment-open';
    button.textContent = 'Open';
    button.title = `Open ${this.file}`;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.open(this.file));
    dom.append(button);
    return dom;
  }

  // Clicks and keys stay with the header: it can't be selected or edited.
  ignoreEvent(): boolean {
    return true;
  }
}

/** The headers, as block widgets above each segment; block decorations must come from state. */
function headers(open: (file: string) => void): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const pieces = piecesOf(state);
    if (!pieces || pieces.segments.length === 0) return Decoration.none;
    const unsaved = state.field(unsavedField);
    const pad = paddings(state, pieces);
    const widgets = pieces.segments.map((s) =>
      Decoration.widget({ widget: new HeaderWidget(s.file, unsaved.has(s.file), pad.get(s)!, s.depth, open), block: true, side: -1 }).range(pieces.range(s).from),
    );
    return Decoration.set(widgets, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.startState.field(unsavedField, false) !== tr.state.field(unsavedField) || piecesOf(tr.startState) !== piecesOf(tr.state) ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}

const lineDecos = new Map<string, Decoration>();
const lineDeco = (depth: number, padding: number): Decoration => {
  const key = `${depth}:${padding}`;
  let deco = lineDecos.get(key);
  if (!deco) lineDecos.set(key, (deco = Decoration.line({ class: `cm-segment cm-segment-depth-${depth}`, attributes: { style: `padding-left: calc(6px + ${padding}ch)` } })));
  return deco;
};

/** The shading and padding of each visible segment line. */
const shading = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || piecesOf(update.startState) !== piecesOf(update.state)) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const { state } = view;
      const pieces = piecesOf(state);
      const builder = new RangeSetBuilder<Decoration>();
      if (!pieces || pieces.segments.length === 0) return builder.finish();
      const pad = paddings(state, pieces);
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = state.doc.lineAt(pos);
          const segment = pieces.segmentAt(line.from);
          if (segment) builder.add(line.from, line.from, lineDeco(segment.depth, pad.get(segment)!));
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  '.cm-segment': { backgroundColor: 'var(--mounted-row-bg)', boxShadow: 'inset 3px 0 0 var(--segment-border)' },
  '.cm-segment-header': {
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    padding: '2px 6px',
    fontSize: '12px',
    backgroundColor: 'var(--badge-bg)',
    color: 'var(--badge-fg)',
    borderTop: '1px solid var(--segment-border)',
    userSelect: 'none',
  },
  '.cm-segment-unsaved': { color: 'var(--fg-muted)' },
  '.cm-segment-open': {
    font: 'inherit',
    fontSize: '11px',
    border: '1px solid var(--button-border)',
    background: 'var(--button-bg)',
    color: 'var(--fg)',
    borderRadius: '4px',
    padding: '0 6px',
    cursor: 'pointer',
  },
});

/** The composed text editor's extensions. `open` makes a file the active one (a header's Open). */
export function segments(open: (file: string) => void): Extension {
  return [unsavedField, headers(open), shading, theme];
}
