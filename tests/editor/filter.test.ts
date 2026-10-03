// @vitest-environment jsdom
// Task 41: the text editor filtered. On examples/demo.plan, `carol` shows Design (11), UX
// wireframes (13), Build (15), Web app (17), Docs (27), User guide (28) and Training (29); every
// other line is hidden: its text untouched, the cursor and selections skipping it, no edit reaching
// into it, and search not landing in it.

import { cursorCharLeft, cursorCharRight, cursorDocEnd, cursorDocStart, cursorLineDown, cursorLineUp, deleteCharForward, deleteLine, insertNewlineAndIndent } from '@codemirror/commands';
import { foldCode, unfoldAll } from '@codemirror/language';
import { findNext, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import demo from '../../examples/demo.plan?raw';
import { trackFilter } from '../../src/app/filter';
import { analyze } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import { filterRows } from '../../src/core';
import type { RowLayout } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import type { TextEditor } from '../../src/editor';
import { editorLayout } from '../support/layout';
import { frames } from '../support/panes';

let pane: HTMLElement;
let buffer: CodeMirrorBuffer;
let editor: TextEditor;
let view: EditorView;
let restore: () => void;
let layout: RowLayout | null = null;

beforeEach(async () => {
  pane = document.createElement('div');
  document.body.append(pane);
  restore = editorLayout(pane, () => 20);
  buffer = new CodeMirrorBuffer(demo);
  editor = mountTextEditor(buffer, pane, { onCursorLine: () => {}, onSave: () => {}, root: 'demo.plan' });
  view = EditorView.findFromDOM(pane.querySelector('.cm-editor')!)!;
  const model = analyze(buffer.text(), { filename: 'demo.plan', version: buffer.version() });
  editor.update(model);
  editor.setFilter(trackFilter(model, filterRows(model, 'carol'), () => buffer.text()).visible(model));
  editor.onRowLayout((l) => (layout = l));
  await frames();
});
afterEach(() => {
  editor.destroy();
  restore();
  pane.remove();
});

const lineOf = (pos = view.state.selection.main.head) => view.state.doc.lineAt(pos).number;
const at = (line: number, column = 0) => view.dispatch({ selection: { anchor: view.state.doc.line(line).from + column } });
const end = (line: number) => view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
const shownLines = () => layout!.rows.map((r) => r.at!.line);

describe('the cursor and selections skip hidden lines', () => {
  // Which line moving down or up reaches depends on coordinates, which jsdom doesn't have: the
  // browser pass checks it. Here, wherever it lands is a shown line.
  it('lands on a shown line moving down or up', () => {
    const shown = [11, 13, 15, 17, 27, 28, 29];
    at(13);
    for (const move of [cursorLineDown, cursorLineDown, cursorLineUp, cursorLineDown]) {
      move(view);
      expect(shown).toContain(lineOf());
    }
  });

  it('moves right off a line’s end onto the next shown line, and left back', () => {
    end(17);
    cursorCharRight(view);
    expect([lineOf(), view.state.selection.main.head]).toEqual([27, view.state.doc.line(27).from]);
    cursorCharLeft(view);
    expect([lineOf(), view.state.selection.main.head]).toEqual([17, view.state.doc.line(17).to]);
  });

  it('never rests on the hidden lines at the document’s edges', () => {
    // Lines 1–10 (front matter, comments, Discovery’s rows) and line 30, the empty last line, are hidden.
    cursorDocStart(view);
    expect(lineOf()).toBe(11);
    cursorDocEnd(view);
    expect(lineOf()).toBe(29);
  });

  it('keeps a selection’s ends on shown lines', () => {
    at(13);
    view.dispatch({ selection: { anchor: view.state.selection.main.anchor, head: view.state.doc.line(14).from + 2 } });
    expect(lineOf(view.state.selection.main.head)).toBe(15);
  });
});

describe('an edit can’t reach a hidden line', () => {
  it('refuses typing into a hidden line', () => {
    const before = buffer.text();
    view.dispatch({ changes: { from: view.state.doc.line(14).from + 2, insert: 'x' }, userEvent: 'input.type' });
    expect(buffer.text()).toBe(before);
  });

  it('refuses joining a hidden line to a shown one, from either side', () => {
    const before = buffer.text();
    end(17);
    deleteCharForward(view);
    expect(buffer.text()).toBe(before);
    view.dispatch({ changes: { from: view.state.doc.line(16).to, to: view.state.doc.line(17).from }, userEvent: 'delete.backward' });
    expect(buffer.text()).toBe(before);
  });

  it('takes a new line typed after a shown row, and shows it', async () => {
    end(17);
    insertNewlineAndIndent(view);
    view.dispatch(view.state.replaceSelection('Mobile app'), { userEvent: 'input.type' });
    expect(buffer.text().split('\n')[17]).toBe('    Mobile app');
    await frames();
    expect(shownLines()).toEqual([11, 13, 15, 17, 18, 28, 29, 30]);
  });

  it('deletes a whole shown line, leaving the hidden line after it whole', () => {
    at(13);
    deleteLine(view);
    expect(buffer.text().split('\n')[12]).toMatch(/^ {4}Design review/);
  });

  it('lets text that isn’t the user’s through: a change from the file on disk', () => {
    buffer.apply([{ from: view.state.doc.line(14).from + 4, to: view.state.doc.line(14).from + 10, insert: 'Final' }], 'remote');
    expect(buffer.text().split('\n')[13]).toMatch(/^ {4}Final review/);
  });
});

describe('Ctrl+F', () => {
  /** Search the panel's way: its field is typed into, and it commits a query without our test. */
  function type(query: string): void {
    openSearchPanel(view);
    const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name=search]')!;
    field.value = query;
    field.dispatchEvent(new KeyboardEvent('keyup'));
  }

  it('finds matches in shown lines only', () => {
    at(11);
    type('carol');
    const lines: number[] = [];
    for (let i = 0; i < 5; i++) {
      findNext(view);
      lines.push(lineOf());
    }
    // Every carol in the demo is a shown row's owner; after Training, it wraps round.
    expect(lines).toEqual([13, 17, 28, 29, 13]);
  });

  it('doesn’t land in a hidden line', () => {
    at(13);
    // bob owns Architecture, Design review, API and Deployment, all hidden.
    type('bob');
    findNext(view);
    expect(lineOf()).toBe(13);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it('keeps the test on a query set by a command too', () => {
    at(13);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'dave' })) });
    findNext(view);
    expect(lineOf()).toBe(13);
  });
});

describe('folding the shown lines', () => {
  it('folds a shown parent, hiding its shown children too, and unfolds', async () => {
    at(15);
    expect(foldCode(view)).toBe(true);
    await frames();
    expect(shownLines()).toEqual([11, 13, 15, 27, 28, 29]);
    unfoldAll(view);
    await frames();
    expect(shownLines()).toEqual([11, 13, 15, 17, 27, 28, 29]);
  });
});
