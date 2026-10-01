// The forward pass (spec §2.11): durations, starts and finishes, in working hours from project-start.
// Every finish goes through calendar.add; no stage adds hours itself.

import type { ItemNode, Pinnable, Stage, WorkHours } from '../../core';
import { duration, finish, milestone, projectFinish, start } from './fields';
import { readNetwork, spanOf } from './network';

export const forwardStage: Stage = {
  id: 'schedule.forward',
  keys: { required: ['project-start'] },
  roles: { optional: ['effort', 'duration', 'start', 'deps'] },
  markers: ['milestone'],
  reads: [],
  writes: [start, duration, finish, milestone, projectFinish],
  run(ctx) {
    const calendar = ctx.calendar!;
    const net = readNetwork(ctx, true);
    const effort = ctx.bindings.roles.get('effort');
    const span = ctx.bindings.roles.get('duration');
    const hoursOf = (n: ItemNode, column: string | undefined) => (column === undefined ? undefined : ctx.hours(n, column));
    const filled = (n: ItemNode, role: string) => spanOf(ctx, n, role) !== undefined;

    const starts = new Map<ItemNode, Pinnable<WorkHours>>();
    const finishes = new Map<ItemNode, WorkHours>();
    /** What a row passes down to its descendants: the later of its derived start and its pin. */
    const floor = new Map<ItemNode, WorkHours>();

    for (const n of net.order) {
      const summary = n.children.length > 0;
      const up = net.parent.get(n);
      let derived = up ? floor.get(up)! : 0;
      for (const link of net.into.get(n)!) derived = Math.max(derived, calendar.add(finishes.get(link.from)!, link.lag));
      const date = ctx.cell(n, 'start');
      // A start pin is the start of its day: the row may begin as soon as that working day does.
      const pin = date?.type === 'date' ? calendar.fromDate(date.text, 'start') : undefined;
      floor.set(n, pin === undefined ? derived : Math.max(derived, pin));
      starts.set(n, { derived, ...(pin === undefined ? {} : { pin }), effective: floor.get(n)!, mode: pin === undefined ? 'derived' : 'pinned' });
      const marked = ctx.marked(n, 'milestone');
      ctx.set(n, milestone, marked && !summary);

      if (summary) {
        if (marked) ctx.diagnose({ line: n.line, severity: 'warning', code: 'schedule-milestone-parent', message: 'a parent row is a summary, not a milestone; its dates come from its children' });
        if (span !== undefined && filled(n, 'duration')) {
          ctx.diagnose({ line: n.line, span: spanOf(ctx, n, 'duration'), severity: 'info', code: 'schedule-summary-duration', message: `a parent row's span comes from its children; the ${span} column's value is ignored` });
        }
        continue;
      }

      let length: Pinnable<number>;
      if (marked) {
        length = { derived: 0, effective: 0, mode: 'derived' };
        for (const [role, column] of [['effort', effort], ['duration', span]] as const) {
          if (column !== undefined && filled(n, role)) {
            ctx.diagnose({ line: n.line, span: spanOf(ctx, n, role), severity: 'warning', code: 'schedule-milestone-effort', message: `a milestone takes no time; the ${column} column's value is ignored` });
          }
        }
      } else {
        const derivedLength = hoursOf(n, effort) ?? 0;
        const pinned = hoursOf(n, span);
        length = pinned === undefined ? { derived: derivedLength, effective: derivedLength, mode: 'derived' } : { derived: derivedLength, pin: pinned, effective: pinned, mode: 'pinned' };
        if (pinned !== undefined && pinned === derivedLength) {
          ctx.diagnose({ line: n.line, span: spanOf(ctx, n, 'duration'), severity: 'info', code: 'schedule-pin-equals-derived', message: `the ${span} column's value is the row's effort anyway` });
        }
        if (length.effective === 0) ctx.diagnose({ line: n.line, severity: 'info', code: 'schedule-no-duration', message: 'no effort or duration, so the row takes no time' });
      }
      ctx.set(n, duration, length);
      finishes.set(n, calendar.add(floor.get(n)!, length.effective));
    }

    // Summaries, bottom up: the earliest descendant start and the latest descendant finish.
    const summarize = (n: ItemNode): void => {
      if (n.children.length === 0) return;
      n.children.forEach(summarize);
      const own = starts.get(n)!;
      own.effective = Math.min(...n.children.map((c) => starts.get(c)!.effective));
      finishes.set(n, Math.max(...n.children.map((c) => finishes.get(c)!)));
    };
    ctx.model.roots.forEach(summarize);

    for (const n of net.items) {
      const value = starts.get(n)!;
      ctx.set(n, start, value);
      ctx.set(n, finish, finishes.get(n)!);
      if (value.pin === undefined) continue;
      const at = { line: n.line, span: spanOf(ctx, n, 'start') };
      const column = ctx.bindings.roles.get('start');
      if (value.effective > value.pin) {
        const when = calendar.toDate(value.effective, 'start');
        ctx.diagnose({ ...at, severity: 'info', code: 'schedule-pin-no-effect', message: `the ${column} column's date has no effect; the row starts ${when}` });
      } else if (value.pin === value.derived) {
        ctx.diagnose({ ...at, severity: 'info', code: 'schedule-pin-equals-derived', message: `the ${column} column's date is when the row would start anyway` });
      }
    }
    ctx.setValue(projectFinish, Math.max(0, ...net.items.map((n) => finishes.get(n)!)));
  },
};
