// @vitest-environment jsdom
// The single-file workspace (PLUGINS.md §7.1): open and save through the File System Access API
// and through the fallback, reporting what each write actually did.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSingleFileWorkspace } from '../../src/app/workspace';

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

describe('native workspace', () => {
  function setup(opened?: ReturnType<typeof fakeHandle>, saveTarget?: ReturnType<typeof fakeHandle>) {
    const win = {
      showOpenFilePicker: vi.fn(async () => (opened ? [opened.handle] : abort())),
      showSaveFilePicker: vi.fn(async () => (saveTarget ? saveTarget.handle : abort())),
      document,
    } as unknown as Window;
    Object.assign(win, { self: win, top: win });
    return { store: createSingleFileWorkspace(win), win: win as unknown as { showOpenFilePicker: ReturnType<typeof vi.fn>; showSaveFilePicker: ReturnType<typeof vi.fn> } };
  }

  it('opens a file and writes back to the same handle without prompting', async () => {
    const file = fakeHandle('q4.plan', 'Auth | 2d\n');
    const { store, win } = setup(file);
    expect(store.can).toEqual({ list: false, watch: false, saveInPlace: true });
    expect(await store.list()).toEqual([]);
    expect(await store.open()).toEqual({ path: 'q4.plan', text: 'Auth | 2d\n' });
    expect(win.showOpenFilePicker.mock.calls[0][0].types[0].accept).toEqual({ 'text/plain': ['.plan', '.rows'] });
    expect(await store.list()).toEqual(['q4.plan']);
    expect(await store.read('q4.plan')).toBe('Auth | 2d\n');
    expect(await store.write('q4.plan', 'Auth | 3d\n')).toEqual({ outcome: 'saved', path: 'q4.plan' });
    expect(file.written).toEqual(['Auth | 3d\n']);
    expect(win.showSaveFilePicker).not.toHaveBeenCalled();
  });

  it('save as prompts once with the suggested name; later writes reuse the handle', async () => {
    const target = fakeHandle('new.plan', '');
    const { store, win } = setup(undefined, target);
    expect(await store.saveAs('a\n', 'untitled.plan')).toEqual({ outcome: 'saved', path: 'new.plan' });
    expect(await store.write('new.plan', 'b\n')).toEqual({ outcome: 'saved', path: 'new.plan' });
    expect(win.showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(win.showSaveFilePicker.mock.calls[0][0]).toMatchObject({ suggestedName: 'untitled.plan' });
    expect(target.written).toEqual(['a\n', 'b\n']);
  });

  it('save as writes to the new handle, not the opened one', async () => {
    const file = fakeHandle('q4.plan', '');
    const target = fakeHandle('copy.plan', '');
    const { store, win } = setup(file, target);
    await store.open();
    expect(await store.saveAs('x\n', 'q4.plan')).toEqual({ outcome: 'saved', path: 'copy.plan' });
    expect(win.showSaveFilePicker.mock.calls[0][0]).toMatchObject({ suggestedName: 'q4.plan' });
    expect(target.written).toEqual(['x\n']);
    expect(file.written).toEqual([]);
  });

  it('treats a dismissed picker as cancel', async () => {
    const { store } = setup();
    expect(await store.open()).toBeNull();
    expect(await store.saveAs('x', 'untitled.plan')).toEqual({ outcome: 'cancelled' });
  });

  it('reports a failed write, and any other path as needing a folder workspace', async () => {
    const file = fakeHandle('q4.plan', '');
    file.handle.createWritable = async () => {
      throw new DOMException('The user denied write access', 'NotAllowedError');
    };
    const { store } = setup(file);
    await store.open();
    expect(await store.write('q4.plan', 'x')).toEqual({ outcome: 'failed', reason: 'The user denied write access' });
    expect(await store.write('other.plan', 'x')).toEqual({ outcome: 'failed', reason: 'other.plan is not the open file; reading other files needs a folder workspace' });
    await expect(store.read('other.plan')).rejects.toThrow('needs a folder workspace');
  });

  it('resolves an include path relative to the file', () => {
    const { store } = setup();
    expect(store.resolve('q4.plan', 'team.plan')).toBe('team.plan');
    expect(store.resolve('plans/q4.plan', './sub/a.plan')).toBe('plans/sub/a.plan');
    expect(store.resolve('plans/q4.plan', '../shared.plan')).toBe('shared.plan');
  });
});

describe('fallback workspace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is chosen when the picker API is missing', () => {
    expect('showOpenFilePicker' in window).toBe(false);
    expect(createSingleFileWorkspace(window).can.saveInPlace).toBe(false);
  });

  it('is chosen inside an iframe even when the picker API exists', () => {
    const win = { showOpenFilePicker: vi.fn(), showSaveFilePicker: vi.fn(), document, top: {} } as unknown as Window;
    Object.assign(win, { self: win });
    expect(createSingleFileWorkspace(win).can.saveInPlace).toBe(false);
  });

  it('opens through a file input', async () => {
    let input: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });
    const store = createSingleFileWorkspace(window);
    const opened = store.open();
    expect(input?.type).toBe('file');
    expect(input?.accept).toBe('.plan,.rows');
    Object.defineProperty(input, 'files', { value: [new File(['A | 1h\n'], 'a.plan')] });
    input!.dispatchEvent(new Event('change'));
    expect(await opened).toEqual({ path: 'a.plan', text: 'A | 1h\n' });
    expect(await store.list()).toEqual(['a.plan']);
    expect(await store.read('a.plan')).toBe('A | 1h\n');
  });

  it('downloads in place of writing, and says so', async () => {
    let link: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      link = this;
    });
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => (blobs.push(blob), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const store = createSingleFileWorkspace(window);
    expect(await store.saveAs('A | 1h\n', 'untitled.plan')).toEqual({ outcome: 'downloaded' });
    expect(link?.download).toBe('untitled.plan');
    expect(link?.href).toBe('blob:x');
    expect(await blobs[0].text()).toBe('A | 1h\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(await store.write('a.plan', 'A | 2h\n')).toEqual({ outcome: 'downloaded' });
    expect(link?.download).toBe('a.plan');
    expect(await blobs[1].text()).toBe('A | 2h\n');
  });
});
