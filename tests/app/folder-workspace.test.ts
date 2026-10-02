// @vitest-environment jsdom
// The folder workspace (PLUGINS.md §7.1): it lists a folder's plan files recursively, reads and
// writes them by relative path, resolves paths inside the folder only, and remembers the folder so
// it can be reopened with one click.

import { describe, expect, it, vi } from 'vitest';
import { Notice } from '../../src/core';
import { createFolderWorkspace, folderUnavailable } from '../../src/app/workspace';
import { fakeFolder, fakeMemory } from '../support/fs';
import type { Tree } from '../support/fs';

const portfolio = (): Tree => ({
  'portfolio.plan': 'Portfolio\n',
  'notes.txt': 'not a plan',
  teams: { 'alpha.plan': 'A | 1d\n', 'beta.rows': 'B\n', deep: { 'gamma.plan': 'G\n' } },
  '.git': { 'hidden.plan': 'x' },
  node_modules: { 'pkg.plan': 'x' },
});

function setup(tree: Tree = portfolio(), memory = fakeMemory()) {
  const folder = fakeFolder('Portfolio', tree);
  const showDirectoryPicker = vi.fn(async () => folder.handle);
  const win = { showDirectoryPicker } as unknown as Window;
  Object.assign(win, { self: win, top: win });
  return { folder, memory, win, showDirectoryPicker, workspace: createFolderWorkspace(win, memory) };
}

describe('folder workspace', () => {
  it('can list and save in place, and cannot save as', () => {
    expect(setup().workspace.can).toEqual({ list: true, watch: false, saveInPlace: true, saveAs: false });
  });

  it('lists plan and rows files recursively, relative to the folder, skipping dot-folders and node_modules', async () => {
    // Only dot-folders are skipped; a dot-file is listed.
    const { workspace, showDirectoryPicker } = setup({ ...portfolio(), '.hidden.plan': 'x' });
    await workspace.open();
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(await workspace.list()).toEqual(['.hidden.plan', 'portfolio.plan', 'teams/alpha.plan', 'teams/beta.rows', 'teams/deep/gamma.plan']);
  });

  it('reads and writes by relative path', async () => {
    const { workspace, folder } = setup();
    await workspace.open();
    expect(await workspace.read('teams/alpha.plan')).toBe('A | 1d\n');
    expect(await workspace.write('teams/alpha.plan', 'A | 2d\n')).toEqual({ outcome: 'saved', path: 'teams/alpha.plan' });
    expect((folder.tree.teams as Tree)['alpha.plan']).toBe('A | 2d\n');
    await expect(workspace.read('teams/none.plan')).rejects.toThrow('none.plan was not found');
  });

  it('save as creates nothing: that comes later', async () => {
    const { workspace } = setup();
    expect(await workspace.saveAs('x', 'untitled.plan')).toEqual({ outcome: 'failed', reason: 'Creating files comes in a later task' });
  });

  it('resolves relative paths, normalising . and .., and refuses one outside the folder', () => {
    const { workspace } = setup();
    expect(workspace.resolve('portfolio.plan', 'teams/alpha.plan')).toBe('teams/alpha.plan');
    expect(workspace.resolve('teams/alpha.plan', './deep/gamma.plan')).toBe('teams/deep/gamma.plan');
    expect(workspace.resolve('teams/deep/gamma.plan', '../../portfolio.plan')).toBe('portfolio.plan');
    expect(workspace.resolve('teams/alpha.plan', 'deep/../beta.rows')).toBe('teams/beta.rows');
    expect(() => workspace.resolve('teams/alpha.plan', '../../other.plan')).toThrow('../../other.plan from teams/alpha.plan is outside the folder');
    expect(() => workspace.resolve('portfolio.plan', '../x.plan')).toThrow('outside the folder');
  });

  it('treats a dismissed picker as cancel', async () => {
    const { workspace, showDirectoryPicker } = setup();
    showDirectoryPicker.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    expect(await workspace.open()).toBeNull();
  });
});

describe('the file shown first', () => {
  it('is the first file at the top level', async () => {
    const { workspace } = setup({ a: { 'z.plan': 'z' }, 'b.plan': 'b', 'c.plan': 'c' });
    expect(await workspace.open()).toEqual({ path: 'b.plan', text: 'b' });
  });

  it('is the first listed when there is none at the top level', async () => {
    const { workspace } = setup({ b: { 'z.plan': 'z' }, a: { 'y.plan': 'y' } });
    expect(await workspace.open()).toEqual({ path: 'a/y.plan', text: 'y' });
  });

  it('is the file last active in the same folder', async () => {
    const tree = portfolio();
    const memory = fakeMemory();
    const first = setup(tree, memory);
    await first.workspace.open();
    await memory.setActive('teams/alpha.plan');
    // Picked again: the same folder, so its last active file comes back.
    const second = createFolderWorkspace(first.win, memory);
    expect(await second.open()).toEqual({ path: 'teams/alpha.plan', text: 'A | 1d\n' });
  });

  it('ignores a last active file that is gone, and one from another folder', async () => {
    const memory = fakeMemory();
    const other = fakeFolder('Other', { 'teams': { 'alpha.plan': 'other' } });
    await memory.remember(other.handle, 'teams/alpha.plan');
    const { workspace } = setup(portfolio(), memory);
    expect((await workspace.open())!.path).toBe('portfolio.plan');
    await memory.setActive('gone.plan');
    expect((await createFolderWorkspace(setup(portfolio(), memory).win, memory).open())!.path).toBe('portfolio.plan');
  });

  it('an empty folder opens nothing, says so, and is not remembered', async () => {
    const memory = fakeMemory();
    const { workspace } = setup({ 'notes.txt': 'x', '.git': { 'a.plan': 'x' } }, memory);
    await expect(workspace.open()).rejects.toThrow(new Notice('No plan files in folder'));
    expect(await memory.load()).toBeNull();
  });
});

describe('remembering the folder', () => {
  it('remembers the folder opened, replacing any other', async () => {
    const memory = fakeMemory();
    const other = fakeFolder('Other', {});
    await memory.remember(other.handle, null);
    const { workspace, folder } = setup(portfolio(), memory);
    await workspace.open();
    expect(await memory.load()).toEqual({ handle: folder.handle, active: 'portfolio.plan' });
  });

  it('reopens without the picker, asking for permission once', async () => {
    const { folder, memory, win, showDirectoryPicker } = setup();
    const request = vi.spyOn(folder.handle as unknown as { requestPermission(): Promise<PermissionState> }, 'requestPermission');
    const workspace = createFolderWorkspace(win, memory, folder.handle);
    expect(await workspace.open()).toEqual({ path: 'portfolio.plan', text: 'Portfolio\n' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(showDirectoryPicker).not.toHaveBeenCalled();
  });

  it('a refusal says so and keeps the folder remembered; a later retry can be granted', async () => {
    const { folder, memory, win } = setup();
    await memory.remember(folder.handle, null);
    folder.permission = 'denied';
    await expect(createFolderWorkspace(win, memory, folder.handle).open()).rejects.toThrow(new Notice('Permission to open Portfolio was refused'));
    expect((await memory.load())?.handle).toBe(folder.handle);
    folder.permission = 'granted';
    expect((await createFolderWorkspace(win, memory, folder.handle).open())?.path).toBe('portfolio.plan');
  });

  it('forgets a folder that no longer resolves, and says so', async () => {
    const { folder, memory, win } = setup();
    await memory.remember(folder.handle, null);
    folder.gone = true;
    await expect(createFolderWorkspace(win, memory, folder.handle).open()).rejects.toThrow(new Notice('Portfolio can no longer be found, so it was forgotten'));
    expect(await memory.load()).toBeNull();
  });
});

describe('folderUnavailable', () => {
  it('names what is needed when the browser has no directory picker, as in Firefox', () => {
    expect('showDirectoryPicker' in window).toBe(false);
    expect(folderUnavailable(window)).toBe('Opening a folder needs Edge or Chrome');
  });

  it('is null with the picker at the top level, and says why inside a frame', () => {
    const win = { showDirectoryPicker: vi.fn() } as unknown as Window;
    Object.assign(win, { self: win, top: win });
    expect(folderUnavailable(win)).toBeNull();
    Object.assign(win, { top: {} });
    expect(folderUnavailable(win)).toBe('Opening a folder does not work in an embedded browser frame');
  });
});
