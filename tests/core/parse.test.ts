import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core';
import type { ItemNode } from '../../src/core';
import { load } from './helpers';

describe('hierarchy (§2.4)', () => {
  it('0 / 8 / 4 indents: third item is a sibling of the second, no diagnostic', () => {
    const { tree, model } = load('A\n        B\n    C');
    expect(tree.items).toHaveLength(1);
    const a = tree.items[0];
    expect(a.children.map((c) => c.title)).toEqual(['B', 'C']);
    expect(a.children[0].children).toHaveLength(0);
    expect(model.diagnostics).toHaveLength(0);
  });
});

describe('lossless round-trip', () => {
  const original = [
    '---',
    'columns: est:duration | owner:text | notes:text',
    '---',
    '',
    '// a comment  ',
    'Auth  | 2d |',
    '\tTabbed child | 4h',
    '   Odd indent | 1h  ',
    '        <!-- markdown comment -->',
    '',
    'Trailing pipes | | |',
    '# reserved line',
    'Last |',
    '',
  ].join('\n');

  it('reconstructing from source ranges yields the original byte-for-byte (after tab conversion)', () => {
    const tree = parse(original);
    const expected = original.replace(/\t/g, '    ');
    expect(tree.text).toBe(expected);
    const rebuilt = tree.nodes.map((n) => tree.text.slice(n.span.from, n.span.to)).join('\n');
    expect(rebuilt).toBe(expected);
  });

  it('every line is retained as a node, comments and blanks included', () => {
    const tree = parse(original);
    expect(tree.nodes).toHaveLength(original.split('\n').length);
    expect(tree.nodes.map((n) => n.kind)).toEqual([
      'front-matter',
      'front-matter',
      'front-matter',
      'blank',
      'comment',
      'item',
      'item',
      'item',
      'comment',
      'blank',
      'item',
      'reserved',
      'item',
      'blank',
    ]);
  });
});

describe('empty and trivial files', () => {
  it.each([
    ['empty file', ''],
    ['only front matter', '---\ncolumns: est:duration | owner:text | notes:text\n---\n'],
    ['only comments', '// one\n// two'],
  ])('%s parses without error and produces an empty model', (_name, text) => {
    const { model } = load(text);
    expect(model.roots).toHaveLength(0);
    expect(model.diagnostics).toHaveLength(0);
    expect(model.totals[0]).toEqual({ effective: 0, doneSum: 0 });
  });
});

describe('item grammar (§2.3)', () => {
  it('trailing | produces nothing; an interior empty field is kept', () => {
    const tree = parse('A | 4h |\nB | | bob');
    const [a, b] = tree.items;
    expect(a.fields.map((f) => f.value)).toEqual(['4h']);
    expect(b.fields.map((f) => f.value)).toEqual(['', 'bob']);
  });

  it('~ marks done, with optional whitespace before the title', () => {
    const tree = parse('~Done\n~   Also done\nNot ~ done');
    expect(tree.items.map((i) => [i.title, i.done])).toEqual([
      ['Done', true],
      ['Also done', true],
      ['Not ~ done', false],
    ]);
  });

  it('fields carry trimmed values with spans over the trimmed text', () => {
    const tree = parse('Auth | 2d  | alice');
    const item = tree.items[0] as ItemNode;
    expect(item.title).toBe('Auth');
    expect(tree.text.slice(item.titleSpan.from, item.titleSpan.to)).toBe('Auth');
    const [est, owner] = item.fields;
    expect(tree.text.slice(est.span.from, est.span.to)).toBe('2d');
    expect(tree.text.slice(owner.span.from, owner.span.to)).toBe('alice');
  });

  it('front matter must start on line 1; a later --- is an item', () => {
    const tree = parse('A\n---\nB');
    expect(tree.frontMatter).toBeNull();
    expect(tree.items.map((i) => i.title)).toEqual(['A', '---', 'B']);
  });
});
