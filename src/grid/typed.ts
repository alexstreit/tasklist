// Typed cell input (spec §4b.6.5). Duration text is normalised when the user
// commits it; nothing here ever touches a cell the user didn't edit.

const UNITS: Record<string, 'm' | 'h' | 'd' | 'w'> = {
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w',
};
const TERM = /^(\d+(?:\.\d+)?)[ \t]*([A-Za-z]+)[ \t]*/;

/**
 * `4 Hours`, `1.5 days`, `2 wks 3d` and `90 mins` become `4h`, `1.5d`, `2w 3d` and `90m`: each term
 * a number and a unit word, in any case, each unit at most once, with an optional sign in front.
 * Anything else, a bare number included, comes back as typed.
 */
export function normaliseDuration(typed: string): string {
  const m = /^[ \t]*([+-]?)[ \t]*([\s\S]*?)[ \t]*$/.exec(typed)!;
  const terms: string[] = [];
  const seen = new Set<string>();
  let rest = m[2];
  while (rest !== '') {
    const t = TERM.exec(rest);
    const unit = t && UNITS[t[2].toLowerCase()];
    if (!t || !unit || seen.has(unit)) return typed;
    seen.add(unit);
    terms.push(`${t[1]}${unit}`);
    rest = rest.slice(t[0].length);
  }
  return terms.length === 0 ? typed : m[1] + terms.join(' ');
}
