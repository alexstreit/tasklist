// Open and save. File System Access API where available, otherwise
// <input type="file"> for open and a download for save. Spec §6.

export interface OpenedFile {
  name: string;
  text: string;
}

export interface FileStore {
  /** Name of the current file; null for a new document. */
  readonly name: string | null;
  /** True when save writes back to the opened file; false when it downloads a copy. */
  readonly inPlace: boolean;
  /** Resolves null when the user cancels. */
  open(): Promise<OpenedFile | null>;
  /** Save to the current file, or Save As when there is none. Resolves false when cancelled. */
  save(text: string): Promise<boolean>;
  saveAs(text: string): Promise<boolean>;
}

const TYPES = [{ description: 'Plan files', accept: { 'text/plain': ['.plan', '.txt'] } }];
const DEFAULT_NAME = 'untitled.plan';

// Not in TypeScript's DOM lib yet.
interface PickerWindow {
  showOpenFilePicker?(options?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: object): Promise<FileSystemFileHandle>;
}

export function createFileStore(win: Window = window): FileStore {
  const picker = win as unknown as PickerWindow;
  return picker.showOpenFilePicker && picker.showSaveFilePicker ? nativeStore(picker) : fallbackStore(win.document);
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

function nativeStore(win: PickerWindow): FileStore {
  let handle: FileSystemFileHandle | null = null;
  const write = async (text: string): Promise<boolean> => {
    const stream = await handle!.createWritable();
    await stream.write(text);
    await stream.close();
    return true;
  };
  const store: FileStore = {
    inPlace: true,
    get name() {
      return handle?.name ?? null;
    },
    async open() {
      const picked = await cancellable(win.showOpenFilePicker!({ types: TYPES }));
      if (!picked) return null;
      handle = picked[0];
      const file = await handle.getFile();
      return { name: handle.name, text: await file.text() };
    },
    save(text) {
      return handle ? write(text) : store.saveAs(text);
    },
    async saveAs(text) {
      const picked = await cancellable(win.showSaveFilePicker!({ types: TYPES, suggestedName: handle?.name ?? DEFAULT_NAME }));
      if (!picked) return false;
      handle = picked;
      return write(text);
    },
  };
  return store;
}

function fallbackStore(document: Document): FileStore {
  let name: string | null = null;
  const store: FileStore = {
    inPlace: false,
    get name() {
      return name;
    },
    open() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.plan,.txt,text/plain';
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          name = file.name;
          resolve({ name, text: await file.text() });
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
    async save(text) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      link.download = name ?? DEFAULT_NAME;
      link.click();
      URL.revokeObjectURL(link.href);
      return true;
    },
    saveAs(text) {
      return store.save(text);
    },
  };
  return store;
}
