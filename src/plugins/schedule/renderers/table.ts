// The schedule table (spec §5.4): one row per item with its start, finish, duration and slack.
// Reads the schedule fields; dates and days come from the model's calendar.

import type { ItemNode, Model, RenderContext, Renderer, WorkHours } from '../../../core';
import { formatDate, formatPinnableDate } from '../../../core';
import { addItemRow, addTitleCell, createGrid, mount, muted, shows } from '../../../ui/grid';
import { critical, duration, finish, late, milestone, slack, start } from '../fields';
import './table.css';

/** Working hours in days and hours of the calendar's day: `1d 4h`, `3d`, `0h`, `−1d`. */
export function formatDays(hours: number, hoursPerDay: number): string {
  const size = Math.round(Math.abs(hours) * 1000) / 1000;
  const days = Math.floor(size / hoursPerDay);
  const rest = Math.round((size - days * hoursPerDay) * 1000) / 1000;
  const parts = [...(days > 0 ? [`${days}d`] : []), ...(rest > 0 ? [`${rest}h`] : [])];
  return `${hours < 0 && size > 0 ? '−' : ''}${parts.length > 0 ? parts.join(' ') : '0h'}`;
}

export const scheduleRenderer: Renderer = {
  id: 'schedule',
  label: 'Schedule',
  requires: [start, duration, finish, slack, critical, late, milestone],
  rank: 10,

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const calendar = model.calendar!;
    const table = createGrid('plan-schedule', ['#', '', 'start', 'finish', 'duration', 'slack']);
    // Starts at their own edge, a milestone's the end; finishes at the end edge, since a finish is exclusive.
    const date = (t: WorkHours, edge: 'start' | 'end') => formatDate(calendar.toDate(t, edge), calendar);
    const visit = (node: ItemNode, depth: number): void => {
      if (shows(ctx, node)) {
        const row = addItemRow(table, node, ctx, model);
        row.classList.toggle('critical', model.get(node, critical)!);
        row.classList.toggle('late', model.get(node, late)!);
        addTitleCell(row, node, ctx, depth);

        const begins = model.get(node, start)!;
        const ends = model.get(node, finish)!;
        const point = model.get(node, milestone)!;
        const from = row.insertCell();
        from.textContent = formatPinnableDate(begins.effective, begins.edge, calendar);
        if (begins.mode !== 'derived' && begins.derived !== undefined) from.append(muted(`⟨${formatPinnableDate(begins.derived, begins.edge, calendar)}⟩`));
        row.insertCell().textContent = date(ends, 'end');

        const length = model.get(node, duration);
        const span = row.insertCell();
        if (point) span.textContent = 'milestone';
        else if (length) {
          span.textContent = formatDays(length.effective, calendar.hoursPerDay);
          if (length.mode !== 'derived' && length.derived !== undefined) span.append(muted(`⟨${formatDays(length.derived, calendar.hoursPerDay)}⟩`));
        }
        const spare = row.insertCell();
        spare.className = 'slack';
        spare.textContent = formatDays(model.get(node, slack)!, calendar.hoursPerDay);
      }
      node.children.forEach((child) => visit(child, depth + 1));
    };
    model.roots.forEach((root) => visit(root, 0));
    mount(host, table, ctx);
  },
};
