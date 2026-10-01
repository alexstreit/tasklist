// Typed model fields (PLUGINS.md §4). Every computed value is a field that one
// plugin owns, read with the key its owner exports, never as a property.

export interface FieldKey<T> {
  readonly plugin: string;
  readonly name: string;
  /** `node` fields hold one value per item; `document` fields one value per file. */
  readonly scope: 'node' | 'document';
  readonly pinnable: 'no' | 'single' | 'by-column';
  /** A single pinnable key's name in the pin review: 'Start', 'Duration'. A by-column key shows its column's name. */
  readonly label?: string;
  /** How the pin review formats a single pinnable key's values. A by-column value is formatted by its column's type. */
  readonly kind?: PinKind;
  /** Carries `T` for type inference only; never set. */
  readonly type?: T;
}

/** A value the rest of the file derives and a row may pin (PLUGINS.md §4). */
export interface Pinnable<T> {
  /** What the rest of the file gives; absent when nothing derives it. */
  derived?: T;
  /** What the row's own cell says, when it says something. */
  pin?: T;
  /** What is used, by the owning stage's rule. */
  effective: T;
  /** The only record of whether a value is pinned: pinned is `mode !== 'derived'`. `additive` is estimate's only. */
  mode: 'derived' | 'pinned' | 'additive';
}

/** Hours, shown with formatDuration; or working hours from project-start, shown as a date. */
export type PinKind = 'duration' | 'date';

export function defineField<T>(plugin: string, name: string, scope: 'node' | 'document'): FieldKey<T> {
  return Object.freeze({ plugin, name, scope, pinnable: 'no' });
}

/** A node-scope field with one pinnable value per item, and how the pin review shows it. */
export function definePinnable<T>(plugin: string, name: string, show: { label: string; kind: PinKind }): FieldKey<Pinnable<T>> {
  return Object.freeze({ plugin, name, scope: 'node', pinnable: 'single', label: show.label, kind: show.kind });
}

/** A node-scope field with a pinnable value per column, keyed by column name, since a file's columns are not known statically. */
export function definePinnableByColumn<T>(plugin: string, name: string): FieldKey<Map<string, Pinnable<T>>> {
  return Object.freeze({ plugin, name, scope: 'node', pinnable: 'by-column' });
}

/** `estimate.rollup`, for messages. */
export function fieldName(key: FieldKey<unknown>): string {
  return `${key.plugin}.${key.name}`;
}
