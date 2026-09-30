// The include loop (PLUGINS.md §6), with an in-memory workspace that can read paths: it gathers
// only when the set of include paths changes, drops a gather a newer one overtook, and stops on a
// cycle.

import { describe, expect, it, vi } from 'vitest';
import { createIncludes } from '../../src/app/includes';
import type { Workspace } from '../../src/core';

const include = (...paths: string[]) => `---\ninclude: ${paths.join(' | ')}\n---\nA\n`;

/** Reads from `files`; each read waits until `release` is called, so a test controls the order. */
function fakeWorkspace(files: Record<string, string>) {
  const reads: string[] = [];
  const pending: (() => void)[] = [];
  const workspace: Pick<Workspace, 'read' | 'resolve'> = {
    read: (path) => {
      reads.push(path);
      return new Promise((resolve, reject) => {
        pending.push(() => (path in files ? resolve(files[path]) : reject(new Error(`no ${path}`))));
      });
    },
    resolve: (_from, ref) => ref,
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      while (pending.length > 0) pending.shift()!();
      await Promise.resolve();
    }
  };
  return { workspace, reads, pending, settle };
}

describe('the include loop', () => {
  it('gathers when an include is added, and empties the snapshot when it is removed', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'team.plan': 'T | 1h\n' });
    const gathered = vi.fn();
    const includes = createIncludes(workspace, gathered);
    expect(includes.snapshot('q4.plan', 'A\n')).toEqual(new Map());
    expect(reads).toEqual([]);

    expect(includes.snapshot('q4.plan', include('team.plan'))).toEqual(new Map());
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
    expect(includes.snapshot('q4.plan', include('team.plan'))).toEqual(new Map([['team.plan', 'T | 1h\n']]));
    // The same set of paths, another keystroke: nothing is read again.
    includes.snapshot('q4.plan', include('team.plan') + 'B\n');
    await settle();
    expect(reads).toEqual(['team.plan']);

    expect(includes.snapshot('q4.plan', 'A\n')).toEqual(new Map());
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
  });

  it('leaves out a file that fails to read, and retries it only when the set of paths changes', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'team.plan': 'T\n' });
    const includes = createIncludes(workspace, () => {});
    includes.snapshot('q4.plan', include('missing.plan'));
    await settle();
    includes.snapshot('q4.plan', include('missing.plan') + 'B\n');
    await settle();
    expect(reads).toEqual(['missing.plan']);
    expect(includes.snapshot('q4.plan', include('missing.plan', 'team.plan'))).toEqual(new Map());
    await settle();
    expect(reads).toEqual(['missing.plan', 'missing.plan', 'team.plan']);
    expect(includes.snapshot('q4.plan', include('missing.plan', 'team.plan'))).toEqual(new Map([['team.plan', 'T\n']]));
  });

  it('drops a gather that a newer one overtook', async () => {
    const { workspace, pending, settle } = fakeWorkspace({ 'old.plan': 'O\n', 'new.plan': 'N\n' });
    const gathered = vi.fn();
    const includes = createIncludes(workspace, gathered);
    includes.snapshot('q4.plan', include('old.plan'));
    const slow = pending.shift()!; // old.plan's read is still in flight
    includes.snapshot('q4.plan', include('new.plan'));
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
    slow();
    await settle();
    expect(gathered).toHaveBeenCalledTimes(1);
    expect(includes.snapshot('q4.plan', include('new.plan'))).toEqual(new Map([['new.plan', 'N\n']]));
  });

  it('follows includes of included files, and stops on a cycle of two files', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'a.plan': include('b.plan'), 'b.plan': include('a.plan') });
    const includes = createIncludes(workspace, () => {});
    includes.snapshot('q4.plan', include('a.plan'));
    await settle();
    expect(reads).toEqual(['a.plan', 'b.plan']);
    expect([...includes.snapshot('q4.plan', include('a.plan')).keys()]).toEqual(['a.plan', 'b.plan']);
  });

  it('never reads the open file, whose text is the buffer', async () => {
    const { workspace, reads, settle } = fakeWorkspace({ 'a.plan': include('q4.plan') });
    const includes = createIncludes(workspace, () => {});
    includes.snapshot('q4.plan', include('a.plan'));
    await settle();
    expect(reads).toEqual(['a.plan']);
  });
});
