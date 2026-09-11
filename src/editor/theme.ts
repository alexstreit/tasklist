// Editor chrome colours from the app's CSS custom properties (src/app/theme.css),
// plus CodeMirror's own light/dark base rules flipped on the same media query
// so the editor and the page switch together, without a reload.

import { Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Selects CodeMirror's `&dark` or `&light` base rules; the colours below override most of them. */
const scheme = (dark: boolean): Extension => EditorView.theme({}, { dark });

const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-fg)' },
  '.cm-content': { caretColor: 'var(--caret)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--gutter-bg)', color: 'var(--gutter-fg)', borderRight: '1px solid var(--gutter-border)' },
  '.cm-foldGutter span': { color: 'var(--fold)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--hover)', border: '1px solid var(--border)', color: 'var(--fg-muted)' },
  // @codemirror/lint draws underlines and gutter markers as fixed-colour SVGs; redraw them from the variables.
  '.cm-lintRange': { backgroundImage: 'none', textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationSkipInk: 'none' },
  '.cm-lintRange-warning': { textDecorationColor: 'var(--diag-warning)' },
  '.cm-lintRange-info': { textDecorationColor: 'var(--diag-info)' },
  '.cm-lintRange-active': { backgroundColor: 'var(--diag-active)' },
  '.cm-lint-marker-warning': { content: 'normal', backgroundColor: 'var(--diag-warning)', clipPath: 'polygon(50% 8%, 96% 90%, 4% 90%)' },
  '.cm-lint-marker-info': { content: 'normal', backgroundColor: 'var(--diag-info)', clipPath: 'inset(18% round 2px)' },
});

export function planTheme(): Extension {
  // jsdom has no matchMedia; treat that as light.
  const query = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  const compartment = new Compartment();
  const follow = ViewPlugin.define((view) => {
    const onChange = (event: MediaQueryListEvent) => view.dispatch({ effects: compartment.reconfigure(scheme(event.matches)) });
    query?.addEventListener('change', onChange);
    return { destroy: () => query?.removeEventListener('change', onChange) };
  });
  return [chrome, compartment.of(scheme(query?.matches ?? false)), follow];
}
