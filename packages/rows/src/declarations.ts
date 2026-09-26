// Column declarations (base §4): `name[:type][ option]...`. Types are kept as written here;
// reading and validating them is the types stage.
import { isWs } from './text';
import type { ColumnOption } from './types';

export interface Piece {
  text: string;
  from: number; // offsets into the string that was split
  to: number;
}

/**
 * Splits at `at(c)` outside `[...]` and `"..."`. A `[` without a matching `]` protects nothing
 * (base §4); a quote without a closing quote likewise.
 */
function splitOutside(s: string, at: (c: string) => boolean, from = 0, to = s.length): Piece[] {
  const pieces: Piece[] = [];
  let start = from;
  let i = from;
  while (i < to) {
    const c = s[i];
    if (at(c)) {
      pieces.push({ text: s.slice(start, i), from: start, to: i });
      start = i + 1;
    } else if (c === '[' || c === '"') {
      const close = c === '[' ? s.indexOf(']', i + 1) : closingQuote(s, i + 1);
      if (close !== -1 && close < to) {
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  pieces.push({ text: s.slice(start, to), from: start, to });
  return pieces;
}

function closingQuote(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

const trimPiece = (p: Piece): Piece => {
  let { from, to } = p;
  const s = p.text;
  let a = 0;
  let b = s.length;
  while (a < b && isWs(s[a])) a++;
  while (b > a && isWs(s[b - 1])) b--;
  from += a;
  to = from + (b - a);
  return { text: s.slice(a, b), from, to };
};

/** The declarations of a `columns` value, trimmed. An empty value declares nothing. */
export function splitDeclarations(value: string, sep: string): Piece[] {
  const pieces = splitOutside(value, (c) => c === sep).map(trimPiece);
  if (pieces.length === 1 && pieces[0].text === '') return [];
  // A trailing delimiter followed only by whitespace is ignored, as in rows (base §3).
  if (pieces.length > 1 && pieces[pieces.length - 1].text === '') pieces.pop();
  return pieces;
}

export interface Declaration {
  name: string;
  type: string;
  options: ColumnOption[];
}

export function parseDeclaration(text: string): Declaration {
  const words = splitOutside(text, isWs)
    .map((p) => p.text)
    .filter((w) => w !== '');
  const [head = '', ...rest] = words;
  const colon = head.indexOf(':');
  const name = colon === -1 ? head : head.slice(0, colon);
  const type = colon === -1 ? 'text' : head.slice(colon + 1);
  const options = rest.map((w): ColumnOption => {
    const eq = w.indexOf('=');
    if (eq === -1) return { key: w, value: null };
    let value = w.slice(eq + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    return { key: w.slice(0, eq), value };
  });
  return { name, type, options };
}
