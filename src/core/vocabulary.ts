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

/** A core frontmatter key: its value's type, and what the file is told about it. */
export interface CoreKey {
  type: TypeKind;
  /** A valid value, for the message when the value isn't the type. */
  example: string;
  /** What a value that isn't the type means for the file. */
  ignored: string;
  /** Roles that make the key expected: with one bound and the key not written, the file gets `no-KEY`. */
  expectedWith: readonly string[];
  /** The `no-KEY` message. */
  missing: string;
  /** The label of the fix that writes today's date, for both `no-KEY` and `key-type`. */
  fix: string;
}

/** Each core frontmatter key. */
export const CORE_KEYS: Readonly<Record<string, CoreKey>> = {
  // Hour 0 of the schedule; no calendar without it. Estimate-only files bind only effort, so they are never told about it.
  'project-start': {
    type: 'date',
    example: '2026-10-05',
    ignored: "the schedule isn't computed",
    expectedWith: ['duration', 'start', 'deps', 'deadline'],
    missing: 'Set a project start to compute the schedule',
    fix: 'Set project start to today',
  },
};

/** The core marker names. */
export const CORE_MARKERS: readonly string[] = ['done', 'milestone'];

/** The plugin a qualified name belongs to (`propricer` for `propricer.rate-table`); null for a bare name. */
export function pluginOf(name: string): string | null {
  const dot = name.indexOf('.');
  return dot === -1 ? null : name.slice(0, dot);
}
