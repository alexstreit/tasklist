// Highlighting from the rows tokenizer (spec §4.1), as a pure function: one
// line and what the latest parsed document says about the file in, styled
// spans out. The tokens are the parser's own (rows DESIGN §7); what this adds
// is the context for them and the per-type colours.

import { tokenizeLine } from 'rows';
import type { LineState, LineTokens, RowsDocument, Token, TypeKind } from 'rows';

/** What the highlighter knows about the file, taken from the latest parsed document. */
export interface Syntax {
  sep: string;
  comment: string;
  /** Marker character → marker name. */
  markers: Map<string, string>;
  extensions: boolean;
  /** Every column, the lead at index 0. */
  columns: { name: string; index: number; kind: TypeKind; settable: boolean; implicit: boolean }[];
  /**
   * End of the frontmatter block as the parser read it, or null when it has
   * none. Undefined before there is a parsed document: the tokenizer's own
   * state is then carried from line 1.
   */
  frontmatterTo?: number | null;
}

/** Before the first parse: rows' defaults, and no markers or columns. */
export const FALLBACK_SYNTAX: Syntax = { sep: '|', comment: '//', markers: new Map(), extensions: true, columns: [] };

export function syntaxOf(doc: RowsDocument): Syntax {
  const { sep, comment, markers, extensions, columns } = doc.schema;
  const frontmatter = doc.lines.filter((l) => l.kind.startsWith('fm-'));
  return {
    sep,
    comment,
    markers: new Map(markers.map((m) => [m.char, m.name])),
    extensions,
    columns: columns.map(({ name, index, kind, settable, implicit }) => ({ name, index, kind, settable, implicit })),
    frontmatterTo: frontmatter.length > 0 ? frontmatter[frontmatter.length - 1].to : null,
  };
}

/**
 * The tokenizer state for a line, from the parsed frontmatter extent, or null
 * when there is no parsed document and the caller has to carry the state.
 * The parser knows whether a frontmatter block is ever closed and the
 * tokenizer can't, so the extent comes from the parser whenever it can.
 */
export function lineState(syntax: Syntax, line: number, from: number): LineState | null {
  if (syntax.frontmatterTo === undefined) return null;
  if (syntax.frontmatterTo === null || from > syntax.frontmatterTo) return 'body';
  return line === 1 ? 'start' : 'frontmatter';
}

/** A styled span; offsets are into the line. */
export interface Styled {
  from: number;
  to: number;
  cls: string;
}

const SUMMABLE = new Set<TypeKind>(['duration', 'number']);

export function styleLine(text: string, state: LineState, syntax: Syntax): { kind: LineTokens['kind']; styles: Styled[]; next: LineState } {
  const { sep, comment, markers, extensions } = syntax;
  const { kind, tokens, next: nextState } = tokenizeLine(text, { sep, comment, markers, extensions, state });
  const styles: Styled[] = [];
  const add = (from: number, to: number, cls: string): void => void (to > from && styles.push({ from, to, cls }));

  if (kind.startsWith('fm-')) {
    add(0, text.length, 'cm-plan-front-matter');
    return { kind, styles, next: nextState };
  }

  const quoted = (t: Token): void => {
    // Quoted text and its escapes, split so that no two spans overlap.
    let at = t.from;
    for (const e of t.escapes ?? []) {
      add(at, e.from, 'cm-plan-quoted');
      add(e.from, e.to, 'cm-plan-quoted cm-plan-escape');
      at = e.to;
    }
    add(at, t.to, 'cm-plan-quoted');
  };
  const typed = (from: number, to: number, kind: TypeKind | undefined): void => {
    if (kind === undefined || !SUMMABLE.has(kind)) return;
    if (text[from] === '+') {
      add(from, from + 1, 'cm-plan-additive');
      from++;
      while (from < to && (text[from] === ' ' || text[from] === '\t')) from++;
    }
    add(from, to, 'cm-plan-duration');
  };

  // Which column each cell sets, by the parser's rules (rows base §3, §6): a
  // name no settable column has makes the cell unnamed, raw text and all; a
  // column set twice, or an unnamed cell after a named one or past the
  // positional columns, is overflow and has no type.
  const positional = syntax.columns.filter((c) => !c.implicit).length;
  const set = new Set<number>();
  let next = 1;
  let named = false;
  const cell = (name: Token | undefined, equals: Token | undefined, value: Token | undefined): void => {
    if (name) {
      const written = text.slice(name.from, name.to);
      const column = syntax.columns.find((c) => c.settable && c.name === written);
      if (column) {
        add(name.from, name.to, 'cm-plan-name');
        if (equals) add(equals.from, equals.to, 'cm-plan-name');
        if (value?.quoted) quoted(value);
        else if (value && !set.has(column.index)) typed(value.from, value.to, column.kind);
        if (!set.has(column.index)) named = true;
        set.add(column.index);
        return;
      }
      // Read as unnamed: the whole cell is its unquoted value.
      const to = (value ?? equals ?? name).to;
      positionally(name.from, to, undefined);
      return;
    }
    // An empty cell has no value token, but it still takes its position.
    positionally(value?.from ?? 0, value?.to ?? 0, value);
  };
  /** An unnamed cell; `token` is its value token, absent when the cell was read as unnamed. */
  const positionally = (from: number, to: number, token: Token | undefined): void => {
    const kind = !named && next < positional ? syntax.columns.find((c) => c.index === next)?.kind : undefined;
    if (!named) set.add(next++);
    if (token?.quoted) quoted(token);
    else typed(from, to, kind);
  };

  let name: Token | undefined;
  let equals: Token | undefined;
  let value: Token | undefined;
  let inCell = false;
  const flush = (): void => {
    if (inCell) cell(name, equals, value);
    name = equals = value = undefined;
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'comment':
        add(t.from, t.to, 'cm-plan-comment');
        break;
      case 'marker':
        add(t.from, t.to, 'cm-plan-marker');
        break;
      case 'anchor':
        add(t.from, t.to, 'cm-plan-anchor');
        break;
      case 'lead':
        if (t.quoted) quoted(t);
        break;
      case 'delimiter':
        flush();
        inCell = true;
        add(t.from, t.to, 'cm-plan-separator');
        break;
      case 'name':
        name = t;
        break;
      case 'equals':
        equals = t;
        break;
      case 'value':
        value = t;
        break;
    }
  }
  flush();
  return { kind, styles, next: nextState };
}
