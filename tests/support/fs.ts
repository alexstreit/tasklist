// An in-memory fake of the File System Access handles a folder workspace uses. The handles read and
// write a plain object tree, so a test edits or deletes "on disk" by changing the tree.

export interface Tree {
  [name: string]: string | Tree;
}

export interface FakeFolder {
  handle: FileSystemDirectoryHandle;
  tree: Tree;
  /** What requestPermission answers. */
  permission: PermissionState;
  /** True once the folder itself is deleted or moved: every call fails with NotFoundError. */
  gone: boolean;
  /** Every write, as [path, text]. */
  writes: [string, string][];
}

const notFound = (name: string) => new DOMException(`${name} was not found`, 'NotFoundError');

export function fakeFolder(name: string, tree: Tree): FakeFolder {
  const folder: FakeFolder = { handle: undefined as unknown as FileSystemDirectoryHandle, tree, permission: 'granted', gone: false, writes: [] };
  const check = () => {
    if (folder.gone) throw notFound(name);
  };

  const file = (dir: Tree, fileName: string, path: string) => ({
    kind: 'file' as const,
    name: fileName,
    async getFile() {
      check();
      if (typeof dir[fileName] !== 'string') throw notFound(fileName);
      const text = dir[fileName] as string;
      return { text: async () => text };
    },
    async createWritable() {
      check();
      let out = '';
      return {
        write: async (t: string) => void (out += t),
        close: async () => {
          dir[fileName] = out;
          folder.writes.push([path, out]);
        },
      };
    },
  });

  const directory = (node: Tree, dirName: string, prefix: string): object => ({
    kind: 'directory' as const,
    name: dirName,
    node,
    async *entries() {
      check();
      for (const [key, value] of Object.entries(node)) {
        yield [key, typeof value === 'string' ? file(node, key, prefix + key) : directory(value, key, `${prefix}${key}/`)];
      }
    },
    async getDirectoryHandle(key: string, options?: { create?: boolean }) {
      check();
      if (node[key] === undefined && options?.create) node[key] = {};
      if (typeof node[key] !== 'object') throw notFound(key);
      return directory(node[key] as Tree, key, `${prefix}${key}/`);
    },
    async getFileHandle(key: string, options?: { create?: boolean }) {
      check();
      if (node[key] === undefined && options?.create) node[key] = '';
      if (typeof node[key] !== 'string') throw notFound(key);
      return file(node, key, prefix + key);
    },
    async isSameEntry(other: { node?: Tree }) {
      return other.node === node;
    },
    async queryPermission() {
      return folder.permission;
    },
    async requestPermission() {
      check();
      return folder.permission;
    },
  });

  folder.handle = directory(tree, name, '') as FileSystemDirectoryHandle;
  return folder;
}

/** A FolderMemory that lives in memory, for tests that run without IndexedDB. */
export function fakeMemory() {
  let stored: { handle: FileSystemDirectoryHandle; active: string | null } | null = null;
  return {
    load: async () => (stored ? { ...stored } : null),
    remember: async (handle: FileSystemDirectoryHandle, active: string | null) => void (stored = { handle, active }),
    setActive: async (path: string) => void (stored && (stored = { ...stored, active: path })),
    forget: async () => void (stored = null),
  };
}
