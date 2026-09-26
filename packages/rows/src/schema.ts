// Resolved keys and columns (base §2.2, §2.3, §4) with their recovery rows in base §6.
import { parseDeclaration, splitDeclarations, type Piece } from './declarations';
import { rowsError } from './errors';
import { readFrontmatter } from './frontmatter';
import { isWs, NAME, normalise, splitLines } from './text';
import type { ExtensionContext } from './tokenize';
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
// The ref options (ext §4.3), known only when the extensions are on.
const EXTENSION_OPTIONS: typeof OPTIONS = {
  many: { flag: true, kinds: ['ref'] },
  qualifier: { flag: false, kinds: ['ref'] },
};

/** A column that only carries a type, for validating qualifiers. */
function typedColumn(name: string, type: string, kind: Column['kind'], enumValues?: string[]): Column {
  const column: Column = { index: -1, name, type, kind, options: [], required: false, unique: false, default: null, settable: false, implicit: true };
  if (enumValues) column.enumValues = enumValues;
  return column;
}

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
  const knownOptions = extensions ? { ...OPTIONS, ...EXTENSION_OPTIONS } : OPTIONS;
  for (const { key, value } of column.options) {
    const known = knownOptions[key];
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
    } else if ((key === 'many' || key === 'qualifier') && column.index === 0) {
      invalid(option, 'a lead ref column cannot use many or qualifier');
    } else if (key === 'many') {
      column.many = true;
    } else if (key === 'qualifier') {
      // Written like a declaration (base §4): NAME[:TYPE], the type defaulting to text.
      const colon = value!.indexOf(':');
      const name = colon === -1 ? value! : value!.slice(0, colon);
      const typeText = colon === -1 ? 'text' : value!.slice(colon + 1);
      const type = parseType(typeText, true);
      if (!NAME.test(name)) invalid(option, `the qualifier name "${name}" is not valid`);
      else if (type.ok && type.kind === 'ref') invalid(option, 'a qualifier cannot be a ref'); // Q41
      else if (type.ok) {
        for (const problem of type.ignored ?? []) report('invalid-enum-value', `An ${problem} enum value in ${typeText}; ignored.`);
        column.qualifier = { name, column: typedColumn(name, type.type, type.kind, type.enumValues) };
      } else {
        report(type.problem === 'malformed' ? 'malformed-type' : 'unknown-type', `${type.problem === 'malformed' ? 'Malformed' : 'Unknown'} qualifier type ${typeText}; read as text.`);
        column.qualifier = { name, column: typedColumn(name, 'text', 'text') };
      }
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

/**
 * `anyAnchors` reports whether any body row has an anchor, scanning with the resolved delimiter,
 * comment marker and markers; identity depends on it (ext §3.1).
 */
export function resolveSchema(
  fm: Frontmatter | null,
  options: ParseOptions,
  errors: RowsError[],
  anyAnchors: (sep: string, comment: string, ext: ExtensionContext) => boolean = () => false,
): Schema {
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
  const declaredBy = new Map<Column, Key>();
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
    if (key) declaredBy.set(column, key);
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

  const tableEntry = fileEntry('table');
  const defaultTable = options.filename !== undefined ? stem(options.filename) : null;
  if (tableEntry?.value === '') {
    errors.push(rowsError('empty-value', tableEntry.line, 'table is empty; the file name is used.', tableEntry.valueFrom, tableEntry.valueTo));
  }
  const table = tableEntry && tableEntry.value !== '' ? tableEntry.value : defaultTable;

  const schema: Schema = {
    table,
    format: 'rows/1',
    sep,
    comment,
    keys: Object.fromEntries([...keys].map(([k, v]) => [k, v.value])),
    lead: columns[0],
    columns,
    identity: false,
    key: null,
    nest: null,
    markers: [],
    order: 'position',
    includes: [],
  };
  if (options.extensions !== false) readExtensionKeys(schema, keys, declaredBy, report, anyAnchors);

  if (profileHasErrors) {
    errors.push(rowsError('profile-has-errors', profileLine, `Profile ${profileName} has errors in its frontmatter.`, ...profileSpan));
  }
  return schema;
}

type KeyReport = (key: Key, code: Parameters<typeof rowsError>[0], message: string, span?: { from: number; to: number }) => void;

/** A piece of a key's value, as a span in the file when the value is written unquoted there. */
function spanOf(key: Key, piece: Piece): { from: number; to: number } | undefined {
  if (!('entry' in key.source) || key.source.entry.quoted) return undefined;
  return { from: key.source.entry.valueFrom + piece.from, to: key.source.entry.valueFrom + piece.to };
}

/** The extension keys (ext §3–§7) and the implicit columns (ext §2). */
function readExtensionKeys(
  schema: Schema,
  keys: Map<string, Key>,
  declaredBy: Map<Column, Key>,
  report: KeyReport,
  anyAnchors: (sep: string, comment: string, ext: ExtensionContext) => boolean,
): void {
  const { columns, sep, comment, table } = schema;
  const byName = (name: string) => columns.find((c) => c.name === name);

  // include (ext §4.1). v1 reads no include (DESIGN §1): each one is unreadable, known by its alias or stem.
  const include = keys.get('include');
  if (include) {
    const seen = new Set<string>();
    for (const piece of splitDeclarations(include.value, sep)) {
      const m = /^(.*?)[ \t]+as[ \t]+(\S+)$/.exec(piece.text);
      const path = m ? m[1] : piece.text;
      const name = m ? m[2] : stem(path);
      const span = spanOf(include, piece);
      report(include, 'unresolvable-include', `Include ${path} cannot be read; references into ${name} are errors.`, span);
      if (name === table || seen.has(name)) {
        report(include, 'duplicate-table-name', `Table name ${name} is ${name === table ? "this file's own" : 'already used'}.`, span);
      }
      seen.add(name);
      schema.includes.push({ path, table: name });
    }
  }

  // ref targets (ext §4.2)
  for (const column of columns.filter((c) => c.kind === 'ref')) {
    const target = /^ref\[(.*)\]$/.exec(column.type)?.[1] ?? null;
    column.refCurrent = target === null || target === table;
    column.refTable = target ?? table;
    column.refKnown = column.refCurrent || schema.includes.some((i) => i.table === target);
    if (!column.refKnown) {
      const key = declaredBy.get(column);
      if (key) report(key, 'unknown-table', `${column.type} names no table; its references are errors.`);
    }
  }

  // markers (ext §5). A repeated name or character is an invalid entry, as a repeated enum value is (base §5).
  const markersKey = keys.get('markers');
  const pending: { name: string; char: string; column: Column | undefined }[] = [];
  if (markersKey) {
    for (const entry of markersKey.value.split(/[ \t]+/).filter((e) => e !== '')) {
      const m = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/.exec(entry);
      const char = m?.[2] ?? '';
      const bad =
        !m ||
        [...char].length !== 1 ||
        /[\p{L}\p{N}]/u.test(char) ||
        isWs(char) ||
        '"#{\\='.includes(char) ||
        char === sep ||
        char === comment[0] ||
        pending.some((p) => p.name === m[1] || p.char === char);
      if (bad) {
        report(markersKey, 'invalid-marker', `Invalid marker entry ${entry}; ignored.`);
        continue;
      }
      const declared = byName(m[1]);
      if (declared && declared.kind !== 'bool') {
        report(markersKey, 'marker-column-not-bool', `Marker column ${m[1]} is not bool; the marker is ignored.`);
        continue;
      }
      pending.push({ name: m[1], char, column: declared });
    }
  }

  // key (ext §3.1); an empty key or order is an error and its default applies, as for base keys (base §6).
  const keyKey = keys.get('key');
  if (keyKey?.value === '') report(keyKey, 'empty-value', 'key is empty; id is used.');
  const orderKey = keys.get('order');
  if (orderKey?.value === '') report(orderKey, 'empty-value', 'order is empty; position is used.');
  const nestKey = keys.get('nest');
  const nestName = nestKey && nestKey.value !== '' ? nestKey.value : null;

  schema.identity = keyKey !== undefined || anyAnchors(sep, comment, { markers: new Map(pending.map((p) => [p.char, p.name])) });

  // Implicit columns follow the declared ones, in the order key, nest, markers (ext §2).
  const implicit = (name: string, key: Key | undefined, type: string, kind: Column['kind'], extra: Partial<Column> = {}): Column => {
    const column: Column = { index: columns.length, name, type, kind, options: [], required: false, unique: false, default: null, settable: NAME.test(name), implicit: true, ...extra };
    if (!column.settable && key) report(key, 'invalid-column-name', `Column name "${name}" is not valid; the column cannot be set by name.`);
    columns.push(column);
    return column;
  };
  if (schema.identity) {
    const name = keyKey?.value || 'id';
    schema.key = byName(name) ?? implicit(name, keyKey, 'text', 'text');
  }
  if (nestName) {
    const column = byName(nestName) ?? implicit(nestName, nestKey, 'ref', 'ref', { refTable: table, refCurrent: true, refKnown: true });
    const valid = column.kind === 'ref' && column.refCurrent === true && column.options.length === 0;
    if (!valid) report(nestKey!, 'invalid-nest-column', `Nest column ${nestName} must be a ref to this table, without options; indentation still nests.`);
    schema.nest = { column, valid };
  }
  for (const p of pending) {
    const column = p.column ?? implicit(p.name, markersKey, 'bool', 'bool', { default: { type: 'bool', value: false } });
    schema.markers.push({ name: p.name, char: p.char, column });
  }

  // order (ext §7)
  if (orderKey && orderKey.value !== '') {
    const v = orderKey.value;
    if (v === 'position' || v === 'none') schema.order = v;
    else {
      const descending = v.startsWith('-');
      const column = byName(descending ? v.slice(1) : v);
      if (column) schema.order = { column, descending };
      else report(orderKey, 'unknown-order-column', `order names no column ${v}; read as position.`);
    }
  }
}
