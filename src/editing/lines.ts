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
