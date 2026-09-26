// Task 17's properties, over generated files and every conformance input:
// lines reproduce the text, value spans decode to the cell text, strict mode never throws,
// and tokenizeLine agrees with parseRows on every token boundary.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRows, tokenizeLine, type Cell, type LineState, type ParseOptions, type RowsDocument, type Token } from '../src/index';
import { generatedFiles } from './generators';

// ---------- inputs ----------

const generated = generatedFiles();

const conformance = fileURLToPath(new URL('../conformance/', import.meta.url));
const conformanceInputs = readdirSync(conformance, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => {
    const dir = join(conformance, e.name);
    const raw = existsSync(join(dir, 'options.json')) ? JSON.parse(readFileSync(join(dir, 'options.json'), 'utf8')) : {};
    const { profileFiles, ...options } = raw;
    return {
      text: readFileSync(join(dir, 'input.rows'), 'utf8'),
      options: { ...options, resolveProfile: (path: string) => profileFiles?.[path] } as ParseOptions,
    };
  });

const inputs = [...conformanceInputs, ...generated];

// ---------- checks ----------

/** An independent decoder for a value span (base §3, §6). */
function decode(slice: string): string | null {
  if (slice === '') return null;
  if (!slice.startsWith('"')) return slice;
  const escapes: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };
  let out = '';
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i];
    if (c === '"') return out + slice.slice(i + 1);
    if (c === '\\' && i + 1 < slice.length) {
      out += escapes[slice[i + 1]] ?? c + slice[i + 1];
      i++;
    } else out += c;
  }
  return out;
}

const allCells = (doc: RowsDocument): Cell[] => doc.rows.flatMap((r) => [...r.cells.filter((c): c is Cell => c !== null), ...r.overflow]);

describe('parseRows properties', () => {
  it(`runs over ${inputs.length} inputs`, () => {
    expect(conformanceInputs.length).toBeGreaterThan(100);
  });

  it('every line, joined with newlines, reproduces the text', () => {
    for (const { text, options } of inputs) {
      const doc = parseRows(text, options);
      const joined = doc.lines.map((l) => doc.text.slice(l.from, l.to)).join('\n') + (doc.endsWithNewline ? '\n' : '');
      expect(joined).toBe(doc.text);
      doc.lines.forEach((l, i) => expect(l.line).toBe(i + 1));
    }
  });

  it("every cell's value span decodes to its text", () => {
    for (const { text, options } of inputs) {
      const doc = parseRows(text, options);
      for (const cell of allCells(doc)) {
        expect(decode(doc.text.slice(cell.valueFrom, cell.valueTo)), JSON.stringify(text)).toBe(cell.text);
        expect(cell.from <= cell.valueFrom && cell.valueFrom <= cell.valueTo && cell.valueTo <= cell.to).toBe(true);
      }
    }
  });

  it('puts the lead in cells[0] (DESIGN §4)', () => {
    for (const { text, options } of inputs) {
      for (const row of parseRows(text, options).rows) expect(row.cells[0]).toBe(row.lead);
    }
  });

  it('strict mode never throws, and fails exactly on syntax and structural errors', () => {
    for (const { text, options } of inputs) {
      const doc = parseRows(text, { ...options, mode: 'strict' });
      expect(doc.failed).toBe(doc.errors.some((e) => e.class !== 'validation'));
      expect(parseRows(text, { ...options, mode: 'tolerant' }).failed).toBe(false);
    }
  });
});

describe('tokenizeLine agrees with parseRows', () => {
  const span = (t: { from: number; to: number }) => [t.from, t.to];
  // The context a highlighter builds from the latest parsed document.
  const contextOf = (doc: RowsDocument, options: ParseOptions) => ({
    sep: doc.schema.sep,
    comment: doc.schema.comment,
    markers: new Map(doc.schema.markers.map((m) => [m.char, m.name])),
    extensions: options.extensions,
  });

  it('on every line kind', () => {
    for (const { text, options } of inputs) {
      const doc = parseRows(text, options);
      if (doc.errors.some((e) => e.code === 'unclosed-frontmatter')) continue; // a highlighter can't know (tokenize.ts)
      let state: LineState = 'start';
      for (const l of doc.lines) {
        const t = tokenizeLine(doc.text.slice(l.from, l.to), { ...contextOf(doc, options), state });
        expect(t.kind, JSON.stringify(text)).toBe(l.kind);
        state = t.next;
      }
    }
  });

  it('on every token boundary in every row', () => {
    for (const { text, options } of inputs) {
      const doc = parseRows(text, options);
      for (const row of doc.rows) {
        const tokens = tokenizeLine(doc.text.slice(row.from, row.to), contextOf(doc, options)).tokens.map(
          (t): Token => ({ ...t, from: t.from + row.from, to: t.to + row.from }),
        );
        const indent = tokens.find((t) => t.type === 'indent');
        expect(indent ? span(indent) : [row.indent.from, row.indent.from]).toEqual(span(row.indent));

        // Tokens between delimiters, one group per cell; empty cells have no tokens.
        const groups: Token[][] = [[]];
        for (const t of tokens) {
          if (t.type === 'delimiter') groups.push([]);
          else if (t.type !== 'indent') groups[groups.length - 1].push(t);
        }
        const [leadGroup, ...cellGroups] = groups;
        expect(leadGroup.filter((t) => t.type === 'marker').map(span)).toEqual(row.markers.map(span));
        const anchorTokens = leadGroup.filter((t) => t.type === 'anchor');
        for (const a of row.anchors) expect(anchorTokens.some((t) => t.from <= a.from && a.to <= t.to)).toBe(true);
        expect(anchorTokens.length > 0).toBe(row.anchors.length > 0);
        const leadToken = leadGroup.find((t) => t.type === 'lead');
        expect(leadToken ? span(leadToken) : [row.lead.valueFrom, row.lead.valueFrom]).toEqual([row.lead.valueFrom, row.lead.valueTo]);

        const cells = [...row.cells.slice(1).filter((c): c is Cell => c !== null), ...row.overflow]
          .filter((c) => c.to > c.from)
          .sort((a, b) => a.from - b.from);
        const nonEmpty = cellGroups.filter((g) => g.length > 0);
        expect(nonEmpty.length, JSON.stringify(text)).toBe(cells.length);
        cells.forEach((cell, i) => {
          const g = nonEmpty[i];
          expect([g[0].from, g[g.length - 1].to]).toEqual([cell.from, cell.to]);
          const name = g.find((t) => t.type === 'name');
          const value = g.find((t) => t.type === 'value');
          if (cell.name) expect(name && span(name)).toEqual(span(cell.name));
          // A named cell read as unnamed (invalid-cell-name) keeps the tokenizer's name token.
          if (cell.name || !name) {
            expect(value ? span(value) : [cell.valueFrom, cell.valueFrom]).toEqual([cell.valueFrom, cell.valueTo]);
            expect(value?.quoted ?? false).toBe(cell.quoted);
          }
        });
      }
    }
  });
});
