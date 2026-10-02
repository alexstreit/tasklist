// What the text editor adds over a composed buffer (spec §4.5): each segment's lines shaded and
// bordered, with a class for their mount depth and indented by line padding under their mount row;
// and each segment's mount line as its header: the header's background, the border starting there,
// and its file's unsaved marker, Open and Unmount at the line's end.

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { piecesOf } from '../buffer/composed';
import type { PieceMap, Segment } from '../buffer/pieces';
import type { FileLine } from '../core';
import { lineStart } from './files';
import { indentOf } from './lines';

/** The files with unsaved changes, for the mount lines' markers. */
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

/** What a segment's mount line ends with: its file's unsaved marker, Open and Unmount. */
class MountWidget extends WidgetType {
  constructor(
    readonly segment: Segment,
    readonly unsaved: boolean,
    readonly actions: SegmentActions,
  ) {
    super();
  }

  eq(other: MountWidget): boolean {
    return other.segment.file === this.segment.file && other.unsaved === this.unsaved && other.segment.mount.file === this.segment.mount.file && other.segment.mount.line === this.segment.mount.line;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'cm-segment-controls';
    const { file, mount } = this.segment;
    if (this.unsaved) {
      const marker = document.createElement('span');
      marker.className = 'cm-segment-unsaved';
      marker.textContent = '●';
      marker.title = 'Unsaved changes';
      dom.append(marker);
    }
    const button = (label: string, title: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cm-segment-action';
      b.dataset.action = label.toLowerCase();
      b.textContent = label;
      b.title = title;
      // Out of the tab order, as the grid's are; a click doesn't move the cursor.
      b.tabIndex = -1;
      b.addEventListener('mousedown', (event) => event.preventDefault());
      b.addEventListener('click', run);
      return b;
    };
    dom.append(
      button('Open', `Open ${file}`, () => this.actions.open(file)),
      button('Unmount', `Stop showing ${file} here; the file stays as it is`, () => this.actions.unmount(mount)),
    );
    return dom;
  }

  // Clicks stay with the controls: they aren't text.
  ignoreEvent(): boolean {
    return true;
  }
}

/** A segment's mount line's buttons: Open makes the file active; Unmount clears the mount row's `mount=` cell. */
export interface SegmentActions {
  open(file: string): void;
  unmount(mountRow: FileLine): void;
}

/** The mount lines' controls, as widgets at each line's end. */
function controls(actions: SegmentActions): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const pieces = piecesOf(state);
    if (!pieces || pieces.segments.length === 0) return Decoration.none;
    const unsaved = state.field(unsavedField);
    const widgets = pieces.segments.flatMap((s) => {
      const at = lineStart(state, s.mount);
      if (at === null) return [];
      const end = state.doc.lineAt(at).to;
      return [Decoration.widget({ widget: new MountWidget(s, unsaved.has(s.file), actions), side: 1 }).range(end)];
    });
    return Decoration.set(widgets, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.startState.field(unsavedField, false) !== tr.state.field(unsavedField) || piecesOf(tr.startState) !== piecesOf(tr.state) ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}

const lineDecos = new Map<string, Decoration>();
/**
 * A line's decoration: inside a segment its shading, depth class and padding; a segment's mount line
 * the header's background, where the border starts; the mount row's own children, below it, the border.
 */
const lineDeco = (segment: { depth: number; padding: number } | null, role: 'mount' | 'inner' | null): Decoration => {
  const key = `${segment?.depth}:${segment?.padding}:${role}`;
  let deco = lineDecos.get(key);
  if (!deco) {
    const classes = [...(segment ? ['cm-segment', `cm-segment-depth-${segment.depth}`] : []), ...(role ? [`cm-segment-${role}`] : [])];
    const attributes = segment ? { style: `padding-left: calc(6px + ${segment.padding}ch)` } : undefined;
    lineDecos.set(key, (deco = Decoration.line({ class: classes.join(' '), ...(attributes ? { attributes } : {}) })));
  }
  return deco;
};

/** The shading and padding of each visible segment line, and each segment's mount line and the lines under it before the segment. */
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
      // Each segment's mount line, and the mount row's own lines between it and the segment.
      const roles = new Map<number, 'mount' | 'inner'>();
      for (const s of pieces.segments) {
        const at = lineStart(state, s.mount);
        if (at === null) continue;
        const mount = state.doc.lineAt(at).number;
        roles.set(mount, 'mount');
        const first = state.doc.lineAt(pieces.range(s).from).number;
        for (let n = mount + 1; n < first; n++) if (!roles.has(n)) roles.set(n, 'inner');
      }
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = state.doc.lineAt(pos);
          const segment = pieces.segmentAt(line.from);
          const role = roles.get(line.number) ?? null;
          if (segment || role) builder.add(line.from, line.from, lineDeco(segment ? { depth: segment.depth, padding: pad.get(segment)! } : null, role));
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
  // A segment's mount line is its header: the header's background, and the border starts there.
  '.cm-segment-mount': { backgroundColor: 'var(--badge-bg)', boxShadow: 'inset 3px 0 0 var(--segment-border)' },
  '.cm-segment-inner': { boxShadow: 'inset 3px 0 0 var(--segment-border)' },
  '.cm-segment-controls': { marginLeft: '12px', fontSize: '12px', userSelect: 'none' },
  '.cm-segment-unsaved': { color: 'var(--fg-muted)', marginRight: '6px' },
  '.cm-segment-action': {
    marginRight: '6px',
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

/** The composed text editor's extensions; `actions` are the mount lines' Open and Unmount. */
export function segments(actions: SegmentActions): Extension {
  return [unsavedField, controls(actions), shading, theme];
}
