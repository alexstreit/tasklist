// Row alignment between the shell's two panes (spec §3.3, §3.4). The shell connects a leading pane
// to a following one by what each declares it can do, never by which editor or view it holds.

import type { RenderContext, RowLayout } from '../core';
import { ScrollEcho } from '../ui/row-layout';
import type { Leader } from '../ui/row-layout';

/** The shell's end of a following renderer. */
export interface Follower {
  /** Hand the follower a layout to draw against. */
  layout(layout: RowLayout): void;
  /** The follower's body was scrolled. Returns an unsubscribe function. */
  onScroll(cb: (top: number) => void): () => void;
  /** The follower's natural header height, at once if already known, then on each change. Returns an unsubscribe function. */
  onHeaderHeight(cb: (px: number) => void): () => void;
}

/** What a pane can do. A pane may lead, follow, both or neither. */
export interface Pane {
  leads?: Leader;
  follows?: Follower;
  /**
   * The element the pane's editor or view is mounted in. A layout's `bodyTop` and a header height
   * are measured from its content top; the shell converts between the two panes' tops.
   */
  host?: HTMLElement;
}

/** Where an element's content box starts, from the page's top. */
function contentTop(el: HTMLElement): number {
  return el.getBoundingClientRect().top + el.clientTop + (parseFloat(getComputedStyle(el).paddingTop) || 0);
}

type FollowerContext = Required<Pick<RenderContext, 'onRowLayout' | 'reportScroll' | 'reportHeaderHeight'>>;

/**
 * One following renderer's channel to the shell: `context` goes into its RenderContext, and
 * `follower` is what `connectPanes` connects. It keeps the latest layout and header height, so
 * a renderer that subscribes late, or a connection made after it rendered, misses neither.
 */
export function followerChannel(): { follower: Follower; context: FollowerContext } {
  let latest: RowLayout | null = null;
  let header: number | null = null;
  let draw: ((layout: RowLayout) => void) | null = null;
  const scrolls = new Set<(top: number) => void>();
  const headers = new Set<(px: number) => void>();
  return {
    follower: {
      layout(layout) {
        latest = layout;
        draw?.(layout);
      },
      onScroll(cb) {
        scrolls.add(cb);
        return () => void scrolls.delete(cb);
      },
      onHeaderHeight(cb) {
        headers.add(cb);
        if (header !== null) cb(header);
        return () => void headers.delete(cb);
      },
    },
    context: {
      onRowLayout(cb) {
        draw = cb;
        if (latest) cb(latest);
      },
      reportScroll(top) {
        for (const cb of [...scrolls]) cb(top);
      },
      reportHeaderHeight(px) {
        if (px === header) return;
        header = px;
        for (const cb of [...headers]) cb(px);
      },
    },
  };
}

/**
 * Connect two panes, left and right, when one leads and the other follows; when both could lead,
 * the left one does. Two editors, or two renderers that don't follow, stay unconnected. Returns
 * the function that disconnects them.
 *
 * Connected, the leader's body starts no higher than the follower's header ends, so both start at
 * the larger of the two; the follower draws at the layout's `bodyTop`. The two hosts' tops may
 * differ, either way round: the shell measures both against the page and converts each `bodyTop`
 * and header height between them, and measures again when either host is resized. Scrolling syncs
 * both ways, and each side's echo of a scroll the shell gave it is dropped (`ScrollEcho`).
 */
export function connectPanes(left: Pane, right: Pane): () => void {
  const [lead, follow] = left.leads && right.follows ? [left, right] : right.leads && left.follows ? [right, left] : [];
  if (!lead || !follow) return () => {};
  const leader = lead.leads!;
  const follower = follow.follows!;
  const leaderEcho = new ScrollEcho();
  const followerEcho = new ScrollEcho();
  /** How far the follower's host starts below the leader's; negative when it starts above. */
  const measure = () => (lead.host && follow.host ? contentTop(follow.host) - contentTop(lead.host) : 0);
  let offset = measure();
  let header: number | null = null;
  let latest: RowLayout | null = null;

  const fitHeader = () => {
    if (header !== null) leader.setMinBodyTop(Math.max(0, header + offset));
  };
  // The leader's layout in the follower's terms: the same rows, from the follower's own top. On the
  // leader catching up with a scroll the shell gave it, the follower stays where it was scrolled.
  const forward = (layout: RowLayout) => {
    const scrollTop = leaderEcho.isEcho(layout.scrollTop) ? leaderEcho.value! : layout.scrollTop;
    followerEcho.set(scrollTop);
    follower.layout({ ...layout, bodyTop: layout.bodyTop - offset, scrollTop });
  };

  const offs = [
    follower.onHeaderHeight((px) => {
      header = px;
      fitHeader();
    }),
    leader.onRowLayout((layout) => {
      latest = layout;
      forward(layout);
    }),
    follower.onScroll((top) => {
      if (followerEcho.isEcho(top)) return;
      leaderEcho.set(top);
      leader.scrollTo(top);
    }),
  ];

  // A host moves when the bar above it wraps or grows; that resizes it too. jsdom has no ResizeObserver.
  const resize =
    typeof ResizeObserver === 'function' && lead.host && follow.host
      ? new ResizeObserver(() => {
          const next = measure();
          if (next === offset) return;
          offset = next;
          fitHeader();
          if (latest) forward(latest);
        })
      : null;
  for (const host of [lead.host, follow.host]) if (host) resize?.observe(host);

  return () => {
    resize?.disconnect();
    for (const off of offs) off();
    leader.setMinBodyTop(0);
  };
}
