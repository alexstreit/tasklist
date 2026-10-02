// Cell edits through the rows edit API. Spec §4b.2. The grid never builds row
// text itself: each edit asks rows, against the document the model was read
// from, and gets back edits or the reason rows won't make them. Only the
// whole-line replacement of comment and blank rows is done here, since those
// lines are not rows. Structure operations on item rows work in levels
// (spec §4b.6.4), and every edit carries the auto repairs of the rows it
// touches (spec §4b.6.1). A mounted row is edited against its own file's document (spec §4b.2),
// and a root column is written to the column it maps to in that file (`Model.column`).

import { deleteRow, insertRow, levelIndent, moveRow, repairs, rowLevels, setCell, setLead, setLevel, setMarker } from 'rows';
import type { Column as RowsColumn, EditResult, RowsDocument } from 'rows';
import type { ItemNode, Model, Span } from '../core';
import type { TextEdit } from '../buffer';
import { normaliseDuration } from './typed';

const NOTHING: EditResult = { edits: [] };

/** A typed value as it is written: tabs as spaces (the buffer holds none, spec §2.2), edges trimmed, empty as null. */
function written(typed: string): string | null {
  const value = typed.replace(/\t/g, ' ').trim();
  return value === '' ? null : value;
}

/** The rows document of a file in the model: the root's, or a mounted file's. */
export function docIn(model: Model, file: string): RowsDocument {
  return model.files.get(file)?.doc ?? model.doc;
}

/** The rows document the node's row is in: its own file's. */
export function docOf(model: Model, node: ItemNode): RowsDocument {
  return docIn(model, node.file);
}

/**
 * How the grid names a file to its user: by its last path segment, or by its path in the folder
 * when another file in the composed plan has the same last segment.
 */
export function fileLabel(model: Model, file: string): string {
  const base = (path: string) => path.split('/').pop()!;
  return [...model.files.keys()].some((other) => other !== file && base(other) === base(file)) ? file : base(file);
}

/** Whether rows can write done in `file`: a `done` marker, or a bool column named `done` (spec §2.5). */
export function canMarkDone(model: Model, file = model.file): boolean {
  const { markers, columns } = docIn(model, file).schema;
  return markers.some((m) => m.name === 'done') || columns.some((c) => c.name === 'done' && c.kind === 'bool');
}

export function setTitle(model: Model, node: ItemNode, typed: string): EditResult {
  const title = written(typed) ?? '';
  if (typed === node.title || title === node.title) return NOTHING;
  return setLead(docOf(model, node), node.row, title);
}

/** The rows column for a document's declared column `index`. */
function declared(doc: RowsDocument, index: number): RowsColumn {
  return doc.schema.columns.filter((c) => c.index > 0 && !c.implicit)[index];
}

/** The rows column for the root's declared column `index`. */
export function columnOf(model: Model, index: number) {
  return declared(model.doc, index);
}

/** The rows column a node's cell for root column `index` is in, in its own file; null when it maps to none there. */
export function cellColumn(model: Model, node: ItemNode, index: number): RowsColumn | null {
  const own = model.column(node, index);
  return own === null ? null : (declared(docOf(model, node), own) ?? null);
}

/** Why a cell can't be written: its file has no column for the root column. */
export function noColumn(model: Model, node: ItemNode, index: number): { refused: string } {
  return { refused: `file ${fileLabel(model, node.file)} has no column ${model.columns[index].name}` };
}

/** Write the declared column `index`; an empty value clears the cell. Typed durations are normalised (spec §4b.6.5). */
export function setField(model: Model, node: ItemNode, index: number, typed: string): EditResult {
  const current = model.field(node, index)?.text ?? null;
  const column = cellColumn(model, node, index);
  if (!column) return written(typed) === null ? NOTHING : noColumn(model, node, index);
  const value = written(column.kind === 'duration' ? normaliseDuration(typed) : typed);
  if (typed === current || value === current) return NOTHING;
  return setCell(docOf(model, node), node.row, column, value);
}

/** Tick or clear a bool cell (spec §4b.6.5), as rows writes a flag. */
export function setFlag(model: Model, node: ItemNode, index: number, on: boolean): EditResult {
  const column = cellColumn(model, node, index);
  if (!column) return noColumn(model, node, index);
  return setMarker(docOf(model, node), node.row, column.name, on);
}

/** Whether the node's own file declares the marker. */
export function hasMarker(model: Model, node: ItemNode, name: string): boolean {
  return docOf(model, node).schema.markers.some((m) => m.name === name);
}

/** Turn a marker other than done on or off, as its toggle column does (spec §4b.1). The marker is the row's file's, by name. */
export function setToggle(model: Model, node: ItemNode, name: string, on: boolean): EditResult {
  if (!hasMarker(model, node, name)) return { refused: `file ${fileLabel(model, node.file)} has no marker ${name}` };
  return setMarker(docOf(model, node), node.row, name, on);
}

/** Turn the node's own done flag on or off. A node done through an ancestor has none of its own. */
export function setDone(model: Model, node: ItemNode, done: boolean): EditResult {
  if (done === node.ownDone) return NOTHING;
  return setMarker(docOf(model, node), node.row, 'done', done);
}

/** Clear a mount row's `mount=` cell: its file is no longer shown here, and stays as it is (spec §4b.4). */
export function unmount(model: Model, node: ItemNode): EditResult {
  const doc = docOf(model, node);
  const column = doc.schema.mount?.column;
  return column && node.row.mount ? setCell(doc, node.row, column, null) : NOTHING;
}

/** Write a row's `mount=` cell: `path` is relative to the row's own file (spec §4b.7). */
export function mountOn(model: Model, node: ItemNode, path: string): EditResult {
  const doc = docOf(model, node);
  const column = doc.schema.mount?.column;
  if (!column) return { refused: `file ${fileLabel(model, node.file)} has no mount column` };
  return node.row.mount?.path === path ? NOTHING : setCell(doc, node.row, column, path);
}

/** A new item with this title, before a line or at the end of `file`, at `indent` spaces. Nothing when no title was typed. */
export function insertItem(model: Model, at: { beforeLine: number } | 'end', indent: number, typed: string, file = model.file): EditResult {
  const title = written(typed);
  return title === null ? NOTHING : insertRow(docIn(model, file), at, indent, title);
}

/**
 * Each item of `file`'s level, by line, in the two senses the grid meets:
 * - `shown`: its depth in the plan's composed tree, which follows rows' parent relation and the
 *   mounts. The grid indents titles by it.
 * - `indent`: its depth in the indentation tree (rows `rowLevels`), the level rows' structure edits
 *   (setLevel, levelIndent, moveRow) work in. The grid passes it to insertIndent and shiftItem, and
 *   enables Indent and Outdent by it.
 * They agree except for an indent-0 row whose `parent=` names another row, and that row's
 * descendants: rows puts it under its parent, so `shown` is deeper than `indent`.
 */
export function levels(model: Model, file = model.file): Map<number, { shown: number; indent: number }> {
  const indent = rowLevels(docIn(model, file));
  const out = new Map<number, { shown: number; indent: number }>();
  const visit = (node: ItemNode, depth: number): void => {
    // Only the file's own rows: another file's line numbers are its own.
    if (node.file === file) out.set(node.line, { shown: depth, indent: indent.get(node.row) ?? 0 });
    node.children.forEach((child) => visit(child, depth + 1));
  };
  model.roots.forEach((root) => visit(root, 0));
  return out;
}

/** The indent of a row inserted above `node`: the node's level, snapped to a valid indent (spec §4b.6.4). */
export function insertIndent(model: Model, node: ItemNode, depth: number): number {
  return levelIndent(docOf(model, node), { beforeLine: node.line }, depth) ?? node.indent;
}

/** Indent makes the row the last child of its previous sibling; outdent the next sibling of its parent. */
export function shiftItem(model: Model, node: ItemNode, depth: number, by: 1 | -1): EditResult {
  // A mounted file's root stays in its file: there is no level above it there.
  if (depth + by < 0 && node.file !== model.file) return { refused: `it would leave file ${fileLabel(model, node.file)}` };
  return setLevel(docOf(model, node), node.row, depth + by);
}

/** Swap the row and its subtree with its previous or next sibling's. */
export function moveItem(model: Model, node: ItemNode, dir: 'up' | 'down'): EditResult {
  return moveRow(docOf(model, node), node.row, dir);
}

/** Delete the row; its descendants move up one level. With `removeReferences`, the references to it go too. */
export function deleteItem(model: Model, node: ItemNode, removeReferences = false): EditResult {
  return deleteRow(docOf(model, node), node.row, { removeReferences });
}

/** Two edits that can't go in one change: they overlap, or both insert at one place. */
const overlap = (a: TextEdit, b: TextEdit) => (a.from < b.to && b.from < a.to) || (a.from === b.from && (a.from === a.to) === (b.from === b.to));
/** A cell repair can't meet the edit either: an append after a broken cell already accounts for it. */
const touch = (a: TextEdit, b: TextEdit) => a.from <= b.to && b.from <= a.to;

/**
 * An edit with the auto repairs of the rows it touches (all in one file), as one change, so they
 * undo in one step (spec §4b.6.1). A repair that collides with the edit is left
 * out: the edit is what the user asked for. A row's indent repairs go together,
 * and structure operations, which set levels themselves, take none.
 */
export function withRepairs(model: Model, result: EditResult, touched: ItemNode[], indents = true): EditResult {
  if ('refused' in result || result.edits.length === 0) return result;
  const edits = [...result.edits];
  for (const node of touched) {
    const labelled = repairs(docOf(model, node), node.row);
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
