// CodeMirror language mode for plan files. Spec §4.1.
// A line-based stream tokenizer; parser state carries front matter and
// inherited done-ness (a `~` ancestor dims the whole subtree, §2.8).

import { HighlightStyle, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { StreamParser, StringStream } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { Tag } from '@lezer/highlight';
import { indentOf, lineKind } from './lines';
import type { LineKind } from './lines';

export const planTags = {
  frontMatter: Tag.define(),
  comment: Tag.define(),
  doneMarker: Tag.define(),
  separator: Tag.define(),
  duration: Tag.define(),
  additive: Tag.define(),
  /** Applied to every token on a done line, own or inherited. */
  done: Tag.define(),
};

interface State {
  atStart: boolean;
  inFrontMatter: boolean;
  /** Indent of the outermost `~` item whose subtree we are inside, else null. */
  doneIndent: number | null;
  // Per-line scratch, set at start of line.
  kind: LineKind | 'frontMatter';
  indent: number;
  done: boolean;
  fieldIndex: number;
}

const VALUE = /\d+(?:\.\d+)?\s*[hdw]?/;
const ADDITIVE_PREFIX = new RegExp(`^\\+(?=\\s*${VALUE.source}\\s*(?:\\||$))`);
const VALUE_TOKEN = new RegExp(`^${VALUE.source}(?=\\s*(?:\\||$))`);

function startLine(line: string, state: State): void {
  state.fieldIndex = 0;
  state.done = false;
  const isDelimiter = line.trimEnd() === '---';
  if (state.atStart) {
    state.atStart = false;
    if (isDelimiter) {
      state.inFrontMatter = true;
      state.kind = 'frontMatter';
      return;
    }
  } else if (state.inFrontMatter) {
    if (isDelimiter) state.inFrontMatter = false;
    state.kind = 'frontMatter';
    return;
  }
  state.kind = lineKind(line);
  if (state.kind !== 'item') return;
  state.indent = indentOf(line);
  if (state.doneIndent !== null && state.indent <= state.doneIndent) state.doneIndent = null;
  if (line[state.indent] === '~' && state.doneIndent === null) state.doneIndent = state.indent;
  state.done = state.doneIndent !== null;
}

function token(stream: StringStream, state: State): string | null {
  if (stream.sol()) startLine(stream.string, state);
  switch (state.kind) {
    case 'frontMatter':
    case 'comment':
      stream.skipToEnd();
      return state.kind;
    case 'blank':
    case 'reserved': // underlined through its diagnostic, not the tokenizer
      stream.skipToEnd();
      return null;
  }
  const tag = (name: string | null): string | null =>
    state.done ? (name ? `${name} done` : 'done') : name;
  if (stream.eatSpace()) return null;
  if (stream.start === state.indent && stream.eat('~')) return tag('doneMarker');
  if (stream.eat('|')) {
    state.fieldIndex++;
    return tag('separator');
  }
  if (state.fieldIndex > 0) {
    if (stream.match(ADDITIVE_PREFIX)) return tag('additive');
    if (stream.match(VALUE_TOKEN)) return tag('duration');
  }
  stream.match(/^[^|]+/);
  return tag(null);
}

const parser: StreamParser<State> = {
  startState: () => ({
    atStart: true,
    inFrontMatter: false,
    doneIndent: null,
    kind: 'blank',
    indent: 0,
    done: false,
    fieldIndex: 0,
  }),
  copyState: (s) => ({ ...s }),
  blankLine: (state) => {
    state.atStart = false;
  },
  token,
  tokenTable: planTags,
  languageData: { commentTokens: { line: '//' } },
};

export const planLanguage = StreamLanguage.define(parser);

export const planHighlightStyle = HighlightStyle.define([
  { tag: planTags.frontMatter, class: 'cm-plan-front-matter' },
  { tag: planTags.comment, class: 'cm-plan-comment' },
  { tag: planTags.doneMarker, class: 'cm-plan-done-marker' },
  { tag: planTags.separator, class: 'cm-plan-separator' },
  { tag: planTags.duration, class: 'cm-plan-duration' },
  { tag: planTags.additive, class: 'cm-plan-additive' },
  { tag: planTags.done, class: 'cm-plan-done' },
]);

const planTheme = EditorView.theme({
  '.cm-plan-front-matter': { color: '#7c6f64' },
  '.cm-plan-comment': { color: '#8a8a8a', fontStyle: 'italic' },
  '.cm-plan-done-marker': { color: '#16a34a', fontWeight: 'bold' },
  '.cm-plan-separator': { color: '#9ca3af' },
  '.cm-plan-duration': { color: '#1d4ed8' },
  '.cm-plan-additive': { color: '#b45309', fontWeight: 'bold' },
  '.cm-plan-done': { opacity: '0.5' },
});

export function plan(): LanguageSupport {
  return new LanguageSupport(planLanguage, [syntaxHighlighting(planHighlightStyle), planTheme]);
}
