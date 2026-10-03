// Gathering mounted files (Task 35; PLUGINS.md §6), with an in-memory workspace: adding a mount reads
// the new file and removing it drops it; a file is read once while it stays mounted; a file open in
// the store gives its current text; and typing in the root parses no other file.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as rows from 'rows';
import { createMounts } from '../../src/app/mounts';
import { analyze } from '../../src/app/registry';
import { mountsOf } from '../../src/core';
import type { Workspace } from '../../src/core';
import { resolve } from '../support/portfolio';

// Every parse, by the text parsed, so a test can count the files parsed again.
const parsed: string[] = [];
vi.mock('rows', async (original) => {
  const actual = await original<typeof rows>();
  return { ...actual, parseRows: (text: string, options?: rows.ParseOptions) => (parsed.push(text), actual.parseRows(text, options)) };
});

/** Reads from `files`; each read waits until `settle`, so a test controls the order. */
function fakeWorkspace(files: Record<string, string>) {
  const reads: string[] = [];
  const pending: (() => void)[] = [];
  const workspace: Pick<Workspace, 'read' | 'resolve'> = {
    read: (path) => {
      reads.push(path);
      return new Promise((done, fail) => pending.push(() => (path in files ? done(files[path]) : fail(new Error(`no ${path}`)))));
    },
    resolve,
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      while (pending.length > 0) pending.shift()!();
      await Promise.resolve();
    }
  };
  return { workspace, files, reads, pending, settle };
}

const open = new Map<string, string>();
const openText = (path: string) => open.get(path);
beforeEach(() => open.clear());

describe('gathering mounted files', () => {
  it('reads a newly mounted file, and drops one that is no longer mounted', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'team.plan': 'T | 1h\n' });
    const gathered = vi.fn();
    const mounts = createMounts({ workspace, openText }, gathered);
    expect(mounts.snapshot('root.plan', [])).toEqual(new Map());

    expect(mounts.snapshot('root.plan', ['team.plan'])).toEqual(new Map());
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
    expect(mounts.snapshot('root.plan', ['team.plan'])).toEqual(new Map([['team.plan', 'T | 1h\n']]));

    expect(mounts.snapshot('root.plan', [])).toEqual(new Map());
    mounts.snapshot('root.plan', ['team.plan']);
    await settle();
    expect(reads).toEqual(['team.plan', 'team.plan']);
  });

  it('reads a file once while it stays mounted, even when other mounts come and go', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'a.plan': 'A\n', 'b.plan': 'B\n' });
    const mounts = createMounts({ workspace, openText }, () => {});
    mounts.snapshot('root.plan', ['a.plan']);
    await settle();
    for (let i = 0; i < 5; i++) mounts.snapshot('root.plan', ['a.plan']);
    mounts.snapshot('root.plan', ['a.plan', 'b.plan']);
    await settle();
    mounts.snapshot('root.plan', ['a.plan']);
    expect(reads).toEqual(['a.plan', 'b.plan']);
  });

  it('gives null for a file that can’t be read, and doesn’t read it again while it stays mounted', async () => {
    const { workspace, reads, settle } = fakeWorkspace({});
    const mounts = createMounts({ workspace, openText }, () => {});
    mounts.snapshot('root.plan', ['gone.plan']);
    await settle();
    expect(mounts.snapshot('root.plan', ['gone.plan'])).toEqual(new Map([['gone.plan', null]]));
    expect(reads).toEqual(['gone.plan']);
  });

  it('follows the mounts of mounted files, relative to each, and stops on a loop', async () => {
    const { workspace, reads, settle } = fakeWorkspace({
      'teams/a.plan': 'A | mount=b.plan\n',
      'teams/b.plan': 'B | mount=../root.plan\nC | mount=a.plan\n',
    });
    const mounts = createMounts({ workspace, openText }, () => {});
    mounts.snapshot('root.plan', ['teams/a.plan']);
    await settle();
    mounts.snapshot('root.plan', ['teams/a.plan']);
    await settle();
    expect(reads).toEqual(['teams/a.plan', 'teams/b.plan']);
    expect([...mounts.snapshot('root.plan', ['teams/a.plan']).keys()]).toEqual(['teams/a.plan', 'teams/b.plan']);
  });

  it('never reads a path outside the folder', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'team.plan': 'T\n' });
    const mounts = createMounts({ workspace, openText }, () => {});
    mounts.snapshot('root.plan', ['../out.plan', 'team.plan']);
    await settle();
    expect(reads).toEqual(['team.plan']);
  });

  it('takes a file open in the store from its buffer, unsaved edits included, and never reads it', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'team.plan': 'T | 1h\n' });
    const mounts = createMounts({ workspace, openText }, () => {});
    open.set('team.plan', 'T | 4h\n');
    expect(mounts.snapshot('root.plan', ['team.plan'])).toEqual(new Map([['team.plan', 'T | 4h\n']]));
    await settle();
    expect(reads).toEqual([]);
  });

  it('reads every file again after reread, and drops a read that a reread overtook', async () => {
    const { workspace, files, reads, pending, settle } = fakeWorkspace({ 'team.plan': 'T | 1h\n' });
    const gathered = vi.fn();
    const mounts = createMounts({ workspace, openText }, gathered);
    mounts.snapshot('root.plan', ['team.plan']);
    const slow = pending.shift()!; // the first read is still in flight
    mounts.reread();
    files['team.plan'] = 'T | 2h\n';
    mounts.snapshot('root.plan', ['team.plan']);
    await settle();
    slow();
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
    expect(reads).toEqual(['team.plan', 'team.plan']);
    expect(mounts.snapshot('root.plan', ['team.plan'])).toEqual(new Map([['team.plan', 'T | 2h\n']]));
  });
});

describe('typing in the root', () => {
  it('parses no other file: mounted files are parsed once, then kept by their text', async () => {
    const { workspace, settle } = fakeWorkspace({ 'a.plan': 'A1 | 1h\nA2 | mount=b.plan\n', 'b.plan': 'B1 | 2h\n' });
    const mounts = createMounts({ workspace, openText }, () => {});
    let model = analyze('Root | mount=a.plan\n', { filename: 'root.plan', files: new Map(), resolve });
    const step = (text: string) =>
      (model = analyze(text, { filename: 'root.plan', files: mounts.snapshot('root.plan', mountsOf(model)), resolve }));
    // Gathering: a.plan, then b.plan, which a.plan mounts.
    for (let i = 0; i < 3; i++) {
      step('Root | mount=a.plan\n');
      await settle();
    }
    expect(model.files.size).toBe(3);
    parsed.length = 0;
    let text = 'Root | mount=a.plan\n';
    for (const key of 'New task') step((text += key));
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.filter((t) => !t.startsWith('Root'))).toEqual([]);
    expect(model.files.size).toBe(3);
  });
});
