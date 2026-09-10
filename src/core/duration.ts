// Duration and number value parsing/formatting. Spec §2.6.
// Units are fixed in the MVP: bare number = hours, 1d = 8h, 1w = 40h.

const UNIT_HOURS: Record<string, number> = { h: 1, d: 8, w: 40 };

export interface ParsedValue {
  value: number; // hours for durations
  additive: boolean;
}

/**
 * One or more whitespace-separated `number unit` terms (`2d 4h`), any order,
 * each unit at most once. A bare number is hours and must be the sole term.
 * A leading `+` applies to the whole value.
 */
export function parseDuration(raw: string): ParsedValue | null {
  let s = raw.trim();
  const additive = s.startsWith('+');
  if (additive) s = s.slice(1).trim();
  const terms = s.split(/\s+/);
  if (terms.length === 1 && /^\d+(?:\.\d+)?$/.test(terms[0])) {
    return { value: parseFloat(terms[0]), additive };
  }
  const seen = new Set<string>();
  let hours = 0;
  for (const term of terms) {
    const m = /^(\d+(?:\.\d+)?)([hdw])$/.exec(term);
    if (!m || seen.has(m[2])) return null;
    seen.add(m[2]);
    hours += parseFloat(m[1]) * UNIT_HOURS[m[2]];
  }
  return { value: hours, additive };
}

export function parseNumber(raw: string): ParsedValue | null {
  const m = /^(\+)?\s*(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return null;
  return { value: parseFloat(m[2]), additive: m[1] === '+' };
}

/** Mixed units, largest first: 60 -> "1w 2d 4h". 0 -> "0h". */
export function formatDuration(hours: number): string {
  const total = round(hours);
  const w = Math.floor(total / 40);
  const afterWeeks = round(total - w * 40);
  const d = Math.floor(afterWeeks / 8);
  const h = round(afterWeeks - d * 8);
  const parts: string[] = [];
  if (w > 0) parts.push(`${w}w`);
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  return parts.length > 0 ? parts.join(' ') : '0h';
}

// Kill float noise from summing fractional hours (0.1 + 0.2).
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
