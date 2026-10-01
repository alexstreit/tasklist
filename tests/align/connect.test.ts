// @vitest-environment jsdom
// Task 29: the shell's connecting function. Panes connect by what they declare they can do;
// scrolling syncs both ways, and each side's echo of a scroll the shell gave it is dropped.

import { describe, expect, it, vi } from 'vitest';
import { connectPanes, followerChannel } from '../../src/app/align';
import type { Pane } from '../../src/app/align';
import { analyze } from '../../src/app/registry';
import type { RenderContext, RowLayout } from '../../src/core';
import { mockResizeObserver } from '../support/layout';
import { stubFollower } from '../support/stub-follower';

const model = analyze('A\n    B\nC\n');

/**
 * A leader whose scroll position is whole pixels, as a browser's may be, and whose scroll event
 * arrives only when the test delivers it.
 */
function fakeLeader() {
  const listeners = new Set<(layout: RowLayout) => void>();
  const pending: number[] = [];
  const leader = {
    scrollTop: 0,
    minBodyTop: 0,
    subscribed: 0,
    layout: (): RowLayout => ({
      version: 0,
      bodyTop: Math.max(40, leader.minBodyTop),
      contentHeight: 66,
      scrollTop: leader.scrollTop,
      rows: [1, 2, 3].map((line, i) => ({ at: { line }, top: i * 22, height: 22 })),
    }),
    publish: () => listeners.forEach((cb) => cb(leader.layout())),
    onRowLayout: vi.fn((cb: (layout: RowLayout) => void) => {
      leader.subscribed++;
      listeners.add(cb);
      cb(leader.layout());
      return () => void listeners.delete(cb);
    }),
    scrollTo: vi.fn((top: number) => {
      leader.scrollTop = Math.round(top);
      pending.push(leader.scrollTop);
    }),
    setMinBodyTop: vi.fn((px: number) => {
      leader.minBodyTop = px;
      leader.publish();
    }),
    /** The scroll events for the shell's scrollTo calls arrive, late. */
    deliver: () => {
      while (pending.shift() !== undefined) leader.publish();
    },
  };
  return leader;
}

const ctx: RenderContext = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {} };

/** The stub as a following pane. */
function following(header?: number) {
  const stub = stubFollower({ header });
  const channel = followerChannel();
  const render = () => stub.renderer.render(model, document.createElement('div'), { ...ctx, ...channel.context });
  return { stub, pane: { follows: channel.follower } satisfies Pane, render };
}

describe('connecting panes', () => {
  it('syncs a leader scroll to the follower, and drops the follower’s echo', () => {
    const leader = fakeLeader();
    const { stub, pane, render } = following();
    connectPanes({ leads: leader }, pane);
    render();
    leader.scrollTop = 120;
    leader.publish();
    expect(stub.scrollTop).toBe(120);
    stub.echo();
    expect(leader.scrollTo).not.toHaveBeenCalled();
  });

  it('syncs a follower scroll to the leader; the leader’s late echo moves nothing and loops nowhere', () => {
    const leader = fakeLeader();
    const { stub, pane, render } = following();
    connectPanes({ leads: leader }, pane);
    render();
    stub.scroll(300.4);
    expect(leader.scrollTo).toHaveBeenCalledExactlyOnceWith(300.4);
    const frames = stub.frames.length;
    // The leader's scroll event, delivered after a delay, carries its rounded position.
    leader.deliver();
    expect(stub.frames.length).toBe(frames + 1);
    expect(stub.scrollTop).toBe(300.4);
    stub.echo();
    leader.deliver();
    expect(leader.scrollTo).toHaveBeenCalledTimes(1);
    expect(Math.abs(stub.scrollTop - leader.scrollTop)).toBeLessThanOrEqual(1);
  });

  it('a real scroll after an echo still syncs', () => {
    const leader = fakeLeader();
    const { stub, pane, render } = following();
    connectPanes({ leads: leader }, pane);
    render();
    stub.scroll(300);
    leader.deliver();
    leader.scrollTop = 500;
    leader.publish();
    expect(stub.scrollTop).toBe(500);
    stub.scroll(80);
    expect(leader.scrollTo).toHaveBeenLastCalledWith(80);
  });

  it('starts both bodies at the larger header, and gives the space back on disconnect', () => {
    const leader = fakeLeader();
    const { stub, pane, render } = following(64);
    const disconnect = connectPanes({ leads: leader }, pane);
    render();
    expect(leader.setMinBodyTop).toHaveBeenCalledWith(64);
    expect(stub.last()!.bodyTop).toBe(64);
    disconnect();
    expect(leader.setMinBodyTop).toHaveBeenLastCalledWith(0);
  });

  it('the left pane leads when both could', () => {
    const [left, right] = [fakeLeader(), fakeLeader()];
    const a = following();
    const b = following();
    connectPanes({ leads: left, follows: a.pane.follows }, { leads: right, follows: b.pane.follows });
    expect([left.subscribed, right.subscribed]).toEqual([1, 0]);
    b.render();
    left.scrollTop = 10;
    left.publish();
    expect(b.stub.scrollTop).toBe(10);
  });

  it('a follower on the left follows a leader on the right', () => {
    const leader = fakeLeader();
    const { pane } = following();
    connectPanes(pane, { leads: leader });
    expect(leader.subscribed).toBe(1);
  });

  it('leaves two leaders unconnected: two editors side by side', () => {
    const [left, right] = [fakeLeader(), fakeLeader()];
    connectPanes({ leads: left }, { leads: right })();
    expect([left.subscribed, right.subscribed, left.setMinBodyTop.mock.calls.length]).toEqual([0, 0, 0]);
  });

  it('leaves two renderers that don’t follow unconnected', () => {
    expect(() => connectPanes({}, {})()).not.toThrow();
  });

  it('a follower with no leader draws its natural layout', () => {
    const { stub, pane, render } = following();
    connectPanes({}, pane);
    render();
    expect(stub.last()).toMatchObject({ kind: 'render', bodyTop: 40, contentHeight: 66, scrollTop: 0 });
    expect(stub.last()!.rows.map((r) => [r.line, r.title, r.top])).toEqual([
      [1, 'A', 0],
      [2, 'B', 22],
      [3, 'C', 44],
    ]);
  });
});

describe('hosts at different heights', () => {
  /** A host at `top` px from the page's top, which the test can move. */
  function hostAt(top: number) {
    const el = document.createElement('div');
    const at = { top };
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, at.top, 600, 400));
    return { el, at };
  }

  function connect(leaderTop: number, followerTop: number) {
    const resize = mockResizeObserver();
    const leader = fakeLeader();
    const lead = hostAt(leaderTop);
    const follow = hostAt(followerTop);
    const { stub, pane, render } = following(40);
    const disconnect = connectPanes({ leads: leader, host: lead.el }, { ...pane, host: follow.el });
    render();
    /** Where each body starts on the page; they line up when equal. */
    const bodies = () => [lead.at.top + leader.layout().bodyTop, follow.at.top + stub.last()!.bodyTop];
    return { leader, stub, lead, follow, bodies, resize, disconnect };
  }

  it('lines up the bodies when the follower’s host is 32px lower', () => {
    const { stub, bodies, resize } = connect(0, 32);
    // The follower's 40px header ends 72px down the page, so the leader's body starts there.
    expect(bodies()).toEqual([72, 72]);
    expect(stub.last()!.bodyTop).toBe(40);
    resize.restore();
  });

  it('lines up the bodies when the leader’s host is 32px lower', () => {
    const { leader, stub, bodies, resize } = connect(32, 0);
    expect(bodies()).toEqual([72, 72]);
    // The leader's own 40px header is the taller: the follower's body starts below its header.
    expect(leader.minBodyTop).toBe(8);
    expect(stub.last()!.bodyTop).toBe(72);
    resize.restore();
  });

  it('redoes the alignment when a host moves after connection', () => {
    const { follow, bodies, resize } = connect(0, 32);
    follow.at.top = 50;
    resize.fire();
    expect(bodies()).toEqual([90, 90]);
    follow.at.top = 10;
    resize.fire();
    expect(bodies()).toEqual([50, 50]);
    resize.restore();
  });
});

describe('a follower channel', () => {
  it('replays the latest layout and header height to whoever subscribes late', () => {
    const channel = followerChannel();
    const layout: RowLayout = { version: 0, bodyTop: 0, contentHeight: 0, scrollTop: 0, rows: [] };
    channel.follower.layout(layout);
    channel.context.reportHeaderHeight(64);
    const seen: unknown[] = [];
    channel.context.onRowLayout((l) => seen.push(l));
    channel.follower.onHeaderHeight((px) => seen.push(px));
    expect(seen).toEqual([layout, 64]);
  });
});
