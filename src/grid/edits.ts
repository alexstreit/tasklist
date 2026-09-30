// Cell edits through the rows edit API. Spec §4b.2. The grid never builds row
// text itself: each edit asks rows, against the document the model was read
// from, and gets back edits or the reason rows won't make them. Only the
// whole-line replacement of comment and blank rows is done here, since those
// lines are not rows. Structure operations on item rows work in levels
// (spec §4b.6.4), and every edit carries the auto repairs of the rows it
// touches (spec §4b.6.1).

import { deleteRow, insertRow, levelIndent, moveRow, repairs, rowLevels, setCell, setLead, setLevel, setMarker } from 'rows';
import type { EditResult } from 'rows';
import type { ItemNode, Model, Span } from '../core';
import type { TextEdit } from '../buffer';
import { normaliseDuration } from './typed';

const NOTHING: EditResult = { edits: [] };

/** A typed value as it is written: tabs as spaces (the buffer holds none, spec §2.2), edges trimmed, empty as null. */
function written(typed: string): string | null {
  const value = typed.replace(/\t/g, ' ').trim();
  return value === '' ? null : value;
}

/** Whether rows can write done for this document: a `done` marker, or a bool column named `done` (spec §2.5). */
export function canMarkDone(model: Model): boolean {
  const { markers, columns } = model.doc.schema;
  return markers.some((m) => m.name === 'done') || columns.some((c) => c.name === 'done' && c.kind === 'bool');
}

export function setTitle(model: Model, node: ItemNode, typed: string): EditResult {
  const title = written(typed) ?? '';
  if (typed === node.title || title === node.title) return NOTHING;
  return setLead(model.doc, node.row, title);
}

/** The rows column for the declared column `index`. */
export function columnOf(model: Model, index: number) {
  return model.doc.schema.columns.filter((c) => c.index > 0 && !c.implicit)[index];
}

/** Write the declared column `index`; an empty value clears the cell. Typed durations are normalised (spec §4b.6.5). */
export function setField(model: Model, node: ItemNode, index: number, typed: string): EditResult {
  const current = node.fields[index]?.text ?? null;
  const column = columnOf(model, index);
  const value = written(column.kind === 'duration' ? normaliseDuration(typed) : typed);
  if (typed === current || value === current) return NOTHING;
  return setCell(model.doc, node.row, column, value);
}

/** Tick or clear a bool cell (spec §4b.6.5), as rows writes a flag. */
export function setFlag(model: Model, node: ItemNode, index: number, on: boolean): EditResult {
  return setMarker(model.doc, node.row, columnOf(model, index).name, on);
}

/** Turn the node's own done flag on or off. A node done through an ancestor has none of its own. */
export function setDone(model: Model, node: ItemNode, done: boolean): EditResult {
  if (done === node.ownDone) return NOTHING;
  return setMarker(model.doc, node.row, 'done', done);
}

/** A new item with this title, before a line or at the end, at `indent` spaces. Nothing when no title was typed. */
export function insertItem(model: Model, at: { beforeLine: number } | 'end', indent: number, typed: string): EditResult {
  const title = written(typed);
  return title === null ? NOTHING : insertRow(model.doc, at, indent, title);
}

/**
 * Each item's level, by line, in the two senses the grid meets:
 * - `shown`: its depth in the plan's tree, which follows rows' parent relation. The grid indents
 *   titles by it.
 * - `indent`: its depth in the indentation tree (rows `rowLevels`), the level rows' structure edits
 *   (setLevel, levelIndent, moveRow) work in. The grid passes it to insertIndent and shiftItem, and
 *   enables Indent and Outdent by it.
 * They agree except for an indent-0 row whose `parent=` names another row, and that row's
 * descendants: rows puts it under its parent, so `shown` is deeper than `indent`.
 */
export function levels(model: Model): Map<number, { shown: number; indent: number }> {
  const indent = rowLevels(model.doc);
  const out = new Map<number, { shown: number; indent: number }>();
  const visit = (node: ItemNode, depth: number): void => {
    out.set(node.line, { shown: depth, indent: indent.get(node.row) ?? 0 });
    node.children.forEach((child) => visit(child, depth + 1));
  };
  model.roots.forEach((root) => visit(root, 0));
  return out;
}

/** The indent of a row inserted above `node`: the node's level, snapped to a valid indent (spec §4b.6.4). */
export function insertIndent(model: Model, node: ItemNode, depth: number): number {
  return levelIndent(model.doc, { beforeLine: node.line }, depth) ?? node.indent;
}

/** Indent makes the row the last child of its previous sibling; outdent the next sibling of its parent. */
export function shiftItem(model: Model, node: ItemNode, depth: number, by: 1 | -1): EditResult {
  return setLevel(model.doc, node.row, depth + by);
}

/** Swap the row and its subtree with its previous or next sibling's. */
export function moveItem(model: Model, node: ItemNode, dir: 'up' | 'down'): EditResult {
  return moveRow(model.doc, node.row, dir);
}

/** Delete the row; its descendants move up one level. */
export function deleteItem(model: Model, node: ItemNode): EditResult {
  return deleteRow(model.doc, node.row);
}

/** Two edits that can't go in one change: they overlap, or both insert at one place. */
const overlap = (a: TextEdit, b: TextEdit) => (a.from < b.to && b.from < a.to) || (a.from === b.from && (a.from === a.to) === (b.from === b.to));
/** A cell repair can't meet the edit either: an append after a broken cell already accounts for it. */
const touch = (a: TextEdit, b: TextEdit) => a.from <= b.to && b.from <= a.to;

/**
 * An edit with the auto repairs of the rows it touches, as one change, so they
 * undo in one step (spec §4b.6.1). A repair that collides with the edit is left
 * out: the edit is what the user asked for. A row's indent repairs go together,
 * and structure operations, which set levels themselves, take none.
 */
export function withRepairs(model: Model, result: EditResult, touched: ItemNode[], indents = true): EditResult {
  if ('refused' in result || result.edits.length === 0) return result;
  const edits = [...result.edits];
  for (const { row } of touched) {
    const labelled = repairs(model.doc, row);
    const indent = labelled.find((r) => r.kind === 'indent')?.edits ?? [];
    if (indents && indent.length > 0 && !indent.some((r) => edits.some((e) => overlap(e, r)))) edits.push(...indent);
    for (const r of labelled.filter((r) => r.kind !== 'indent').flatMap((r) => r.edits)) if (!edits.some((e) => touch(e, r))) edits.push(r);
  }
  // An insert and a replacement that start at one place become one edit, the insert first.
  const sorted = edits.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: TextEdit[] = [];
  for (const e of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.from === e.from && last.to === last.from) merged[merged.length - 1] = { from: e.from, to: e.to, insert: last.insert + e.insert };
    else merged.push(e);
  }
  return { edits: merged };
}

/**
 * Replace a whole line. Comment and blank rows are edited as raw text
 * (spec §4b.1), so nothing here is trimmed or stripped but the characters
 * that would split one line into two.
 */
export function setLine(text: string, span: Span, value: string): TextEdit[] {
  const line = value.replace(/[\n\r\t]+/g, ' ').trimEnd();
  return line === text.slice(span.from, span.to) ? [] : [{ from: span.from, to: span.to, insert: line }];
}
