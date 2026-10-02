// The Gantt chart's geometry (spec §5.5): where every mark, line and label goes, as plain data with
// no DOM. The x axis is working days: a position is `WorkHours / hoursPerDay × dayWidth`, so
// weekends take no space and every mark sits on the schedule's own axis. The renderer only places
// what this returns.

import type { IsoDate, ItemNode, Model, RowLayout, WorkHours } from '../../../../core';
import { formatDate } from '../../../../ui/dates';
import { critical, deadline, finish, late, milestone, projectFinish, start } from '../../fields';

export type GanttMark = { kind: 'bar' | 'summary'; x: number; width: number } | { kind: 'milestone'; x: number };

export interface GanttRow {
  line: number;
  /** The row's file: the root file's path, or a mounted file's. */
  file: string;
  /** From the layout, in its content coordinates. */
  top: number;
  height: number;
  mark: GanttMark;
  critical: boolean;
  late: boolean;
  done: boolean;
  /** The start's mode isn't `derived`. */
  pinned: boolean;
  /** A pinned start's own date; left of the mark when the pin had no effect. */
  pinX?: number;
  /** A late row's deadline. */
  deadlineX?: number;
}

export interface Gantt {
  /** The extent's width: through the later of the project finish and the latest deadline, rounded up to a whole working day, plus one. */
  width: number;
  rows: GanttRow[];
  /** One per layout row with a line, item or not: where the cursor and hover bands go. */
  bands: { line: number; file: string; top: number; height: number }[];
  /** One per distinct deadline date. */
  deadlines: { x: number; label: string }[];
  finish: number;
  /** Absent when today is outside the extent. */
  today?: number;
  /** A separator and label at each week's first working day. */
  weeks: { x: number; label: string }[];
  /** Each working day's letter. */
  days: { x: number; letter: string }[];
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A row's key: its line alone is ambiguous once files are mounted. */
export const rowKey = (row: { file: string; line: number }): string => `${row.file}\n${row.line}`;
const weekday = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** The chart for the rows in `layout`. Needs the schedule's fields and the model's calendar. */
export function ganttGeometry(model: Model, layout: RowLayout, dayWidth: number, today: IsoDate): Gantt {
  const calendar = model.calendar!;
  const hpd = calendar.hoursPerDay;
  const x = (t: WorkHours) => (t / hpd) * dayWidth;

  const items = new Map<string, ItemNode>();
  const collect = (node: ItemNode): void => void (items.set(rowKey(node), node), node.children.forEach(collect));
  model.roots.forEach(collect);

  // Every row's deadline, folded or not, drawn or not.
  const due = new Set<WorkHours>();
  for (const node of items.values()) {
    const t = model.get(node, deadline);
    if (t !== undefined) due.add(t);
  }
  const end = model.value(projectFinish)!;
  const days = Math.ceil(Math.max(end, ...due) / hpd) + 1;

  const rows: GanttRow[] = [];
  const bands: Gantt['bands'] = [];
  for (const row of layout.rows) {
    if (!row.at) continue;
    const at = row.at;
    bands.push({ line: at.line, file: at.file, top: row.top, height: row.height });
    const node = items.get(rowKey(at));
    if (!node) continue;
    const begins = model.get(node, start)!;
    const ends = model.get(node, finish)!;
    const mark: GanttMark = model.get(node, milestone)
      ? { kind: 'milestone', x: x(ends) }
      : { kind: node.children.length > 0 ? 'summary' : 'bar', x: x(begins.effective), width: x(ends) - x(begins.effective) };
    const isLate = model.get(node, late)!;
    const pinned = begins.mode !== 'derived';
    rows.push({
      line: node.line,
      file: node.file,
      top: row.top,
      height: row.height,
      mark,
      critical: model.get(node, critical)!,
      late: isLate,
      done: node.done,
      pinned,
      ...(pinned && begins.pin !== undefined ? { pinX: x(begins.pin) } : {}),
      ...(isLate ? { deadlineX: x(model.get(node, deadline)!) } : {}),
    });
  }

  const weeks: Gantt['weeks'] = [];
  const letters: Gantt['days'] = [];
  for (let d = 0; d < days; d++) {
    const date = calendar.toDate(d * hpd, 'start');
    // A week starts on a day that comes earlier in the week than the working day before it.
    if (d === 0 || weekday(date) < weekday(calendar.toDate((d - 1) * hpd, 'start'))) weeks.push({ x: d * dayWidth, label: formatDate(date, calendar) });
    letters.push({ x: d * dayWidth, letter: LETTERS[weekday(date)] });
  }

  // Today's line is at the start of its working day.
  const now = calendar.fromDate(today, 'start');
  return {
    width: days * dayWidth,
    rows,
    bands,
    deadlines: [...due].sort((a, b) => a - b).map((t) => ({ x: x(t), label: formatDate(calendar.toDate(t, 'end'), calendar) })),
    finish: x(end),
    ...(now >= 0 && now < days * hpd ? { today: x(now) } : {}),
    weeks,
    days: letters,
  };
}
