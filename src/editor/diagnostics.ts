// Diagnostics gutter and underlines via @codemirror/lint. Spec §4.4.
// The shell pushes the model's diagnostics here after each analyze(); there
// is no lint source of its own, so the gutter and the preview always agree.

import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { StateEffect, StateField } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { EditorView, showPanel } from '@codemirror/view';
import type { Panel } from '@codemirror/view';
import type { TextEdit } from '../buffer';
import { inputEdit, preview, resolveFix } from '../core';
import { today } from '../ui/today';
import type { Diagnostic, Fix } from '../core';

/** Applies a fix's edits; the text editor sends them through the buffer (spec §4.4). */
export type ApplyFix = (edits: TextEdit[]) => void;

/** A confirm fix waiting for its preview to be accepted, against the text it was made for. */
interface Pending {
  fix: Fix;
  doc: Text;
  apply: ApplyFix;
}

const setPending = StateEffect.define<Pending | null>();

/** The confirm fix being previewed, shown in a panel below the editor. Any edit to the text drops it. */
const pendingFix = StateField.define<Pending | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value;
    return tr.docChanged ? null : value;
  },
  provide: (field) => showPanel.from(field, (pending) => (pending ? (view) => previewPanel(view, pending) : null)),
});

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * A confirm fix's exact change, with its warning, before anything is written
 * (spec §4b.6.2). Apply writes it; Cancel or Escape writes nothing. A fix that
 * takes a typed value shows it in an input, and the preview follows it.
 */
function previewPanel(view: EditorView, pending: Pending): Panel {
  const { doc, apply } = pending;
  const fix = resolveFix(pending.fix, today());
  const dom = element('div', 'cm-fix-preview');
  dom.setAttribute('role', 'region');
  dom.setAttribute('aria-label', `Preview: ${fix.label}`);
  const close = () => {
    view.dispatch({ effects: setPending.of(null) });
    view.focus();
  };
  let edits = fix.edits;
  const pre = element('pre', 'cm-fix-lines', fix.preview ?? '');
  const ok = element('button', 'cm-fix-apply', 'Apply');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    if (view.state.doc.eq(doc)) apply(edits);
    close();
  });
  const cancel = element('button', 'cm-fix-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  dom.append(element('strong', 'cm-fix-label', fix.label));
  if (fix.warning) dom.append(element('p', 'cm-fix-warning', fix.warning));
  let first: HTMLElement = ok;
  if (fix.input) {
    const typed = fix.input;
    const input = element('input', 'cm-fix-input');
    input.value = fix.input.value;
    input.setAttribute('aria-label', 'New name');
    input.addEventListener('input', () => {
      const value = input.value.trim();
      edits = [inputEdit(typed, value)];
      pre.textContent = preview(doc.toString(), edits);
      ok.disabled = value === '';
    });
    dom.append(input);
    first = input;
  }
  dom.append(pre, ok, cancel);
  dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && event.target === first && first !== ok && !ok.disabled) {
      event.preventDefault();
      ok.click();
    }
  });
  return { dom, mount: () => first.focus() };
}

/**
 * Spanned diagnostics underline exactly their span. Spanless ones become an
 * empty range at the start of their line: a gutter marker with no underline.
 * Fixes become lint actions, whatever their tier; a confirm fix shows its
 * preview first. Their edits are in the coordinates of `doc`, so an action
 * does nothing once the text has changed; the diagnostics for the new text
 * are on their way. A fix that suggests today's date gets it here, so the
 * action writes the date its label showed.
 */
export function toLintDiagnostics(diagnostics: readonly Diagnostic[], doc: Text, apply?: ApplyFix): LintDiagnostic[] {
  const day = today();
  return diagnostics.map((d) => {
    const lineStart = doc.line(Math.min(d.line, doc.lines)).from;
    const from = d.span ? Math.min(d.span.from, doc.length) : lineStart;
    const to = d.span ? Math.min(d.span.to, doc.length) : lineStart;
    const out: LintDiagnostic = { from, to, severity: d.severity, message: d.message };
    if (apply && d.fixes) {
      out.actions = d.fixes.map((suggested) => resolveFix(suggested, day)).map((fix) => ({
        name: fix.label,
        apply: (view: EditorView) => {
          if (!view.state.doc.eq(doc)) return;
          if (fix.tier === 'confirm') view.dispatch({ effects: setPending.of({ fix, doc, apply }) });
          else apply(fix.edits);
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
  pendingFix,
  // Lint marks an empty range with an inline point; spanless diagnostics are gutter-only.
  EditorView.theme({
    '.cm-lintPoint:after': { display: 'none' },
    '.cm-fix-preview': { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'baseline', padding: '6px 8px', fontSize: '13px' },
    '.cm-fix-preview pre': { flexBasis: '100%', margin: '2px 0', padding: '4px 6px', background: 'var(--hover)', borderRadius: '3px', whiteSpace: 'pre-wrap' },
    '.cm-fix-warning': { flexBasis: '100%', margin: '0', borderLeft: '2px solid var(--diag-warning)', paddingLeft: '6px' },
    '.cm-fix-preview button': { font: 'inherit', fontSize: '12px', border: '1px solid var(--button-border)', background: 'var(--button-bg)', color: 'var(--fg)', borderRadius: '4px', padding: '0 8px', cursor: 'pointer' },
    '.cm-fix-input': { font: 'inherit', fontSize: '12px', color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--accent-border)', borderRadius: '2px' },
  }),
];
