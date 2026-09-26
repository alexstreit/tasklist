// parseRows (DESIGN §3, §4): normalise → frontmatter → schema → rows.
import { readFrontmatter } from './frontmatter';
import { buildRow } from './rows';
import { resolveSchema } from './schema';
import { normalise, splitLines } from './text';
import { classifyBodyLine } from './tokenize';
import type { Line, ParseOptions, Row, RowsDocument, RowsError } from './types';

export function parseRows(input: string, options: ParseOptions = {}): RowsDocument {
  const text = normalise(input);
  const physical = splitLines(text);
  const errors: RowsError[] = [];
  const block = readFrontmatter(physical, errors);
  const schema = resolveSchema(block.frontmatter, options, errors);

  const lines: Line[] = [];
  const rows: Row[] = [];
  for (const [i, l] of physical.entries()) {
    const base = { line: l.line, from: l.from, to: l.to };
    if (i < block.kinds.length) {
      lines.push({ kind: block.kinds[i], ...base });
      continue;
    }
    const kind = classifyBodyLine(l.text, schema.comment);
    if (kind !== 'row') {
      lines.push({ kind, ...base });
      continue;
    }
    const row = buildRow(l, schema);
    rows.push(row);
    errors.push(...row.errors);
    lines.push({ kind, ...base, row });
  }

  return {
    text,
    endsWithNewline: text.endsWith('\n'),
    lines,
    frontmatter: block.frontmatter,
    schema,
    rows,
    roots: rows,
    errors,
    failed: options.mode === 'strict' && errors.some((e) => e.class !== 'validation'),
  };
}
