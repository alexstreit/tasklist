// Normalisation (base §1, DESIGN §5) and the whitespace the specs mean: space and tab.

export const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t';

export function trimStartIndex(s: string, from = 0, to = s.length): number {
  while (from < to && isWs(s[from])) from++;
  return from;
}

export function trimEndIndex(s: string, from = 0, to = s.length): number {
  while (to > from && isWs(s[to - 1])) to--;
  return to;
}

export const trimWs = (s: string): string => s.slice(trimStartIndex(s), trimEndIndex(s));

export const isAllWs = (s: string, from = 0): boolean => trimStartIndex(s, from) === s.length;

/** Strips a leading BOM and turns CRLF into LF. */
export function normalise(text: string): string {
  return (text.startsWith('﻿') ? text.slice(1) : text).replace(/\r\n/g, '\n');
}

export interface PhysicalLine {
  text: string;
  line: number;
  from: number;
  to: number;
}

/** Physical lines of normalised text. A final newline ends the last line; it doesn't start another. */
export function splitLines(text: string): PhysicalLine[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  let from = 0;
  return parts.map((part, i) => {
    const line = { text: part, line: i + 1, from, to: from + part.length };
    from = line.to + 1;
    return line;
  });
}

export const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
