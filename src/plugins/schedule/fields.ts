// The schedule plugin's fields (PLUGINS.md §4, spec §2.11). Times are working hours from
// project-start (WorkHours); a finish is exclusive. A parent row is a summary: it has start,
// finish, slack, critical and late, and no duration, late start or late finish.

import { defineField, definePinnable } from '../../core';
import type { WorkHours } from '../../core';

/**
 * `derived` is the floor the rest of the file gives the row: hour 0, each dependency's finish plus
 * its lag, and each ancestor's floor. `pin` is the start column's date. A leaf starts at the later
 * of the two; a summary's `effective` is its earliest descendant start.
 */
export const start = definePinnable<WorkHours>('schedule', 'start', { label: 'Start', kind: 'date' });

/** Leaves only, in hours. `derived` is the effort at one full-time person (0 without it); `pin` is the dur column. A milestone's is 0. */
export const duration = definePinnable<number>('schedule', 'duration', { label: 'Duration', kind: 'duration' });

/** `calendar.add(start, duration)` for a leaf; the latest descendant finish for a summary. */
export const finish = defineField<WorkHours>('schedule', 'finish', 'node');

/** Leaves only. */
export const lateStart = defineField<WorkHours>('schedule', 'late-start', 'node');
export const lateFinish = defineField<WorkHours>('schedule', 'late-finish', 'node');

/** `lateStart - start` for a leaf; the smallest among its descendants for a summary. */
export const slack = defineField<number>('schedule', 'slack', 'node');

/** `slack <= 0`, for every row. */
export const critical = defineField<boolean>('schedule', 'critical', 'node');

/** The row's finish passes its own deadline. */
export const late = defineField<boolean>('schedule', 'late', 'node');

/** A leaf with the milestone marker: the schedule table shows it as a point. */
export const milestone = defineField<boolean>('schedule', 'milestone', 'node');

/** The row's deadline, at the end of its date: set on each row whose deadline cell is. */
export const deadline = defineField<WorkHours>('schedule', 'deadline', 'node');

/** The latest finish of all. */
export const projectFinish = defineField<WorkHours>('schedule', 'project-finish', 'document');
