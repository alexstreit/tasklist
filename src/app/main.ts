// App shell: buffer -> analyze -> active renderer, with cursor sync both ways,
// plus open/save of files through the workspace. The shell holds the open files,
// each with its own buffer, and hands the active file's buffer to whichever editor
// is mounted (spec §3.7, §6). In a folder, the editors show each file through its
// composed view, which holds its one undo history and shows the files it mounts
// as segments (spec §4.5); the file's own buffer is the record of its text.

import { CodeMirrorBuffer } from '../buffer';
import { ComposedBuffer } from '../buffer/composed';
import type { Mount } from '../buffer/pieces';
import { mountsOf, Notice, PROFILES, readMounts, relativePath, unmetReason } from '../core';
import type { Exporter, FileLine, ItemNode, Model, OpenedFile, Renderer, Workspace } from '../core';
import { mountTextEditor } from '../editor';
import { mountGrid } from '../grid';
import { mountOn, withRepairs } from '../grid/edits';
import { today } from '../ui/today';
import type { Leader } from '../ui/row-layout';
import { connectPanes, followerChannel } from './align';
import { cursorItemFor, itemLines } from './cursor';
import { ask, names } from './dialog';
import { createOpenFiles, isDirty } from './files';
import type { OpenFile, OpenFiles, SaveResult } from './files';
import { createMounts } from './mounts';
import { mountFilePanel } from './panel';
import { analyze, exporters, registry, renderers } from './registry';
import { mountStartScreen } from './start-screen';
import { TEMPLATES } from './templates';
import type { FolderTemplate, Template } from './templates';
import { newPlanText, newPlanWizard } from './wizard';
import { createFolderMemory, createFolderWorkspace, createSingleFileWorkspace, folderUnavailable } from './workspace';
import './theme.css';
import './style.css';

const DEBOUNCE_MS = 50;

/** What the shell needs from whichever editor is mounted, and what one that leads also offers. Spec §3.4. */
interface PlanEditor extends Partial<Leader> {
  update(model: Model): void;
  setCursorLine(at: FileLine): void;
  /** Band the row on `at`, hovered in the view; null clears it. */
  setHoverLine?(at: FileLine | null): void;
  /** The line hovered in the editor, or null when the pointer left its rows. Replaces any earlier callback. */
  onHoverLine?(cb: (at: FileLine | null) => void): void;
  /** The files with unsaved changes: the composed text editor's segment headers mark them. */
  showUnsaved?(files: ReadonlySet<string>): void;
  destroy(): void;
}

const sameLine = (a: FileLine | null, b: FileLine | null): boolean => a === b || (!!a && !!b && a.file === b.file && a.line === b.line);

let active = renderers[0];
// The active renderer's channel, when it follows; a new one for each renderer.
let channel = followerChannel();
let disconnect = (): void => {};
const host = document.getElementById('host')!;
const editorHost = document.getElementById('editor')!;
const editorTabs = document.getElementById('editors')!;
const tabs = document.getElementById('renderers')!;
const exportBar = document.getElementById('exporters')!;
// The active renderer's own controls, beside the exporters (spec §3.3), cleared when another view is chosen.
const viewTools = document.createElement('div');
viewTools.id = 'view-tools';
exportBar.before(viewTools);
// The last folder opened, for Reopen.
const memory = createFolderMemory();
const filename = document.getElementById('filename')!;
const status = document.getElementById('status')!;

let model: Model;
let lines = new Map<string, number[]>();
let cursorLine: FileLine | null = null;
let highlightedLine: FileLine | null = null;
let dirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;
// True when the editor itself moved the cursor, so the preview scrolls to follow it.
let editorMovedCursor = false;
// A finished read of a mounted file re-analyzes the current text with the new snapshot.
const gathered = (): void => {
  dirty = true;
  schedule();
};

function setCursorLine(at: FileLine): void {
  editor?.setCursorLine(at);
}

function onCursorLine(at: FileLine, fromApi: boolean): void {
  cursorLine = at;
  if (!fromApi) editorMovedCursor = true;
  schedule();
}

// Hover is relayed by line, like the cursor, between whichever editor and view are showing.
let editorHover: FileLine | null = null;
let showHover: ((at: FileLine | null) => void) | null = null;

function setHoverLine(at: FileLine | null): void {
  editor?.setHoverLine?.(at);
}

function onHoverLine(cb: (at: FileLine | null) => void): void {
  showHover = cb;
  cb(editorHover);
}

function onEditorHover(at: FileLine | null): void {
  editorHover = at;
  showHover?.(at);
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

// The root's mounts as of its last analysis, as written: the next snapshot follows them.
let mounted: { path: string; refs: string[] } | null = null;
// The mounted files' texts the last analysis read, for opening a composed one in the store.
let snapshot: ReadonlyMap<string, string | null> = new Map();

/**
 * Analyzes the active file with the files it mounts (PLUGINS.md §6). The mounts come from its model,
 * so when they change, or another file becomes active, it is analyzed again with the new snapshot.
 */
function analyzeActive(): Model {
  const file = files.active();
  const { buffer, path } = file;
  const text = buffer.text();
  const root = path ?? '';
  const { workspace } = files;
  const run = (refs: readonly string[] | null) => {
    snapshot = refs === null ? new Map() : mounts.snapshot(root, refs);
    return analyze(text, {
      filename: path ?? undefined,
      // The version of the buffer the editors show: the composed view's, in a folder.
      version: editorBuffer(file).version(),
      // Only a workspace that can list files can read the ones mounted; otherwise each mount says to open the folder.
      ...(workspace.can.list ? { files: snapshot, resolve: (from: string, ref: string) => workspace.resolve(from, ref) } : {}),
    });
  };
  const known = mounted?.path === root ? mounted.refs : null;
  const next = run(known);
  const refs = mountsOf(next);
  if (known !== null && refs.join('\n') === known.join('\n')) return next;
  mounted = { path: root, refs };
  return run(refs);
}

/** A file badge's Open, or a problem in a mounted file: that file becomes the active one, at `line`. */
function openFile(path: string, line?: number): void {
  files.show(path).then(
    () => line !== undefined && editor?.setCursorLine({ file: path, line }),
    (e) => report('open', e),
  );
}

/**
 * Shows in the active file's composed view the segments its model composes (spec §4.5). A mounted
 * file not open yet is opened in the store, with the text the analysis read, so its edits have a
 * buffer to land in.
 */
function recompose(next: Model): void {
  const view = views.get(files.active());
  if (!view) return;
  const wanted: Mount[] = [];
  const visit = (node: ItemNode): void => {
    if (node.composes !== undefined) wanted.push({ file: node.file, line: node.line, target: node.composes });
    node.children.forEach(visit);
  };
  next.roots.forEach(visit);
  for (const { target } of wanted) {
    const text = snapshot.get(target);
    if (typeof text === 'string') files.adopt(target, text);
  }
  view.recompose(wanted, (file) => next.files.get(file)?.doc.schema.comment ?? '//');
}

function render(): void {
  if (dirty) {
    model = analyzeActive();
    lines = itemLines(model);
    dirty = false;
    // A change of segments re-analyzes, for the new version; the model's files are as they were.
    recompose(model);
    editor?.update(model);
    renderExporters();
  }
  if (unmet(active, model) !== null) {
    // The document changed under the active renderer; fall back to one that can show it.
    const fallback = renderers.find((r) => unmet(r, model) === null);
    if (!fallback) {
      renderTabs();
      host.replaceChildren();
      viewTools.replaceChildren();
      return;
    }
    activate(fallback);
  }
  renderTabs();
  const cursorItem = cursorItemFor(lines, cursorLine);
  const scrollToCursor = editorMovedCursor && cursorItem !== null && !sameLine(cursorItem, highlightedLine);
  editorMovedCursor = false;
  highlightedLine = cursorItem ? { file: cursorItem.file, line: cursorItem.line } : null;
  active.render(model, host, {
    cursorLine,
    cursorItem,
    scrollToCursor,
    setCursorLine,
    openFile: (path) => openFile(path),
    toolbar: (el) => (viewTools.append(el), () => el.remove()),
    setHoverLine,
    onHoverLine,
    ...(active.follows ? channel.context : {}),
  });
}

function activate(renderer: Renderer): void {
  if (renderer === active) return;
  active = renderer;
  viewTools.replaceChildren();
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
  document.title = starting ? 'Plan' : `${isDirty(file) ? '● ' : ''}${name} — Plan`;
  const closable = files.workspace.can.list && closing(file) !== null;
  closeFileItem.disabled = !closable;
  closeFileItem.title = closable ? '' : 'This is the only open file; use Close folder.';
  editor?.showUnsaved?.(new Set(files.files().flatMap((f) => (f.path !== null && isDirty(f) ? [f.path] : []))));
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
  if (editorBuffer(file) !== shownBuffer) {
    shownBuffer = editorBuffer(file);
    cursorLine = highlightedLine = null;
    dirty = true;
    mountEditor(editorKind);
    render();
    if (files.workspace.can.list && file.path !== null) void memory.setActive(file.path);
  }
  updateTitle();
}

function useFiles(next: OpenFiles<CodeMirrorBuffer>): void {
  for (const view of views.values()) view.destroy();
  views = new Map();
  files = next;
  mounts = createMounts({ workspace: next.workspace, openText }, gathered);
  mounted = null;
  files.onChange(onFilesChange);
  renderToolbar();
  onFilesChange();
}

// Each file's composed view, in a folder, made when the file is first shown (spec §4.5).
let views = new Map<OpenFile, ComposedBuffer>();

/** The buffer the editors show for a file: its composed view in a folder, else its own buffer. */
function editorBuffer(file: OpenFile<CodeMirrorBuffer>): CodeMirrorBuffer {
  if (!files.workspace.can.list || file.path === null) return file.buffer;
  let view = views.get(file);
  if (!view) {
    const created = new ComposedBuffer(file.path, { buffer: (path) => files.files().find((f) => f.path === path)?.buffer });
    created.onChange(() => {
      if (views.get(files.active()) === created) {
        dirty = true;
        schedule();
      }
    });
    created.onRefused(() => (status.textContent = "Edits can't cross from one plan file into another."));
    views.set(file, (view = created));
  }
  return view;
}

/**
 * The folder's plan files for the grid's Mount plan… (spec §4b.7), each with the files it mounts,
 * resolved: an open file's current text, any other read from disk; one that can't be read mounts nothing.
 */
async function listPlans(): Promise<{ path: string; mounts: string[] }[]> {
  const { workspace } = files;
  const paths = (await workspace.list()).filter((path) => path.endsWith('.plan'));
  return Promise.all(
    paths.map(async (path) => {
      const text = openText(path) ?? (await workspace.read(path).catch(() => ''));
      const mounts = readMounts(text, path).flatMap((ref) => {
        try {
          return [workspace.resolve(path, ref)];
        } catch {
          return [];
        }
      });
      return { path, mounts };
    }),
  );
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

/**
 * Save the active file in place, or Save As when it has none. A composed view also saves every file
 * it shows with unsaved changes, each with the check that its file on disk is unchanged (spec §4.5).
 */
async function save(as = false): Promise<void> {
  const file = files.active();
  const view = views.get(file);
  const shown = view && !as ? new Set(view.pieces().files()) : new Set<string>();
  const others = files.files().filter((f) => f !== file && f.path !== null && shown.has(f.path) && isDirty(f));
  const saved = [file];
  let ok = reportSave(file, await files.save(file, as));
  for (const other of others) {
    const result = await files.save(other);
    if (reportSave(other, result) && result.outcome === 'saved') saved.push(other);
    else ok = false;
  }
  if (ok && saved.length > 1) status.textContent = `Saved ${names(saved.map(nameOf))}`;
  updateTitle();
}

/** Saves every unsaved file, or those of `only`; true when all of them were saved (or downloaded). */
async function saveAll(only?: readonly OpenFile<CodeMirrorBuffer>[]): Promise<boolean> {
  const unsaved = (only ?? files.files()).filter(isDirty);
  const results = await files.saveAll(only);
  let ok = true;
  results.forEach((result, i) => (ok = reportSave(unsaved[i], result) && ok));
  if (ok && unsaved.length > 1) status.textContent = `Saved ${names(unsaved.map(nameOf))}`;
  updateTitle();
  return ok;
}

/**
 * Before the open files, or the files of `closing`, are replaced or closed: true to go ahead, saving
 * or discarding their unsaved changes as the user says.
 */
async function settleUnsaved(closing?: readonly OpenFile<CodeMirrorBuffer>[]): Promise<boolean> {
  const unsaved = (closing ?? files.files()).filter(isDirty);
  if (unsaved.length === 0) return true;
  const choice = await ask(`${names(unsaved.map(nameOf))} ${unsaved.length === 1 ? 'has' : 'have'} unsaved changes.`, [
    'Save all and continue',
    'Discard and continue',
    'Cancel',
  ]);
  if (choice === 'Cancel') return false;
  return choice === 'Discard and continue' || saveAll(unsaved);
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
  if (!file || file.path === null) return;
  await replaceFiles(workspace, file);
}

/** The workspace's files replace the open ones, with `file` active, and the start screen goes. */
async function replaceFiles(workspace: Workspace, file: OpenedFile): Promise<void> {
  // The active buffer is reused, so the mounted editor stays; loading clears its history.
  useFiles(createOpenFiles(workspace, files.active().buffer, file, { makeBuffer, ask: { overwrite } }));
  showStart(false);
  editor?.setCursorLine({ file: file.path, line: 1 });
  status.textContent = `Opened ${file.path}`;
  await files.relist();
}

/**
 * `text` as an untitled document in the single-file workspace, replacing the open files, after the
 * unsaved-changes dialog: a single-file template, or a new plan outside a folder.
 */
async function openUntitled(text: string): Promise<void> {
  if (!(await settleUnsaved())) return;
  const buffer = files.active().buffer;
  buffer.apply([{ from: 0, to: buffer.text().length, insert: text }], 'load');
  useFiles(createOpenFiles(createSingleFileWorkspace(), buffer, null, { makeBuffer, ask: { overwrite } }));
  showStart(false);
}

/**
 * A folder template (spec §6): its files are written into a folder the user picks, keeping their
 * relative paths, and the folder opens with `show` active. A file already there stops it before
 * anything is written, and one that blocks a write stops it there, keeping what was written; either
 * way the folder then opens as Open folder opens one, and the status line names the file.
 */
async function openFolderTemplate(template: FolderTemplate): Promise<void> {
  if (!(await settleUnsaved())) return;
  const workspace = createFolderWorkspace(window, memory);
  // What stopped the template being written, and how many of its files were.
  let blocked: string | null = null;
  let written = 0;
  const unwritten = () => `${blocked}, so the template wasn't ${written > 0 ? 'fully ' : ''}written.`;
  try {
    // Picks the folder; nothing is remembered until the open below succeeds.
    if (!(await workspace.open({ allowEmpty: true }))) return;
    const there = await workspace.list();
    const taken = Object.keys(template.files).find((path) => there.includes(path));
    if (taken !== undefined) blocked = `${taken} already exists`;
    for (const [path, text] of blocked === null ? Object.entries(template.files) : []) {
      const result = await workspace.create(path, text);
      if (result.outcome !== 'saved') {
        blocked = result.outcome === 'failed' ? result.reason : `${path} wasn't created`;
        break;
      }
      written++;
    }
    const opened = await workspace.open();
    if (!opened || opened.path === null) return;
    await replaceFiles(workspace, blocked === null ? { path: template.show, text: await workspace.read(template.show) } : opened);
    if (blocked !== null) status.textContent = `${unwritten()} Opened the folder instead.`;
  } catch (e) {
    if (e instanceof Notice) status.textContent = blocked === null ? e.message : `${unwritten()} ${e.message}`;
    else report('open', e);
  } finally {
    void renderReopen();
  }
}

function openTemplate(template: Template): void {
  if ('files' in template) void openFolderTemplate(template);
  else void openUntitled(template.text);
}

/** The item row on `at` in the current model: the cursor's, or the grid's selection; null on any other line. */
function rowAt(at: FileLine | null): ItemNode | null {
  if (!at) return null;
  const find = (nodes: readonly ItemNode[]): ItemNode | null => {
    for (const node of nodes) {
      if (node.file === at.file && node.line === at.line) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  return find(model.roots);
}

/**
 * New plan… (spec §6). In a folder it creates the file, which becomes active, or with the mount box
 * ticked mounts it under the cursor's row, as one undo step, with the master still active. Elsewhere
 * it opens an untitled document, after the unsaved-changes dialog.
 */
async function newPlan(): Promise<void> {
  const { workspace } = files;
  const inFolder = workspace.can.create;
  if (dirty) render();
  const row = inFolder ? rowAt(cursorLine) : null;
  // A row that mounts a file already isn't offered: the box would replace its mount.
  const under = row && !row.row.mount ? row : null;
  const listing = inFolder ? await workspace.list().catch(() => [...files.listing()]) : [];
  const result = await newPlanWizard({
    types: PROFILES.map((p) => ({ ...p, needsStart: analyze(newPlanText(p.name)).diagnostics.some((d) => d.code === 'no-project-start') })),
    folder: inFolder
      ? {
          // Every folder the listing reaches, each of a file's folders and the folders above them.
          folders: ['', ...[...new Set(listing.flatMap((path) => path.split('/').slice(0, -1).map((_, i, parts) => `${parts.slice(0, i + 1).join('/')}/`)))].sort()],
          exists: (path) => listing.includes(path),
        }
      : null,
    mountUnder: under ? under.title : null,
    today: today(),
  });
  if (!result) return;
  if (result.path === undefined) {
    await openUntitled(result.text);
    return;
  }
  const created = await workspace.create(result.path, result.text);
  if (created.outcome !== 'saved') return report(`create ${result.path}`, created.outcome === 'failed' ? created.reason : created.outcome);
  status.textContent = `Created ${result.path}`;
  await files.relist();
  if (!(result.mount && under)) {
    await files.show(result.path).catch((e) => report('open', e));
    return;
  }
  // The model the row came from may be older than the buffer by now.
  if (dirty) render();
  const node = rowAt({ file: under.file, line: under.line });
  const view = views.get(files.active());
  const edit = node && withRepairs(model, mountOn(model, node, relativePath(node.file, result.path)), [node]);
  if (!view || !edit || 'refused' in edit) return report(`mount ${result.path}`, edit && 'refused' in edit ? edit.refused : 'the row is gone');
  view.applyFile(node.file, edit.edits, 'wizard');
}

/**
 * What Close file on `file` closes (spec §6): the file, and the files opened only to show its
 * mounts, except those a segment of another open file still shows. Null when no other file would
 * stay open.
 */
function closing(file: OpenFile<CodeMirrorBuffer>): OpenFile<CodeMirrorBuffer>[] | null {
  const others = files.files().filter((f) => f.shown && f !== file);
  if (others.length === 0) return null;
  const segments = (f: OpenFile) => views.get(f)?.pieces().files() ?? (f.path === null ? [] : [f.path]);
  const kept = new Set(others.flatMap(segments));
  const own = new Set(segments(file));
  return files.files().filter((f) => f.path !== null && !kept.has(f.path) && (f === file || (!f.shown && own.has(f.path))));
}

/** Close file: the active file closes, after the unsaved-changes dialog, and the next open file becomes active. */
async function closeFile(): Promise<void> {
  const file = files.active();
  const drop = closing(file);
  if (!drop || !(await settleUnsaved(drop))) return;
  files.close(file, drop);
  for (const f of new Set([file, ...drop])) {
    views.get(f)?.destroy();
    views.delete(f);
  }
  status.textContent = `Closed ${file.path}`;
}

/** Close folder, or Close in the single-file workspace: everything closes, and the start screen shows. The remembered folder stays. */
async function closeAll(): Promise<void> {
  if (!(await settleUnsaved())) return;
  const buffer = files.active().buffer;
  buffer.apply([{ from: 0, to: buffer.text().length, insert: '' }], 'load');
  useFiles(createOpenFiles(createSingleFileWorkspace(), buffer, null, { makeBuffer, ask: { overwrite } }));
  status.textContent = '';
  showStart(true);
  void renderReopen();
}

/** Reads every open file again, on focus and Refresh (spec §6). */
async function refresh(): Promise<void> {
  await files.refresh();
  // Mounted files are read again too, and the active file analyzed with them.
  mounts.reread();
  dirty = true;
  schedule();
  const missing = files.files().filter((f) => f.missing);
  if (missing.length > 0) status.textContent = `${names(missing.map(nameOf))} ${missing.length === 1 ? 'is' : 'are'} no longer on disk`;
  updateTitle();
}

// The buffer the editor shows, set by boot.
let shownBuffer: CodeMirrorBuffer;

// One editor is mounted at a time, over the active file's buffer (spec §3.4).
const editors = [
  {
    id: 'text',
    label: 'Text',
    mount: (): PlanEditor =>
      mountTextEditor(editorBuffer(files.active()), editorHost, { onCursorLine, onSave: () => void save(), root: files.active().path ?? '', onOpenFile: (path) => openFile(path) }),
  },
  {
    id: 'grid',
    label: 'Grid',
    // In a folder the grid shows the composed view, every file in it, and edits each in its own file (spec §4b.1).
    mount: (): PlanEditor =>
      mountGrid(editorBuffer(files.active()), editorHost, {
        onCursorLine,
        onOpenFile: (path) => openFile(path),
        status: (message) => (status.textContent = message),
        // Only a workspace that can list files has plans to mount.
        ...(files.workspace.can.list ? { plans: listPlans } : {}),
      }),
  },
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
  // The new editor marks the files with unsaved changes too (the segments' headers).
  updateTitle();
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
const newButton = button('New…', 'new');
const openFolderButton = button('Open folder', 'open-folder');
const reopenButton = button('Reopen', 'reopen');
const saveAllButton = button('Save all', 'save-all');
const refreshButton = button('Refresh', 'refresh');
const closeButton = button('Close', 'close');
openButton.textContent = 'Open file';
openButton.before(newButton);
openButton.after(openFolderButton, reopenButton);
saveAsButton.after(saveAllButton, refreshButton, closeButton);
// The Close menu, in a folder: Close file and Close folder. In the single-file workspace Close closes at once.
const closeMenu = document.createElement('div');
closeMenu.className = 'close-menu';
closeMenu.setAttribute('role', 'menu');
closeMenu.hidden = true;
const closeFileItem = button('Close file', 'close-file');
const closeFolderItem = button('Close folder', 'close-folder');
for (const item of [closeFileItem, closeFolderItem]) item.setAttribute('role', 'menuitem');
closeMenu.append(closeFileItem, closeFolderItem);
// Anchors the menu under the Close button.
const closeAnchor = document.createElement('span');
closeAnchor.className = 'close-anchor';
closeAnchor.append(closeMenu);
closeButton.after(closeAnchor);
const showCloseMenu = (on: boolean): void => {
  closeMenu.hidden = !on;
  closeButton.setAttribute('aria-expanded', String(on));
  if (on) closeMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
};
const panelHost = document.createElement('nav');
panelHost.id = 'files';
editorHost.before(panelHost);
const panel = mountFilePanel(panelHost, (path) => {
  files.show(path).catch((e) => report('open', e));
});
const preview = document.getElementById('preview')!;

// The start screen shows on every load, and after Close folder (spec §6).
let starting = false;

/** What the toolbar and panel offer follows what the workspace can do (PLUGINS.md §7.1); the start screen has no document. */
function renderToolbar(): void {
  const { can } = files.workspace;
  saveButton.textContent = can.saveInPlace ? 'Save' : 'Download';
  saveButton.hidden = starting;
  saveAsButton.hidden = starting || !can.saveInPlace || !can.saveAs;
  saveAllButton.hidden = starting || !can.list;
  refreshButton.hidden = starting || !can.saveInPlace;
  closeButton.hidden = starting;
  if (can.list) closeButton.setAttribute('aria-haspopup', 'menu');
  else closeButton.removeAttribute('aria-haspopup');
  showCloseMenu(false);
  editorTabs.hidden = filename.hidden = starting;
  panelHost.hidden = starting || !can.list;
}

const noFolder = folderUnavailable();
openFolderButton.disabled = noFolder !== null;
openFolderButton.title = noFolder ?? '';
reopenButton.hidden = true;

const startHost = document.createElement('section');
startHost.id = 'start';
panelHost.before(startHost);
const reopen = (): void => {
  const folder = remembered;
  if (folder) void open(() => createFolderWorkspace(window, memory, folder));
};
const startScreen = mountStartScreen(startHost, TEMPLATES, noFolder, {
  reopen,
  newPlan: () => void newPlan(),
  openFolder: () => void open(() => createFolderWorkspace(window, memory)),
  openFile: () => void open(() => createSingleFileWorkspace()),
  template: openTemplate,
});

/** The start screen, in place of the panes; or the panes. */
function showStart(on: boolean): void {
  starting = on;
  editorHost.hidden = preview.hidden = on;
  renderToolbar();
  updateTitle();
  startScreen.show(on);
}

// The folder Reopen reopens, read when the page loads and after every open.
let remembered: FileSystemDirectoryHandle | null = null;

/** Reopen shows while a folder is remembered; asking for permission again needs a click. */
async function renderReopen(): Promise<void> {
  remembered = noFolder === null ? ((await memory.load())?.handle ?? null) : null;
  reopenButton.hidden = !remembered;
  if (remembered) reopenButton.textContent = `Reopen ${remembered.name}`;
  startScreen.setReopen(remembered?.name ?? null);
}

let files: OpenFiles<CodeMirrorBuffer>;
/** A mounted file open in the store gives its current text, unsaved edits included. */
const openText = (path: string): string | undefined => files.files().find((f) => f.path === path)?.buffer.text();
let mounts: ReturnType<typeof createMounts>;

/**
 * Starts the app. A real load shows the start screen; `document` opens that text instead, as an
 * untitled document in the single-file workspace, which tests use.
 */
export function boot(options: { document?: string } = {}): void {
  const first = new CodeMirrorBuffer(options.document ?? '');
  shownBuffer = first;
  files = createOpenFiles(createSingleFileWorkspace(), first, null, { makeBuffer, ask: { overwrite } });
  mounts = createMounts({ workspace: files.workspace, openText }, gathered);
  files.onChange(onFilesChange);
  watch(first);
  mountEditor(lastEditor());

  exportBar.replaceChildren(...exportButtons);
  render();
  showStart(options.document === undefined);
  void renderReopen();
}

newButton.addEventListener('click', () => void newPlan());
openButton.addEventListener('click', () => void open(() => createSingleFileWorkspace()));
openFolderButton.addEventListener('click', () => void open(() => createFolderWorkspace(window, memory)));
reopenButton.addEventListener('click', reopen);
closeButton.addEventListener('click', () => {
  if (files.workspace.can.list) showCloseMenu(closeButton.getAttribute('aria-expanded') !== 'true');
  else void closeAll();
});
closeMenu.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  showCloseMenu(false);
  closeButton.focus();
});
closeFileItem.addEventListener('click', () => (showCloseMenu(false), void closeFile()));
closeFolderItem.addEventListener('click', () => (showCloseMenu(false), void closeAll()));
document.addEventListener('click', (event) => {
  if (!closeMenu.hidden && !closeMenu.contains(event.target as Node) && event.target !== closeButton) showCloseMenu(false);
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
