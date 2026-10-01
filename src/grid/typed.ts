// Typed cell input (spec §4b.6.5). Duration text is normalised when the user
// commits it; nothing here ever touches a cell the user didn't edit.

import { parseDuration } from 'rows';

const UNITS: Record<string, 'm' | 'h' | 'd' | 'w'> = {
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w',
};

/**
 * `4 Hours`, `1.5 days`, `2 wks 3d` and `90 mins` become `4h`, `1.5d`, `2w 3d` and `90m`: each
 * number and the unit word after it, in any case, become the number and the unit's letter, and the
 * result is kept when rows reads it as a duration with units. Anything else, a bare number
 * included, comes back as typed.
 */
export function normaliseDuration(typed: string): string {
  const [, sign, rest] = /^[ \t]*([+-]?)[ \t]*([\s\S]*?)[ \t]*$/.exec(typed)!;
  let known = true;
  const terms = rest.replace(/(\d+(?:\.\d+)?)[ \t]*([A-Za-z]+)[ \t]*/g, (_, n: string, word: string) => {
    const unit = UNITS[word.toLowerCase()];
    if (!unit) known = false;
    return `${n}${unit} `;
  });
  const written = sign + terms.trimEnd();
  const value = known ? parseDuration(written, undefined) : null;
  return value?.type === 'duration' && !value.bare ? written : typed;
}
