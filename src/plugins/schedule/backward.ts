// The backward pass (spec §2.11): late starts and finishes, slack, the critical rows and lateness.
// Deadlines seed it, so slack is measured against them; negative slack means already late for one.

import { formatDate } from '../../core';
import type { ItemNode, Stage, WorkHours } from '../../core';
import { critical, deadline, duration, finish, late, lateFinish, lateStart, network, projectFinish, slack, start } from './fields';
import { spanOf } from './network';

export const backwardStage: Stage = {
  id: 'schedule.backward',
  keys: { required: ['project-start'] },
  roles: { optional: ['deps', 'deadline'] },
  reads: [start, duration, finish, projectFinish, network],
  writes: [lateStart, lateFinish, slack, critical, late, deadline],
  run(ctx) {
    const calendar = ctx.calendar!;
    const { model } = ctx;
    const net = model.value(network)!;
    const deadlines = new Map<ItemNode, WorkHours | undefined>();
    for (const n of net.items) {
      const date = ctx.cell(n, 'deadline');
      // A deadline is the end of its day: a row that finishes any time on that day is on time.
      deadlines.set(n, date?.type === 'date' ? calendar.fromDate(date.text, 'end') : undefined);
    }
    const deadlineOf = (n: ItemNode): WorkHours | undefined => deadlines.get(n);

    /**
     * A row's late finish: the earliest of the project finish, its own deadline, its parent's late
     * finish, and each successor's late start less the lag. A parent's limits every descendant, so a
     * link out of a parent holds back its whole subtree.
     */
    const lateFinishes = new Map<ItemNode, WorkHours>();
    /** A leaf's late start; for a summary, the earliest among its descendants, which is what a link into it waits on. */
    const latest = new Map<ItemNode, WorkHours>();
    const slacks = new Map<ItemNode, number>();
    for (const { node: n, end } of [...net.order].reverse()) {
      const summary = n.children.length > 0;
      if (end === 'finish') {
        const up = net.parent.get(n);
        let lf = Math.min(up ? lateFinishes.get(up)! : model.value(projectFinish)!, deadlineOf(n) ?? Infinity);
        for (const link of net.out.get(n)!) lf = Math.min(lf, calendar.add(latest.get(link.to)!, -link.lag));
        lateFinishes.set(n, lf);
        if (!summary) ctx.set(n, lateFinish, lf);
        continue;
      }
      if (summary) {
        latest.set(n, Math.min(...n.children.map((c) => latest.get(c)!)));
        slacks.set(n, Math.min(...n.children.map((c) => slacks.get(c)!)));
        continue;
      }
      const ls = calendar.add(lateFinishes.get(n)!, -model.get(n, duration)!.effective);
      latest.set(n, ls);
      slacks.set(n, ls - model.get(n, start)!.effective);
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
        ctx.diagnose(n, {
          line: n.line,
          span: spanOf(ctx, n, 'deadline'),
          severity: 'warning',
          code: 'schedule-late',
          message: `finishes ${formatDate(calendar.toDate(end, 'end'), calendar)}, after its deadline ${formatDate(date.text, calendar)}`,
        });
      }
    }
  },
};
