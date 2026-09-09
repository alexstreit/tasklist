// Column declarations from front matter. Spec §2.5–2.6.

import type { Column, ColumnType, Diagnostic, FrontMatterEntry } from './types';

export const DEFAULT_COLUMNS: readonly Column[] = [
  { name: 'est', type: 'duration' },
  { name: 'owner', type: 'text' },
  { name: 'notes', type: 'text' },
];

const KNOWN_TYPES: readonly string[] = ['duration', 'number', 'text'];

export interface ParsedColumns {
  columns: Column[];
  diagnostics: Diagnostic[];
}

export function parseColumns(frontMatter: FrontMatterEntry[] | null): ParsedColumns {
  const entry = frontMatter?.find((e) => e.key === 'columns');
  if (!entry || entry.value.trim() === '') {
    return { columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), diagnostics: [] };
  }

  const columns: Column[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const segment of entry.value.split('|')) {
    const segStart = offset;
    offset += segment.length + 1;
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    const colon = trimmed.indexOf(':');
    const name = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
    const rawType = colon === -1 ? '' : trimmed.slice(colon + 1).trim();
    const from = entry.valueSpan.from + segStart + leadingSpaces(segment);
    const span = { from, to: from + trimmed.length };
    let type: ColumnType;
    if (KNOWN_TYPES.includes(rawType)) {
      type = rawType as ColumnType;
    } else {
      type = 'text';
      diagnostics.push({
        line: entry.line,
        span,
        severity: 'warning',
        message: `unknown column type "${rawType}"; treated as text`,
      });
    }
    if (seen.has(name)) {
      diagnostics.push({
        line: entry.line,
        span,
        severity: 'warning',
        message: `duplicate column name "${name}"`,
      });
    }
    seen.add(name);
    columns.push({ name, type });
  }
  return { columns, diagnostics };
}

function leadingSpaces(s: string): number {
  return s.length - s.trimStart().length;
}
