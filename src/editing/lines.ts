// Line addressing for the editing operations. Pure string work: no CodeMirror.

export interface LineRange {
  /** 1-based, inclusive. */
  fromLine: number;
  toLine: number;
}

export interface SourceLine {
  from: number;
  /** End of the text, before the line break. */
  to: number;
  text: string;
}

/** Every line of `text`, in order. A trailing newline yields a final empty line. */
export function lines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  let from = 0;
  for (const t of text.split('\n')) {
    out.push({ from, to: from + t.length, text: t });
    from += t.length + 1;
  }
  return out;
}

export function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

export type LineKind = 'blank' | 'comment' | 'item';

/** rows' body line kinds (base §1), with the document's comment marker. */
export function lineKind(text: string, comment: string): LineKind {
  const trimmed = text.trimStart();
  if (trimmed.trimEnd() === '') return 'blank';
  return trimmed.startsWith(comment) ? 'comment' : 'item';
}

/**
 * The subtree's extent (spec §4.2): the last line of the subtree rooted at item line `line`, or
 * null when the item has no child items. Comments indented deeper than the item are part of it;
 * blank lines never extend it. `textOf` gives a line's text, 1-based, for lines 1 to `count`.
 * Folding and where a mount row's segment goes (§4.5) both use it.
 */
export function subtreeEndLine(count: number, textOf: (line: number) => string, line: number, comment: string): number | null {
  const indent = indentOf(textOf(line));
  let lastItem: number | null = null;
  let lastContent: number | null = null;
  for (let n = line + 1; n <= count; n++) {
    const text = textOf(n);
    const kind = lineKind(text, comment);
    if (kind === 'blank') continue;
    if (kind === 'item') {
      if (indentOf(text) <= indent) break;
      lastItem = lastContent = n;
    } else if (indentOf(text) > indent) {
      lastContent = n;
    }
  }
  return lastItem === null ? null : lastContent;
}
