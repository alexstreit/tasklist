// The folder workspace (PLUGINS.md §7.1): a folder picked with the File System Access API, holding
// plan and rows files at paths relative to it. Each file is read and written in place; nothing is
// created except a file saved back after it went missing (spec §6).

import { Notice } from '../../core';
import type { OpenedFile, Workspace, WriteResult } from '../../core';
import type { FolderMemory } from './memory';
import { cancellable, message } from './single';

// Not in TypeScript's DOM lib yet.
interface DirectoryPickerWindow {
  showDirectoryPicker?(options?: object): Promise<FileSystemDirectoryHandle>;
}
interface Permissions {
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface Entries {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}

const PLAN_FILE = /\.(plan|rows)$/;

/** Why this browser can't open a folder; null when it can. Asked of the browser's API, never its name. */
export function folderUnavailable(win: Window = window): string | null {
  if (!(win as unknown as DirectoryPickerWindow).showDirectoryPicker) return 'Opening a folder needs Edge or Chrome';
  // Chromium refuses to show pickers from a cross-origin frame (e.g. the VS Code Simple Browser).
  if (win.self !== win.top) return 'Opening a folder does not work in an embedded browser frame';
  return null;
}

/** Top-level files first, then each folder's, by name: the order the file panel shows. */
function byFolder(a: string, b: string): number {
  const dir = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
  return dir(a) === dir(b) ? (a < b ? -1 : 1) : dir(a) < dir(b) ? -1 : 1;
}

const notFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError';

/**
 * `remembered` reopens a folder from an earlier visit, asking the browser for permission again, in
 * place of showing the picker.
 */
export function createFolderWorkspace(win: Window, memory: FolderMemory, remembered?: FileSystemDirectoryHandle): Workspace {
  let root: FileSystemDirectoryHandle | null = null;

  const fileAt = async (path: string, create = false): Promise<FileSystemFileHandle> => {
    if (!root) throw new Error('No folder is open');
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(parts[parts.length - 1], { create });
  };

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> => {
    for await (const [name, entry] of (dir as unknown as Entries).entries()) {
      if (entry.kind === 'directory') {
        if (!name.startsWith('.') && name !== 'node_modules') await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`, out);
      } else if (PLAN_FILE.test(name)) out.push(prefix + name);
    }
  };

  const workspace: Workspace = {
    can: { list: true, watch: false, saveInPlace: true, saveAs: false },

    async open(): Promise<OpenedFile | null> {
      let handle: FileSystemDirectoryHandle;
      let paths: string[];
      if (remembered) {
        handle = remembered;
        const gone = new Notice(`${handle.name} can no longer be found, so it was forgotten`);
        try {
          const state = await (handle as unknown as Permissions).requestPermission({ mode: 'readwrite' });
          if (state !== 'granted') throw new Notice(`Permission to open ${handle.name} was refused`);
          root = handle;
          paths = await workspace.list();
        } catch (e) {
          if (!notFound(e)) throw e;
          await memory.forget();
          throw gone;
        }
      } else {
        const picked = await cancellable((win as unknown as DirectoryPickerWindow).showDirectoryPicker!({ mode: 'readwrite' }));
        if (!picked) return null;
        handle = root = picked;
        paths = await workspace.list();
      }
      if (paths.length === 0) throw new Notice('No plan files in folder');
      // The file last active in this folder, else the first at its top level, else the first listed.
      const last = await memory.load();
      const lastActive = last && (await last.handle.isSameEntry(handle)) ? last.active : null;
      const path = lastActive !== null && paths.includes(lastActive) ? lastActive : (paths.find((p) => !p.includes('/')) ?? paths[0]);
      const text = await workspace.read(path);
      await memory.remember(handle, path);
      return { path, text };
    },

    async list() {
      if (!root) throw new Error('No folder is open');
      const out: string[] = [];
      await walk(root, '', out);
      return out.sort(byFolder);
    },

    async read(path) {
      return (await (await fileAt(path)).getFile()).text();
    },

    // Creates the file, and its folders, only when they are missing: saving back a file that went
    // missing on disk, after the user said so.
    async write(path, text): Promise<WriteResult> {
      try {
        const stream = await (await fileAt(path, true)).createWritable();
        await stream.write(text);
        await stream.close();
        return { outcome: 'saved', path };
      } catch (e) {
        return { outcome: 'failed', reason: message(e) };
      }
    },

    saveAs: async () => ({ outcome: 'failed', reason: 'Creating files comes in a later task' }),

    resolve(from, ref) {
      const out = from.split('/').slice(0, -1);
      for (const part of ref.split('/')) {
        if (part === '..') {
          if (out.length === 0) throw new Error(`${ref} from ${from} is outside the folder`);
          out.pop();
        } else if (part !== '.' && part !== '') out.push(part);
      }
      return out.join('/');
    },
  };
  return workspace;
}
