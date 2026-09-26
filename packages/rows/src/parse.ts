// parseRows (DESIGN §3, §4): normalise → frontmatter → schema → rows.
import { rowsError } from './errors';
import { readFrontmatter } from './frontmatter';
import { buildRow } from './rows';
import { resolveSchema } from './schema';
import { normalise, splitLines } from './text';
import { classifyBodyLine } from './tokenize';
import type { Line, ParseOptions, Row, RowsDocument, RowsError, Schema } from './types';

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

  errors.push(...uniqueness(schema, rows));

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

/**
 * base §4 `unique`: no two rows share a non-null value. Values compare as their text, and every
 * row involved gets an error (base §6).
 */
function uniqueness(schema: Schema, rows: Row[]): RowsError[] {
  const errors: RowsError[] = [];
  for (const column of schema.columns.filter((c) => c.unique)) {
    const byText = new Map<string, Row[]>();
    for (const row of rows) {
      const text = row.cells[column.index]?.text;
      if (text === null || text === undefined) continue;
      byText.set(text, [...(byText.get(text) ?? []), row]);
    }
    for (const [text, shared] of byText) {
      if (shared.length < 2) continue;
      for (const row of shared) {
        const cell = row.cells[column.index]!;
        const error = rowsError('not-unique', row.line, `${column.name} ${JSON.stringify(text)} is used by ${shared.length} rows.`, cell.valueFrom, cell.valueTo);
        row.errors.push(error);
        errors.push(error);
      }
    }
  }
  return errors;
}
