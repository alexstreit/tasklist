// Dates as the views show them: `Mon 5 Oct`. Shared by the schedule plugin's renderers and the pin
// review, which belongs to no plugin.

import type { Calendar } from '../core';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon 5 Oct`, with the year when it isn't project-start's: `Mon 4 Jan 2027`. */
export function formatDate(iso: string, calendar: Calendar): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const year = iso.slice(0, 4) === calendar.start.slice(0, 4) ? '' : ` ${d.getUTCFullYear()}`;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}
