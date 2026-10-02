// @vitest-environment jsdom
// The open-files store (spec §6) over a folder workspace and in-memory buffers: each file keeps its
// own text and undo history, saving reads the file again and asks before overwriting a change made
// outside the app, and re-reading applies a clean file's change on disk as a line diff.

import { describe, expect, it, vi } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { createOpenFiles, isDirty } from '../../src/app/files';
import type { OpenFile } from '../../src/app/files';
import { createFolderWorkspace, createSingleFileWorkspace } from '../../src/app/workspace';
import { fakeFolder, fakeMemory } from '../support/fs';
import type { Tree } from '../support/fs';

async function setup(tree: Tree = { 'alpha.plan': 'A1\nA2\nA3\n', 'beta.plan': 'B1\nB2\n', teams: { 'gamma.plan': 'G\n' } }) {
  const folder = fakeFolder('Portfolio', tree);
  const win = { showDirectoryPicker: async () => folder.handle } as unknown as Window;
  Object.assign(win, { self: win, top: win });
  const workspace = createFolderWorkspace(win, fakeMemory());
  const opened = await workspace.open();
  const answers: boolean[] = [];
  const asked: [string | null, string][] = [];
  const overwrite = vi.fn(async (file: OpenFile, why: 'changed' | 'missing') => {
    asked.push([file.path, why]);
    return answers.shift() ?? false;
  });
  const store = createOpenFiles(workspace, new InMemoryBuffer('untitled\n'), opened, {
    makeBuffer: (text) => new InMemoryBuffer(text),
    ask: { overwrite },
  });
  await store.relist();
  const file = (path: string) => store.files().find((f) => f.path === path)!;
  const append = (f: OpenFile, text: string) => f.buffer.apply([{ from: f.buffer.text().length, to: f.buffer.text().length, insert: text }], 'text-editor');
  return { folder, tree, store, file, append, answers, asked, overwrite };
}

describe('open files', () => {
  it('starts with the file the workspace opened, loaded into the buffer it was given, and lists the folder', async () => {
    const { store } = await setup();
    expect(store.active().path).toBe('alpha.plan');
    expect(store.active().buffer.text()).toBe('A1\nA2\nA3\n');
    expect(isDirty(store.active())).toBe(false);
    expect(store.listing()).toEqual(['alpha.plan', 'beta.plan', 'teams/gamma.plan']);
  });

  it('keeps each file’s text and undo history across switches: undo undoes the active file’s edit only', async () => {
    const { store, file, append, folder } = await setup();
    append(store.active(), 'A4\n');
    await store.show('beta.plan');
    expect(store.active().path).toBe('beta.plan');
    append(store.active(), 'B3\n');
    await store.show('alpha.plan');
    expect(store.active().buffer.text()).toBe('A1\nA2\nA3\nA4\n');
    store.active().buffer.undo();
    expect(file('alpha.plan').buffer.text()).toBe('A1\nA2\nA3\n');
    expect(file('beta.plan').buffer.text()).toBe('B1\nB2\nB3\n');
    // Nothing was written by switching.
    expect(folder.writes).toEqual([]);
  });

  it('reads a file the first time it is shown, and not again', async () => {
    const { store, tree } = await setup();
    await store.show('beta.plan');
    tree['beta.plan'] = 'changed\n';
    await store.show('alpha.plan');
    await store.show('beta.plan');
    expect(store.active().buffer.text()).toBe('B1\nB2\n');
  });

  it('tells listeners when the active file changes, not on every edit', async () => {
    const { store, append } = await setup();
    const listener = vi.fn();
    store.onChange(listener);
    append(store.active(), 'x\n');
    expect(listener).not.toHaveBeenCalled();
    await store.show('beta.plan');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('converts tabs and CRLF on reading, and does not mistake that for a change on disk', async () => {
    const { store, folder, answers } = await setup({ 'alpha.plan': 'A\r\n\tB\r\n' });
    expect(store.active().buffer.text()).toBe('A\n    B\n');
    store.active().buffer.apply([{ from: 0, to: 1, insert: 'Z' }], 'grid');
    answers.push(false);
    expect(await store.save(store.active())).toEqual({ outcome: 'saved', path: 'alpha.plan' });
    expect(folder.writes).toEqual([['alpha.plan', 'Z\n    B\n']]);
  });
});

describe('saving', () => {
  it('save writes only the file it is given; save all writes every unsaved file and clears their markers', async () => {
    const { store, file, append, folder, tree } = await setup();
    append(store.active(), 'A4\n');
    await store.show('beta.plan');
    append(store.active(), 'B3\n');
    await store.show('teams/gamma.plan');
    expect(await store.save(file('beta.plan'))).toEqual({ outcome: 'saved', path: 'beta.plan' });
    expect(folder.writes).toEqual([['beta.plan', 'B1\nB2\nB3\n']]);
    expect(isDirty(file('beta.plan'))).toBe(false);
    expect(isDirty(file('alpha.plan'))).toBe(true);

    append(file('beta.plan'), 'B4\n');
    folder.writes.length = 0;
    expect(await store.saveAll()).toEqual([
      { outcome: 'saved', path: 'alpha.plan' },
      { outcome: 'saved', path: 'beta.plan' },
    ]);
    expect(folder.writes.map(([path]) => path)).toEqual(['alpha.plan', 'beta.plan']);
    expect(tree['alpha.plan']).toBe('A1\nA2\nA3\nA4\n');
    expect(store.files().filter(isDirty)).toEqual([]);
  });

  it('a file with no path in a folder workspace is not saved: creating files comes later', async () => {
    const folder = fakeFolder('Portfolio', { 'a.plan': 'A\n' });
    const win = { showDirectoryPicker: async () => folder.handle } as unknown as Window;
    Object.assign(win, { self: win, top: win });
    const store = createOpenFiles(createFolderWorkspace(win, fakeMemory()), new InMemoryBuffer('new\n'), null, {
      makeBuffer: (text) => new InMemoryBuffer(text),
      ask: { overwrite: async () => true },
    });
    expect(await store.save(store.active())).toEqual({ outcome: 'failed', reason: 'Creating files comes in a later task' });
    expect(folder.writes).toEqual([]);
  });

  it('asks before writing over a change on disk: Keep writes nothing and marks it stale, Overwrite writes', async () => {
    const { store, append, tree, folder, answers, asked } = await setup();
    append(store.active(), 'A4\n');
    tree['alpha.plan'] = 'A1\nchanged\n';
    answers.push(false);
    expect(await store.save(store.active())).toEqual({ outcome: 'kept' });
    expect(asked).toEqual([['alpha.plan', 'changed']]);
    expect(folder.writes).toEqual([]);
    expect(store.active().stale).toBe(true);
    expect(isDirty(store.active())).toBe(true);

    answers.push(true);
    expect(await store.save(store.active())).toEqual({ outcome: 'saved', path: 'alpha.plan' });
    expect(tree['alpha.plan']).toBe('A1\nA2\nA3\nA4\n');
    expect(store.active().stale).toBe(false);
    expect(isDirty(store.active())).toBe(false);
  });

  it('does not ask when the disk already holds the text being saved', async () => {
    const { store, append, tree, overwrite } = await setup();
    append(store.active(), 'A4\n');
    tree['alpha.plan'] = 'A1\nA2\nA3\nA4\n';
    expect(await store.save(store.active())).toEqual({ outcome: 'saved', path: 'alpha.plan' });
    expect(overwrite).not.toHaveBeenCalled();
  });

  it('a download is not checked against the disk: it overwrites nothing', async () => {
    const workspace = createSingleFileWorkspace(window);
    expect(workspace.can.saveInPlace).toBe(false);
    const read = vi.spyOn(workspace, 'read');
    vi.spyOn(workspace, 'write').mockResolvedValue({ outcome: 'downloaded' });
    const store = createOpenFiles(workspace, new InMemoryBuffer(''), { path: 'a.plan', text: 'A\n' }, {
      makeBuffer: (text) => new InMemoryBuffer(text),
      ask: { overwrite: async () => false },
    });
    store.active().buffer.apply([{ from: 0, to: 0, insert: 'x' }], 'grid');
    expect(await store.save(store.active())).toEqual({ outcome: 'downloaded' });
    expect(read).not.toHaveBeenCalled();
    // Still unsaved, but leaving the page loses nothing.
    expect(isDirty(store.active())).toBe(true);
    expect(store.active().kept).toBe('xA\n');
  });
});

describe('re-reading', () => {
  it('applies a clean file’s change on disk as a line diff, outside the undo history', async () => {
    const { store, tree } = await setup();
    const buffer = store.active().buffer;
    buffer.apply([{ from: 0, to: 2, insert: 'a1' }], 'text-editor');
    await store.save(store.active());
    const origins: string[] = [];
    const edits: unknown[] = [];
    buffer.onChange((c) => (origins.push(c.origin), edits.push(c.edits)));
    tree['alpha.plan'] = 'a1\nA2 changed\nA3\n';
    await store.refresh();
    expect(buffer.text()).toBe('a1\nA2 changed\nA3\n');
    expect(origins).toEqual(['remote']);
    expect(edits).toEqual([[{ from: 3, to: 6, insert: 'A2 changed\n' }]]);
    expect(isDirty(store.active())).toBe(false);
    // Undo reverts the edit made before, not the change from disk.
    buffer.undo();
    expect(buffer.text()).toBe('A1\nA2 changed\nA3\n');
  });

  it('marks a file with unsaved changes stale and applies nothing; it clears when the disk matches again', async () => {
    const { store, append, tree } = await setup();
    append(store.active(), 'A4\n');
    tree['alpha.plan'] = 'other\n';
    await store.refresh();
    expect(store.active().stale).toBe(true);
    expect(store.active().buffer.text()).toBe('A1\nA2\nA3\nA4\n');
    tree['alpha.plan'] = 'A1\nA2\nA3\n';
    await store.refresh();
    expect(store.active().stale).toBe(false);
  });

  it('lists the folder again: new files appear, deleted files that are not open disappear', async () => {
    const { store, tree } = await setup();
    tree['delta.plan'] = 'D\n';
    delete tree['beta.plan'];
    await store.refresh();
    expect(store.listing()).toEqual(['alpha.plan', 'delta.plan', 'teams/gamma.plan']);
  });
});

describe('a file missing on disk', () => {
  it('while clean: keeps its buffer and stays open, marked missing', async () => {
    const { store, tree } = await setup();
    delete tree['alpha.plan'];
    await store.refresh();
    expect(store.active().missing).toBe(true);
    expect(store.active().buffer.text()).toBe('A1\nA2\nA3\n');
    expect(store.files().map((f) => f.path)).toEqual(['alpha.plan']);
  });

  it('while dirty: keeps its unsaved changes, marked missing', async () => {
    const { store, tree, append } = await setup();
    append(store.active(), 'A4\n');
    delete tree['alpha.plan'];
    await store.refresh();
    expect(store.active().missing).toBe(true);
    expect(store.active().buffer.text()).toBe('A1\nA2\nA3\nA4\n');
    expect(isDirty(store.active())).toBe(true);
  });

  it('saving it asks; No writes nothing, Yes writes it back at its path, folders and all', async () => {
    const { store, tree, folder, answers, asked } = await setup();
    await store.show('teams/gamma.plan');
    delete tree.teams;
    await store.refresh();
    answers.push(false);
    expect(await store.save(store.active())).toEqual({ outcome: 'kept' });
    expect(folder.writes).toEqual([]);
    answers.push(true);
    expect(await store.save(store.active())).toEqual({ outcome: 'saved', path: 'teams/gamma.plan' });
    expect(asked).toEqual([
      ['teams/gamma.plan', 'missing'],
      ['teams/gamma.plan', 'missing'],
    ]);
    expect(tree.teams).toEqual({ 'gamma.plan': 'G\n' });
    expect(store.active().missing).toBe(false);
  });

  it('reappearing clears the marker; it is then stale if it differs and has unsaved changes', async () => {
    const { store, tree, append } = await setup();
    await store.show('beta.plan');
    append(store.active(), 'B3\n');
    delete tree['alpha.plan'];
    delete tree['beta.plan'];
    await store.refresh();
    expect(store.files().map((f) => f.missing)).toEqual([true, true]);
    tree['alpha.plan'] = 'A1\nA2\nA3\n';
    tree['beta.plan'] = 'B other\n';
    await store.refresh();
    expect(store.files().map((f) => [f.missing, f.stale])).toEqual([
      [false, false],
      [false, true],
    ]);
  });
});
