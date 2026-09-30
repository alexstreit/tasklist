// bindVocabulary (PLUGINS.md §6): the file's roles, keys and markers, after profile and file
// merge, checked against the core vocabulary and the registered plugins. Spec §2.9.

import { KNOWN_KEYS, readValue, tokenizeLine } from 'rows';
import type { RowsDocument } from 'rows';
import type { Diagnostic } from './types';
import { CORE_KEYS, CORE_MARKERS, CORE_ROLES, pluginOf } from './vocabulary';

export interface Bindings {
  /** Role name → the name of the column it is bound to. A core role on a column of the wrong type is not here. */
  roles: ReadonlyMap<string, string>;
  /** Core roles left unbound because their column has the wrong type, with the reason in plain words. */
  mistyped: ReadonlyMap<string, string>;
  /** Core and qualified key → its value. A core key whose value doesn't read as its type is not here. */
  keys: ReadonlyMap<string, string>;
  /** The marker names the file uses. */
  markers: ReadonlySet<string>;
}

/** rows base and extension keys (spec §2.9); like `x-` keys, they are never reported. */
const ROWS_KEYS = new Set<string>(KNOWN_KEYS);

const article = (types: readonly string[]) => `a ${types.join(' or ')}`;

/**
 * Binds the vocabulary and reports, on the line that binds the name: a bare name outside the
 * vocabulary (info), a qualified name whose plugin isn't registered (info), a role written in this
 * file on a column of the wrong type (warning), and a core key whose value isn't its type (warning).
 * A profile's role on a file column of the wrong type is left unbound with no diagnostic, as rows
 * drops a profile's role whose column the file replaced (rows Q43).
 */
export function bindVocabulary(doc: RowsDocument, plugins: ReadonlySet<string>): { bindings: Bindings; diagnostics: Diagnostic[] } {
  const { schema, text } = doc;
  const diagnostics: Diagnostic[] = [];
  const entries = doc.frontmatter?.entries ?? [];
  const entryOf = (key: string) => entries.find((e) => e.key === key);

  /** An info for a bare name outside `core`, or a qualified one whose plugin isn't registered; false when it is neither. */
  const unknown = (name: string, core: readonly string[], code: string, what: string, at: Pick<Diagnostic, 'line' | 'span'>): boolean => {
    const plugin = pluginOf(name);
    if (plugin === null && !core.includes(name)) {
      diagnostics.push({ ...at, severity: 'info', code, message: `unknown ${what} "${name}"` });
      return true;
    }
    if (plugin !== null && !plugins.has(plugin)) {
      diagnostics.push({ ...at, severity: 'info', code: 'missing-plugin', message: `${what} "${name}" needs the ${plugin} plugin` });
      return true;
    }
    return false;
  };

  const keys = new Map<string, string>();
  for (const entry of entries) {
    if (ROWS_KEYS.has(entry.key) || entry.key.startsWith('x-')) continue;
    const at = { line: entry.line, span: { from: entry.keyFrom, to: entry.keyTo } };
    unknown(entry.key, Object.keys(CORE_KEYS), 'unknown-key', 'frontmatter key', at);
  }
  for (const [key, value] of Object.entries(schema.keys)) {
    const type = CORE_KEYS[key];
    const plugin = pluginOf(key);
    if (type === undefined && (plugin === null || !plugins.has(plugin))) continue;
    if (type !== undefined && !readValue(value, { kind: type })) {
      const entry = entryOf(key);
      if (entry) {
        const span = { from: entry.valueFrom, to: entry.valueTo };
        diagnostics.push({ line: entry.line, span, severity: 'warning', code: 'key-type', message: `${key} "${value}" is not ${article([type])}; it is ignored` });
      }
      continue;
    }
    keys.set(key, value);
  }

  const roles = new Map<string, string>();
  const mistyped = new Map<string, string>();
  const rolesEntry = entryOf('roles');
  for (const role of schema.roles) {
    // Only a binding written in this file has spans, and a line to report on.
    const at = role.from !== undefined && rolesEntry ? { line: rolesEntry.line, span: { from: role.from, to: role.columnTo ?? role.to! } } : null;
    if (at && unknown(role.name, Object.keys(CORE_ROLES), 'unknown-role', 'role', at)) continue;
    const types = CORE_ROLES[role.name];
    if (types && !types.includes(role.column.kind)) {
      const reason = `the ${role.name} role's column ${role.column.name} is ${role.column.kind}, not ${article(types)}`;
      mistyped.set(role.name, reason);
      if (at) diagnostics.push({ ...at, severity: 'warning', code: 'role-type', message: reason });
      continue;
    }
    roles.set(role.name, role.column.name);
  }

  // rows resolves marker names without spans; find each in its entry's tokens.
  const markersEntry = entryOf('markers');
  if (markersEntry) {
    const { from, to } = doc.lines[markersEntry.line - 1];
    const names = tokenizeLine(text.slice(from, to), { sep: schema.sep, comment: schema.comment, state: 'frontmatter' })
      .tokens.filter((t) => t.type === 'name')
      .map((t) => ({ from: from + t.from, to: from + t.to }));
    for (const marker of schema.markers) {
      const span = names.find((s) => text.slice(s.from, s.to) === marker.name);
      if (span) unknown(marker.name, CORE_MARKERS, 'unknown-marker', 'marker', { line: markersEntry.line, span });
    }
  }

  return { bindings: { roles, mistyped, keys, markers: new Set(schema.markers.map((m) => m.name)) }, diagnostics };
}
