// Ref cells in the grid (spec §4b.2). The file holds references by ID; the grid shows and takes
// outline numbers, which are what a grid user sees, and translates both ways. It is the same for
// any ref column, so nothing here knows about scheduling.

import { setAnchor, setCell } from 'rows';
import type { EditResult, Row } from 'rows';
import { mintId } from '../core';
import type { ItemNode, Model } from '../core';
import type { TextEdit } from '../buffer';
import { columnOf } from './edits';
import { normaliseDuration } from './typed';

/** Each item by its rows row, per model. */
const itemsOf = new WeakMap<Model, Map<Row, ItemNode>>();
function items(model: Model): Map<Row, ItemNode> {
  let map = itemsOf.get(model);
  if (!map) {
    map = new Map();
    const visit = (node: ItemNode): void => void (map!.set(node.row, node), node.children.forEach(visit));
    model.roots.forEach(visit);
    itemsOf.set(model, map);
  }
  return map;
}

/** A reference as written, split as rows splits it (ext §4.2): the locator, and the qualifier after whitespace. */
const REFERENCE = /^(\S+)(?:[ \t]+(.+))?$/;
const OUTLINE = /^\d+(?:\.\d+)*$/;

/**
 * What a ref cell shows, and what editing it starts from: each target's outline number with its
 * qualifier as written (`1.2, 2.1 +1d`); a reference that doesn't resolve as written (`#missing`).
 * A cell that doesn't read as references shows its text.
 */
export function refText(model: Model, node: ItemNode, index: number): string {
  const field = node.fields[index];
  if (!field) return '';
  const value = node.row.cells[columnOf(model, index).index]?.value;
  if (value?.type !== 'ref') return field.text;
  const byRow = items(model);
  return field.text
    .split(',')
    .map((part, k) => {
      const [, locator, qualifier] = REFERENCE.exec(part.trim())!;
      const target = value.refs[k].target;
      const shown = (target && byRow.get(target)?.outlineNumber) ?? locator;
      return qualifier === undefined ? shown : `${shown} ${qualifier}`;
    })
    .join(', ');
}

export function isRefColumn(model: Model, index: number): boolean {
  return columnOf(model, index)?.kind === 'ref';
}

/**
 * Writes a ref cell from what was typed: targets separated by commas, each an outline number or
 * `#id`, with an optional qualifier (a duration qualifier is normalised as a typed duration is). An
 * outline number becomes its row's ID; a row without one gets an anchor from mintId, in the same
 * change. Refused only when it can't be written: a number that matches no row, several targets in
 * a column without `many`, or a qualifier the column doesn't declare. `touched` is every row the
 * change writes to, for its repairs.
 */
export function setRefs(model: Model, node: ItemNode, index: number, typed: string): { result: EditResult; touched: ItemNode[] } {
  const column = columnOf(model, index);
  const nothing = { result: { edits: [] }, touched: [] };
  const value = typed.replace(/\t/g, ' ').trim();
  if (value === refText(model, node, index)) return nothing;
  const refused = (why: string) => ({ result: { refused: why }, touched: [] });

  const parts = value.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length > 1 && !column.many) return refused(`column ${column.name} holds one reference`);
  const byOutline = new Map([...items(model).values()].map((n) => [n.outlineNumber, n]));
  const minted = new Map<ItemNode, string>();
  const written: string[] = [];
  for (const part of parts) {
    const [, target, qualifier] = REFERENCE.exec(part)!;
    if (qualifier !== undefined && !column.qualifier) return refused(`column ${column.name} takes no qualifier`);
    let locator = target;
    if (OUTLINE.test(target)) {
      const row = byOutline.get(target);
      if (!row) return refused(`no task ${target}`);
      const id = row.row.id ?? minted.get(row) ?? mintId(model.doc, row.title, minted.values());
      if (row.row.id === null) minted.set(row, id);
      locator = `#${id}`;
    }
    const q = qualifier !== undefined && column.qualifier?.column.kind === 'duration' ? normaliseDuration(qualifier) : qualifier;
    written.push(q === undefined ? locator : `${locator} ${q}`);
  }

  const text = written.join(', ');
  if (text === (node.fields[index]?.text ?? '')) return nothing;
  // The anchors first, so an anchor and the cell written at one place come out in that order.
  const edits: TextEdit[] = [];
  for (const [row, id] of minted) {
    const result = setAnchor(model.doc, row.row, id);
    if ('refused' in result) return refused(result.refused);
    edits.push(...result.edits);
  }
  const cell = setCell(model.doc, node.row, column, text === '' ? null : text);
  if ('refused' in cell) return refused(cell.refused);
  edits.push(...cell.edits);
  return { result: { edits: joinInserts(edits) }, touched: [node, ...minted.keys()] };
}

/** Inserts at one place become one edit, in the order given, so applying them can't reorder them. */
function joinInserts(edits: TextEdit[]): TextEdit[] {
  const out: TextEdit[] = [];
  for (const e of edits) {
    const same = out.find((o) => o.from === e.from && o.to === o.from && e.to === e.from);
    if (same) same.insert += e.insert;
    else out.push({ ...e });
  }
  return out;
}
