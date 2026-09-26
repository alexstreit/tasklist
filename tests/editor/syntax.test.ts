// Highlighting from the rows tokenizer (spec §4.1). The highlighter must never
// disagree with the parser, so it is run beside parseRows over every
// conformance input, with its context taken from the parsed document exactly
// as the editor takes it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRows } from 'rows';
import type { Cell, LineState, ParseOptions, RowsDocument } from 'rows';
import { describe, expect, it } from 'vitest';
import { FALLBACK_SYNTAX, lineState, styleLine, syntaxOf } from '../../src/editor/syntax';
import type { Styled, Syntax } from '../../src/editor/syntax';
import { analyze } from '../../src/core';
import { example } from './helpers';

const conformance = fileURLToPath(new URL('../../packages/rows/conformance/', import.meta.url));
const cases = readdirSync(conformance, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => {
    const dir = join(conformance, e.name);
    const raw = existsSync(join(dir, 'options.json')) ? JSON.parse(readFileSync(join(dir, 'options.json'), 'utf8')) : {};
    const { profileFiles, ...options } = raw;
    return {
      name: e.name,
      text: readFileSync(join(dir, 'input.rows'), 'utf8'),
      options: { ...options, resolveProfile: (path: string) => profileFiles?.[path] } as ParseOptions,
    };
  });

/** Every line of the document, styled the way the editor styles it. */
function highlight(doc: RowsDocument, syntax: Syntax) {
  let carried: LineState = 'start';
  return doc.lines.map((l) => {
    const out = styleLine(doc.text.slice(l.from, l.to), lineState(syntax, l.line, l.from) ?? carried, syntax);
    carried = out.next;
    return { line: l, ...out };
  });
}

const category = (kind: string) => (kind.startsWith('fm-') ? 'frontmatter' : kind);
const spans = (styles: Styled[], cls: string) => styles.filter((s) => s.cls.split(' ').includes(cls)).map((s) => [s.from, s.to]);
/** Adjacent spans of one class, joined: a quoted value is split around its escapes. */
function joined(styles: Styled[], cls: string): number[][] {
  const out: number[][] = [];
  for (const [from, to] of spans(styles, cls)) {
    const last = out[out.length - 1];
    if (last && last[1] === from) last[1] = to;
    else out.push([from, to]);
  }
  return out;
}

describe('the highlighter agrees with the parser', () => {
  it('on every conformance input', () => {
    expect(cases.length).toBeGreaterThan(200);
    let rows = 0;
    for (const { name, text, options } of cases) {
      const doc = parseRows(text, options);
      for (const { line, kind, styles } of highlight(doc, syntaxOf(doc))) {
        const where = `${name}, line ${line.line}`;
        expect(category(kind), where).toBe(category(line.kind));
        const row = line.row;
        if (!row) continue;
        rows++;
        const rel = (s: { from: number; to: number }) => [s.from - line.from, s.to - line.from];
        expect(spans(styles, 'cm-plan-marker'), where).toEqual(row.markers.map(rel));
        // Each anchor lies in an anchor-group span.
        const groups = spans(styles, 'cm-plan-anchor');
        for (const a of row.anchors.map(rel)) expect(groups.some(([f, t]) => f <= a[0] && a[1] <= t), where).toBe(true);
        if (row.anchors.length === 0) expect(groups, where).toEqual([]);

        const cells = [...row.cells.slice(1), ...row.overflow].filter((c): c is Cell => c !== null).sort((a, b) => a.from - b.from);
        expect(
          spans(styles, 'cm-plan-name').filter((_, i) => i % 2 === 0),
          where,
        ).toEqual(cells.filter((c) => c.name).map((c) => rel(c.name!)));

        const quoted = [row.lead, ...cells].filter((c) => c.quoted && c.valueTo > c.valueFrom).map((c) => rel({ from: c.valueFrom, to: c.valueTo }));
        expect(joined(styles, 'cm-plan-quoted'), where).toEqual(quoted);

        // Per-type colour: exactly the unquoted values of duration and number columns.
        const summable = cells
          .filter((c) => !c.quoted && c.valueTo > c.valueFrom && (c.column?.kind === 'duration' || c.column?.kind === 'number'))
          .map((c) => rel({ from: c.valueFrom, to: c.valueTo })[0]);
        // A value starts at its `+` when it has one, else at its duration span.
        const coloured = styles.flatMap((s, i) =>
          s.cls === 'cm-plan-additive' || (s.cls === 'cm-plan-duration' && styles[i - 1]?.cls !== 'cm-plan-additive') ? [s.from] : [],
        );
        expect(coloured, where).toEqual(summable);
      }
    }
    expect(rows).toBeGreaterThan(500);
  });

  it('takes the frontmatter extent from the parsed document, which knows an unclosed block is body', () => {
    const doc = parseRows('---\nlead: title:text\nAuth | 2d\n');
    const lines = highlight(doc, syntaxOf(doc));
    expect(lines.map((l) => category(l.kind))).toEqual(['frontmatter', 'row', 'row']);
    // Without a parsed document the tokenizer can't know, and shows it all as frontmatter.
    const carried = highlight(doc, FALLBACK_SYNTAX);
    expect(carried.map((l) => category(l.kind))).toEqual(['frontmatter', 'frontmatter', 'frontmatter']);
  });
});

describe('styles', () => {
  /** Styled text on a 1-based line of a plan, with the context the editor would have. */
  function styled(text: string, lineNo: number): { text: string; cls: string }[] {
    const doc = analyze(text).doc;
    const lines = highlight(doc, syntaxOf(doc));
    const { line, styles } = lines[lineNo - 1];
    return styles.map((s) => ({ text: doc.text.slice(line.from + s.from, line.from + s.to), cls: s.cls }));
  }
  const classOf = (text: string, lineNo: number, token: string) => styled(text, lineNo).find((s) => s.text === token)?.cls;

  it('distinguishes every category of the §2.10 example', () => {
    expect(classOf(example, 1, '---')).toBe('cm-plan-front-matter');
    expect(classOf(example, 2, 'profile: plan')).toBe('cm-plan-front-matter');
    expect(classOf(example, 4, '// Q4 auth work. Estimates are rough.')).toBe('cm-plan-comment');
    expect(classOf(example, 5, '|')).toBe('cm-plan-separator');
    expect(classOf(example, 5, '2d')).toBe('cm-plan-duration');
    expect(classOf(example, 6, '~')).toBe('cm-plan-marker');
    expect(classOf(example, 8, '+')).toBe('cm-plan-additive');
    expect(classOf(example, 8, '1d')).toBe('cm-plan-duration');
  });

  it('distinguishes anchors, cell names, quoted values and escapes', () => {
    const text = '~Login {#login} | 4h | owner=bob | "a \\"b\\" | c"\n';
    expect(styled(text, 1)).toEqual([
      { text: '~', cls: 'cm-plan-marker' },
      { text: '{#login}', cls: 'cm-plan-anchor' },
      { text: '|', cls: 'cm-plan-separator' },
      { text: '4h', cls: 'cm-plan-duration' },
      { text: '|', cls: 'cm-plan-separator' },
      { text: 'owner', cls: 'cm-plan-name' },
      { text: '=', cls: 'cm-plan-name' },
      { text: '|', cls: 'cm-plan-separator' },
      { text: '"a ', cls: 'cm-plan-quoted' },
      { text: '\\"', cls: 'cm-plan-quoted cm-plan-escape' },
      { text: 'b', cls: 'cm-plan-quoted' },
      { text: '\\"', cls: 'cm-plan-quoted cm-plan-escape' },
      { text: ' | c"', cls: 'cm-plan-quoted' },
    ]);
  });

  it('colours a value by its column, named or positional, and not text columns', () => {
    expect(classOf('Auth | owner=bob | est=2d\n', 1, '2d')).toBe('cm-plan-duration');
    const plain = styled('Auth | 2d | alice | 4h later\n', 1).map((s) => s.text);
    expect(plain).not.toContain('alice');
    expect(plain).not.toContain('4h later');
    expect(plain).not.toContain('Auth');
  });

  it('uses the markers and comment of the document', () => {
    const text = '---\nprofile: plan\ncomment: #\nmarkers: done=~ | blocked=!\n---\n!Auth\n# note\n// not a comment\n';
    expect(classOf(text, 6, '!')).toBe('cm-plan-marker');
    expect(classOf(text, 7, '# note')).toBe('cm-plan-comment');
    expect(classOf(text, 8, '// not a comment')).toBeUndefined();
  });
});
