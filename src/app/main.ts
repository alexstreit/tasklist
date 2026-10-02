// App shell: buffer -> analyze -> active renderer, with cursor sync both ways,
// plus open/save of files through the workspace. The shell holds the open files,
// each with its own buffer, and hands the active file's buffer to whichever editor
// is mounted (spec §3.7, §6).

import { CodeMirrorBuffer } from '../buffer';
import { Notice, unmetReason } from '../core';
import type { Exporter, Model, Renderer, Workspace } from '../core';
import { mountTextEditor } from '../editor';
import { mountGrid } from '../grid';
import type { Leader } from '../ui/row-layout';
import { connectPanes, followerChannel } from './align';
import { cursorItemFor, itemLines } from './cursor';
import { ask, names } from './dialog';
import { createOpenFiles, isDirty } from './files';
import type { OpenFile, OpenFiles, SaveResult } from './files';
import { createIncludes } from './includes';
import { mountFilePanel } from './panel';
import { analyze, exporters, registry, renderers } from './registry';
import { createFolderMemory, createFolderWorkspace, createSingleFileWorkspace, folderUnavailable } from './workspace';
import example from '../../examples/example.plan?raw';
import './theme.css';
import './style.css';

const DEBOUNCE_MS = 50;

/** What the shell needs from whichever editor is mounted, and what one that leads also offers. Spec §3.4. */
interface PlanEditor extends Partial<Leader> {
  update(model: Model): void;
  setCursorLine(line: number): void;
  /** Band the row on `line`, hovered in the view; null clears it. */
  setHoverLine?(line: number | null): void;
  /** The line hovered in the editor, or null when the pointer left its rows. Replaces any earlier callback. */
  onHoverLine?(cb: (line: number | null) => void): void;
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
// The last folder opened, for Reopen.
const memory = createFolderMemory();
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
const gathered = (): void => {
  dirty = true;
  schedule();
};

function setCursorLine(line: number): void {
  editor?.setCursorLine(line);
}

function onCursorLine(line: number, fromApi: boolean): void {
  cursorLine = line;
  if (!fromApi) editorMovedCursor = true;
  schedule();
}

// Hover is relayed by line, like the cursor, between whichever editor and view are showing.
let editorHover: number | null = null;
let showHover: ((line: number | null) => void) | null = null;

function setHoverLine(line: number | null): void {
  editor?.setHoverLine?.(line);
}

function onHoverLine(cb: (line: number | null) => void): void {
  showHover = cb;
  cb(editorHover);
}

function onEditorHover(line: number | null): void {
  editorHover = line;
  showHover?.(line);
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
    const { buffer, path } = files.active();
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
  active.render(model, host, { cursorLine, cursorItem, scrollToCursor, setCursorLine, setHoverLine, onHoverLine, ...(active.follows ? channel.context : {}) });
}

function activate(renderer: Renderer): void {
  if (renderer === active) return;
  active = renderer;
  // The new renderer subscribes when it renders.
  showHover = null;
  channel = followerChannel();
  connect();
}

/** The editor leads when it can, and the renderer follows when it can (spec §3.4); the editor is on the left. */
function connect(): void {
  disconnect();
  const leads = editor?.onRowLayout && editor.scrollTo && editor.setMinBodyTop ? (editor as Leader) : undefined;
  disconnect = connectPanes({ leads, host: editorHost }, { follows: active.follows ? channel.follower : undefined, host });
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

function report(action: string, error: unknown): void {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
  status.textContent = `Could not ${action}: ${message}`;
}

const nameOf = (file: OpenFile): string => (file.path ?? 'Untitled').split('/').pop()!;

/** The title, the file name and the file panel's markers follow the open files. */
function updateTitle(): void {
  const file = files.active();
  const name = file.path ?? 'Untitled';
  filename.textContent = name;
  document.title = `${isDirty(file) ? '● ' : ''}${name} — Plan`;
  panel.update(
    files.workspace.can.list
      ? [...new Set([...files.listing(), ...files.files().flatMap((f) => (f.path === null ? [] : [f.path]))])].map((path) => {
          const open = files.files().find((f) => f.path === path);
          return { path, active: open === file, dirty: !!open && isDirty(open), stale: !!open?.stale, missing: !!open?.missing };
        })
      : [],
  );
}

/** Asked before writing over a change made outside the app (spec §6). */
const overwrite = async (file: OpenFile, why: 'changed' | 'missing'): Promise<boolean> =>
  why === 'changed'
    ? (await ask(`${nameOf(file)} changed on disk since you opened it. Overwrite it, or keep your changes unsaved?`, ['Overwrite', 'Keep'])) === 'Overwrite'
    : (await ask(`${nameOf(file)} is no longer on disk. Save it again at ${file.path}?`, ['Yes', 'No'])) === 'Yes';

/** A new buffer for a file opened beside the others; its edits re-analyze only while it is active. */
function makeBuffer(text: string): CodeMirrorBuffer {
  const buffer = new CodeMirrorBuffer(text);
  watch(buffer);
  return buffer;
}

function watch(buffer: CodeMirrorBuffer): void {
  buffer.onChange(() => {
    if (buffer === files.active().buffer) {
      dirty = true;
      schedule();
    }
    updateTitle();
  });
}

/** Called whenever the store changes: follows a new active file, and redraws the markers. */
function onFilesChange(): void {
  const file = files.active();
  if (file.buffer !== shownBuffer) {
    shownBuffer = file.buffer;
    cursorLine = highlightedLine = null;
    dirty = true;
    mountEditor(editorKind);
    render();
    if (files.workspace.can.list && file.path !== null) void memory.setActive(file.path);
  }
  updateTitle();
}

function useFiles(next: OpenFiles<CodeMirrorBuffer>): void {
  files = next;
  includes = createIncludes(next.workspace, gathered);
  files.onChange(onFilesChange);
  renderToolbar();
  updateTitle();
}

/** Reports what a save did; true when nothing is left unsaved by it. */
function reportSave(file: OpenFile, result: SaveResult): boolean {
  if (result.outcome === 'cancelled') return false;
  if (result.outcome === 'failed') {
    report('save', result.reason);
    return false;
  }
  if (result.outcome === 'kept') status.textContent = `${nameOf(file)} was not saved`;
  else if (result.outcome === 'saved') status.textContent = `Saved ${result.path}`;
  else status.textContent = `Downloaded ${file.path ?? 'untitled.plan'}. This browser cannot write files in place; open the downloaded copy to continue.`;
  return result.outcome !== 'kept';
}

/** Save the active file in place, or Save As when it has none. */
async function save(as = false): Promise<void> {
  const file = files.active();
  reportSave(file, await files.save(file, as));
  updateTitle();
}

/** Saves every unsaved file; true when all of them were saved (or downloaded). */
async function saveAll(): Promise<boolean> {
  const unsaved = files.files().filter(isDirty);
  const results = await files.saveAll();
  let ok = true;
  results.forEach((result, i) => (ok = reportSave(unsaved[i], result) && ok));
  if (ok && unsaved.length > 1) status.textContent = `Saved ${names(unsaved.map(nameOf))}`;
  updateTitle();
  return ok;
}

/** Before the open files are replaced: true to go ahead, saving or discarding unsaved changes as the user says. */
async function settleUnsaved(): Promise<boolean> {
  const unsaved = files.files().filter(isDirty);
  if (unsaved.length === 0) return true;
  const choice = await ask(`${names(unsaved.map(nameOf))} ${unsaved.length === 1 ? 'has' : 'have'} unsaved changes.`, [
    'Save all and continue',
    'Discard and continue',
    'Cancel',
  ]);
  if (choice === 'Cancel') return false;
  return choice === 'Discard and continue' || saveAll();
}

/** Open file, Open folder and Reopen: the new workspace's files replace the open ones. */
async function open(create: () => Workspace): Promise<void> {
  if (!(await settleUnsaved())) return;
  const workspace = create();
  let file;
  try {
    file = await workspace.open();
  } catch (e) {
    if (e instanceof Notice) status.textContent = e.message;
    else report('open', e);
    return;
  } finally {
    void renderReopen();
  }
  if (!file) return;
  // The active buffer is reused, so the mounted editor stays; loading clears its history.
  useFiles(createOpenFiles(workspace, files.active().buffer, file, { makeBuffer, ask: { overwrite } }));
  editor?.setCursorLine(1);
  status.textContent = `Opened ${file.path}`;
  await files.relist();
}

/** Reads every open file again, on focus and Refresh (spec §6). */
async function refresh(): Promise<void> {
  await files.refresh();
  const missing = files.files().filter((f) => f.missing);
  if (missing.length > 0) status.textContent = `${names(missing.map(nameOf))} ${missing.length === 1 ? 'is' : 'are'} no longer on disk`;
  updateTitle();
}

const first = new CodeMirrorBuffer(example);
let shownBuffer = first;

// One editor is mounted at a time, over the active file's buffer (spec §3.4).
const editors = [
  { id: 'text', label: 'Text', mount: (): PlanEditor => mountTextEditor(files.active().buffer, editorHost, { onCursorLine, onSave: () => void save() }) },
  { id: 'grid', label: 'Grid', mount: (): PlanEditor => mountGrid(files.active().buffer, editorHost, { onCursorLine }) },
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
  onEditorHover(null);
  editor.onHoverLine?.(onEditorHover);
  // When an analysis is already pending the new editor fills on the next render.
  if (!dirty) editor.update(model);
  connect();
  renderEditorTabs();
}

// The toolbar's file buttons: the original three, and those this shell adds beside them.
const button = (label: string, id: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  b.textContent = label;
  return b;
};
const openButton = document.getElementById('open')!;
const saveButton = document.getElementById('save')!;
const saveAsButton = document.getElementById('save-as')!;
const openFolderButton = button('Open folder', 'open-folder');
const reopenButton = button('Reopen', 'reopen');
const saveAllButton = button('Save all', 'save-all');
const refreshButton = button('Refresh', 'refresh');
openButton.textContent = 'Open file';
openButton.after(openFolderButton, reopenButton);
saveAsButton.after(saveAllButton, refreshButton);
const panelHost = document.createElement('nav');
panelHost.id = 'files';
editorHost.before(panelHost);
const panel = mountFilePanel(panelHost, (path) => {
  files.show(path).catch((e) => report('open', e));
});

/** What the toolbar and panel offer follows what the workspace can do (PLUGINS.md §7.1). */
function renderToolbar(): void {
  const { can } = files.workspace;
  saveButton.textContent = can.saveInPlace ? 'Save' : 'Download';
  saveAsButton.hidden = !can.saveInPlace || !can.saveAs;
  saveAllButton.hidden = !can.list;
  refreshButton.hidden = !can.saveInPlace;
  panelHost.hidden = !can.list;
}

const noFolder = folderUnavailable();
openFolderButton.disabled = noFolder !== null;
openFolderButton.title = noFolder ?? '';
reopenButton.hidden = true;

// The folder Reopen reopens, read when the page loads and after every open.
let remembered: FileSystemDirectoryHandle | null = null;

/** Reopen shows while a folder is remembered; asking for permission again needs a click. */
async function renderReopen(): Promise<void> {
  remembered = noFolder === null ? ((await memory.load())?.handle ?? null) : null;
  reopenButton.hidden = !remembered;
  if (remembered) reopenButton.textContent = `Reopen ${remembered.name}`;
}

let files: OpenFiles<CodeMirrorBuffer> = createOpenFiles(createSingleFileWorkspace(), first, null, { makeBuffer, ask: { overwrite } });
let includes = createIncludes(files.workspace, gathered);
files.onChange(onFilesChange);
watch(first);
mountEditor(lastEditor());

exportBar.replaceChildren(...exportButtons);
render();
renderToolbar();
updateTitle();
void renderReopen();

openButton.addEventListener('click', () => void open(() => createSingleFileWorkspace()));
openFolderButton.addEventListener('click', () => void open(() => createFolderWorkspace(window, memory)));
reopenButton.addEventListener('click', () => {
  const folder = remembered;
  if (folder) void open(() => createFolderWorkspace(window, memory, folder));
});
saveButton.addEventListener('click', () => void save());
saveAsButton.addEventListener('click', () => void save(true));
saveAllButton.addEventListener('click', () => void saveAll());
refreshButton.addEventListener('click', () => void refresh());
window.addEventListener('focus', () => {
  if (files.workspace.can.saveInPlace) void refresh();
});
window.addEventListener('beforeunload', (event) => {
  if (files.files().some((file) => file.buffer.text() !== file.kept)) event.preventDefault();
});
