// The estimate plugin's fields (PLUGINS.md §4). Roll-ups are per column, keyed
// by column name, for every duration and number column (spec §2.7–2.8).

import { defineField, definePinnableByColumn } from '../../core';

/** Hours for a duration column, the number for a number column. */
export type Amount = number;

/**
 * Each summable column's roll-up. `derived` is the children's sum, absent when no child has a
 * value; `pin` is the row's own value. `effective` is the pin (`pinned`), the pin added to the
 * children's sum (`additive`, a leading `+`), or the children's sum (`derived`, 0 when absent).
 */
export const rollup = definePinnableByColumn<Amount>('estimate', 'rollup');

/** Per column: the row has its own value or any child has one. False means there is nothing to show. */
export const hasValue = defineField<Map<string, boolean>>('estimate', 'has-value', 'node');

/** Per column: `effective` for a done row, else the children's done sums (spec §2.8). */
export const doneSum = defineField<Map<string, Amount>>('estimate', 'done-sum', 'node');

export interface Total {
  effective: Amount;
  doneSum: Amount;
}

/** Per summable column: the roots' effective values and done sums, added up. */
export const totals = defineField<Map<string, Total>>('estimate', 'totals', 'document');
