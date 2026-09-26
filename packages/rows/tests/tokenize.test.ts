import { describe, expect, it } from 'vitest';
import { tokenizeLine, type LineState } from '../src/index';

const ctx = { sep: '|', comment: '//' };
const tokens = (text: string) => tokenizeLine(text, ctx).tokens.map((t) => [t.type, text.slice(t.from, t.to), ...(t.quoted ? ['quoted'] : [])]);

describe('tokenizeLine', () => {
  it('splits a row into indent, lead, delimiters, names and values', () => {
    expect(tokens('    ~Login  | 4h |  owner=bob')).toEqual([
      ['indent', '    '],
      ['lead', '~Login'],
      ['delimiter', '|'],
      ['value', '4h'],
      ['delimiter', '|'],
      ['name', 'owner'],
      ['equals', '='],
      ['value', 'bob'],
    ]);
  });

  it('keeps delimiters inside quotes, and reports recognised escapes', () => {
    const line = 'A | notes="a | b\\n" |';
    const t = tokenizeLine(line, ctx).tokens;
    expect(t.map((x) => x.type)).toEqual(['lead', 'delimiter', 'name', 'equals', 'value', 'delimiter']);
    const value = t[4];
    expect(line.slice(value.from, value.to)).toBe('"a | b\\n"');
    expect(value.escapes!.map((e) => line.slice(e.from, e.to))).toEqual(['\\n']);
  });

  it('takes brace groups after a quoted lead into the lead (base §9)', () => {
    expect(tokens('"Email" {#home} | x')).toEqual([['lead', '"Email" {#home}', 'quoted'], ['delimiter', '|'], ['value', 'x']]);
  });

  it('reads NAME = x and a quoted "NAME=x" as unnamed values', () => {
    expect(tokens('A | owner = bob | "owner=bob"').filter((t) => t[0] === 'name')).toEqual([]);
  });

  it('classifies blank and comment lines with the context comment marker', () => {
    expect(tokenizeLine('   ', ctx).kind).toBe('blank');
    expect(tokenizeLine('  // note', ctx).tokens.map((t) => t.type)).toEqual(['comment']);
    expect(tokenizeLine('-- note', { sep: '|', comment: '--' }).kind).toBe('comment');
  });

  it('carries frontmatter state from line to line', () => {
    let state: LineState = 'start';
    const kinds = ['---', '  table : x', '# c', '', 'bad', '---', 'A'].map((text) => {
      const t = tokenizeLine(text, { ...ctx, state });
      state = t.next;
      return t.kind;
    });
    expect(kinds).toEqual(['fm-open', 'fm-entry', 'fm-comment', 'fm-blank', 'fm-malformed', 'fm-close', 'row']);
    const entry = tokenizeLine('  table : "x"', { ...ctx, state: 'frontmatter' });
    expect(entry.tokens.map((t) => [t.type, '  table : "x"'.slice(t.from, t.to)])).toEqual([
      ['fm-key', 'table'],
      ['fm-colon', ':'],
      ['fm-value', '"x"'],
    ]);
  });

  it('reads a first line that is not --- as body', () => {
    expect(tokenizeLine('A | b', { ...ctx, state: 'start' })).toMatchObject({ kind: 'row', next: 'body' });
  });
});
