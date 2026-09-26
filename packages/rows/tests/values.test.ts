import { describe, expect, it } from 'vitest';
import { durationToMinutes, parseRows } from '../src/index';

const column = (decl: string) => parseRows(`---\ncolumns: ${decl}\n---\n`).schema.columns[1];
const duration = (text: string, decl = 'd:duration') => parseRows(`---\ncolumns: ${decl}\n---\nr | ${text}\n`).rows[0].cells[1]!.value;

describe('duration values (base §5)', () => {
  it.each(['4h', '4 h', '1d 4h', '2 d 4 h', '+2d 4h', '1.5d 4h', '-30m'])('%s is valid', (text) => {
    expect(duration(text)).not.toBeNull();
  });

  it.each(['4 2d', '2d 4', '1d1d', '2dh', 'd 2', '4x', '4'])('%s is invalid', (text) => {
    expect(duration(text)).toBeNull();
  });

  it('accepts a bare number only with unit=', () => {
    expect(duration('4', 'd:duration unit=h')).toEqual({ type: 'duration', sign: null, terms: { h: 4 }, bare: true });
    expect(duration('-4', 'd:duration unit=d')).toEqual({ type: 'duration', sign: '-', terms: { d: 4 }, bare: true });
  });

  it('keeps the sign and the terms as a bag', () => {
    expect(duration('+2d 4h')).toEqual({ type: 'duration', sign: '+', terms: { d: 2, h: 4 }, bare: false });
    expect(duration('4h 1d')).toEqual({ type: 'duration', sign: null, terms: { h: 4, d: 1 }, bare: false });
  });
});

describe('durationToMinutes', () => {
  const minutes = (text: string, decl: string) => {
    const col = column(decl);
    const value = duration(text, decl);
    if (value?.type !== 'duration') throw new Error(`not a duration: ${text}`);
    return durationToMinutes(value, col);
  };

  it('converts m and h always', () => {
    expect(minutes('1h 30m', 'd:duration')).toEqual({ minutes: 90 });
    expect(minutes('-30m', 'd:duration')).toEqual({ minutes: -30 });
  });

  it('converts d only with hpd, and w only with dpw as well', () => {
    expect(minutes('1d 4h', 'd:duration hpd=8')).toEqual({ minutes: 12 * 60 });
    expect(minutes('1d', 'd:duration')).toEqual({ error: 'needs-hpd' });
    expect(minutes('1w', 'd:duration hpd=8 dpw=5')).toEqual({ minutes: 40 * 60 });
    expect(minutes('1w', 'd:duration hpd=8')).toEqual({ error: 'needs-dpw' });
    expect(minutes('0w', 'd:duration hpd=8')).toEqual({ error: 'needs-dpw' });
    expect(minutes('1w', 'd:duration dpw=5')).toEqual({ error: 'needs-hpd' });
    expect(minutes('1.5d', 'd:duration hpd=7.5')).toEqual({ minutes: 1.5 * 7.5 * 60 });
  });
});

describe('column options (base §4)', () => {
  it('ignores a default that does not match the type, with a structural error', () => {
    const doc = parseRows('---\ncolumns: n:number default=abc | p:bool default=false\n---\n');
    expect(doc.schema.columns[1].default).toBeNull();
    expect(doc.schema.columns[2].default).toEqual({ type: 'bool', value: false });
    expect(doc.errors).toMatchObject([{ class: 'structural', code: 'invalid-option-value', line: 2 }]);
  });

  it('reads a default in the column syntax, after unit=', () => {
    expect(column('d:duration default=4 unit=h').default).toEqual({ type: 'duration', sign: null, terms: { h: 4 }, bare: true });
  });

  it('reads required, unique, unit, hpd and dpw, and keeps every option as written', () => {
    const c = column('est:duration unit=h hpd=8 dpw=5 required unique x-mine=1');
    expect(c).toMatchObject({ kind: 'duration', unit: 'h', hpd: 8, dpw: 5, required: true, unique: true });
    expect(c.options.map((o) => o.key)).toEqual(['unit', 'hpd', 'dpw', 'required', 'unique', 'x-mine']);
  });

  it('makes the lead always required', () => {
    expect(parseRows('A').schema.lead.required).toBe(true);
  });
});

describe('typed values', () => {
  it('reads each base type', () => {
    const doc = parseRows('---\ncolumns: n:number | b:bool | d:date | t:datetime | e:enum[low, high]\n---\nr | -1.5 | true | 2028-02-29 | 2026-09-01t10:00:00z | high\n');
    expect(doc.rows[0].cells.map((c) => c?.value)).toEqual([
      { type: 'text', text: 'r' },
      { type: 'number', value: -1.5 },
      { type: 'bool', value: true },
      { type: 'date', text: '2028-02-29' },
      { type: 'datetime', text: '2026-09-01t10:00:00z' },
      { type: 'enum', text: 'high' },
    ]);
    expect(doc.errors).toEqual([]);
  });

  it('leaves the value null and keeps the text when it does not match', () => {
    const cell = parseRows('---\ncolumns: n:number\n---\nr | 1e3\n').rows[0].cells[1]!;
    expect(cell).toMatchObject({ text: '1e3', value: null });
  });
});
