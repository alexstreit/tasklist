// The pin review (spec §5.6): every pin that overrides something, from any plugin, without knowing
// the plugin. For every node field whose key is pinnable, single or by column, it lists each value
// with both a pin and a derived value, in document order. Leaf estimates have nothing derived, so
// they never appear.

import { formatDuration } from '../../core';
import type { FieldKey, ItemNode, Model, Pinnable, RenderContext, Renderer } from '../../core';
import { formatDate } from '../../ui/dates';
import { addItemRow, addTitleCell, createGrid, mount, muted } from '../../ui/grid';
import './pins.css';

interface Entry {
  node: ItemNode;
  /** The key's label, or the column's name for a by-column key. */
  what: string;
  value: Pinnable<number>;
  format: (value: number) => string;
}

function entries(model: Model): Entry[] {
  const calendar = model.calendar;
  const keys = model.fields().filter((key) => key.scope === 'node' && key.pinnable !== 'no');
  // A single key's kind says how to show it; a by-column value is shown by its column's type.
  const byKind = (key: FieldKey<unknown>) => (key.kind === 'date' ? (t: number) => formatDate(calendar!.toDate(t, 'start'), calendar!) : formatDuration);
  const byColumn = (name: string) => (model.columns.find((c) => c.name === name)?.type === 'duration' ? formatDuration : String);
  const overrides = (value: Pinnable<number> | undefined): value is Pinnable<number> => value?.pin !== undefined && value.derived !== undefined;

  const out: Entry[] = [];
  const visit = (node: ItemNode): void => {
    for (const key of keys) {
      if (key.pinnable === 'single') {
        const value = model.get(node, key as FieldKey<Pinnable<number>>);
        if (overrides(value)) out.push({ node, what: key.label ?? key.name, value, format: byKind(key) });
      } else {
        for (const [column, value] of model.get(node, key as FieldKey<Map<string, Pinnable<number>>>) ?? []) {
          if (overrides(value)) out.push({ node, what: column, value, format: byColumn(column) });
        }
      }
    }
    node.children.forEach(visit);
  };
  model.roots.forEach(visit);
  return out;
}

export const pinsView: Renderer = {
  id: 'pins',
  label: 'Pins',
  requires: [],

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    const list = entries(model);
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pins-empty';
      empty.textContent = 'No pins';
      host.replaceChildren(empty);
      return;
    }
    const table = createGrid('plan-pins', ['#', '', 'pinned', 'pin', 'derived', 'effective']);
    for (const { node, what, value, format } of list) {
      const row = addItemRow(table, node, ctx, model);
      addTitleCell(row, node, ctx);
      row.insertCell().textContent = what;
      // An additive pin adds to what is derived, so it shows its sign.
      row.insertCell().textContent = `${value.mode === 'additive' ? '+' : ''}${format(value.pin!)}`;
      row.insertCell().textContent = format(value.derived!);
      const effective = row.insertCell();
      effective.textContent = format(value.effective);
      // A pin whose effective value isn't the pin, such as a start floor that had no effect.
      // Adding is what an additive pin is for, so it never differs.
      if (value.mode === 'pinned' && value.effective !== value.pin) {
        row.classList.add('differs');
        effective.append(muted('differs from the pin'));
      }
    }
    mount(host, table, ctx);
  },
};
