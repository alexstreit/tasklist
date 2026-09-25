// Cell edits as pure functions: a line and a committed value in, text edits
// out. Spec §4b.2. Only the edited field's own characters move; everything
// else on the line, including its alignment, is left alone.

import type { ModelNode } from '../core';
import type { TextEdit } from '../buffer';

/** The format has no escaping, so characters that would change the structure are dropped. */
function clean(value: string): string {
  return value.replace(/\s*[|\n\r\t]\s*/g, ' ').trim();
}

function lineText(text: string, node: ModelNode): string {
  return text.slice(node.span.from, node.span.to);
}

/** Offsets of the field separators on the line. Field `i` follows pipe `i`. */
function pipes(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '|') out.push(i);
  return out;
}

function segment(line: string, at: number[], index: number): { start: number; end: number } {
  return { start: at[index] + 1, end: index + 1 < at.length ? at[index + 1] : line.length };
}

export function setTitle(text: string, node: ModelNode, title: string): TextEdit[] {
  const value = clean(title);
  if (value === node.title) return [];
  return [{ from: node.titleSpan.from, to: node.titleSpan.to, insert: value }];
}

/**
 * Write `raw` into the field of column `index`, padding the line with empty
 * fields when it is too short. Committing empty takes the trailing separators
 * with it, so a padded line does not keep the pipes it grew.
 */
export function setField(text: string, node: ModelNode, index: number, raw: string): TextEdit[] {
  const value = clean(raw);
  const line = lineText(text, node);
  const at = pipes(line);

  if (value === '') {
    if (index >= at.length) return [];
    const values = at.map((_, i) => {
      const { start, end } = segment(line, at, i);
      return i === index ? '' : line.slice(start, end).trim();
    });
    let cut = values.length;
    while (cut > 0 && values[cut - 1] === '') cut--;
    if (cut <= index) {
      // Everything from here on is empty: drop the separators too.
      let from = node.span.from + at[cut];
      while (from > node.span.from && text[from - 1] === ' ') from--;
      return [{ from, to: node.span.to, insert: '' }];
    }
  }

  if (index >= at.length) {
    const end = node.span.from + line.trimEnd().length;
    return [{ from: end, to: end, insert: `${' |'.repeat(index - at.length)} | ${value}` }];
  }

  const { start, end } = segment(line, at, index);
  const inner = line.slice(start, end);
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  return [
    {
      from: node.span.from + start + lead,
      to: node.span.from + end - trail,
      insert: lead === 0 && value !== '' ? ` ${value}` : value,
    },
  ];
}

/** Insert or remove the `~` marker. A node done through an ancestor has none of its own. */
export function setDone(text: string, node: ModelNode, done: boolean): TextEdit[] {
  const at = node.span.from + node.indent;
  if (done === node.source.done) return [];
  // Removing takes the whitespace between the marker and the title with it.
  return done ? [{ from: at, to: at, insert: '~' }] : [{ from: at, to: node.titleSpan.from, insert: '' }];
}

/** A complete item line at `indent`, or null when nothing was typed. */
export function itemLine(indent: number, title: string): string | null {
  const value = clean(title);
  return value === '' ? null : `${' '.repeat(indent)}${value}`;
}

/** A new item line at the end of the document, at `indent` spaces. Spec §4b.1. */
export function appendItem(text: string, title: string, indent: number): TextEdit[] {
  const line = itemLine(indent, title);
  if (line === null) return [];
  const prefix = text === '' || text.endsWith('\n') ? '' : '\n';
  return [{ from: text.length, to: text.length, insert: `${prefix}${line}\n` }];
}
