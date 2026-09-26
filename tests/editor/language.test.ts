// Highlighting per spec §4.1, checked through the syntax tree's style tags.

import { highlightTree } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { planHighlightStyle, planLanguage } from '../../src/editor';
import { example, state } from './helpers';

interface Styled {
  text: string;
  classes: string[];
}

function styled(doc: string): Styled[] {
  const tree = planLanguage.parser.parse(doc);
  const out: Styled[] = [];
  highlightTree(tree, planHighlightStyle, (from, to, cls) => out.push({ text: doc.slice(from, to), classes: cls.split(' ') }));
  return out;
}

/** Classes on the styled token with exactly this text, occurring on the given 1-based line. */
function classesOf(doc: string, line: number, text: string): string[] {
  const lineStart = doc.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  const lineEnd = lineStart + doc.split('\n')[line - 1].length;
  const tree = planLanguage.parser.parse(doc);
  let found: string[] | null = null;
  highlightTree(tree, planHighlightStyle, (from, to, cls) => {
    if (from >= lineStart && to <= lineEnd && doc.slice(from, to) === text) found = cls.split(' ');
  });
  if (!found) throw new Error(`no styled token "${text}" on line ${line}`);
  return found;
}

describe('language mode', () => {
  it('styles every category of the §2.10 example distinctly', () => {
    const doc = example;
    const cases: [number, string, string][] = [
      [1, '---', 'cm-plan-front-matter'],
      [2, 'profile: plan', 'cm-plan-front-matter'],
      [4, '// Q4 auth work. Estimates are rough.', 'cm-plan-comment'],
      [5, '|', 'cm-plan-separator'],
      [5, '2d', 'cm-plan-duration'],
      [6, '~', 'cm-plan-done-marker'],
      [8, '+', 'cm-plan-additive'],
      [8, '1d', 'cm-plan-duration'],
    ];
    for (const [line, text, cls] of cases) {
      expect(classesOf(doc, line, text), `${text} on line ${line}`).toContain(cls);
    }
    // Done line: marker, separator and value all carry the done class.
    expect(classesOf(doc, 6, '~')).toContain('cm-plan-done');
    expect(classesOf(doc, 6, '4h')).toEqual(expect.arrayContaining(['cm-plan-duration', 'cm-plan-done']));
    expect(classesOf(doc, 6, '|')).toEqual(expect.arrayContaining(['cm-plan-separator', 'cm-plan-done']));
    // Not-done neighbours carry no done class.
    expect(classesOf(doc, 7, '6h')).not.toContain('cm-plan-done');
    expect(classesOf(doc, 5, '2d')).not.toContain('cm-plan-done');

    const distinct = new Set([...cases.map((c) => c[2]), 'cm-plan-done']);
    expect(distinct.size).toBe(7);
  });

  it('dims descendants of a done parent, not the following sibling', () => {
    const doc = '~Auth | 2d\n    Login | 4h\n        Deep | 1h\nAdmin | 1d\n';
    expect(classesOf(doc, 2, '4h')).toContain('cm-plan-done');
    expect(classesOf(doc, 3, '1h')).toContain('cm-plan-done');
    expect(classesOf(doc, 4, '1d')).not.toContain('cm-plan-done');
    expect(classesOf(doc, 4, '|')).not.toContain('cm-plan-done');
  });

  it('only treats --- on line 1 as front matter', () => {
    const doc = 'Auth | 2d\n---\n';
    expect(styled(doc).some((s) => s.classes.includes('cm-plan-front-matter'))).toBe(false);
  });

  it('leaves reserved # lines to the diagnostics layer', () => {
    expect(styled('# heading\n')).toEqual([]);
  });

  it('does not style non-value fields or titles', () => {
    const doc = 'Auth | 2d | alice | 4h later\n';
    const texts = styled(doc).map((s) => s.text);
    expect(texts).not.toContain('alice');
    expect(texts).not.toContain('4h later');
    expect(texts).not.toContain('Auth ');
  });

  it('declares // as the line comment token', () => {
    expect(state('x').languageDataAt<{ line: string }>('commentTokens', 0)[0]).toEqual({ line: '//' });
  });
});
