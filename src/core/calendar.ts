// The calendar (PLUGINS.md §7.2): the only thing that adds working time and turns hours into dates
// and back. Scheduling works in working hours from the project start, a plain number.

/** `YYYY-MM-DD`. */
export type IsoDate = string;
/** Working hours since project-start; a finish is exclusive. */
export type WorkHours = number;
export type Edge = 'start' | 'end';

export interface Calendar {
  /** project-start; there is no calendar without it. */
  readonly start: IsoDate;
  /** Every start + duration; negative hours for the backward pass. */
  add(t: WorkHours, hours: number, resource?: string): WorkHours;
  /** 'start': the first working hour on or after d. 'end': the hour just after d's last working hour. */
  fromDate(d: IsoDate, edge: Edge): WorkHours;
  /**
   * 'start': the working day hour t falls in. 'end': the working day hour t - 1 falls in (an
   * exclusive finish), except at hour 0, which has no working hour before it: hour 0's own day.
   */
  toDate(t: WorkHours, edge: Edge): IsoDate;
  /** For showing durations in days. */
  readonly hoursPerDay: number;
}

const DAY_MS = 86_400_000;
/** 1970-01-05, the first Monday after the epoch, as a day number. */
const MONDAY = 4;

const dayNumber = (d: IsoDate): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
const isoDate = (day: number): IsoDate => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Working days before `day`, counted from a fixed Monday. A Saturday or Sunday counts as the Monday after it. */
function workdayIndex(day: number): number {
  const weeks = Math.floor((day - MONDAY) / 7);
  return weeks * 5 + Math.min(day - MONDAY - weeks * 7, 5);
}

function workdayAt(index: number): number {
  const weeks = Math.floor(index / 5);
  return MONDAY + weeks * 7 + (index - weeks * 5);
}

/**
 * The naive calendar: Monday to Friday, `hoursPerDay` hours a day, no holidays. `add` is plain
 * addition. Hour 0 is the first working hour on or after `start`.
 */
export function naiveCalendar(start: IsoDate, hoursPerDay: number): Calendar {
  const origin = workdayIndex(dayNumber(start));
  return {
    start,
    hoursPerDay,
    add: (t, hours) => t + hours,
    fromDate(d, edge) {
      const day = dayNumber(d);
      // The end of d is the start of the day after it; for a weekend day, the end of the Friday before.
      return (workdayIndex(edge === 'start' ? day : day + 1) - origin) * hoursPerDay;
    },
    toDate(t, edge) {
      // An exclusive finish belongs to the day of the instant just before it; hour 0 has none, so its own day.
      const days = edge === 'start' || t === 0 ? Math.floor(t / hoursPerDay) : Math.ceil(t / hoursPerDay) - 1;
      return isoDate(workdayAt(origin + days));
    },
  };
}
