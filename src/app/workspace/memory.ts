// The last folder opened, kept in IndexedDB with the file last active in it, so "Reopen" can ask the
// browser for permission again with one click (spec §6). A per-viewer convenience: when storage is
// unavailable (private browsing, a framed page) nothing is remembered, and nothing fails.

export interface RememberedFolder {
  handle: FileSystemDirectoryHandle;
  /** The file last active in it, relative to the folder. */
  active: string | null;
}

export interface FolderMemory {
  load(): Promise<RememberedFolder | null>;
  /** Replaces whatever folder was remembered before. */
  remember(handle: FileSystemDirectoryHandle, active: string | null): Promise<void>;
  /** Records the active file of the remembered folder. */
  setActive(path: string): Promise<void>;
  forget(): Promise<void>;
}

const DB = 'plan';
const STORE = 'folder';
const KEY = 'last';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const db = await request(open);
  try {
    return await request(body(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export function createFolderMemory(): FolderMemory {
  const memory: FolderMemory = {
    async load() {
      try {
        return ((await run('readonly', (store) => store.get(KEY))) as RememberedFolder | undefined) ?? null;
      } catch {
        return null;
      }
    },
    async remember(handle, active) {
      try {
        await run('readwrite', (store) => store.put({ handle, active }, KEY));
      } catch {
        // Not remembered: the user opens the folder with the picker next time.
      }
    },
    async setActive(path) {
      const folder = await memory.load();
      if (folder) await memory.remember(folder.handle, path);
    },
    async forget() {
      try {
        await run('readwrite', (store) => store.delete(KEY));
      } catch {
        // Nothing was remembered, or nothing can be.
      }
    },
  };
  return memory;
}
