// Resolved keys and columns (base §2.2, §2.3, §4) with their recovery rows in base §6.
import { parseDeclaration, splitDeclarations, type Piece } from './declarations';
import { rowsError } from './errors';
import { readFrontmatter } from './frontmatter';
import { isWs, NAME, normalise, splitLines } from './text';
import type { Column, Frontmatter, FrontmatterEntry, ParseOptions, RowsError, Schema } from './types';

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
      profileHasErrors = profileErrors.length > 0;
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
      type: d.type,
      options: d.options,
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
    if (options.extensions === false && /^ref(\[.*\])?$/.test(column.type)) column.type = 'text'; // base §9
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
  if (lead) {
    const piece = { text: lead.value, from: 0, to: lead.value.length };
    declare(lead.value, lead, piece);
  } else {
    declare(DEFAULT_LEAD, null);
  }
  const declared = keys.get('columns');
  if (declared) for (const piece of splitDeclarations(declared.value, sep)) declare(piece.text, declared, piece);

  if (profileHasErrors) {
    errors.push(rowsError('profile-has-errors', profileLine, `Profile ${profileName} has errors in its frontmatter.`, ...profileSpan));
  }

  const table = fileEntry('table')?.value ?? (options.filename !== undefined ? stem(options.filename) : null);
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
