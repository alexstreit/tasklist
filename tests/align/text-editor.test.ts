// @vitest-environment jsdom
// Task 29: the text editor leading the stub follower. Its rows are CodeMirror's line blocks,
// measured from injected heights (tests/support/layout.ts): 20px a line, 40px for a line that
// wraps.

import { foldEffect, unfoldAll } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { finish, start } from '../../src/plugins/schedule/fields';
import { editorLayout } from '../support/layout';
import { frames, leading } from '../support/panes';
import type { Panes } from '../support/panes';

const TEXT = [
  '---', // 1
  'profile: schedule',
  'project-start: 2026-10-05',
  '---',
  '// the build', // 5
  'Build',
  '    Design the parts that wrap | 1d', // 7
  '    Code | 2d',
  '',
  'Ship | 1d', // 10
  '',
].join('\n');

const lineHeight = (text: string) => (text.includes('wrap') ? 40 : 20);

let panes: Panes;
afterEach(() => panes.destroy());

async function open(text = TEXT, header?: number): Promise<Panes> {
  panes = leading('text', text, { measure: (pane) => editorLayout(pane, lineHeight), header });
  await frames();
  panes.step();
  return panes;
}

const view = () => EditorView.findFromDOM(panes.pane.querySelector('.cm-editor')!)!;
const rows = () => panes.stub.last()!.rows.map((r) => [r.line, r.title, r.top, r.height]);

describe('the text editor leading', () => {
  it('has a row for every line: front matter, comment and blank lines have no item', async () => {
    await open();
    expect(rows()).toEqual([
      [1, null, 0, 20],
      [2, null, 20, 20],
      [3, null, 40, 20],
      [4, null, 60, 20],
      [5, null, 80, 20],
      [6, 'Build', 100, 20],
      [7, 'Design the parts that wrap', 120, 40],
      [8, 'Code', 160, 20],
      [9, null, 180, 20],
      [10, 'Ship', 200, 20],
      // The empty text after the final newline is a line to CodeMirror, and no line of the model's.
      [11, null, 220, 20],
    ]);
    expect(panes.stub.last()).toMatchObject({ kind: 'render', bodyTop: 4, scrollTop: 0 });
  });

  it('gives a wrapped line its own height', async () => {
    await open();
    const design = panes.stub.last()!.rows.find((r) => r.line === 7)!;
    expect(design.height).toBe(40);
    expect(panes.stub.last()!.rows.find((r) => r.line === 8)!.top).toBe(design.top + 40);
  });

  it('drops a folded parent’s children, while the model still has their dates', async () => {
    const model = (await open()).analyze();
    const state = view().state;
    view().dispatch({ effects: foldEffect.of({ from: state.doc.line(6).to, to: state.doc.line(8).to }) });
    await frames();
    expect(panes.stub.last()!.kind).toBe('position');
    expect(rows().map(([line]) => line)).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 11]);
    expect(rows()[5]).toEqual([6, 'Build', 100, 20]);
    expect(rows()[6]).toEqual([9, null, 120, 20]);
    // The Task 30 summary bar spans the children it hides.
    const [design, code] = model.roots[0].children;
    expect([model.get(design, start)?.effective, model.get(code, finish)]).toEqual([0, 16]);

    unfoldAll(view());
    await frames();
    expect(rows().map(([line]) => line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('publishes a scroll with the same row tops; only scrollTop differs', async () => {
    await open();
    const before = panes.stub.last()!;
    view().scrollDOM.scrollTop = 50;
    view().scrollDOM.dispatchEvent(new Event('scroll'));
    const after = panes.stub.last()!;
    expect(after).not.toBe(before);
    expect(after.scrollTop).toBe(50);
    expect({ ...after, scrollTop: 0, kind: 'render' }).toEqual(before);
  });

  it('starts its body below a taller follower header', async () => {
    await open(TEXT, 64);
    await frames();
    expect(panes.stub.last()).toMatchObject({ bodyTop: 64 });
    expect(rows()[0]).toEqual([1, null, 0, 20]);
    expect(view().documentPadding.top).toBe(64);
  });

  it('keeps the last frame after an insert until the model catches up', async () => {
    await open();
    const drawn = panes.stub.frames.length;
    view().dispatch({ changes: { from: view().state.doc.line(10).from, insert: 'Test | 1d\n' } });
    await frames();
    // The editor published the new text's layout; the stub still has the old model.
    expect(panes.stub.frames.length).toBe(drawn);
    const model = panes.analyze();
    expect(panes.stub.frames.length).toBe(drawn);
    panes.render(model);
    expect(panes.stub.last()).toMatchObject({ kind: 'render', version: panes.buffer.version() });
    expect(rows().slice(9, 11)).toEqual([
      [10, 'Test', 200, 20],
      [11, 'Ship', 220, 20],
    ]);
    expect(panes.stub.frames.every((f) => f.version === panes.stub.frames[0].version || f.version === model.version)).toBe(true);
  });
});
