// Line-at-a-time tokenising (base §2.1, §3, §9; DESIGN §7). The parser scans rows with scanRow;
// tokenizeLine flattens the same scan for highlighters, so the two cannot disagree.
import type { ErrorCode } from './errors';
import { isAllWs, isWs, trimEndIndex, trimStartIndex } from './text';

export interface Span {
  from: number;
  to: number;
}

/** A scanned cell. Offsets are into the line. */
export interface ScannedCell extends Span {
  valueFrom: number;
  valueTo: number;
  name: { text: string; from: number; to: number } | null;
  quoted: boolean;
  text: string | null;
  escapes: Span[];
  end: number; // where scanning stopped: the next delimiter, or the end of the line
  closeTo?: number; // just after the closing quote, for a closed quoted cell
}

export interface ScanError extends Span {
  code: ErrorCode;
  message: string;
}

export interface ScannedMarker extends Span {
  name: string;
  char: string;
}

export interface ScannedAnchor extends Span {
  id: string; // the span is the `#ID`
}

/** What the extensions add to a line: marker characters by name. Null for a base-only parse. */
export interface ExtensionContext {
  markers: Map<string, string>; // char → column name
}

export interface ScannedRow {
  indent: { width: number; from: number; to: number };
  markers: ScannedMarker[];
  anchors: ScannedAnchor[];
  anchorGroups: Span[];
  lead: ScannedCell;
  cells: ScannedCell[];
  delimiters: number[];
  errors: ScanError[];
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };
export const NAMED = /^[A-Za-z_][A-Za-z0-9_-]*=/;
export const HEADING = /^#+( |$)/;
// base §9: one or more {...} groups after the closing quote of a lead cell.
const LEAD_GROUPS = /^([ \t]*\{[^{}]*\})+$/;
// Text Anchors §1, §2: an anchor group, and a run of them preceded by whitespace (ext §3.2).
const ID = '[A-Za-z0-9][A-Za-z0-9_-]*';
const GROUP = `\\{[ \\t]*#${ID}(?:[ \\t]+#${ID})*[ \\t]*\\}`;
export const TRAILING_ANCHORS = new RegExp(`(?:^|[ \\t]+)(${GROUP}(?:[ \\t]*${GROUP})*)$`);
const TRAILING_ANCHORS_AFTER_QUOTE = new RegExp(`[ \\t]+(${GROUP}(?:[ \\t]*${GROUP})*)$`);

export type BodyLineKind = 'blank' | 'comment' | 'row';

export function classifyBodyLine(text: string, comment: string): BodyLineKind {
  const start = trimStartIndex(text);
  if (start === text.length) return 'blank';
  return text.startsWith(comment, start) ? 'comment' : 'row';
}

export function scanRow(text: string, sep: string, ext: ExtensionContext | null = null): ScannedRow {
  const errors: ScanError[] = [];
  const indentTo = trimStartIndex(text);
  const indent = { width: indentTo, from: 0, to: indentTo };
  if (text.slice(0, indentTo).includes('\t')) {
    errors.push({ code: 'tab-in-indent', message: 'Tab in indent; each tab counts as one space.', from: 0, to: indentTo });
  }
  if (HEADING.test(text.slice(indentTo))) {
    errors.push({ code: 'heading-line', message: 'Heading line; quote the lead value to write it literally.', from: indentTo, to: text.length });
  }

  const scanCell = (start: number, isLead: boolean): ScannedCell => {
    const from = trimStartIndex(text, start);
    let at = from;
    let name: ScannedCell['name'] = null;
    if (!isLead) {
      const m = NAMED.exec(text.slice(at));
      // No whitespace may follow the `=` either (base §3).
      if (m && !isWs(text[at + m[0].length])) {
        name = { text: m[0].slice(0, -1), from: at, to: at + m[0].length - 1 };
        at += m[0].length;
      }
    }
    const valueFrom = at;

    if (text[at] !== '"') {
      const next = text.indexOf(sep, at);
      const end = next === -1 ? text.length : next;
      const valueTo = Math.max(valueFrom, trimEndIndex(text, valueFrom, end));
      const value = text.slice(valueFrom, valueTo);
      return { from, to: valueTo, valueFrom, valueTo, name, quoted: false, text: value === '' ? null : value, escapes: [], end };
    }

    // Decodes from the opening quote up to `limit`, stopping at a closing quote.
    const decodeQuoted = (limit: number) => {
      let out = '';
      const escapes: Span[] = [];
      const found: ScanError[] = [];
      let k = at + 1;
      while (k < limit) {
        const c = text[k];
        if (c === '"') return { out, escapes, found, closed: k };
        if (c === '\\' && k + 1 < limit) {
          const e = text[k + 1];
          if (e in ESCAPES) {
            out += ESCAPES[e];
            escapes.push({ from: k, to: k + 2 });
          } else {
            out += c + e;
            found.push({ code: 'unknown-escape', message: `Unknown escape \\${e}; kept literally.`, from: k, to: k + 2 });
          }
          k += 2;
          continue;
        }
        out += c;
        k++;
      }
      return { out, escapes, found, closed: -1 };
    };

    let quoted = decodeQuoted(text.length);
    if (quoted.closed === -1) {
      // The cell runs to the end of the line, less trailing whitespace (base §6).
      const end = Math.max(at + 1, trimEndIndex(text, at + 1));
      quoted = decodeQuoted(end);
      errors.push(...quoted.found);
      errors.push({ code: 'unterminated-quote', message: 'Unterminated quoted cell; it runs to the end of the line.', from: at, to: end });
      return { from, to: end, valueFrom, valueTo: end, name, quoted: true, text: quoted.out, escapes: quoted.escapes, end: text.length };
    }
    errors.push(...quoted.found);
    let out = quoted.out;
    const escapes = quoted.escapes;
    const closed = quoted.closed;

    const afterQuote = closed + 1;
    const next = text.indexOf(sep, afterQuote);
    const end = next === -1 ? text.length : next;
    const restTo = trimEndIndex(text, afterQuote, end);
    let valueTo = afterQuote;
    if (restTo > afterQuote) {
      const rest = text.slice(afterQuote, restTo);
      if (!(isLead && LEAD_GROUPS.test(rest))) {
        errors.push({ code: 'text-after-quote', message: 'Text after the closing quote; appended to the value.', from: afterQuote, to: restTo });
      }
      out += rest;
      valueTo = restTo;
    }
    return { from, to: valueTo, valueFrom, valueTo, name, quoted: true, text: out, escapes, end, closeTo: afterQuote };
  };

  // ext §5: markers at the start of the lead value, in any order, each with the whitespace after it.
  const markers: ScannedMarker[] = [];
  let leadStart = indentTo;
  while (ext && ext.markers.has(text[leadStart])) {
    const char = text[leadStart];
    if (markers.some((m) => m.char === char)) {
      errors.push({ code: 'repeated-marker', message: `Marker ${char} repeated; the repeat and the rest are the lead value.`, from: leadStart, to: leadStart + 1 });
      break;
    }
    markers.push({ name: ext.markers.get(char)!, char, from: leadStart, to: leadStart + 1 });
    leadStart = trimStartIndex(text, leadStart + 1);
  }

  let lead: ScannedCell;
  if (text[indentTo] === sep) {
    errors.push({ code: 'row-begins-with-delimiter', message: 'Row begins with the delimiter; the lead is null.', from: indentTo, to: indentTo + 1 });
    lead = { from: indentTo, to: indentTo, valueFrom: indentTo, valueTo: indentTo, name: null, quoted: false, text: null, escapes: [], end: indentTo };
  } else {
    lead = { ...scanCell(leadStart, true), from: indentTo };
  }

  // ext §3.2: anchor groups at the end of the lead cell, after an unquoted value or a closing quote.
  const anchors: ScannedAnchor[] = [];
  const anchorGroups: Span[] = [];
  // An unterminated quote has no closing quote, so nothing can follow it.
  if (ext && lead.text !== null && (!lead.quoted || lead.closeTo !== undefined)) {
    const quotedRest = lead.quoted && lead.closeTo !== undefined;
    const base = quotedRest ? lead.closeTo! : lead.valueFrom;
    const m = (quotedRest ? TRAILING_ANCHORS_AFTER_QUOTE : TRAILING_ANCHORS).exec(text.slice(base, lead.valueTo));
    if (m) {
      const groupsFrom = base + m.index + m[0].length - m[1].length;
      for (const g of text.slice(groupsFrom, lead.valueTo).matchAll(/\{[^}]*\}/g)) {
        const gFrom = groupsFrom + g.index!;
        anchorGroups.push({ from: gFrom, to: gFrom + g[0].length });
        for (const id of g[0].matchAll(new RegExp(`#(${ID})`, 'g'))) {
          anchors.push({ id: id[1], from: gFrom + id.index!, to: gFrom + id.index! + id[0].length });
        }
      }
      const removed = lead.valueTo - (base + m.index);
      const valueTo = base + m.index;
      const decoded = lead.text.slice(0, lead.text.length - removed);
      lead = { ...lead, valueTo, text: quotedRest || decoded !== '' ? decoded : null };
      if (!lead.quoted && valueTo === lead.valueFrom) lead.text = null;
    }
  }

  const cells: ScannedCell[] = [];
  const delimiters: number[] = [];
  let pos = lead.end;
  while (pos < text.length) {
    delimiters.push(pos);
    // A trailing delimiter followed only by whitespace is ignored (base §3).
    if (isAllWs(text, pos + 1)) break;
    const cell = scanCell(pos + 1, false);
    cells.push(cell);
    pos = cell.end;
  }
  return { indent, markers, anchors, anchorGroups, lead, cells, delimiters, errors };
}

export type FrontmatterLineKind = 'fm-close' | 'fm-blank' | 'fm-comment' | 'fm-entry' | 'fm-malformed';

export interface FrontmatterLine {
  kind: FrontmatterLineKind;
  key?: Span & { text: string };
  colon?: number;
  value?: Span; // as written, quotes included
}

const ENTRY = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:/;

/** A frontmatter delimiter: `---`, with trailing whitespace allowed and none leading (base §1). */
export const isDelimiterLine = (text: string): boolean => /^---[ \t]*$/.test(text);

/** A line between the frontmatter delimiters (base §2.1). Lines are trimmed; a delimiter closes. */
export function classifyFrontmatterLine(text: string): FrontmatterLine {
  if (isDelimiterLine(text)) return { kind: 'fm-close' };
  const start = trimStartIndex(text);
  const end = trimEndIndex(text);
  if (start === end) return { kind: 'fm-blank' };
  if (text[start] === '#') return { kind: 'fm-comment' };
  const m = ENTRY.exec(text.slice(start, end));
  if (!m) return { kind: 'fm-malformed' };
  const colon = start + m[0].length - 1;
  const valueFrom = trimStartIndex(text, colon + 1, end);
  return { kind: 'fm-entry', key: { text: m[1], from: start, to: start + m[1].length }, colon, value: { from: valueFrom, to: end } };
}

// ---------- tokenizeLine ----------

export type LineState = 'start' | 'frontmatter' | 'body';

export interface LineContext {
  sep: string;
  comment: string;
  state?: LineState; // default 'body'
  markers?: Map<string, string>; // char → column name; omit for a base-only parse
  extensions?: boolean; // default true
}

export type TokenType =
  | 'indent'
  | 'marker'
  | 'lead'
  | 'anchor'
  | 'delimiter'
  | 'name'
  | 'equals'
  | 'value'
  | 'comment'
  | 'fm-delimiter'
  | 'fm-key'
  | 'fm-colon'
  | 'fm-value'
  | 'fm-comment'
  | 'fm-malformed';

export interface Token extends Span {
  type: TokenType;
  quoted?: boolean;
  escapes?: Span[]; // recognised escapes inside a quoted value
}

export interface LineTokens {
  kind: 'fm-open' | FrontmatterLineKind | BodyLineKind;
  tokens: Token[];
  next: LineState; // the state for the following line
}

/**
 * Tokens for one line, in order and non-overlapping. `start` is the state for a file's first line.
 * A highlighter can't know that a frontmatter block is never closed, so it shows such a file as
 * frontmatter to the end; the parser reads it as body (base §6).
 */
export function tokenizeLine(text: string, ctx: LineContext): LineTokens {
  const state = ctx.state ?? 'body';
  if (state === 'start' && isDelimiterLine(text)) {
    return { kind: 'fm-open', tokens: [{ type: 'fm-delimiter', from: 0, to: 3 }], next: 'frontmatter' };
  }
  if (state === 'frontmatter') {
    const fm = classifyFrontmatterLine(text);
    const tokens: Token[] = [];
    const start = trimStartIndex(text);
    const end = trimEndIndex(text);
    if (fm.kind === 'fm-close') tokens.push({ type: 'fm-delimiter', from: 0, to: 3 });
    else if (fm.kind === 'fm-comment') tokens.push({ type: 'fm-comment', from: start, to: end });
    else if (fm.kind === 'fm-malformed') tokens.push({ type: 'fm-malformed', from: start, to: end });
    else if (fm.kind === 'fm-entry') {
      tokens.push({ type: 'fm-key', from: fm.key!.from, to: fm.key!.to });
      tokens.push({ type: 'fm-colon', from: fm.colon!, to: fm.colon! + 1 });
      if (fm.value!.to > fm.value!.from) tokens.push({ type: 'fm-value', ...fm.value! });
    }
    return { kind: fm.kind, tokens, next: fm.kind === 'fm-close' ? 'body' : 'frontmatter' };
  }

  const kind = classifyBodyLine(text, ctx.comment);
  if (kind === 'blank') return { kind, tokens: [], next: 'body' };
  if (kind === 'comment') {
    return { kind, tokens: [{ type: 'comment', from: trimStartIndex(text), to: text.length }], next: 'body' };
  }
  const ext = ctx.extensions === false ? null : { markers: ctx.markers ?? new Map<string, string>() };
  return { kind, tokens: rowTokens(scanRow(text, ctx.sep, ext)), next: 'body' };
}

function rowTokens(row: ScannedRow): Token[] {
  const tokens: Token[] = [];
  if (row.indent.width > 0) tokens.push({ type: 'indent', from: row.indent.from, to: row.indent.to });
  const value = (type: 'lead' | 'value', cell: ScannedCell) => {
    if (cell.valueTo > cell.valueFrom) {
      tokens.push({ type, from: cell.valueFrom, to: cell.valueTo, quoted: cell.quoted, ...(cell.quoted ? { escapes: cell.escapes } : {}) });
    }
  };
  for (const m of row.markers) tokens.push({ type: 'marker', from: m.from, to: m.to });
  value('lead', row.lead);
  for (const g of row.anchorGroups) tokens.push({ type: 'anchor', from: g.from, to: g.to });
  row.delimiters.forEach((at, i) => {
    tokens.push({ type: 'delimiter', from: at, to: at + 1 });
    const cell = row.cells[i];
    if (!cell) return;
    if (cell.name) {
      tokens.push({ type: 'name', from: cell.name.from, to: cell.name.to });
      tokens.push({ type: 'equals', from: cell.name.to, to: cell.name.to + 1 });
    }
    value('value', cell);
  });
  return tokens;
}
