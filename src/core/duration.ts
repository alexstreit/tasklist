// Duration and number value parsing/formatting. Spec §2.6.
// Units are fixed in the MVP: bare number = hours, 1d = 8h, 1w = 40h.

const UNIT_HOURS: Record<string, number> = { h: 1, d: 8, w: 40 };

export interface ParsedValue {
  value: number; // hours for durations
  additive: boolean;
}

export interface ParseError {
  error: string;
}

export type ParseResult = ParsedValue | ParseError;

const BARE_IN_COMPOUND = 'bare number not allowed in compound duration';

/**
 * One or more `number unit` terms (`2d 4h`, `2 d 4 h`), any order, each unit
 * at most once; whitespace is optional between number and unit and between
 * terms. A bare number is hours and only valid as the entire value. A leading
 * `+` applies to the whole value.
 */
export function parseDuration(raw: string): ParseResult {
  let s = raw.trim();
  const additive = s.startsWith('+');
  if (additive) s = s.slice(1).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return { value: parseFloat(s), additive };

  const term = /\s*(\d+(?:\.\d+)?)(?:\s*([hdw]))?/y;
  const seen = new Set<string>();
  let hours = 0;
  let pos = 0;
  while (pos < s.length) {
    term.lastIndex = pos;
    const m = term.exec(s);
    if (!m) return unparseable('duration', raw);
    pos = term.lastIndex;
    if (!m[2]) {
      const termEnds = pos === s.length || /\s/.test(s[pos]);
      return termEnds ? { error: BARE_IN_COMPOUND } : unparseable('duration', raw);
    }
    if (seen.has(m[2])) return unparseable('duration', raw);
    seen.add(m[2]);
    hours += parseFloat(m[1]) * UNIT_HOURS[m[2]];
  }
  if (seen.size === 0) return unparseable('duration', raw);
  return { value: hours, additive };
}

export function parseNumber(raw: string): ParseResult {
  const m = /^(\+)?\s*(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return unparseable('number', raw);
  return { value: parseFloat(m[2]), additive: m[1] === '+' };
}

function unparseable(type: string, raw: string): ParseError {
  return { error: `unparseable ${type}: "${raw}"` };
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
