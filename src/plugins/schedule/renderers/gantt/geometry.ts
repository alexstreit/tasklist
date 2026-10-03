// The Gantt chart's geometry (spec §5.5): where every mark, line and label goes, as plain data with
// no DOM. The x axis is working days: a position is `WorkHours / hoursPerDay × dayWidth`, so
// weekends take no space and every mark sits on the schedule's own axis. A scale sets `dayWidth`
// and the two tiers of labels. The renderer only places what this returns.

import type { IsoDate, ItemNode, Model, RowLayout, WorkHours } from '../../../../core';
import { formatDate } from '../../../../core';
import { critical, deadline, finish, late, milestone, projectFinish, start } from '../../fields';

/** `width` is the mark's true width; `drawn` is the width it is drawn at, at least MIN_WIDTH. */
export type GanttMark =
  | { kind: 'bar'; x: number; width: number; drawn: number }
  /** `asBar`: narrower than its two end caps, so it is drawn as a bar. */
  | { kind: 'summary'; x: number; width: number; drawn: number; asBar: boolean }
  | { kind: 'milestone'; x: number };

/** Which labels a scale shows: its top tier, then its bottom tier. */
export type Tiers = 'day' | 'week' | 'month';
/** A named scale, as the picker offers it, or an explicit pair (as tests pass it). */
export type Scale = Tiers | 'fit' | { dayWidth: number; tiers: Tiers };

/** Each named scale's px per working day. */
export const DAY_WIDTHS: Record<Tiers, number> = { day: 24, week: 6, month: 1.5 };
/** A bar is never drawn narrower than this, so short tasks stay visible. */
export const MIN_WIDTH = 2;
/** A summary bracket's end caps, each as wide as its border in gantt.css. */
const CAP_WIDTH = 3;
/** A label's width is estimated, with no DOM to measure it: the scale's text is 12px (gantt.css), about
 *  CHAR_WIDTH a character, plus LABEL_PADDING. */
export const CHAR_WIDTH = 7;
export const LABEL_PADDING = 6;
export const labelWidth = (label: string): number => label.length * CHAR_WIDTH + LABEL_PADDING;

export interface GanttLabel {
  x: number;
  label: string;
}

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
  /** The scale resolved: Fit picks both from the chart's width. */
  dayWidth: number;
  tiers: Tiers;
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
  /** The two tiers of labels; a label that would overlap the one before it in its tier is left out. */
  top: GanttLabel[];
  bottom: GanttLabel[];
  /** Full-height lines at each top-tier period, labelled or not. */
  lines: number[];
  /** Short ticks in the scale at each bottom-tier period. */
  ticks: number[];
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A row's key: its line alone is ambiguous once files are mounted. */
export const rowKey = (row: { file: string; line: number }): string => `${row.file}\n${row.line}`;
const weekday = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A named scale's pair. Fit divides the chart's width by the extent and takes the tiers whose
 *  `dayWidth` is nearest by ratio, the coarser on a tie; with no width it is Day. */
export function resolveScale(scale: Scale, days: number, chartWidth: number): { dayWidth: number; tiers: Tiers } {
  if (typeof scale === 'object') return scale;
  if (scale !== 'fit') return { dayWidth: DAY_WIDTHS[scale], tiers: scale };
  if (chartWidth <= 0) return { dayWidth: DAY_WIDTHS.day, tiers: 'day' };
  const dayWidth = chartWidth / days;
  const ratio = (tiers: Tiers) => Math.max(dayWidth / DAY_WIDTHS[tiers], DAY_WIDTHS[tiers] / dayWidth);
  let tiers: Tiers = 'day';
  for (const next of ['week', 'month'] as const) if (ratio(next) <= ratio(tiers)) tiers = next;
  return { dayWidth, tiers };
}

/** Leave out each label that would overlap the one kept before it. */
function spaced(labels: GanttLabel[]): GanttLabel[] {
  const kept: GanttLabel[] = [];
  for (const label of labels) {
    const before = kept[kept.length - 1];
    if (!before || label.x >= before.x + labelWidth(before.label)) kept.push(label);
  }
  return kept;
}

/** The chart for the rows in `layout`, at `scale`. Needs the schedule's fields and the model's
 *  calendar. `chartWidth` is the pane's, read only for Fit. */
export function ganttGeometry(model: Model, layout: RowLayout, scale: Scale, today: IsoDate, chartWidth = 0): Gantt {
  const calendar = model.calendar!;
  const hpd = calendar.hoursPerDay;

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
  const { dayWidth, tiers } = resolveScale(scale, days, chartWidth);
  const x = (t: WorkHours) => (t / hpd) * dayWidth;

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
    const width = x(ends) - x(begins.effective);
    const span = { x: x(begins.effective), width, drawn: Math.max(width, MIN_WIDTH) };
    const mark: GanttMark = model.get(node, milestone)
      ? { kind: 'milestone', x: x(ends) }
      : node.children.length > 0
        ? { kind: 'summary', ...span, asBar: width < 2 * CAP_WIDTH }
        : { kind: 'bar', ...span };
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

  // The periods, each at its first working day; the one that holds hour 0 is at 0.
  const dayLabels: GanttLabel[] = [];
  const weekLabels: GanttLabel[] = [];
  for (let d = 0; d < days; d++) {
    const date = calendar.toDate(d * hpd, 'start');
    // A week starts on a day that comes earlier in the week than the working day before it.
    if (d === 0 || weekday(date) < weekday(calendar.toDate((d - 1) * hpd, 'start'))) weekLabels.push({ x: d * dayWidth, label: tiers === 'day' ? formatDate(date, calendar) : String(Number(date.slice(8))) });
    dayLabels.push({ x: d * dayWidth, label: LETTERS[weekday(date)] });
  }
  // A month or a year is labelled at the first working day on or after its 1st.
  const monthLabels: GanttLabel[] = [];
  const yearLabels: GanttLabel[] = [];
  const first = calendar.toDate(0, 'start');
  let [year, month] = [Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1];
  for (let t = 0; t < days * hpd; ) {
    monthLabels.push({ x: x(t), label: tiers === 'week' ? `${MONTHS[month]} ${year}` : MONTHS[month] });
    if (t === 0 || month === 0) yearLabels.push({ x: x(t), label: String(year) });
    [year, month] = month === 11 ? [year + 1, 0] : [year, month + 1];
    t = calendar.fromDate(`${year}-${String(month + 1).padStart(2, '0')}-01`, 'start');
  }
  const [upper, lower] = { day: [weekLabels, dayLabels], week: [monthLabels, weekLabels], month: [yearLabels, monthLabels] }[tiers];

  // Today's line is at the start of its working day.
  const now = calendar.fromDate(today, 'start');
  return {
    dayWidth,
    tiers,
    width: days * dayWidth,
    rows,
    bands,
    deadlines: [...due].sort((a, b) => a - b).map((t) => ({ x: x(t), label: formatDate(calendar.toDate(t, 'end'), calendar) })),
    finish: x(end),
    ...(now >= 0 && now < days * hpd ? { today: x(now) } : {}),
    top: spaced(upper),
    bottom: spaced(lower),
    lines: upper.map((label) => label.x),
    ticks: lower.map((label) => label.x),
  };
}
