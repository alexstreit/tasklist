// Resolved keys and columns (base §2.2, §2.3, §4) with their recovery rows in base §6.
import { parseDeclaration, splitDeclarations, type Piece } from './declarations';
import { rowsError } from './errors';
import { readFrontmatter } from './frontmatter';
import { isWs, NAME, normalise, splitLines } from './text';
import type { Column, Frontmatter, FrontmatterEntry, ParseOptions, RowsError, Schema } from './types';
import { parseType, positiveNumber, readValue } from './values';

const DEFAULT_SEP = '|';
const DEFAULT_COMMENT = '//';
const DEFAULT_LEAD = 'name:text';
const FORBIDDEN_IN_PROFILE = new Set(['format', 'table', 'profile', 'sep', 'comment', 'include']);

/** Where a key's value came from: an entry in this file, or the profile. */
type Source = { entry: FrontmatterEntry } | { profile: true };
interface Key {
  value: string;
  source: Source;
}

function stem(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

const isPath = (profile: string) => profile.includes('/') || profile.endsWith('.rows');

function validSep(s: string): boolean {
  return [...s].length === 1 && !isWs(s) && !['"', '\\', '='].includes(s);
}

/** Keys set in `entries`, last value winning; each repeat is reported where it is repeated. */
function collectKeys(entries: FrontmatterEntry[], errors: RowsError[]): Map<string, FrontmatterEntry> {
  const keys = new Map<string, FrontmatterEntry>();
  for (const e of entries) {
    if (keys.has(e.key)) errors.push(rowsError('duplicate-key', e.line, `Key ${e.key} set twice; the last value is used.`, e.keyFrom, e.keyTo));
    keys.set(e.key, e);
  }
  return keys;
}

type Report = (code: 'malformed-type' | 'unknown-type' | 'invalid-option-value' | 'duplicate-option' | 'invalid-enum-value', message: string) => void;

// The base options (§4): whether each is a flag, and the column kinds it applies to (null = any).
const OPTIONS: Record<string, { flag: boolean; kinds: string[] | null }> = {
  required: { flag: true, kinds: null },
  unique: { flag: true, kinds: null },
  default: { flag: false, kinds: null },
  unit: { flag: false, kinds: ['number', 'duration'] },
  hpd: { flag: false, kinds: ['duration'] },
  dpw: { flag: false, kinds: ['duration'] },
};

/** base §4 options and §5 types, with their recovery rows in base §6. */
function readTypeAndOptions(column: Column, declared: string, extensions: boolean, report: Report): void {
  const type = parseType(declared, extensions);
  if (type.ok) {
    column.type = type.type;
    column.kind = type.kind;
    if (type.enumValues) column.enumValues = type.enumValues;
    for (const problem of type.ignored ?? []) report('invalid-enum-value', `An ${problem} enum value in ${declared}; ignored.`);
  } else if (type.problem === 'malformed') {
    report('malformed-type', `Malformed type ${declared}; the column is read as text.`);
  } else {
    report('unknown-type', `Unknown type ${declared}; the column is read as text.`);
  }

  const invalid = (option: string, why: string) => report('invalid-option-value', `Invalid option ${option}: ${why}; ignored.`);
  let defaultText: string | null = null;
  const seen = new Set<string>();
  for (const { key, value } of column.options) {
    const known = OPTIONS[key];
    if (!known) continue; // unrecognised: ignored and retained (base §4)
    const option = value === null ? key : `${key}=${value}`;
    // A repeated option is an error, and the last one is used.
    if (seen.has(key)) report('duplicate-option', `Option ${key} is repeated; the last one is used.`);
    seen.add(key);
    if (known.kinds && !known.kinds.includes(column.kind)) {
      invalid(option, `${key} doesn't apply to ${column.type}`);
    } else if (known.flag && value !== null) {
      invalid(option, `${key} is a flag and takes no value`);
    } else if (!known.flag && value === null) {
      invalid(option, `${key} needs a value`);
    } else if (key === 'required' || key === 'unique') {
      column[key] = true;
    } else if (key === 'default') {
      defaultText = value;
    } else if (key === 'unit') {
      if (column.kind === 'duration' && !['m', 'h', 'd', 'w'].includes(value!)) invalid(option, 'a duration unit is m, h, d or w');
      else column.unit = value!;
    } else {
      const n = positiveNumber(value);
      if (n === null) invalid(option, 'it must be a positive number');
      else column[key as 'hpd' | 'dpw'] = n;
    }
  }
  if (defaultText !== null) {
    const value = readValue(defaultText, column);
    if (value === null) invalid(`default=${defaultText}`, `it doesn't match the type ${column.type}`);
    else column.default = value;
  }
}

export function resolveSchema(fm: Frontmatter | null, options: ParseOptions, errors: RowsError[]): Schema {
  const fileKeys = collectKeys(fm?.entries ?? [], errors);
  const keys = new Map<string, Key>();

  // ---- profile (base §2.3) ----
  const profileEntry = fileKeys.get('profile');
  const profileName = profileEntry?.value ?? options.defaultProfile;
  // A default profile has no line in the file; its errors go on line 1.
  const profileLine = profileEntry?.line ?? 1;
  const profileSpan = profileEntry ? ([profileEntry.valueFrom, profileEntry.valueTo] as const) : ([] as const);
  let profileHasErrors = false;
  if (profileName !== undefined) {
    const text = isPath(profileName) ? options.resolveProfile?.(profileName) : options.profiles?.[profileName];
    if (text === undefined) {
      errors.push(rowsError('unresolvable-profile', profileLine, `Profile ${profileName} cannot be resolved; the file is read without it.`, ...profileSpan));
    } else {
      const profileErrors: RowsError[] = [];
      const block = readFrontmatter(splitLines(normalise(text)), profileErrors);
      for (const [key, entry] of collectKeys(block.frontmatter?.entries ?? [], profileErrors)) {
        if (FORBIDDEN_IN_PROFILE.has(key)) {
          errors.push(rowsError('forbidden-profile-key', profileLine, `Profile ${profileName} sets ${key}, which a profile may not set; ignored.`, ...profileSpan));
        } else {
          keys.set(key, { value: entry.value, source: { profile: true } });
        }
      }
      // A profile with no frontmatter, or an unclosed one, supplies nothing and is an error (base §2.3).
      profileHasErrors = profileErrors.length > 0 || block.frontmatter === null;
    }
  }
  for (const [key, entry] of fileKeys) keys.set(key, { value: entry.value, source: { entry } });

  const fileEntry = (key: string) => fileKeys.get(key);
  const report = (key: Key, code: Parameters<typeof rowsError>[0], message: string, span?: { from: number; to: number }) => {
    if ('profile' in key.source) profileHasErrors = true;
    else {
      const e = key.source.entry;
      errors.push(rowsError(code, e.line, message, span?.from ?? e.valueFrom, span?.to ?? e.valueTo));
    }
  };

  // ---- format ----
  const format = fileEntry('format');
  if (format && format.value !== 'rows/1') {
    errors.push(rowsError('unsupported-format', format.line, `Unsupported format ${format.value}; read as rows/1.`, format.valueFrom, format.valueTo));
  }

  // ---- sep and comment, in that order (base §2.2) ----
  let sep = DEFAULT_SEP;
  let comment = DEFAULT_COMMENT;
  const sepEntry = fileEntry('sep');
  const commentEntry = fileEntry('comment');
  const invalidSep = (e: FrontmatterEntry, why: string) =>
    errors.push(rowsError('invalid-sep', e.line, `Invalid sep: ${why}; | is used.`, e.valueFrom, e.valueTo));
  const invalidComment = (e: FrontmatterEntry, why: string) =>
    errors.push(rowsError('invalid-comment', e.line, `Invalid comment: ${why}; // is used.`, e.valueFrom, e.valueTo));
  if (sepEntry) {
    if (validSep(sepEntry.value)) sep = sepEntry.value;
    else invalidSep(sepEntry, 'it must be one character, not whitespace, ", \\ or =');
  }
  if (commentEntry) {
    if (commentEntry.value !== '') comment = commentEntry.value;
    else invalidComment(commentEntry, 'it must not be empty');
  }
  if (sepEntry && sep === sepEntry.value && comment.includes(sep)) {
    invalidSep(sepEntry, `the comment marker ${comment} contains it`);
    sep = DEFAULT_SEP;
  }
  if (commentEntry && comment.includes(sep)) {
    invalidComment(commentEntry, `it contains the delimiter ${sep}`);
    comment = DEFAULT_COMMENT;
  }

  // ---- columns (base §4) ----
  const columns: Column[] = [];
  const declare = (text: string, key: Key | null, piece?: Piece) => {
    const d = parseDeclaration(text);
    const column: Column = {
      index: columns.length,
      name: d.name,
      type: 'text',
      kind: 'text',
      options: d.options,
      required: columns.length === 0, // the lead column is always required (base §4)
      unique: false,
      default: null,
      settable: columns.length > 0,
      implicit: false,
    };
    // Spans exist only for a declaration written unquoted in this file.
    let span: { from: number; to: number } | undefined;
    if (key && 'entry' in key.source && !key.source.entry.quoted && piece) {
      span = { from: key.source.entry.valueFrom + piece.from, to: key.source.entry.valueFrom + piece.to };
      column.from = span.from;
      column.to = span.to;
    }
    if (key) readTypeAndOptions(column, d.type, options.extensions !== false, (code, message) => report(key, code, message, span));
    if (!NAME.test(d.name)) {
      column.settable = false;
      if (key) report(key, 'invalid-column-name', `Column name "${d.name}" is not valid; the column cannot be set by name.`, span);
    } else if (columns.some((c) => c.name === d.name)) {
      column.settable = false;
      if (key) report(key, 'duplicate-column-name', `Column name ${d.name} is already used; this column cannot be set by name.`, span);
    }
    columns.push(column);
  };

  const lead = keys.get('lead');
  if (lead && lead.value !== '') {
    const piece = { text: lead.value, from: 0, to: lead.value.length };
    declare(lead.value, lead, piece);
  } else {
    // A key with a default set to an empty value: the default applies (base §6).
    if (lead) report(lead, 'empty-value', `lead is empty; ${DEFAULT_LEAD} is used.`);
    declare(DEFAULT_LEAD, null);
  }
  const declared = keys.get('columns');
  if (declared) for (const piece of splitDeclarations(declared.value, sep)) declare(piece.text, declared, piece);

  if (profileHasErrors) {
    errors.push(rowsError('profile-has-errors', profileLine, `Profile ${profileName} has errors in its frontmatter.`, ...profileSpan));
  }

  const tableEntry = fileEntry('table');
  const defaultTable = options.filename !== undefined ? stem(options.filename) : null;
  if (tableEntry?.value === '') {
    errors.push(rowsError('empty-value', tableEntry.line, 'table is empty; the file name is used.', tableEntry.valueFrom, tableEntry.valueTo));
  }
  const table = tableEntry && tableEntry.value !== '' ? tableEntry.value : defaultTable;
  return {
    table,
    format: 'rows/1',
    sep,
    comment,
    keys: Object.fromEntries([...keys].map(([k, v]) => [k, v.value])),
    lead: columns[0],
    columns,
  };
}
