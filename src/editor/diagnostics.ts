// Diagnostics gutter and underlines via @codemirror/lint. Spec §4.4.
// The shell pushes the model's diagnostics here after each analyze(); there
// is no lint source of its own, so the gutter and the preview always agree.

import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { TextEdit } from '../buffer';
import type { Diagnostic } from '../core';

/** Applies a fix's edits; the text editor sends them through the buffer (spec §4.4). */
export type ApplyFix = (edits: TextEdit[]) => void;

/**
 * Spanned diagnostics underline exactly their span. Spanless ones become an
 * empty range at the start of their line: a gutter marker with no underline.
 * Fixes become lint actions. Their edits are in the coordinates of `doc`, so
 * an action does nothing once the text has changed; the diagnostics for the
 * new text are on their way.
 */
export function toLintDiagnostics(diagnostics: readonly Diagnostic[], doc: Text, apply?: ApplyFix): LintDiagnostic[] {
  return diagnostics.map((d) => {
    const lineStart = doc.line(Math.min(d.line, doc.lines)).from;
    const from = d.span ? Math.min(d.span.from, doc.length) : lineStart;
    const to = d.span ? Math.min(d.span.to, doc.length) : lineStart;
    const out: LintDiagnostic = { from, to, severity: d.severity, message: d.message };
    if (apply && d.fixes) {
      out.actions = d.fixes.map((fix) => ({
        name: fix.label,
        apply: (view: EditorView) => {
          if (view.state.doc.eq(doc)) apply(fix.edits);
        },
      }));
    }
    return out;
  });
}

export function showDiagnostics(view: EditorView, diagnostics: readonly Diagnostic[], apply?: ApplyFix): void {
  view.dispatch(setDiagnostics(view.state, toLintDiagnostics(diagnostics, view.state.doc, apply)));
}

export const planDiagnostics = [
  lintGutter(),
  // Lint marks an empty range with an inline point; spanless diagnostics are gutter-only.
  EditorView.theme({ '.cm-lintPoint:after': { display: 'none' } }),
];
