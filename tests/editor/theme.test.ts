// @vitest-environment jsdom
// The editor follows prefers-color-scheme: CodeMirror's dark flag is set from
// the media query at creation and flips, without recreating the view, when it changes.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planEditor } from '../../src/editor';

function fakeMatchMedia(matches: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const list = {
    matches,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    removeEventListener: vi.fn(),
  };
  // CodeMirror also queries matchMedia('print'); only the colour-scheme query gets the fake.
  const other = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => (query === '(prefers-color-scheme: dark)' ? list : other)));
  return { fire: (m: boolean) => listeners.forEach((fn) => fn({ matches: m })), list };
}

const create = () => new EditorView({ state: EditorState.create({ doc: 'A | 4h', extensions: planEditor() }), parent: document.body });
const isDark = (view: EditorView) => view.state.facet(EditorView.darkTheme);

afterEach(() => vi.unstubAllGlobals());

describe('editor colour scheme', () => {
  it('is light when the page prefers light, dark when it prefers dark', () => {
    fakeMatchMedia(false);
    expect(isDark(create())).toBe(false);
    fakeMatchMedia(true);
    expect(isDark(create())).toBe(true);
  });

  it('switches when the OS setting changes, in both directions', () => {
    const media = fakeMatchMedia(false);
    const view = create();
    media.fire(true);
    expect(isDark(view)).toBe(true);
    media.fire(false);
    expect(isDark(view)).toBe(false);
  });

  it('stops listening when the view is destroyed', () => {
    const media = fakeMatchMedia(false);
    create().destroy();
    expect(media.list.removeEventListener).toHaveBeenCalledOnce();
  });

  it('is light where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isDark(create())).toBe(false);
  });
});
