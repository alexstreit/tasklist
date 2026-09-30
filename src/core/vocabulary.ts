// The plan format's core vocabulary (VISION §4.1, PLUGINS.md §3). Bare role, key and marker names
// belong to the format and never change once files use them; a plugin's own names are qualified
// with its id (`propricer.rate-table`). This file fixes what each core name means.

import type { TypeKind } from 'rows';

/** Each core role, and the column types it may be bound to. */
export const CORE_ROLES: Readonly<Record<string, readonly TypeKind[]>> = {
  effort: ['duration', 'number'], // the one column that is effort, for scheduling
  duration: ['duration'],
  start: ['date'], // a start floor
  deps: ['ref'],
  deadline: ['date'],
};

/** Each core frontmatter key, and its value's type. */
export const CORE_KEYS: Readonly<Record<string, TypeKind>> = {
  'project-start': 'date', // hour 0 of the schedule; no calendar without it
};

/** The core marker names. */
export const CORE_MARKERS: readonly string[] = ['done', 'milestone'];

/** The plugin a qualified name belongs to (`propricer` for `propricer.rate-table`); null for a bare name. */
export function pluginOf(name: string): string | null {
  const dot = name.indexOf('.');
  return dot === -1 ? null : name.slice(0, dot);
}
