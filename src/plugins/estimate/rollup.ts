// The roll-up stage. Spec §2.7–2.8. Walks the tree bottom-up, reading each
// summable cell as readTree read it.

import { formatDuration } from '../../core';
import type { FieldKey, ItemNode, Pinnable, Stage } from '../../core';
import { doneSum, hasValue, rollup, totals } from './fields';
import type { Amount, Total } from './fields';

export const rollupStage: Stage = {
  id: 'estimate.rollup',
  reads: [],
  writes: [rollup, hasValue, doneSum, totals],
  run(ctx) {
    const { model } = ctx;
    const summable = model.columns.flatMap((column, index) => (column.type === 'duration' || column.type === 'number' ? [{ column, index }] : []));
    // A child's value, which this stage has already set.
    const at = <T>(node: ItemNode, key: FieldKey<Map<string, T>>, name: string): T => model.get(node, key)!.get(name)!;

    const walk = (item: ItemNode): void => {
      item.children.forEach(walk);
      const rollups = new Map<string, Pinnable<Amount>>();
      const has = new Map<string, boolean>();
      const done = new Map<string, Amount>();
      for (const { column, index } of summable) {
        const { name } = column;
        const children = item.children;
        const childSum = children.reduce((sum, c) => sum + at(c, rollup, name).effective, 0);
        const derived = children.some((c) => at(c, hasValue, name)) ? childSum : undefined;
        // An unreadable value counts as empty; readTree has already said why.
        const pin = ctx.hours(item, name);
        let value: Pinnable<Amount>;
        if (pin === undefined) value = { effective: childSum, mode: 'derived' };
        else if (item.fields[index]!.additive) value = { pin, effective: childSum + pin, mode: 'additive' };
        else {
          value = { pin, effective: pin, mode: 'pinned' };
          if (derived !== undefined && pin !== derived) {
            const fmt = column.type === 'duration' ? formatDuration : String;
            ctx.diagnose({
              line: item.line,
              span: item.fields[index]!.span,
              severity: 'info',
              code: 'override-differs',
              message: `override differs from children (${fmt(pin)} vs ${fmt(derived)})`,
            });
          }
        }
        if (derived !== undefined) value.derived = derived;
        rollups.set(name, value);
        has.set(name, value.mode !== 'derived' || derived !== undefined);
        done.set(name, item.done ? value.effective : children.reduce((sum, c) => sum + at(c, doneSum, name), 0));
      }
      ctx.set(item, rollup, rollups);
      ctx.set(item, hasValue, has);
      ctx.set(item, doneSum, done);
    };
    model.roots.forEach(walk);

    const sums = new Map<string, Total>();
    for (const { column } of summable) {
      sums.set(column.name, {
        effective: model.roots.reduce((sum, r) => sum + at(r, rollup, column.name).effective, 0),
        doneSum: model.roots.reduce((sum, r) => sum + at(r, doneSum, column.name), 0),
      });
    }
    ctx.setValue(totals, sums);
  },
};
