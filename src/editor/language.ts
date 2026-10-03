// Highlighting for plan files. Spec §4.1. Tokens come from the rows
// tokenizer (./syntax); the context for them — separator, comment, markers,
// column types and the frontmatter extent — and the done lines come from the
// latest model, and are mapped through edits until the next one arrives. In a
// composed text each line is tokenised with its own file's syntax (§4.5).

import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tokenizeLine } from 'rows';
import type { LineState } from 'rows';
import type { FileLine, ItemNode, Model } from '../core';
import { piecesOf } from '../buffer/composed';
import { fileLineAt, lineStart, placeAt, rootFileField, setRootFile, stretches, toDoc } from './files';
import type { Stretch } from './files';
import { FALLBACK_SYNTAX, lineState, styleLine, syntaxOf } from './syntax';
import type { Syntax } from './syntax';

interface Latest {
  /** Each file's syntax, its frontmatter extent in this document's positions (spec §4.1, §4.5). */
  files: ReadonlyMap<string, Syntax>;
  /** A line decoration on every done line, own or inherited (spec §2.8). */
  done: DecorationSet;
}

const setLatest = StateEffect.define<Latest>();
const doneLine = Decoration.line({ class: 'cm-plan-done' });

export const latestSyntax = StateField.define<Latest>({
  create: () => ({ files: new Map(), done: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLatest)) return effect.value;
    if (!tr.docChanged) return value;
    const files = new Map<string, Syntax>();
    for (const [file, syntax] of value.files) {
      const to = syntax.frontmatterTo;
      files.set(file, typeof to === 'number' ? { ...syntax, frontmatterTo: tr.changes.mapPos(to) } : syntax);
    }
    return { files, done: value.done.map(tr.changes) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.done),
});

/** The syntax of the file at `pos`, from its latest parsed document. */
function syntaxAt(state: EditorState, pos: number): Syntax {
  return state.field(latestSyntax, false)?.files.get(placeAt(state, pos).file) ?? FALLBACK_SYNTAX;
}

/** The comment marker of the file at `pos` (the root file's when omitted), from its latest parsed document. */
export function commentOf(state: EditorState, pos = 0): string {
  return syntaxAt(state, pos).comment;
}

/**
 * Hand the highlighter a fresh model. Each file shown is highlighted from its own document. A model
 * for other text than the view's (any file's) is ignored; a fresh one follows.
 */
export function showSyntax(view: EditorView, model: Model): void {
  // A plain buffer holds the model's root file, whatever it was called before.
  const state = piecesOf(view.state) ? view.state : view.state.update({ effects: setRootFile.of(model.file) }).state;
  const shown = new Map<string, Stretch[]>();
  for (const s of stretches(state)) shown.set(s.file, [...(shown.get(s.file) ?? []), s]);
  const files = new Map<string, Syntax>();
  for (const [file, list] of shown) {
    const doc = model.files.get(file)?.doc;
    if (!doc || !list.every((s) => doc.text.slice(s.from, s.to) === state.doc.sliceString(s.at, s.at + (s.to - s.from)))) return;
    const syntax = syntaxOf(doc);
    const to = syntax.frontmatterTo;
    files.set(file, typeof to === 'number' ? { ...syntax, frontmatterTo: toDoc(state, file, to) ?? to } : syntax);
  }
  const starts: number[] = [];
  const visit = (node: ItemNode): void => {
    if (node.done && files.has(node.file)) {
      const at = toDoc(state, node.file, node.span.from);
      if (at !== null) starts.push(at);
    }
    node.children.forEach(visit);
  };
  model.roots.forEach(visit);
  starts.sort((a, b) => a - b);
  const done = Decoration.set(starts.map((from) => doneLine.range(from)));
  view.dispatch({ effects: [setLatest.of({ files, done }), ...(state === view.state ? [] : [setRootFile.of(model.file)])] });
}

/** The state for a line, carried from its file's first line when there is no parsed frontmatter extent yet. */
function stateAt(state: EditorState, n: number, syntax: Syntax, line: FileLine): LineState {
  const { doc } = state;
  const known = lineState(syntax, line.line, doc.line(n).from);
  if (known) return known;
  const first = lineStart(state, { file: line.file, line: 1 });
  let carried: LineState = 'start';
  for (let m = first === null ? n : doc.lineAt(first).number; m < n && carried !== 'body'; m++) {
    if (placeAt(state, doc.line(m).from).file !== line.file) continue;
    carried = tokenizeLine(doc.line(m).text, { ...syntax, state: carried }).next;
  }
  return carried;
}

const marks = new Map<string, Decoration>();
const mark = (cls: string): Decoration => marks.get(cls) ?? marks.set(cls, Decoration.mark({ class: cls })).get(cls)!;

function tokens(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const builder = new RangeSetBuilder<Decoration>();
  let last = 0;
  for (const { from, to } of view.visibleRanges) {
    let n = Math.max(doc.lineAt(from).number, last + 1);
    // The state carried from the line before, while the lines are one file's.
    let carried: { file: string; state: LineState } | null = null;
    for (; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.from > to) break;
      const at = fileLineAt(state, line.from);
      const syntax = syntaxAt(state, line.from);
      const before = carried?.file === at.file ? carried.state : stateAt(state, n, syntax, at);
      const out = styleLine(line.text, lineState(syntax, at.line, line.from) ?? before, syntax);
      for (const s of out.styles) builder.add(line.from + s.from, line.from + s.to, mark(s.cls));
      carried = { file: at.file, state: out.next };
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
    rootFileField,
    latestSyntax,
    highlighter,
    planTheme,
    // For CodeMirror's own comment commands; Ctrl+/ is the plan keymap's (spec §4.3).
    EditorState.languageData.of((state, pos) => [{ commentTokens: { line: commentOf(state, pos) } }]),
  ];
}
