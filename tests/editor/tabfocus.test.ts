// @vitest-environment jsdom
// Escape then Tab leaves the editor (spec §4.3): Tab must reach the browser
// unhandled so its default focus move happens. Without Escape, Tab indents.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planEditor } from '../../src/editor';

let view: EditorView;

beforeEach(() => {
  // jsdom has no layout; CodeMirror only needs these to not throw.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  view = new EditorView({
    state: EditorState.create({ doc: 'Auth | 2d\n', extensions: planEditor() }),
    parent: document.body,
  });
});

afterEach(() => view.destroy());

function keydown(key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe('Tab capture', () => {
  it('Tab alone indents and is consumed', () => {
    const event = keydown('Tab', 9);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('    Auth | 2d\n');
  });

  it('Escape then Tab is left to the browser', () => {
    keydown('Escape', 27);
    const event = keydown('Tab', 9);
    expect(event.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe('Auth | 2d\n');
  });

  it('any other key after Escape re-arms Tab capture', () => {
    keydown('Escape', 27);
    keydown('ArrowDown', 40);
    const event = keydown('Tab', 9);
    expect(event.defaultPrevented).toBe(true);
  });
});
