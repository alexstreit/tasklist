// The settings fixes (spec §4b.6.6): errors in the frontmatter, or in its absence, that change how
// the whole file reads. Every one is `confirm`, since it rewrites settings. Each is added to the
// diagnostic of the rows error it resolves. The conversion fix, which only adds to the settings, is
// in read.ts.

import { tokenizeLine } from 'rows';
import type { RowsDocument, RowsError, TextEdit } from 'rows';
import { confirm } from './fixes';
import type { Diagnostic } from './types';

const REMOVE_SETTING = new Set(['invalid-sep', 'invalid-comment', 'unsupported-format', 'unresolvable-profile', 'forbidden-profile-key', 'profile-has-errors']);
const REMOVE_OPTION = new Set(['malformed-type', 'unknown-type', 'invalid-option-value', 'duplicate-option']);
const RENAME = new Set(['duplicate-column-name', 'invalid-column-name']);
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** "Close settings": `---` after the last line from line 2 on that reads as a `key: value` entry. */
function closeFix(doc: RowsDocument) {
  const { text, lines, schema } = doc;
  let last = lines[0];
  for (const line of lines.slice(1)) {
    const { kind } = tokenizeLine(text.slice(line.from, line.to), { sep: schema.sep, comment: schema.comment, state: 'frontmatter' });
    if (kind === 'fm-entry') last = line;
    else if (kind !== 'fm-blank' && kind !== 'fm-comment') break;
  }
  return confirm(text, 'Close settings', [{ from: last.to, to: last.to, insert: '\n---' }]);
}

/** A column name nothing else uses: the name made valid, then numbered. */
function freeName(doc: RowsDocument, name: string): string {
  let base = name.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!NAME.test(base)) base = `c${base}`;
  const used = new Set(doc.schema.columns.map((c) => c.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function settingsFixes(doc: RowsDocument, diagnosticOf: (e: RowsError) => Diagnostic): void {
  const { text } = doc;
  const add = (e: RowsError, fix: ReturnType<typeof confirm>) => (diagnosticOf(e).fixes ??= []).push(fix);
  for (const e of doc.errors) {
    if (e.code === 'unclosed-frontmatter') {
      add(e, closeFix(doc));
      continue;
    }
    const entry = doc.frontmatter?.entries.find((x) => x.line === e.line);
    if (!entry || e.from === undefined || e.to === undefined) continue; // not written in this file
    if (REMOVE_SETTING.has(e.code)) {
      const line = doc.lines[e.line - 1];
      add(e, confirm(text, 'Remove this setting', [{ from: line.from, to: doc.lines[e.line].from, insert: '' }]));
    } else if (REMOVE_OPTION.has(e.code)) {
      // The type, or the option with the whitespace before it.
      let from = e.from;
      if (text[from] !== ':') while (from > entry.valueFrom && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
      add(e, confirm(text, 'Remove this option', [{ from, to: e.to, insert: '' }]));
    } else if (RENAME.has(e.code)) {
      const column = doc.schema.columns.find((c) => c.from === e.from);
      if (!column) continue;
      const span = { from: column.from!, to: column.from! + column.name.length };
      const value = freeName(doc, column.name);
      const edits: TextEdit[] = [{ ...span, insert: value }];
      add(e, confirm(text, 'Rename column…', edits, { input: { span, value } }));
    }
  }
}
