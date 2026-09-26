// Cell edits through the rows edit API. Spec §4b.2. The grid never builds row
// text itself: each edit asks rows, against the document the model was read
// from, and gets back edits or the reason rows won't make them. Only the
// whole-line replacement of comment and blank rows is done here, since those
// lines are not rows.

import { insertRow, setCell, setLead, setMarker } from 'rows';
import type { EditResult } from 'rows';
import type { Model, ModelNode, Span } from '../core';
import type { TextEdit } from '../buffer';

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

export function setTitle(model: Model, node: ModelNode, typed: string): EditResult {
  const title = written(typed) ?? '';
  if (typed === node.title || title === node.title) return NOTHING;
  return setLead(model.doc, node.source.row, title);
}

/** Write the declared column `index`; an empty value clears the cell. */
export function setField(model: Model, node: ModelNode, index: number, typed: string): EditResult {
  const current = node.source.fields[index]?.text ?? null;
  const value = written(typed);
  if (typed === current || value === current) return NOTHING;
  const column = model.doc.schema.columns.filter((c) => c.index > 0 && !c.implicit)[index];
  return setCell(model.doc, node.source.row, column, value);
}

/** Turn the node's own done flag on or off. A node done through an ancestor has none of its own. */
export function setDone(model: Model, node: ModelNode, done: boolean): EditResult {
  if (done === node.source.done) return NOTHING;
  return setMarker(model.doc, node.source.row, 'done', done);
}

/** A new item with this title, before a line or at the end, at `indent` spaces. Nothing when no title was typed. */
export function insertItem(model: Model, at: { beforeLine: number } | 'end', indent: number, typed: string): EditResult {
  const title = written(typed);
  return title === null ? NOTHING : insertRow(model.doc, at, indent, title);
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
