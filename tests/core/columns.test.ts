import { describe, expect, it } from 'vitest';
import { parse, parseColumns } from '../../src/core';

const DEFAULTS = [
  { name: 'est', type: 'duration' },
  { name: 'owner', type: 'text' },
  { name: 'notes', type: 'text' },
];

describe('parseColumns (§2.5)', () => {
  it('defaults when there is no front matter', () => {
    expect(parseColumns(null).columns).toEqual(DEFAULTS);
    expect(parseColumns(null).diagnostics).toHaveLength(0);
  });

  it('defaults when front matter has no columns key', () => {
    const tree = parse('---\ncalendar: x\n---\n');
    expect(parseColumns(tree.frontMatter).columns).toEqual(DEFAULTS);
  });

  it('parses declared columns in order', () => {
    const tree = parse('---\ncolumns: est:duration | pts:number | who:text\n---\n');
    expect(parseColumns(tree.frontMatter).columns).toEqual([
      { name: 'est', type: 'duration' },
      { name: 'pts', type: 'number' },
      { name: 'who', type: 'text' },
    ]);
  });

  it('unknown type falls back to text with a warning', () => {
    const tree = parse('---\ncolumns: when:date\n---\n');
    const { columns, diagnostics } = parseColumns(tree.frontMatter);
    expect(columns).toEqual([{ name: 'when', type: 'text' }]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ line: 2, severity: 'warning' });
  });

  it('duplicate names warn', () => {
    const tree = parse('---\ncolumns: est:duration | est:number\n---\n');
    const { diagnostics } = parseColumns(tree.frontMatter);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });
});
