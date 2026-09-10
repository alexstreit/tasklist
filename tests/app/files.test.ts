// @vitest-environment jsdom
// Open/save through the File System Access API and through the fallback.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileStore } from '../../src/app/files';

function fakeHandle(name: string, text: string) {
  const written: string[] = [];
  const handle = {
    name,
    getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({ write: async (t: string) => void written.push(t), close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  return { handle, written };
}

function abort(): Promise<never> {
  return Promise.reject(new DOMException('cancelled', 'AbortError'));
}

describe('native store', () => {
  function setup(opened?: ReturnType<typeof fakeHandle>, saveTarget?: ReturnType<typeof fakeHandle>) {
    const win = {
      showOpenFilePicker: vi.fn(async () => (opened ? [opened.handle] : abort())),
      showSaveFilePicker: vi.fn(async () => (saveTarget ? saveTarget.handle : abort())),
      document,
    } as unknown as Window;
    return { store: createFileStore(win), win: win as unknown as { showOpenFilePicker: ReturnType<typeof vi.fn>; showSaveFilePicker: ReturnType<typeof vi.fn> } };
  }

  it('opens a file and saves back to the same handle without prompting', async () => {
    const file = fakeHandle('q4.plan', 'Auth | 2d\n');
    const { store, win } = setup(file);
    expect(store.name).toBeNull();
    expect(await store.open()).toEqual({ name: 'q4.plan', text: 'Auth | 2d\n' });
    expect(store.name).toBe('q4.plan');
    expect(await store.save('Auth | 3d\n')).toBe(true);
    expect(file.written).toEqual(['Auth | 3d\n']);
    expect(win.showSaveFilePicker).not.toHaveBeenCalled();
  });

  it('save on a new document prompts once; later saves reuse the handle', async () => {
    const target = fakeHandle('new.plan', '');
    const { store, win } = setup(undefined, target);
    expect(await store.save('a\n')).toBe(true);
    expect(await store.save('b\n')).toBe(true);
    expect(win.showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(win.showSaveFilePicker.mock.calls[0][0]).toMatchObject({ suggestedName: 'untitled.plan' });
    expect(target.written).toEqual(['a\n', 'b\n']);
    expect(store.name).toBe('new.plan');
  });

  it('save as always prompts and suggests the current name', async () => {
    const file = fakeHandle('q4.plan', '');
    const target = fakeHandle('copy.plan', '');
    const { store, win } = setup(file, target);
    await store.open();
    expect(await store.saveAs('x\n')).toBe(true);
    expect(win.showSaveFilePicker.mock.calls[0][0]).toMatchObject({ suggestedName: 'q4.plan' });
    expect(target.written).toEqual(['x\n']);
    expect(file.written).toEqual([]);
    expect(store.name).toBe('copy.plan');
  });

  it('treats a dismissed picker as cancel', async () => {
    const { store } = setup();
    expect(await store.open()).toBeNull();
    expect(await store.save('x')).toBe(false);
    expect(store.name).toBeNull();
  });
});

describe('fallback store', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is chosen when the picker API is missing', () => {
    expect('showOpenFilePicker' in window).toBe(false);
    expect(createFileStore(window)).toBeDefined();
  });

  it('opens through a file input', async () => {
    let input: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });
    const store = createFileStore(window);
    const opened = store.open();
    expect(input?.type).toBe('file');
    Object.defineProperty(input, 'files', { value: [new File(['A | 1h\n'], 'a.plan')] });
    input!.dispatchEvent(new Event('change'));
    expect(await opened).toEqual({ name: 'a.plan', text: 'A | 1h\n' });
    expect(store.name).toBe('a.plan');
  });

  it('saves as a download named after the open file', async () => {
    let link: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      link = this;
    });
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => (blobs.push(blob), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const store = createFileStore(window);
    expect(await store.save('A | 1h\n')).toBe(true);
    expect(link?.download).toBe('untitled.plan');
    expect(link?.href).toBe('blob:x');
    expect(await blobs[0].text()).toBe('A | 1h\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
