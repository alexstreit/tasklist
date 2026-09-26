// Highlighting for plan files. Spec §4.1. Tokens come from the rows
// tokenizer (./syntax); the context for them — separator, comment, markers,
// column types and the frontmatter extent — and the done lines come from the
// latest model, and are mapped through edits until the next one arrives.

import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tokenizeLine } from 'rows';
import type { LineState } from 'rows';
import type { Model, ModelNode } from '../core';
import { FALLBACK_SYNTAX, lineState, styleLine, syntaxOf } from './syntax';
import type { Syntax } from './syntax';

interface Latest {
  syntax: Syntax;
  /** A line decoration on every done line, own or inherited (spec §2.8). */
  done: DecorationSet;
}

const setLatest = StateEffect.define<Latest>();
const doneLine = Decoration.line({ class: 'cm-plan-done' });

export const latestSyntax = StateField.define<Latest>({
  create: () => ({ syntax: FALLBACK_SYNTAX, done: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLatest)) return effect.value;
    if (!tr.docChanged) return value;
    const to = value.syntax.frontmatterTo;
    return {
      syntax: typeof to === 'number' ? { ...value.syntax, frontmatterTo: tr.changes.mapPos(to) } : value.syntax,
      done: value.done.map(tr.changes),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.done),
});

/** The comment marker of the latest parsed document. */
export function commentOf(state: EditorState): string {
  return state.field(latestSyntax, false)?.syntax.comment ?? FALLBACK_SYNTAX.comment;
}

/** Hand the highlighter a fresh model. A model for other text than the view's is ignored; a fresh one follows. */
export function showSyntax(view: EditorView, model: Model): void {
  if (model.doc.text !== view.state.doc.toString()) return;
  const starts: number[] = [];
  const visit = (node: ModelNode): void => {
    if (node.done) starts.push(node.span.from);
    node.children.forEach(visit);
  };
  model.roots.forEach(visit);
  starts.sort((a, b) => a - b);
  const done = Decoration.set(starts.map((from) => doneLine.range(from)));
  view.dispatch({ effects: setLatest.of({ syntax: syntaxOf(model.doc), done }) });
}

/** The state for a line, carried from line 1 when there is no parsed frontmatter extent yet. */
function stateAt(doc: Text, line: number, syntax: Syntax): LineState {
  const known = lineState(syntax, line, doc.line(line).from);
  if (known) return known;
  let state: LineState = 'start';
  for (let n = 1; n < line && state !== 'body'; n++) state = tokenizeLine(doc.line(n).text, { ...syntax, state }).next;
  return state;
}

const marks = new Map<string, Decoration>();
const mark = (cls: string): Decoration => marks.get(cls) ?? marks.set(cls, Decoration.mark({ class: cls })).get(cls)!;

function tokens(view: EditorView): DecorationSet {
  const { syntax } = view.state.field(latestSyntax);
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();
  let last = 0;
  for (const { from, to } of view.visibleRanges) {
    let n = Math.max(doc.lineAt(from).number, last + 1);
    let state = n <= doc.lines ? stateAt(doc, n, syntax) : 'body';
    for (; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.from > to) break;
      const out = styleLine(line.text, lineState(syntax, n, line.from) ?? state, syntax);
      for (const s of out.styles) builder.add(line.from + s.from, line.from + s.to, mark(s.cls));
      state = out.next;
      last = n;
    }
  }
  return builder.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tokens(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.startState.field(latestSyntax) !== update.state.field(latestSyntax)) {
        this.decorations = tokens(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Colours come from the --tok-* custom properties in src/app/theme.css.
const planTheme = EditorView.theme({
  '.cm-plan-front-matter': { color: 'var(--tok-front-matter)' },
  '.cm-plan-comment': { color: 'var(--tok-comment)', fontStyle: 'italic' },
  '.cm-plan-marker': { color: 'var(--tok-marker)', fontWeight: 'bold' },
  '.cm-plan-anchor': { color: 'var(--tok-anchor)' },
  '.cm-plan-separator': { color: 'var(--tok-separator)' },
  '.cm-plan-name': { color: 'var(--tok-name)' },
  '.cm-plan-quoted': { color: 'var(--tok-quoted)' },
  '.cm-plan-escape': { color: 'var(--tok-escape)', fontWeight: 'bold' },
  '.cm-plan-duration': { color: 'var(--tok-duration)' },
  '.cm-plan-additive': { color: 'var(--tok-additive)', fontWeight: 'bold' },
  '.cm-plan-done': { opacity: '0.5' },
});

export function plan(): Extension {
  return [
    latestSyntax,
    highlighter,
    planTheme,
    // For CodeMirror's own comment commands; Ctrl+/ is the plan keymap's (spec §4.3).
    EditorState.languageData.of((state) => [{ commentTokens: { line: commentOf(state) } }]),
  ];
}
