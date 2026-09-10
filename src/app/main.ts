// App shell: buffer -> analyze -> active renderer, with cursor sync both ways.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { analyze } from '../core';
import type { Model, Renderer } from '../core';
import { planEditor } from '../editor';
import { treeRenderer } from '../renderers/tree';
import example from '../../examples/example.plan?raw';
import './style.css';

const DEBOUNCE_MS = 50;

const renderers: Renderer[] = [treeRenderer];
const active = renderers[0];
const host = document.getElementById('preview')!;

let model: Model;
let cursorLine: number | null = null;
let dirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function setCursorLine(line: number): void {
  const { doc } = view.state;
  if (line > doc.lines) return;
  view.dispatch({ selection: { anchor: doc.line(line).from }, scrollIntoView: true });
  view.focus();
}

function render(): void {
  if (dirty) {
    model = analyze(view.state.doc.toString());
    dirty = false;
  }
  active.render(model, host, { cursorLine, setCursorLine });
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

const view = new EditorView({
  state: EditorState.create({
    doc: example,
    extensions: [
      planEditor(),
      EditorView.updateListener.of((update) => {
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        const cursorMoved = line !== cursorLine;
        cursorLine = line;
        if (update.docChanged) dirty = true;
        if (update.docChanged || cursorMoved) schedule();
      }),
    ],
  }),
  parent: document.getElementById('editor')!,
});

cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
render();
