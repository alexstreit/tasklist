// A test-only following renderer (Task 29). It is not registered: it records what it would draw,
// by the follower rules of spec §3.3, instead of drawing.

import type { ItemNode, Model, RenderContext, Renderer, RowLayout } from '../../src/core';
import { naturalLayout } from '../../src/ui/row-layout';

/** One drawn frame: a full render on a new model, or a reposition on a new layout. */
export interface Frame {
  kind: 'render' | 'position';
  /** The version of the model drawn; always the layout's. */
  version: number;
  bodyTop: number;
  contentHeight: number;
  scrollTop: number;
  /** `title` is null for a row whose line has no item: drawn empty. */
  rows: { line: number | null; file: string | null; title: string | null; top: number; height: number }[];
}

export interface StubFollower {
  renderer: Renderer;
  frames: Frame[];
  last(): Frame | undefined;
  /** Its body's scroll position: set from each layout it draws, or by `scroll`. */
  readonly scrollTop: number;
  /** The user scrolls its body. */
  scroll(top: number): void;
  /** The browser delivers the scroll event for a scroll the stub set itself from a layout. */
  echo(): void;
}

export function stubFollower({ header = 40, height = 400, rowHeight = 22 } = {}): StubFollower {
  const frames: Frame[] = [];
  let model: Model | null = null;
  let drawn: Model | null = null;
  let layout: RowLayout | null = null;
  let ctx: RenderContext | null = null;
  let scrollTop = 0;

  function draw(): void {
    if (!model) return;
    // With nothing leading, it lays its rows out itself.
    const current = layout ?? naturalLayout(model, model.version, { bodyTop: header, scrollTop, height, rowHeight });
    // A layout of another version is of other text: keep the last frame.
    if (current.version !== model.version) return;
    // Keyed by file and line: a composed editor's rows come from several files (Task 36).
    const items = new Map<string, ItemNode>();
    const collect = (node: ItemNode): void => void (items.set(`${node.file}\n${node.line}`, node), node.children.forEach(collect));
    model.roots.forEach(collect);
    scrollTop = current.scrollTop;
    frames.push({
      kind: model === drawn ? 'position' : 'render',
      version: model.version,
      bodyTop: current.bodyTop,
      contentHeight: current.contentHeight,
      scrollTop,
      rows: current.rows.map((row) => ({
        line: row.at?.line ?? null,
        file: row.at?.file ?? null,
        title: (row.at && items.get(`${row.at.file}\n${row.at.line}`)?.title) ?? null,
        top: row.top,
        height: row.height,
      })),
    });
    drawn = model;
  }

  const renderer: Renderer = {
    id: 'stub',
    label: 'Stub',
    requires: [],
    follows: true,
    render(next, _host, context) {
      model = next;
      ctx = context;
      context.reportHeaderHeight?.(header);
      // Replays the latest layout at once, which draws when its version matches.
      context.onRowLayout?.((next) => {
        layout = next;
        draw();
      });
      if (drawn !== next) draw();
    },
  };

  return {
    renderer,
    frames,
    last: () => frames[frames.length - 1],
    get scrollTop() {
      return scrollTop;
    },
    scroll(top) {
      scrollTop = top;
      ctx?.reportScroll?.(top);
    },
    echo() {
      ctx?.reportScroll?.(scrollTop);
    },
  };
}
