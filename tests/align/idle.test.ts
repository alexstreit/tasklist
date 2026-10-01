// @vitest-environment jsdom
// Task 29: a leader measures only while something subscribes to its layout. Every measurement a
// leader makes reads its pane's rect, so a spy on that rect counts them. CodeMirror's own
// measuring reads only its own elements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { mountTextEditor } from '../../src/editor';
import { mountGrid } from '../../src/grid';
import { mockResizeObserver } from '../support/layout';

const TEXT = '// plan\nBuild\n    Design | 1d\n\nShip | 1d\n';

let cleanup: () => void;
afterEach(() => cleanup());

function mount(kind: 'text' | 'grid') {
  const resize = mockResizeObserver();
  const pane = document.createElement('div');
  document.body.append(pane);
  const measured = vi.spyOn(pane, 'getBoundingClientRect');
  const buffer = new CodeMirrorBuffer(TEXT);
  const hooks = { onCursorLine: () => {}, onSave: () => {} };
  const editor = kind === 'text' ? mountTextEditor(buffer, pane, hooks) : mountGrid(buffer, pane, hooks);
  editor.update(analyze(buffer.text()));
  const scroller = kind === 'text' ? pane.querySelector<HTMLElement>('.cm-scroller')! : pane;
  const scroll = () => {
    scroller.scrollTop += 10;
    scroller.dispatchEvent(new Event('scroll'));
  };
  cleanup = () => {
    editor.destroy();
    resize.restore();
    pane.remove();
  };
  return { editor, buffer, measured, scroll, resize };
}

describe.each(['text', 'grid'] as const)('the %s editor with no subscriber', (kind) => {
  it('measures nothing on a scroll, an edit, an update, a resize or a minimum body top', () => {
    const { editor, buffer, measured, scroll, resize } = mount(kind);
    measured.mockClear();
    scroll();
    buffer.apply([{ from: 0, to: 0, insert: 'Plan\n' }], 'grid');
    editor.update(analyze(buffer.text()));
    resize.fire();
    editor.setMinBodyTop(64);
    editor.setMinBodyTop(0);
    expect(measured).not.toHaveBeenCalled();
  });

  it('measures on a scroll once something subscribes, and stops when it unsubscribes', () => {
    const { editor, measured, scroll } = mount(kind);
    const off = editor.onRowLayout(() => {});
    measured.mockClear();
    scroll();
    expect(measured).toHaveBeenCalled();
    off();
    measured.mockClear();
    scroll();
    expect(measured).not.toHaveBeenCalled();
  });
});
