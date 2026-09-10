import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import type { StateCommand } from '@codemirror/state';
import { planEditor } from '../../src/editor';

export const example = readFileSync(new URL('../../examples/example.plan', import.meta.url), 'utf8');

export function state(doc: string, selection?: { anchor: number; head?: number }): EditorState {
  return EditorState.create({ doc, selection, extensions: planEditor() });
}

/** Run a command against a state and return the resulting state. */
export function run(start: EditorState, command: StateCommand): { state: EditorState; handled: boolean } {
  let state = start;
  const handled = command({ state, dispatch: (tr) => (state = tr.state) });
  return { state, handled };
}

/** Offset of the first occurrence of `needle` in `doc`. */
export function at(doc: string, needle: string): number {
  const i = doc.indexOf(needle);
  if (i === -1) throw new Error(`"${needle}" not in doc`);
  return i;
}
