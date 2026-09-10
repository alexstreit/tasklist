// App shell: buffer -> analyze -> whatever is on the right.
// The right pane is a raw JSON dump of the model until Task 3.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { analyze } from '../core';
import type { Model } from '../core';
import { planEditor } from '../editor';
import example from '../../examples/example.plan?raw';
import './style.css';

const DEBOUNCE_MS = 50;

const output = document.getElementById('model')!;

function showModel(model: Model): void {
  // `source` repeats the parse tree under every node; drop it from the dump.
  output.textContent = JSON.stringify(model, (key, value) => (key === 'source' ? undefined : value), 2);
}

let timer: ReturnType<typeof setTimeout> | undefined;

const view = new EditorView({
  state: EditorState.create({
    doc: example,
    extensions: [
      planEditor(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        clearTimeout(timer);
        timer = setTimeout(() => showModel(analyze(view.state.doc.toString())), DEBOUNCE_MS);
      }),
    ],
  }),
  parent: document.getElementById('editor')!,
});

showModel(analyze(view.state.doc.toString()));
