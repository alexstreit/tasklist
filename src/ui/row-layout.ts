// Row alignment between panes (spec §3.3, §3.4). A pane may lead, publishing where its rows are
// as a RowLayout; follow, drawing its rows where it's told; both; or neither. A follower always
// draws from a RowLayout: with nothing leading, it builds its own with `naturalLayout`. The name
// avoids "rows", which already means the library.

import type { ItemNode, Model, RowLayout } from '../core';

export type { RowLayout } from '../core';

/** What a leading pane offers: the optional part of `PlanEditor` (spec §3.4). */
export interface Leader {
  /** Called with a fresh layout at once, then after every scroll, edit, fold and resize. Returns an unsubscribe function. */
  onRowLayout(cb: (layout: RowLayout) => void): () => void;
  scrollTo(top: number): void;
  /** Start the body at least `px` from the pane's top, by adding space above it; 0 removes it. */
  setMinBodyTop(px: number): void;
}

/** A follower's own viewport, for `naturalLayout`. */
export interface Viewport {
  /** Where its body starts: its own header height. */
  bodyTop: number;
  scrollTop: number;
  /** The body's visible height. */
  height: number;
  /** `--row-height`, in px. */
  rowHeight: number;
}

/** A follower's own layout when nothing leads: one row per item of the composed tree, in document order, at `rowHeight`. */
export function naturalLayout(model: Model, version: number, viewport: Viewport): RowLayout {
  const { bodyTop, scrollTop, height, rowHeight } = viewport;
  const items: ItemNode[] = [];
  const collect = (node: ItemNode): void => void (items.push(node), node.children.forEach(collect));
  model.roots.forEach(collect);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight));
  const rows = items.slice(first, last).map((node, i) => ({
    at: { file: node.file, line: node.line },
    top: (first + i) * rowHeight,
    height: rowHeight,
  }));
  return { version, bodyTop, contentHeight: items.length * rowHeight, scrollTop, rows };
}

/**
 * One side's scroll echo. When the shell scrolls a pane, the pane reports that scroll back, maybe
 * late; a report within 1px of the value the shell last set is that echo, and is dropped. It
 * compares values rather than holding a flag, so an echo that arrives late is still recognised.
 */
export class ScrollEcho {
  private last: number | null = null;

  /** The shell set this side's scroll to `top`. */
  set(top: number): void {
    this.last = top;
  }

  /** The value the shell last set, or null when it has set none. */
  get value(): number | null {
    return this.last;
  }

  /** True when a reported `top` is the echo of the value last set. */
  isEcho(top: number): boolean {
    return this.last !== null && Math.abs(top - this.last) <= 1;
  }
}

/** A leader's subscribers: `publish` measures only when someone is listening. */
export function layoutPublisher(measure: () => RowLayout): { onRowLayout: Leader['onRowLayout']; publish(): void; listened(): boolean } {
  const listeners = new Set<(layout: RowLayout) => void>();
  return {
    onRowLayout(cb) {
      listeners.add(cb);
      cb(measure());
      return () => void listeners.delete(cb);
    },
    publish() {
      if (listeners.size === 0) return;
      const layout = measure();
      for (const cb of [...listeners]) cb(layout);
    },
    listened: () => listeners.size > 0,
  };
}
