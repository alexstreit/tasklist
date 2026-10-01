// App shell: buffer -> analyze -> active renderer, with cursor sync both ways,
// plus open/save of the buffer through the workspace. The shell owns the buffer
// and hands it to whichever editor is active (spec §3.7).

import { CodeMirrorBuffer } from '../buffer';
import { unmetReason } from '../core';
import type { Exporter, Model, Renderer } from '../core';
import { mountTextEditor } from '../editor';
import { mountGrid } from '../grid';
import type { Leader } from '../ui/row-layout';
import { connectPanes, followerChannel } from './align';
import { cursorItemFor, itemLines } from './cursor';
import { createIncludes } from './includes';
import { analyze, exporters, registry, renderers } from './registry';
import { createSingleFileWorkspace } from './workspace';
import example from '../../examples/example.plan?raw';
import './theme.css';
import './style.css';

const DEBOUNCE_MS = 50;
const DEFAULT_NAME = 'untitled.plan';

/** What the shell needs from whichever editor is mounted, and what one that leads also offers. Spec §3.4. */
interface PlanEditor extends Partial<Leader> {
  update(model: Model): void;
  setCursorLine(line: number): void;
  destroy(): void;
}

let active = renderers[0];
// The active renderer's channel, when it follows; a new one for each renderer.
let channel = followerChannel();
let disconnect = (): void => {};
const host = document.getElementById('host')!;
const editorHost = document.getElementById('editor')!;
const editorTabs = document.getElementById('editors')!;
const tabs = document.getElementById('renderers')!;
const exportBar = document.getElementById('exporters')!;
const workspace = createSingleFileWorkspace();
// The open file's path; null for a new document.
let path: string | null = null;
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
// A finished gather re-analyzes the current text with the new snapshot.
const includes = createIncludes(workspace, () => {
  dirty = true;
  schedule();
});

function setCursorLine(line: number): void {
  editor?.setCursorLine(line);
}

function onCursorLine(line: number, fromApi: boolean): void {
  cursorLine = line;
  if (!fromApi) editorMovedCursor = true;
  schedule();
}

/** Why a renderer or exporter cannot use this model; null when it can. */
function unmet(view: Renderer | Exporter, model: Model): string | null {
  return unmetReason(registry, model, view.requires);
}

function renderTabs(): void {
  tabs.replaceChildren(
    ...renderers.map((renderer) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = renderer.label;
      button.classList.toggle('active', renderer === active);
      const reason = unmet(renderer, model);
      button.disabled = reason !== null;
      button.title = reason ?? '';
      button.addEventListener('click', () => {
        activate(renderer);
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

const exportButtons = exporters.map((exporter) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = exporter.label;
  button.addEventListener('click', () => void copyExport(exporter, button));
  return button;
});

/** The buttons are made once, so a "Copied" confirmation survives a re-render; only whether each can run changes. */
function renderExporters(): void {
  exporters.forEach((exporter, i) => {
    const reason = unmet(exporter, model);
    exportButtons[i].disabled = reason !== null;
    exportButtons[i].title = reason ?? '';
  });
}

function render(): void {
  if (dirty) {
    const text = buffer.text();
    model = analyze(text, { filename: path ?? undefined, files: includes.snapshot(path, text), version: buffer.version() });
    lines = itemLines(model);
    dirty = false;
    editor?.update(model);
    renderExporters();
  }
  if (unmet(active, model) !== null) {
    // The document changed under the active renderer; fall back to one that can show it.
    const fallback = renderers.find((r) => unmet(r, model) === null);
    if (!fallback) {
      renderTabs();
      host.replaceChildren();
      return;
    }
    activate(fallback);
  }
  renderTabs();
  const cursorItem = cursorItemFor(lines, cursorLine);
  const scrollToCursor = editorMovedCursor && cursorItem !== null && cursorItem.line !== highlightedLine;
  editorMovedCursor = false;
  highlightedLine = cursorItem?.line ?? null;
  active.render(model, host, { cursorLine, cursorItem, scrollToCursor, setCursorLine, ...(active.follows ? channel.context : {}) });
}

function activate(renderer: Renderer): void {
  if (renderer === active) return;
  active = renderer;
  channel = followerChannel();
  connect();
}

/** The editor leads when it can, and the renderer follows when it can (spec §3.4); the editor is on the left. */
function connect(): void {
  disconnect();
  const leads = editor?.onRowLayout && editor.scrollTo && editor.setMinBodyTop ? (editor as Leader) : undefined;
  disconnect = connectPanes({ leads }, { follows: active.follows ? channel.follower : undefined });
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

// The text as last loaded or saved in place; the document is unsaved when it differs.
let savedText: string;
// The text as last loaded, saved or downloaded: leaving the page loses nothing when it matches.
let keptText: string;

function unsaved(): boolean {
  return buffer.text() !== savedText;
}

function updateTitle(): void {
  const name = path ?? 'Untitled';
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
    file = await workspace.open();
  } catch (e) {
    report('open', e);
    return;
  }
  if (!file) return;
  // Tabs become 4 spaces on load (spec §2.1); the buffer never holds tabs.
  buffer.apply([{ from: 0, to: buffer.text().length, insert: file.text.replace(/\t/g, '    ') }], 'load');
  path = file.path;
  editor?.setCursorLine(1);
  savedText = keptText = buffer.text();
  updateTitle();
  status.textContent = `Opened ${file.path}`;
}

/** Save to the open file, or Save As when there is none. */
async function save(as = false): Promise<void> {
  const text = buffer.text();
  const result = !as && path !== null ? await workspace.write(path, text) : await workspace.saveAs(text, path ?? DEFAULT_NAME);
  if (result.outcome === 'cancelled') return;
  if (result.outcome === 'failed') return report('save', result.reason);
  keptText = text;
  if (result.outcome === 'saved') {
    // Only a write in place changes the file on disk, so only it clears the indicator.
    path = result.path;
    savedText = text;
    status.textContent = `Saved ${path}`;
  } else {
    status.textContent = `Downloaded ${path ?? DEFAULT_NAME}. This browser cannot write files in place; open the downloaded copy to continue.`;
  }
  updateTitle();
}

const buffer = new CodeMirrorBuffer(example);

// One editor is mounted at a time, over the one buffer (spec §3.4).
const editors = [
  { id: 'text', label: 'Text', mount: (): PlanEditor => mountTextEditor(buffer, editorHost, { onCursorLine, onSave: () => void save() }) },
  { id: 'grid', label: 'Grid', mount: (): PlanEditor => mountGrid(buffer, editorHost, { onCursorLine }) },
];
// Which editor was last used. A per-viewer convenience: it may be unavailable
// (private browsing), and nothing depends on it.
const EDITOR_KEY = 'plan.editor';

function lastEditor(): (typeof editors)[number] {
  try {
    return editors.find((kind) => kind.id === localStorage.getItem(EDITOR_KEY)) ?? editors[0];
  } catch {
    return editors[0];
  }
}

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
  disconnect();
  disconnect = () => {};
  editor?.destroy();
  editorKind = kind;
  try {
    localStorage.setItem(EDITOR_KEY, kind.id);
  } catch {
    // Storage is not available; the app just opens in the default editor next time.
  }
  editor = kind.mount();
  // When an analysis is already pending the new editor fills on the next render.
  if (!dirty) editor.update(model);
  connect();
  renderEditorTabs();
}

mountEditor(lastEditor());

buffer.onChange(() => {
  dirty = true;
  updateTitle();
  schedule();
});

savedText = keptText = buffer.text();
exportBar.replaceChildren(...exportButtons);
render();
updateTitle();

document.getElementById('open')!.addEventListener('click', () => void open());
const saveButton = document.getElementById('save')!;
const saveAsButton = document.getElementById('save-as')!;
saveButton.addEventListener('click', () => void save());
saveAsButton.addEventListener('click', () => void save(true));
if (!workspace.can.saveInPlace) {
  saveButton.textContent = 'Download';
  saveAsButton.hidden = true;
}
window.addEventListener('beforeunload', (event) => {
  if (buffer.text() !== keptText) event.preventDefault();
});
