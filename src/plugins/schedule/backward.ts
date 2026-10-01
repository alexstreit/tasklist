// The backward pass (spec §2.11): late starts and finishes, slack, the critical rows and lateness.
// Deadlines seed it, so slack is measured against them; negative slack means already late for one.

import type { ItemNode, Stage, WorkHours } from '../../core';
import { critical, deadline, duration, finish, late, lateFinish, lateStart, projectFinish, slack, start } from './fields';
import { readNetwork, spanOf } from './network';

export const backwardStage: Stage = {
  id: 'schedule.backward',
  keys: { required: ['project-start'] },
  roles: { optional: ['deps', 'deadline'] },
  reads: [start, duration, finish, projectFinish],
  writes: [lateStart, lateFinish, slack, critical, late, deadline],
  run(ctx) {
    const calendar = ctx.calendar!;
    const { model } = ctx;
    const net = readNetwork(ctx, false);
    const deadlineOf = (n: ItemNode): WorkHours | undefined => {
      const date = ctx.cell(n, 'deadline');
      // A deadline is the end of its day: a row that finishes any time on that day is on time.
      return date?.type === 'date' ? calendar.fromDate(date.text, 'end') : undefined;
    };

    /** The earliest deadline of the row and its ancestors; parents come first in the order. */
    const limit = new Map<ItemNode, WorkHours>();
    for (const n of net.order) {
      const up = net.parent.get(n);
      limit.set(n, Math.min(up ? limit.get(up)! : model.value(projectFinish)!, deadlineOf(n) ?? Infinity));
    }

    /** A leaf's late start; for a summary, the earliest among its descendants, which is what a link into it waits on. */
    const latest = new Map<ItemNode, WorkHours>();
    const slacks = new Map<ItemNode, number>();
    for (const n of [...net.order].reverse()) {
      if (n.children.length > 0) {
        latest.set(n, Math.min(...n.children.map((c) => latest.get(c)!)));
        slacks.set(n, Math.min(...n.children.map((c) => slacks.get(c)!)));
        continue;
      }
      let lf = limit.get(n)!;
      for (const link of net.out.get(n)!) lf = Math.min(lf, calendar.add(latest.get(link.to)!, -link.lag));
      const ls = calendar.add(lf, -model.get(n, duration)!.effective);
      latest.set(n, ls);
      slacks.set(n, ls - model.get(n, start)!.effective);
      ctx.set(n, lateFinish, lf);
      ctx.set(n, lateStart, ls);
    }

    for (const n of net.items) {
      const s = slacks.get(n)!;
      ctx.set(n, slack, s);
      ctx.set(n, critical, s <= 0);
      const due = deadlineOf(n);
      if (due !== undefined) ctx.set(n, deadline, due);
      const end = model.get(n, finish)!;
      const isLate = due !== undefined && end > due;
      ctx.set(n, late, isLate);
      if (isLate) {
        const date = ctx.cell(n, 'deadline') as { text: string };
        ctx.diagnose({
          line: n.line,
          span: spanOf(ctx, n, 'deadline'),
          severity: 'warning',
          code: 'schedule-late',
          message: `finishes ${calendar.toDate(end, 'end')}, after its deadline ${date.text}`,
        });
      }
    }
  },
};
