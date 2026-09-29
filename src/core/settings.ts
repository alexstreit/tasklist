// The settings fixes (spec §4b.6.6): errors in the frontmatter, or in its absence, that change how
// the whole file reads. They are `confirm`, since they rewrite settings, except the fixes for an
// unknown type, which leave the values read as they are or as the type the user evidently meant.
// Each is added to the diagnostic of the rows error it resolves. The conversion fix, which only
// adds to the settings, is in read.ts.

import { NAME, tokenizeLine, TYPE_NAMES } from 'rows';
import type { RowsDocument, RowsError, TextEdit } from 'rows';
import { confirm } from './fixes';
import type { Diagnostic, Fix } from './types';

const REMOVE_SETTING = new Set(['invalid-sep', 'invalid-comment', 'unsupported-format', 'unresolvable-profile', 'forbidden-profile-key', 'profile-has-errors']);
const REMOVE_OPTION = new Set(['malformed-type', 'invalid-option-value', 'duplicate-option']);
const RENAME = new Set(['duplicate-column-name', 'invalid-column-name']);
/** Types an unknown one may be a typo of. `enum` needs its values, so it is never suggested. */
const TYPES = TYPE_NAMES.filter((t) => t !== 'enum');

/** Levenshtein distance. */
function distance(a: string, b: string): number {
  let row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

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

/** Each fix is also added to `made`, since what a settings fix does depends on the whole file, and readPlan checks it. */
export function settingsFixes(doc: RowsDocument, diagnosticOf: (e: RowsError) => Diagnostic, made: Set<Fix>): void {
  const { text } = doc;
  const add = (e: RowsError, fix: Fix) => {
    made.add(fix);
    (diagnosticOf(e).fixes ??= []).push(fix);
  };
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
    } else if (e.code === 'unknown-type') {
      // "Change type to date" for a near miss, then "Remove the type", which leaves the text column it is read as.
      const typed = text.slice(e.from + 1, e.to);
      const near = TYPES.map((t) => ({ t, d: distance(typed.toLowerCase(), t) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d)[0];
      if (near) add(e, { label: `Change type to ${near.t}`, tier: 'click', edits: [{ from: e.from + 1, to: e.to, insert: near.t }] });
      add(e, { label: 'Remove the type', tier: 'click', edits: [{ from: e.from, to: e.to, insert: '' }] });
    } else if (e.code === 'marker-column-not-bool') {
      // A marker's column declared in this file with another type: "Make done a checkbox column".
      const markers = doc.schema.keys.markers ?? '';
      const column = doc.schema.columns.find(
        (c) => c.typeFrom !== undefined && c.kind !== 'bool' && !c.implicit && markers.split(/[ \t]+/).some((m) => m.startsWith(`${c.name}=`)) && (c.from === e.from || entry.key === 'markers'),
      );
      if (!column) continue;
      add(e, confirm(text, `Make ${column.name} a checkbox column`, [{ from: column.typeFrom!, to: column.typeTo!, insert: ':bool' }]));
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
