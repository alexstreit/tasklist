// Diagnostics gutter and underlines via @codemirror/lint. Spec §4.4.
// The shell pushes the model's diagnostics here after each analyze(); there
// is no lint source of its own, so the gutter and the preview always agree.

import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Diagnostic } from '../core';

/**
 * Spanned diagnostics underline exactly their span. Spanless ones become an
 * empty range at the start of their line: a gutter marker with no underline.
 */
export function toLintDiagnostics(diagnostics: readonly Diagnostic[], doc: Text): LintDiagnostic[] {
  return diagnostics.map((d) => {
    const lineStart = doc.line(Math.min(d.line, doc.lines)).from;
    const from = d.span ? Math.min(d.span.from, doc.length) : lineStart;
    const to = d.span ? Math.min(d.span.to, doc.length) : lineStart;
    return { from, to, severity: d.severity, message: d.message };
  });
}

export function showDiagnostics(view: EditorView, diagnostics: readonly Diagnostic[]): void {
  view.dispatch(setDiagnostics(view.state, toLintDiagnostics(diagnostics, view.state.doc)));
}

export const planDiagnostics = [
  lintGutter(),
  // Lint marks an empty range with an inline point; spanless diagnostics are gutter-only.
  EditorView.theme({ '.cm-lintPoint:after': { display: 'none' } }),
];
