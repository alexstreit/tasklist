// One suite, both implementations. Spec §3.7: editors depend on PlanBuffer
// alone, so InMemoryBuffer must behave exactly like the CodeMirror one.

import { describe, expect, it } from 'vitest';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import type { BufferChange, PlanBuffer } from '../../src/buffer';

const implementations: [string, (doc: string) => PlanBuffer][] = [
  ['InMemoryBuffer', (doc) => new InMemoryBuffer(doc)],
  ['CodeMirrorBuffer', (doc) => new CodeMirrorBuffer(doc)],
];

/** Collect every change a buffer reports. */
function record(buffer: PlanBuffer): BufferChange[] {
  const changes: BufferChange[] = [];
  buffer.onChange((c) => changes.push(c));
  return changes;
}

describe.each(implementations)('%s', (_name, create) => {
  it('applies edits in the coordinates of the document before the change', () => {
    const buffer = create('Auth\nAdmin\n');
    buffer.apply([{ from: 0, to: 4, insert: 'Login' }, { from: 5, to: 5, insert: '    ' }], 'grid');
    expect(buffer.text()).toBe('Login\n    Admin\n');
  });

  it('reports the new text, the edits and the origin', () => {
    const buffer = create('ab\n');
    const changes = record(buffer);
    buffer.apply([{ from: 1, to: 1, insert: 'X' }], 'grid');
    expect(changes).toHaveLength(1);
    expect(changes[0].text).toBe('aXb\n');
    expect(changes[0].origin).toBe('grid');
    expect([...changes[0].edits]).toEqual([{ from: 1, to: 1, insert: 'X' }]);
  });

  it('maps positions before and after an insert', () => {
    const buffer = create('abcdef');
    const changes = record(buffer);
    buffer.apply([{ from: 3, to: 3, insert: 'XY' }], 'grid');
    expect(changes[0].mapPos(1)).toBe(1);
    expect(changes[0].mapPos(5)).toBe(7);
  });

  it('maps positions across a deletion', () => {
    const buffer = create('abcdef');
    const changes = record(buffer);
    buffer.apply([{ from: 1, to: 3, insert: '' }], 'grid');
    expect(changes[0].mapPos(0)).toBe(0);
    expect(changes[0].mapPos(5)).toBe(3);
    // Inside the deleted range: collapses to where it went.
    expect(changes[0].mapPos(2)).toBe(1);
  });

  it('undoes and redoes, reporting the origin each time', () => {
    const buffer = create('a\n');
    const changes = record(buffer);
    buffer.apply([{ from: 1, to: 1, insert: 'b' }], 'text-editor');
    buffer.undo();
    expect(buffer.text()).toBe('a\n');
    buffer.redo();
    expect(buffer.text()).toBe('ab\n');
    expect(changes.map((c) => c.origin)).toEqual(['text-editor', 'undo', 'redo']);
    expect(changes[1].text).toBe('a\n');
  });

  it('undo with nothing to undo changes nothing', () => {
    const buffer = create('a\n');
    const changes = record(buffer);
    buffer.undo();
    buffer.redo();
    expect(buffer.text()).toBe('a\n');
    expect(changes).toEqual([]);
  });

  it('a new edit drops the redo stack', () => {
    const buffer = create('');
    buffer.apply([{ from: 0, to: 0, insert: 'a' }], 'grid');
    buffer.undo();
    buffer.apply([{ from: 0, to: 0, insert: 'b' }], 'grid');
    buffer.redo();
    expect(buffer.text()).toBe('b');
  });

  it('stops notifying after unsubscribe', () => {
    const buffer = create('');
    const changes: BufferChange[] = [];
    const off = buffer.onChange((c) => changes.push(c));
    buffer.apply([{ from: 0, to: 0, insert: 'a' }], 'grid');
    off();
    buffer.apply([{ from: 1, to: 1, insert: 'b' }], 'grid');
    expect(changes).toHaveLength(1);
    expect(buffer.text()).toBe('ab');
  });

  it('clears the history when a file is loaded', () => {
    const buffer = create('old\n');
    buffer.apply([{ from: 0, to: 4, insert: 'new\n' }], 'load');
    buffer.undo();
    expect(buffer.text()).toBe('new\n');
  });
});
