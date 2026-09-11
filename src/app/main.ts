// App shell: buffer -> analyze -> active renderer, with cursor sync both ways,
// plus open/save of the buffer as a file.

import { EditorState, Transaction } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { analyze } from '../core';
import type { Exporter, Model, Renderer } from '../core';
import { planEditor, showDiagnostics } from '../editor';
import { cursorItemFor, itemLines } from './cursor';
import { createFileStore } from './files';
import { tsvExporter } from '../exporters/tsv';
import { ganttRenderer } from '../renderers/gantt';
import { tableRenderer } from '../renderers/table';
import { treeRenderer } from '../renderers/tree';
import example from '../../examples/example.plan?raw';
import './style.css';

const DEBOUNCE_MS = 50;

const renderers: Renderer[] = [treeRenderer, tableRenderer, ganttRenderer];
const exporters: Exporter[] = [tsvExporter];
let active = renderers[0];
const host = document.getElementById('host')!;
const tabs = document.getElementById('renderers')!;
const exportBar = document.getElementById('exporters')!;
const files = createFileStore();
const filename = document.getElementById('filename')!;
const status = document.getElementById('status')!;

let model: Model;
let lines: number[] = [];
let cursorLine: number | null = null;
let highlightedLine: number | null = null;
let dirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;
// Set while a cursor move requested by the preview is dispatched, so it does not scroll the preview.
let fromPreview = false;
let editorMovedCursor = false;

function setCursorLine(line: number): void {
  const { doc } = view.state;
  if (line > doc.lines) return;
  fromPreview = true;
  view.dispatch({ selection: { anchor: doc.line(line).from }, scrollIntoView: true });
  fromPreview = false;
  view.focus();
}

/** Why a renderer cannot show this document; empty when it can. */
function unmet(renderer: Renderer, model: Model): string[] {
  return renderer.requires
    .filter((req) => !model.columns.some((c) => c.type === req.type))
    .map((req) => `needs a ${req.type} column`);
}

function renderTabs(): void {
  tabs.replaceChildren(
    ...renderers.map((renderer) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = renderer.label;
      button.classList.toggle('active', renderer === active);
      const reasons = unmet(renderer, model);
      button.disabled = reasons.length > 0;
      button.title = reasons.join('; ');
      button.addEventListener('click', () => {
        active = renderer;
        render();
      });
      return button;
    }),
  );
}

/** Every exporter's output goes to the clipboard; the button confirms briefly, failures go to the status line. */
async function copyExport(exporter: Exporter, button: HTMLButtonElement): Promise<void> {
  try {
    // Absent outside a secure, top-level context (e.g. an embedded browser frame).
    if (!navigator.clipboard) throw new Error('clipboard unavailable in this context');
    await navigator.clipboard.writeText(exporter.export(model).data);
  } catch (e) {
    report('copy', e);
    return;
  }
  button.textContent = 'Copied';
  setTimeout(() => (button.textContent = exporter.label), 1500);
}

function renderExporters(): void {
  exportBar.replaceChildren(
    ...exporters.map((exporter) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = exporter.label;
      button.addEventListener('click', () => void copyExport(exporter, button));
      return button;
    }),
  );
}

function render(): void {
  if (dirty) {
    model = analyze(view.state.doc.toString());
    lines = itemLines(model);
    dirty = false;
    showDiagnostics(view, model.diagnostics);
  }
  if (unmet(active, model).length > 0) {
    // The document changed under the active renderer; fall back to one that can show it.
    const fallback = renderers.find((r) => unmet(r, model).length === 0);
    if (!fallback) {
      renderTabs();
      host.replaceChildren();
      return;
    }
    active = fallback;
  }
  renderTabs();
  const cursorItem = cursorItemFor(lines, cursorLine);
  const scrollToCursor = editorMovedCursor && cursorItem !== null && cursorItem.line !== highlightedLine;
  editorMovedCursor = false;
  highlightedLine = cursorItem?.line ?? null;
  active.render(model, host, { cursorLine, cursorItem, scrollToCursor, setCursorLine });
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

// The buffer as last loaded or saved; the document is unsaved when it differs.
let savedDoc: Text;

function unsaved(): boolean {
  return !view.state.doc.eq(savedDoc);
}

function updateTitle(): void {
  const name = files.name ?? 'Untitled';
  filename.textContent = name;
  document.title = `${unsaved() ? '● ' : ''}${name} — Plan`;
}

function report(action: string, error: unknown): void {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
  status.textContent = `Could not ${action}: ${message}`;
}

async function open(): Promise<void> {
  let file;
  try {
    file = await files.open();
  } catch (e) {
    report('open', e);
    return;
  }
  if (!file) return;
  // Tabs become 4 spaces on load (spec §2.1); the buffer never holds tabs.
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: file.text.replace(/\t/g, '    ') },
    selection: { anchor: 0 },
    annotations: Transaction.addToHistory.of(false),
  });
  savedDoc = view.state.doc;
  updateTitle();
  status.textContent = `Opened ${file.name}`;
}

async function save(as = false): Promise<void> {
  const doc = view.state.doc;
  let ok: boolean;
  try {
    ok = as ? await files.saveAs(doc.toString()) : await files.save(doc.toString());
  } catch (e) {
    report('save', e);
    return;
  }
  if (!ok) return;
  savedDoc = doc;
  updateTitle();
  status.textContent = files.inPlace
    ? `Saved ${files.name}`
    : `Downloaded ${files.name ?? 'untitled.plan'}. This browser cannot write files in place; open the downloaded copy to continue.`;
}

const view = new EditorView({
  state: EditorState.create({
    doc: example,
    extensions: [
      keymap.of([{ key: 'Mod-s', run: () => (void save(), true) }]),
      planEditor(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) updateTitle();
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        const cursorMoved = line !== cursorLine;
        cursorLine = line;
        if (update.docChanged) dirty = true;
        if (cursorMoved && !fromPreview) editorMovedCursor = true;
        if (update.docChanged || cursorMoved) schedule();
      }),
    ],
  }),
  parent: document.getElementById('editor')!,
});

savedDoc = view.state.doc;
cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
render();
renderExporters();
updateTitle();

document.getElementById('open')!.addEventListener('click', () => void open());
const saveButton = document.getElementById('save')!;
const saveAsButton = document.getElementById('save-as')!;
saveButton.addEventListener('click', () => void save());
saveAsButton.addEventListener('click', () => void save(true));
if (!files.inPlace) {
  saveButton.textContent = 'Download';
  saveAsButton.hidden = true;
}
window.addEventListener('beforeunload', (event) => {
  if (unsaved()) event.preventDefault();
});
