import { describe, expect, it } from 'vitest';
import { byTitle, load } from './helpers';

const parse = (text: string) => load(text).tree;

describe('hierarchy (§2.4)', () => {
  it('0 / 8 / 4 indents: third item is a sibling of the second, with one structural error', () => {
    const { tree, model } = load('A\n        B\n    C');
    expect(tree.items).toHaveLength(1);
    const a = tree.items[0];
    expect(a.children.map((c) => c.title)).toEqual(['B', 'C']);
    expect(a.children[0].children).toHaveLength(0);
    expect(model.diagnostics).toMatchObject([{ line: 3, severity: 'error', code: 'bad-indent' }]);
  });
});

describe('outline numbers (§3.1)', () => {
  it('numbers items by position among siblings, appended to the parent', () => {
    const { tree } = load('A\n    B\n        C\n    D\nE');
    const a = tree.items[0];
    expect(a.outlineNumber).toBe('1');
    expect(a.children.map((c) => c.outlineNumber)).toEqual(['1.1', '1.2']);
    expect(a.children[0].children[0].outlineNumber).toBe('1.1.1');
    expect(tree.items[1].outlineNumber).toBe('2');
  });

  it('a comment line between siblings does not affect numbering; a heading line is an item', () => {
    const { model } = load('A\n    B\n    // C | 2d\n    D\n\n# heading\nE');
    expect(byTitle(model, 'B').outlineNumber).toBe('1.1');
    expect(byTitle(model, 'D').outlineNumber).toBe('1.2');
    expect(byTitle(model, '# heading').outlineNumber).toBe('2');
    expect(byTitle(model, 'E').outlineNumber).toBe('3');
  });

  it('0 / 8 / 4 indents: third item is numbered as a sibling (1.2), not a grandchild', () => {
    const { model } = load('A\n        B\n    C');
    expect(byTitle(model, 'C').outlineNumber).toBe('1.2');
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
    // The empty text after a final newline is not a line (rows base §1).
    const rebuilt = tree.nodes.map((n) => tree.text.slice(n.span.from, n.span.to)).join('\n') + '\n';
    expect(rebuilt).toBe(expected);
  });

  it('every line is retained as a node, comments and blanks included', () => {
    const tree = parse(original);
    expect(tree.nodes).toHaveLength(original.split('\n').length - 1);
    expect(tree.nodes.map((n) => n.kind)).toEqual([
      'front-matter',
      'front-matter',
      'front-matter',
      'blank',
      'comment',
      'item',
      'item',
      'item',
      'item', // <!-- --> is a row (§2.3)
      'blank',
      'item',
      'item', // a heading line is a row with a structural error
      'item',
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
  it('trailing | produces nothing; an interior empty field is unset', () => {
    const tree = parse('A | 4h |\nB | | bob');
    const [a, b] = tree.items;
    expect(a.fields.map((f) => f?.text ?? null)).toEqual(['4h', null, null]);
    expect(b.fields.map((f) => f?.text ?? null)).toEqual([null, 'bob', null]);
  });

  it('~ marks done, with optional whitespace before the title', () => {
    const tree = parse('~Done\n~   Also done\nNot ~ done');
    expect(tree.items.map((i) => [i.title, i.done])).toEqual([
      ['Done', true],
      ['Also done', true],
      ['Not ~ done', false],
    ]);
  });

  it('fields carry decoded text with spans over the value as written', () => {
    const tree = parse('Auth | 2d  | alice');
    const item = tree.items[0];
    expect(item.title).toBe('Auth');
    expect(tree.text.slice(item.titleSpan.from, item.titleSpan.to)).toBe('Auth');
    const [est, owner] = item.fields.map((f) => f!);
    expect(tree.text.slice(est.span.from, est.span.to)).toBe('2d');
    expect(tree.text.slice(owner.span.from, owner.span.to)).toBe('alice');
  });

  it('front matter must start on line 1; a later --- is an item', () => {
    const tree = parse('A\n---\nB');
    expect(tree.doc.frontmatter).toBeNull();
    expect(tree.items.map((i) => i.title)).toEqual(['A', '---', 'B']);
  });
});
