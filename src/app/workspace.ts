// The single-file workspace (PLUGINS.md §7.1): Task 4's open and save behind the Workspace
// interface. File System Access API where available, otherwise <input type="file"> for open and a
// download for save. Spec §6.

import type { OpenedFile, Workspace, WriteResult } from '../core';

// Open takes plan and rows files; Save As offers .plan first (spec §6).
const TYPES = [{ description: 'Plan and rows files', accept: { 'text/plain': ['.plan', '.rows'] } }];

// Not in TypeScript's DOM lib yet.
interface PickerWindow {
  showOpenFilePicker?(options?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: object): Promise<FileSystemFileHandle>;
}

export function createSingleFileWorkspace(win: Window = window): Workspace {
  const picker = win as unknown as PickerWindow;
  // Chromium refuses to show the pickers from a cross-origin frame (e.g. the
  // VS Code Simple Browser), so a framed page uses the fallback.
  const framed = win.self !== win.top;
  return picker.showOpenFilePicker && picker.showSaveFilePicker && !framed ? nativeWorkspace(picker) : fallbackWorkspace(win.document);
}

/** Resolves null when the user dismissed a picker. */
async function cancellable<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

const message = (e: unknown): string => (typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e));
const needsFolder = (path: string) => new Error(`${path} is not the open file; reading other files needs a folder workspace`);

/** The parts every single-file workspace shares: it lists and resolves only relative to the one file. */
function singleFile(current: () => string | null): Pick<Workspace, 'list' | 'resolve'> {
  return {
    list: async () => {
      const path = current();
      return path === null ? [] : [path];
    },
    resolve(from, ref) {
      const parts = [...from.split('/').slice(0, -1), ...ref.split('/')];
      const out: string[] = [];
      for (const part of parts) {
        if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else if (part !== '.' && part !== '') out.push(part);
      }
      return out.join('/');
    },
  };
}

function nativeWorkspace(win: PickerWindow): Workspace {
  let handle: FileSystemFileHandle | null = null;
  const write = async (text: string): Promise<WriteResult> => {
    try {
      const stream = await handle!.createWritable();
      await stream.write(text);
      await stream.close();
      return { outcome: 'saved', path: handle!.name };
    } catch (e) {
      return { outcome: 'failed', reason: message(e) };
    }
  };
  return {
    can: { list: false, watch: false, saveInPlace: true },
    ...singleFile(() => handle?.name ?? null),
    async open(): Promise<OpenedFile | null> {
      const picked = await cancellable(win.showOpenFilePicker!({ types: TYPES }));
      if (!picked) return null;
      handle = picked[0];
      const file = await handle.getFile();
      return { path: handle.name, text: await file.text() };
    },
    async read(path) {
      if (!handle || path !== handle.name) throw needsFolder(path);
      return (await handle.getFile()).text();
    },
    async write(path, text) {
      if (!handle || path !== handle.name) return { outcome: 'failed', reason: needsFolder(path).message };
      return write(text);
    },
    async saveAs(text, suggested) {
      let picked;
      try {
        picked = await cancellable(win.showSaveFilePicker!({ types: TYPES, suggestedName: suggested }));
      } catch (e) {
        return { outcome: 'failed', reason: message(e) };
      }
      if (!picked) return { outcome: 'cancelled' };
      handle = picked;
      return write(text);
    },
  };
}

function fallbackWorkspace(document: Document): Workspace {
  let opened: File | null = null;
  const download = (text: string, name: string): WriteResult => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
    return { outcome: 'downloaded' };
  };
  return {
    can: { list: false, watch: false, saveInPlace: false },
    ...singleFile(() => opened?.name ?? null),
    open() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.plan,.rows';
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          opened = file;
          resolve({ path: file.name, text: await file.text() });
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
    async read(path) {
      if (!opened || path !== opened.name) throw needsFolder(path);
      return opened.text();
    },
    // Nothing is written in place: the browser downloads a copy.
    write: async (path, text) => download(text, path),
    saveAs: async (text, suggested) => download(text, suggested),
  };
}
