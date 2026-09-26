// Types and typed values (base §5), and the options that depend on them (base §4).
import type { Column, Value } from './types';

export type TypeKind = 'text' | 'number' | 'bool' | 'date' | 'datetime' | 'duration' | 'enum' | 'ref';
export type DurationUnit = 'm' | 'h' | 'd' | 'w';

const SIMPLE = new Set(['text', 'number', 'bool', 'date', 'datetime', 'duration']);
// A type is a name, optionally followed by one bracketed parameter.
const TYPE = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\[([^\]]*)\])?$/;

export type ParsedType =
  | { ok: true; type: string; kind: TypeKind; enumValues?: string[] }
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
    const values = param.split(',').map((v) => v.replace(/^[ \t]+|[ \t]+$/g, ''));
    if (values.some((v) => v === '')) return { ok: false, problem: 'malformed' };
    return { ok: true, type: `enum[${values.join(',')}]`, kind: 'enum', enumValues: values };
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
 * base §5: `[ "+" / "-" ] term *( [ WSP ] term )`, `term = number [ WSP ] unit`. `[ WSP ]` is at
 * most one space or tab. Each unit appears at most once.
 */
export function parseDuration(text: string, unit: DurationUnit | undefined): Value | null {
  if (unit !== undefined && NUMBER.test(text)) {
    const sign = text[0] === '+' || text[0] === '-' ? text[0] : null;
    return { type: 'duration', sign, terms: { [unit]: Number(sign ? text.slice(1) : text) }, bare: true };
  }
  const m = /^([+-]?)(.*)$/.exec(text)!;
  const sign = (m[1] || null) as '+' | '-' | null;
  const terms: Partial<Record<DurationUnit, number>> = {};
  const TERM = /^(\d+(?:\.\d+)?)[ \t]?([mhdw])/;
  let rest = m[2];
  let first = true;
  while (rest !== '') {
    if (!first && (rest[0] === ' ' || rest[0] === '\t')) rest = rest.slice(1);
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
