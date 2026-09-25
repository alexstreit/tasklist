// App shell: buffer -> analyze -> active renderer, with cursor sync both ways,
// plus open/save of the buffer as a file. The shell owns the buffer and hands
// it to whichever editor is active (spec §3.7).

import { CodeMirrorBuffer } from '../buffer';
import { analyze } from '../core';
import type { Exporter, Model, Renderer } from '../core';
import { mountTextEditor } from '../editor';
import { mountGrid } from '../grid';
import { cursorItemFor, itemLines } from './cursor';
import { createFileStore } from './files';
import { tsvExporter } from '../exporters/tsv';
import { ganttRenderer } from '../renderers/gantt';
import { tableRenderer } from '../renderers/table';
import { treeRenderer } from '../renderers/tree';
import example from '../../examples/example.plan?raw';
import './theme.css';
import './style.css';

const DEBOUNCE_MS = 50;

/** What the shell needs from whichever editor is mounted. Spec §3.4. */
interface PlanEditor {
  update(model: Model): void;
  setCursorLine(line: number): void;
  destroy(): void;
}

const renderers: Renderer[] = [treeRenderer, tableRenderer, ganttRenderer];
const exporters: Exporter[] = [tsvExporter];
let active = renderers[0];
const host = document.getElementById('host')!;
const editorHost = document.getElementById('editor')!;
const editorTabs = document.getElementById('editors')!;
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
// True when the editor itself moved the cursor, so the preview scrolls to follow it.
let editorMovedCursor = false;

function setCursorLine(line: number): void {
  editor?.setCursorLine(line);
}

function onCursorLine(line: number, fromApi: boolean): void {
  cursorLine = line;
  if (!fromApi) editorMovedCursor = true;
  schedule();
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
    model = analyze(buffer.text());
    lines = itemLines(model);
    dirty = false;
    editor?.update(model);
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

// The text as last loaded or saved; the document is unsaved when it differs.
let savedText: string;

function unsaved(): boolean {
  return buffer.text() !== savedText;
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
  buffer.apply([{ from: 0, to: buffer.text().length, insert: file.text.replace(/\t/g, '    ') }], 'load');
  editor?.setCursorLine(1);
  savedText = buffer.text();
  updateTitle();
  status.textContent = `Opened ${file.name}`;
}

async function save(as = false): Promise<void> {
  const text = buffer.text();
  let ok: boolean;
  try {
    ok = as ? await files.saveAs(text) : await files.save(text);
  } catch (e) {
    report('save', e);
    return;
  }
  if (!ok) return;
  savedText = text;
  updateTitle();
  status.textContent = files.inPlace
    ? `Saved ${files.name}`
    : `Downloaded ${files.name ?? 'untitled.plan'}. This browser cannot write files in place; open the downloaded copy to continue.`;
}

const buffer = new CodeMirrorBuffer(example);

// One editor is mounted at a time, over the one buffer (spec §3.4).
const editors = [
  { id: 'text', label: 'Text', mount: (): PlanEditor => mountTextEditor(buffer, editorHost, { onCursorLine, onSave: () => void save() }) },
  { id: 'grid', label: 'Grid', mount: (): PlanEditor => mountGrid(buffer, editorHost, { onCursorLine }) },
];
let editorKind = editors[0];
let editor: PlanEditor | undefined;

function renderEditorTabs(): void {
  editorTabs.replaceChildren(
    ...editors.map((kind) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = kind.label;
      button.classList.toggle('active', kind === editorKind);
      button.addEventListener('click', () => mountEditor(kind));
      return button;
    }),
  );
}

function mountEditor(kind: (typeof editors)[number]): void {
  editor?.destroy();
  editorKind = kind;
  editor = kind.mount();
  // When an analysis is already pending the new editor fills on the next render.
  if (!dirty) editor.update(model);
  renderEditorTabs();
}

mountEditor(editorKind);

buffer.onChange(() => {
  dirty = true;
  updateTitle();
  schedule();
});

savedText = buffer.text();
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
