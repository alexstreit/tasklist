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
 * the larger of the two; the follower draws at the layout's `bodyTop`. Scrolling syncs both ways,
 * and each side's echo of a scroll the shell gave it is dropped (`ScrollEcho`).
 */
export function connectPanes(left: Pane, right: Pane): () => void {
  const [leader, follower] =
    left.leads && right.follows ? [left.leads, right.follows] : right.leads && left.follows ? [right.leads, left.follows] : [];
  if (!leader || !follower) return () => {};
  const leaderEcho = new ScrollEcho();
  const followerEcho = new ScrollEcho();
  const offs = [
    follower.onHeaderHeight((px) => leader.setMinBodyTop(px)),
    leader.onRowLayout((layout) => {
      // The leader catching up with a scroll the shell gave it: the follower stays where it was scrolled.
      const scrollTop = leaderEcho.isEcho(layout.scrollTop) ? leaderEcho.value! : layout.scrollTop;
      followerEcho.set(scrollTop);
      follower.layout(scrollTop === layout.scrollTop ? layout : { ...layout, scrollTop });
    }),
    follower.onScroll((top) => {
      if (followerEcho.isEcho(top)) return;
      leaderEcho.set(top);
      leader.scrollTo(top);
    }),
  ];
  return () => {
    for (const off of offs) off();
    leader.setMinBodyTop(0);
  };
}
