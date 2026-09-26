// Types and typed values (base §5), and the options that depend on them (base §4).
import type { Column, Value } from './types';

export type TypeKind = 'text' | 'number' | 'bool' | 'date' | 'datetime' | 'duration' | 'enum' | 'ref';
export type DurationUnit = 'm' | 'h' | 'd' | 'w';

const SIMPLE = new Set(['text', 'number', 'bool', 'date', 'datetime', 'duration']);
// A type is a name, optionally followed by one bracketed parameter.
const TYPE = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\[([^\]]*)\])?$/;

export type ParsedType =
  | { ok: true; type: string; kind: TypeKind; enumValues?: string[]; ignored?: ('empty' | 'repeated')[] }
  | { ok: false; problem: 'malformed' | 'unknown' };

/** Reads a declared type. Malformed and unknown types are read as `text` by the caller (base §6). */
export function parseType(declared: string, extensions: boolean): ParsedType {
  const m = TYPE.exec(declared);
  if (!m) return { ok: false, problem: 'malformed' };
  const [, name, param] = m;
  if (name.startsWith('x-')) return { ok: true, type: 'text', kind: 'text' }; // extension types (base §5)
  if (name === 'ref') {
    // Reserved (base §9): text in a base-only parse; the extensions stage reads it.
    return extensions ? { ok: true, type: declared, kind: 'ref' } : { ok: true, type: 'text', kind: 'text' };
  }
  if (name === 'enum') {
    if (param === undefined) return { ok: false, problem: 'malformed' };
    // base §5: enum[] is malformed; empty and repeated values are ignored, each with an error.
    const values: string[] = [];
    const ignored: ('empty' | 'repeated')[] = [];
    for (const v of param.split(',').map((v) => v.replace(/^[ \t]+|[ \t]+$/g, ''))) {
      if (v === '') ignored.push('empty');
      else if (values.includes(v)) ignored.push('repeated');
      else values.push(v);
    }
    // With no values left, as in enum[] or enum[,], the type is malformed (base §5).
    if (values.length === 0) return { ok: false, problem: 'malformed' };
    return { ok: true, type: `enum[${values.join(',')}]`, kind: 'enum', enumValues: values, ignored };
  }
  if (SIMPLE.has(name)) return param === undefined ? { ok: true, type: name, kind: name as TypeKind } : { ok: false, problem: 'malformed' };
  return { ok: false, problem: 'unknown' };
}

// ---------- values ----------

const NUMBER = /^[+-]?\d+(\.\d+)?$/;
const UNSIGNED = /^\d+(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// RFC 3339 §5.6 date-time; `T` and `Z` may be lower case (RFC 3339 §5.6, note).
const DATETIME = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

function realDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

function realDatetime(text: string): boolean {
  const m = DATETIME.exec(text);
  if (!m) return false;
  const [, date, hour, minute, second, , offset, offHour, offMinute] = m;
  if (!realDate(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60) return false;
  return offset.length === 1 || (Number(offHour) <= 23 && Number(offMinute) <= 59);
}

/**
 * base §5: `[ ( "+" / "-" ) *WSP ] term *( *WSP term )`, `term = number *WSP unit`. Each unit appears at
 * most once.
 */
export function parseDuration(text: string, unit: DurationUnit | undefined): Value | null {
  if (unit !== undefined && NUMBER.test(text)) {
    const sign = text[0] === '+' || text[0] === '-' ? text[0] : null;
    return { type: 'duration', sign, terms: { [unit]: Number(sign ? text.slice(1) : text) }, bare: true };
  }
  const m = /^(?:([+-])[ \t]*)?(.*)$/.exec(text)!;
  const sign = (m[1] || null) as '+' | '-' | null;
  const terms: Partial<Record<DurationUnit, number>> = {};
  const TERM = /^(\d+(?:\.\d+)?)[ \t]*([mhdw])/;
  let rest = m[2];
  let first = true;
  while (rest !== '') {
    if (!first) rest = rest.replace(/^[ \t]+/, '');
    const t = TERM.exec(rest);
    if (!t) return null;
    const u = t[2] as DurationUnit;
    if (terms[u] !== undefined) return null;
    terms[u] = Number(t[1]);
    rest = rest.slice(t[0].length);
    first = false;
  }
  if (first) return null;
  return { type: 'duration', sign, terms, bare: false };
}

/** The typed value of a cell's text, or null when it doesn't match the column. */
export function readValue(text: string, column: Column): Value | null {
  switch (column.kind) {
    case 'text':
      return { type: 'text', text };
    case 'number':
      return NUMBER.test(text) ? { type: 'number', value: Number(text) } : null;
    case 'bool':
      return text === 'true' ? { type: 'bool', value: true } : text === 'false' ? { type: 'bool', value: false } : null;
    case 'date':
      return realDate(text) ? { type: 'date', text } : null;
    case 'datetime':
      return realDatetime(text) ? { type: 'datetime', text } : null;
    case 'enum':
      return column.enumValues!.includes(text) ? { type: 'enum', text } : null;
    case 'duration':
      return parseDuration(text, column.unit as DurationUnit | undefined);
    case 'ref':
      return null; // the extensions stage reads references
  }
}

/** A positive number, as `hpd=` and `dpw=` take (base §4). */
export const positiveNumber = (s: string | null): number | null => (s !== null && UNSIGNED.test(s) && Number(s) > 0 ? Number(s) : null);

/**
 * A key such that two cells of a column are equal (base §5) exactly when their keys are equal.
 * A value that doesn't match its column compares as its text.
 */
export function equalityKey(cell: { text: string | null; value: Value | null }, column: Pick<Column, 'hpd' | 'dpw'>): string | null {
  if (cell.text === null) return null;
  const v = cell.value;
  if (v === null) return `text:${cell.text}`;
  switch (v.type) {
    case 'number':
      return `number:${v.value}`;
    case 'datetime':
      return `instant:${instant(v.text)}`;
    case 'duration': {
      // Minutes where the column permits the conversion; otherwise the bag of terms. The sign counts.
      const converted = durationToMinutes({ ...v, sign: null }, column);
      const magnitude =
        'minutes' in converted
          ? `${converted.minutes}m`
          : (['m', 'h', 'd', 'w'] as const).map((u) => (v.terms[u] === undefined ? '' : `${u}${v.terms[u]}`)).join(' ');
      return `duration:${v.sign ?? ''}${'minutes' in converted ? 'minutes' : 'bag'}:${magnitude}`;
    }
    case 'ref':
      return `text:${cell.text}`; // the extensions stage defines reference equality
    default:
      return `text:${cell.text}`; // text, enum, bool and date: by code point
  }
}

/** Compares two strings by Unicode code point (JavaScript's `<` compares UTF-16 units). */
export function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

type Comparable = { text: string | null; value: Value | null };

/**
 * Orders two non-null cells of a column (ext §7), consistently with equality (base §5). Returns
 * null for a pair that can't be compared: durations the column can't both convert, and a valid
 * value against an invalid one. Two invalid values compare as their text.
 */
export function compareValues(a: Comparable, b: Comparable, column: Column): number | null {
  if (column.kind === 'ref') return compareCodePoints(a.text!, b.text!); // by locator text
  const [x, y] = [a.value, b.value];
  if (x === null && y === null) return compareCodePoints(a.text!, b.text!);
  if (x === null || y === null) return null;
  if (x.type === 'number' && y.type === 'number') return x.value - y.value;
  if (x.type === 'bool' && y.type === 'bool') return Number(x.value) - Number(y.value);
  if (x.type === 'enum' && y.type === 'enum') return column.enumValues!.indexOf(x.text) - column.enumValues!.indexOf(y.text);
  if (x.type === 'datetime' && y.type === 'datetime') {
    const [p, q] = [instantParts(x.text), instantParts(y.text)];
    return p.seconds - q.seconds || compareCodePoints(p.fraction.padEnd(q.fraction.length, '0'), q.fraction.padEnd(p.fraction.length, '0'));
  }
  if (x.type === 'duration' && y.type === 'duration') {
    const [p, q] = [durationToMinutes(x, column), durationToMinutes(y, column)];
    return 'minutes' in p && 'minutes' in q ? p.minutes - q.minutes : null;
  }
  return compareCodePoints(a.text!, b.text!); // text and date
}

/** A datetime as whole seconds since the epoch, plus its fraction digits without trailing zeros. */
function instantParts(text: string): { seconds: number; fraction: string } {
  const m = DATETIME.exec(text)!;
  const [date, hour, minute, second, fraction = '', offset, offHour, offMinute] = m.slice(1);
  const [y, mo, d] = date.split('-').map(Number);
  const offsetMinutes = offset.length === 1 ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offHour) * 60 + Number(offMinute));
  const seconds = Date.UTC(y, mo - 1, d, Number(hour), Number(minute)) / 1000 + Number(second) - offsetMinutes * 60;
  return { seconds, fraction: fraction.slice(1).replace(/0+$/, '') };
}

function instant(text: string): string {
  const { seconds, fraction } = instantParts(text);
  return fraction ? `${seconds}.${fraction}` : `${seconds}`;
}

const MINUTES: Record<'m' | 'h', number> = { m: 1, h: 60 };

/**
 * Minutes in a duration. m and h always convert; d needs the column's `hpd`, and w needs its
 * `dpw` as well (base §5).
 */
export function durationToMinutes(
  value: Extract<Value, { type: 'duration' }>,
  column: Pick<Column, 'hpd' | 'dpw'>,
): { minutes: number } | { error: 'needs-hpd' | 'needs-dpw' } {
  const { m = 0, h = 0, d = 0, w = 0 } = value.terms;
  const has = (u: DurationUnit) => value.terms[u] !== undefined;
  if (has('w') && column.dpw === undefined) return { error: 'needs-dpw' };
  if ((has('d') || has('w')) && column.hpd === undefined) return { error: 'needs-hpd' };
  const days = d + w * (column.dpw ?? 0);
  const minutes = m * MINUTES.m + h * MINUTES.h + days * (column.hpd ?? 0) * 60;
  return { minutes: value.sign === '-' ? -minutes : minutes };
}
