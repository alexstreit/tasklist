// Reading a lag (spec §2.11). A reading only this plugin needs, so it lives here as a pure function.

import type { Value } from 'rows';

/**
 * A lag in working hours. A lag is calendar time, not effort, so a day is the calendar's
 * `hoursPerDay` and a week is 5 of them, whatever the effort column's `dpw`. Negative when written
 * with `-`; 0 when there is no lag. A leading `+` means nothing here, and is read as the value.
 */
export function lagHours(value: Value | null, hoursPerDay: number): number {
  if (value?.type !== 'duration') return 0;
  const { m = 0, h = 0, d = 0, w = 0 } = value.terms;
  const hours = m / 60 + h + d * hoursPerDay + w * 5 * hoursPerDay;
  return value.sign === '-' ? -hours : hours;
}
