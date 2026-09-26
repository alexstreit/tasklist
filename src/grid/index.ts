// Grid editor. A task sheet over the shared buffer: every change it makes is
// a text edit like any other. Spec §4b.

import type { EditResult } from 'rows';
import { formatDuration } from '../core';
import type { Cell, Column, Diagnostic, Model, ModelNode, Node, Span } from '../core';
import type { PlanBuffer, TextEdit } from '../buffer';
import { deleteLines, indent, moveDown, moveUp, outdent } from '../editing';
import type { LineRange } from '../editing';
import { canMarkDone, insertItem, setDone, setField, setLine, setTitle } from './edits';
import './grid.css';

/** Cell columns: the WBS cell (which selects the row), the done checkbox, the title, then the declared columns. */
const WBS = -1;
const DONE = 0;
const TITLE = 1;
const DECLARED = 2;

/** An item line, or any other line shown as one editable full-width cell. */
type Row =
  | { kind: 'item'; line: number; span: Span; indent: number; node: ModelNode; depth: number }
  | { kind: 'line'; line: number; span: Span; indent: number; text: string; blank: boolean };

export interface GridHooks {
  /** `fromApi` is true when the move came from setCursorLine rather than the user. */
  onCursorLine(line: number, fromApi: boolean): void;
}

export interface GridEditor {
  update(model: Model): void;
  setCursorLine(line: number): void;
  destroy(): void;
}

function format(column: Column, value: number): string {
  return column.type === 'duration' ? formatDuration(value) : String(value);
}

function muted(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

/** 1-based line containing `pos`. */
function lineAt(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** End of `line`'s text, before its line break. */
function lineEndOf(text: string, line: number): number {
  let from = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', from);
    if (next === -1) return text.length;
    from = next + 1;
  }
  const end = text.indexOf('\n', from);
  return end === -1 ? text.length : end;
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

const within = (outer: Span, inner: Span): boolean => inner.from >= outer.from && inner.to <= outer.to;

export function mountGrid(buffer: PlanBuffer, parent: HTMLElement, hooks: GridHooks): GridEditor {
  const bar = document.createElement('div');
  bar.className = 'sheet-toolbar';
  const table = document.createElement('table');
  table.className = 'plan-sheet';
  parent.replaceChildren(bar, table);

  let model: Model | null = null;
  let rows: Row[] = [];
  const byLine = new Map<number, Row>();
  // The front matter block, shown collapsed and read-only above the rows.
  let frontMatter: { span: Span; text: string; diagnostic?: Diagnostic } | null = null;
  // Diagnostics by `line:column`; spec §4b.2.
  let marks = new Map<string, Diagnostic>();
  // Where the grid is: a cell of a row, or its WBS cell, which is what row
  // selection is. Anchored to the end of the line so that edits and inserted
  // lines above it carry the place along (spec §4b.3).
  let at: { anchor: number; column: number } | null = null;
  let held = false; // the grid holds the browser focus
  let editing: { line: number; column: number } | null = null;
  // The cell that is in the page's tab order; every other cell is -1.
  let tabStop: HTMLTableCellElement | null = null;
  let selectedRow: HTMLTableRowElement | null = null;
  // A row being typed into that is not in the buffer yet: the insert-above
  // row and the new-task row. Nothing is written until a title is committed.
  let draft: { anchor: number; indent: number } | null = null;

  const draftInput = document.createElement('input');
  draftInput.className = 'cell-input';
  draftInput.placeholder = 'New task';
  const newTask = document.createElement('input');
  newTask.className = 'cell-input';
  newTask.placeholder = 'New task';

  const off = buffer.onChange((change) => {
    // A loaded file is a different document; the old anchors mean nothing in it.
    if (change.origin === 'load') {
      at = null;
      draft = null;
      return;
    }
    if (at) at = { anchor: change.mapPos(at.anchor), column: at.column };
    if (draft) draft = { anchor: change.mapPos(draft.anchor), indent: draft.indent };
  });

  function cellFor(line: number, column: number): HTMLTableCellElement | null {
    const row = table.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
    return row?.querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`) ?? null;
  }

  /**
   * Focusing a cell blurs whatever held the focus, and a blur handler may
   * commit an edit and rebuild the table underneath us. Then the cell we were
   * focusing is detached and the focus lands nowhere, so resolve it again.
   */
  function focusCell(line: number, column: number): void {
    const td = cellFor(line, column);
    td?.focus();
    if (td && !td.isConnected) cellFor(line, column)?.focus();
  }

  /** The row the toolbar and the structural keys act on. */
  function target(): Row | null {
    return at ? (byLine.get(lineAt(buffer.text(), at.anchor)) ?? null) : null;
  }

  function range(row: Row): LineRange {
    return { fromLine: row.line, toLine: row.line };
  }

  function apply(edits: readonly TextEdit[]): void {
    if (edits.length > 0) buffer.apply(edits, 'grid');
  }

  // A brief message by a cell, saying why an edit was not made (spec §4b.2).
  // It goes when the cell is next redrawn, or after a few seconds.
  const note = document.createElement('div');
  note.className = 'sheet-notice';
  note.setAttribute('role', 'status');
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  function notice(td: HTMLElement | null, message: string): void {
    if (!td) return;
    note.textContent = message;
    td.append(note);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => note.remove(), 4000);
  }

  /**
   * Make a rows edit against the document the model was read from, and
   * return the edits applied; or show why it can't be made, leave the cell as
   * it was, and return null. The model trails the buffer by the shell's
   * debounce, and edits against an older text would land in the wrong place.
   */
  function write(td: HTMLElement | null, make: (current: Model) => EditResult): TextEdit[] | null {
    const result: EditResult =
      model && model.doc.text === buffer.text() ? make(model) : { refused: 'the grid is still reading the last change; try again' };
    if ('refused' in result) {
      notice(td, `Not changed: ${result.refused}`);
      return null;
    }
    apply(result.edits);
    return result.edits;
  }

  /** The cells a row offers, left to right. A non-item line has only its raw cell. */
  function columnsOf(row: Row): number[] {
    if (row.kind === 'line') return [WBS, TITLE];
    return [WBS, DONE, TITLE, ...(model?.columns ?? []).map((_, i) => DECLARED + i)];
  }

  /** The column to land on when arriving at a row that may not have the one we left. */
  function nearest(row: Row, column: number): number {
    return columnsOf(row).includes(column) ? column : TITLE;
  }

  /** The text a cell edits, or null when the cell is not text-editable. */
  function rawOf(row: Row, column: number): string | null {
    if (row.kind === 'line') return column === TITLE ? row.text : null;
    if (column === TITLE) return row.node.title;
    const cell = row.node.cells[column - DECLARED] as Cell | undefined;
    if (!cell) return null;
    if (cell.kind === 'text') return cell.value;
    // An additive value rolls its children in; editing it in place would be a lie.
    return cell.mode === 'additive' ? null : cell.raw;
  }

  function fill(td: HTMLTableCellElement, column: Column, cell: Cell): void {
    td.replaceChildren();
    if (cell.kind === 'text') {
      td.textContent = cell.value;
      return;
    }
    if (cell.mode === 'additive') {
      td.classList.add('additive');
      td.title = `additive value "${cell.raw}" — edit it in the text editor`;
      td.append(muted('+'));
    }
    // An unestimated subtree shows nothing rather than "0h".
    if (!cell.hasValue) return;
    td.append(format(column, cell.effective));
    if (cell.mode === 'derived') td.classList.add('derived');
    // Derived cells render bare: effective already is the child sum.
    else if (cell.childrenHaveValue) td.append(muted(`⟨Σ ${format(column, cell.childSum)}⟩`));
  }

  /** `className` is passed in rather than set by the caller, so it cannot wipe the diagnostic class. */
  function addCell(row: HTMLTableRowElement, line: number, column: number, className = ''): HTMLTableCellElement {
    const td = row.insertCell();
    td.dataset.column = String(column);
    td.tabIndex = -1;
    td.className = className;
    const diagnostic = marks.get(`${line}:${column}`);
    if (diagnostic) {
      td.classList.add(diagnostic.severity);
      td.title = diagnostic.message;
    }
    return td;
  }

  /** The placeholder row for a title that has not been written to the buffer yet. */
  function addDraftRow(body: HTMLTableSectionElement, columns: Column[]): void {
    const row = body.insertRow();
    row.className = 'draft';
    row.insertCell();
    row.insertCell();
    const title = row.insertCell();
    title.style.paddingLeft = `${0.5 + (draft ? draft.indent / 4 : 0) * 1.25}em`;
    title.append(draftInput);
    columns.forEach(() => row.insertCell());
  }

  function addItemRow(body: HTMLTableSectionElement, row: Row & { kind: 'item' }, columns: Column[]): void {
    const { node } = row;
    const tr = body.insertRow();
    tr.className = 'item';
    tr.dataset.line = String(node.line);
    tr.classList.toggle('done', node.done);

    addCell(tr, node.line, WBS, 'wbs').textContent = node.outlineNumber;

    const check = addCell(tr, node.line, DONE, 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = node.done;
    // The cell is the focusable thing (Space toggles it); a tabbable checkbox
    // would make Tab walk the checkbox column instead of the grid.
    box.tabIndex = -1;
    // Done through an ancestor: shown, but only the ancestor's marker can clear it.
    box.disabled = !canMarkDone(model!) || (node.done && !node.source.done);
    box.addEventListener('change', () => {
      if (!write(check, (current) => setDone(current, node, box.checked))) box.checked = !box.checked;
    });
    check.append(box);

    const title = addCell(tr, node.line, TITLE, 'title');
    title.textContent = node.title;
    title.style.paddingLeft = `${0.5 + row.depth * 1.25}em`;

    node.cells.forEach((cell, i) => fill(addCell(tr, node.line, DECLARED + i), columns[i], cell));
  }

  /** A comment or blank line: one full-width cell holding the raw text. */
  function addLineRow(body: HTMLTableSectionElement, row: Row & { kind: 'line' }, columns: Column[]): void {
    const tr = body.insertRow();
    tr.dataset.line = String(row.line);
    tr.className = row.blank ? 'line blank' : 'line';
    addCell(tr, row.line, WBS, 'wbs');
    const raw = addCell(tr, row.line, TITLE, 'raw');
    raw.colSpan = 2 + columns.length;
    raw.textContent = row.text;
  }

  function build(): void {
    if (!model) return;
    const columns = model.columns;
    const text = buffer.text();
    const draftLine = draft ? lineAt(text, draft.anchor) : null;
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    for (const name of ['#', '', 'Task', ...columns.map((c) => c.name)]) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }

    const body = table.createTBody();
    if (frontMatter) {
      const tr = body.insertRow();
      tr.className = 'front-matter';
      tr.insertCell();
      const cell = tr.insertCell();
      cell.className = 'raw';
      cell.colSpan = 2 + columns.length;
      cell.textContent = frontMatter.text;
      if (frontMatter.diagnostic) {
        cell.classList.add(frontMatter.diagnostic.severity);
        cell.title = frontMatter.diagnostic.message;
      }
    }

    byLine.clear();
    selectedRow = null;
    for (const row of rows) {
      if (row.line === draftLine) addDraftRow(body, columns);
      byLine.set(row.line, row);
      if (row.kind === 'item') addItemRow(body, row, columns);
      else addLineRow(body, row, columns);
    }
    // The line the draft was anchored to is no longer a row (an undo, say).
    // Keep the draft on screen rather than dropping what was typed.
    if (draftLine !== null && !byLine.has(draftLine)) addDraftRow(body, columns);

    const foot = table.createTFoot();
    const total = foot.insertRow();
    total.className = 'total';
    total.insertCell();
    total.insertCell();
    total.insertCell().textContent = 'Total';
    columns.forEach((column, i) => {
      const td = total.insertCell();
      const sum = model?.totals[i];
      if (!sum) return;
      td.append(format(column, sum.effective), muted(`done ${format(column, sum.doneSum)}`));
    });

    const adder = foot.insertRow();
    adder.className = 'new-task';
    adder.insertCell();
    adder.insertCell();
    adder.insertCell().append(newTask);
    columns.forEach(() => adder.insertCell());
    markPlace();
  }

  /**
   * Show where the grid is: the selected-row class, and the roving tab stop —
   * the one cell in the table that is in the page's tab order, so the keyboard
   * can reach the grid and leave it again. With no place yet, that is the first
   * row's WBS cell, which is also its row selector.
   */
  function markPlace(): void {
    const line = at ? lineAt(buffer.text(), at.anchor) : null;
    const row = at?.column === WBS && line !== null ? cellFor(line, WBS)?.parentElement : null;
    if (row !== selectedRow) {
      selectedRow?.classList.remove('selected');
      selectedRow = (row as HTMLTableRowElement | null) ?? null;
      selectedRow?.classList.add('selected');
    }

    const stop = line === null ? cellFor(rows[0]?.line ?? 0, WBS) : cellFor(line, at?.column ?? WBS);
    if (stop === tabStop) return;
    if (tabStop?.isConnected) tabStop.tabIndex = -1;
    tabStop = stop;
    if (stop) stop.tabIndex = 0;
  }

  /**
   * Put the place on a cell. The anchor comes from the buffer as it stands,
   * not from the model, which may predate the edit that led here.
   */
  function place(line: number, column: number, fromApi = false): void {
    at = { anchor: lineEndOf(buffer.text(), line), column };
    held = true;
    markPlace();
    focusCell(line, column);
    updateToolbar();
    hooks.onCursorLine(line, fromApi);
  }

  function clearPlace(): void {
    at = null;
    held = false;
    markPlace();
    updateToolbar();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function rowIndex(line: number): number {
    return rows.findIndex((row) => row.line === line);
  }

  function lastColumn(row: Row): number {
    const columns = columnsOf(row);
    return columns[columns.length - 1];
  }

  /** Move the place `delta` rows, or to the new-task row when it runs off the end. */
  function step(line: number, delta: number, column: number): void {
    const next = rows[rowIndex(line) + delta];
    if (next) place(next.line, nearest(next, column));
    else if (delta > 0) newTask.focus();
  }

  /** The next or previous editable cell, wrapping across rows. */
  function tab(row: Row, column: number, back: boolean): void {
    const columns = columnsOf(row).filter((c) => c !== WBS);
    const i = columns.indexOf(column);
    const next = columns[i + (back ? -1 : 1)];
    if (next !== undefined) {
      place(row.line, next);
      return;
    }
    const sibling = rows[rowIndex(row.line) + (back ? -1 : 1)];
    if (sibling) place(sibling.line, back ? lastColumn(sibling) : columnsOf(sibling)[1]);
    else if (!back) newTask.focus();
  }

  function endEdit(row: Row, column: number): void {
    editing = null;
    const td = cellFor(row.line, column);
    if (!td) return;
    // Shows the model as it stands; the rebuild after the edit corrects it.
    if (row.kind === 'line') td.textContent = row.text;
    else if (column === TITLE) td.textContent = row.node.title;
    else if (model) fill(td, model.columns[column - DECLARED], row.node.cells[column - DECLARED]);
    td.focus();
  }

  function commit(row: Row, column: number, value: string): void {
    endEdit(row, column);
    if (row.kind === 'line') return apply(setLine(buffer.text(), row.span, value));
    const { node } = row;
    write(cellFor(row.line, column), (current) =>
      column === TITLE ? setTitle(current, node, value) : setField(current, node, column - DECLARED, value),
    );
  }

  /**
   * Open the cell's editor. `typed` is null when the edit was asked for
   * without a key (a double-click: select the content), '' for F2 (keep the
   * content, caret at the end), or the printable key that started it.
   */
  function beginEdit(row: Row, column: number, typed: string | null = null): void {
    const raw = rawOf(row, column);
    if (raw === null) return;
    place(row.line, column);
    const td = cellFor(row.line, column);
    if (!td) return;
    editing = { line: row.line, column };
    const input = document.createElement('input');
    input.className = 'cell-input';
    // Spreadsheet rule: editing shows the text as written, not the computed value.
    input.value = typed ? typed : raw;
    td.replaceChildren(input);
    input.focus();
    if (typed === null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(row, column, input.value);
        step(row.line, 1, column);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        commit(row, column, input.value);
        tab(row, column, event.shiftKey);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        endEdit(row, column);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        // Spreadsheet rule again: this cancels the edit, it does not undo the buffer.
        event.preventDefault();
        endEdit(row, column);
      }
    });
    input.addEventListener('blur', () => {
      if (editing?.line === row.line && editing.column === column) commit(row, column, input.value);
    });
  }

  // Structural operations. Spec §4b.4; the edits themselves are src/editing's.

  function startDraft(row: Row): void {
    draft = { anchor: row.span.from, indent: row.indent };
    draftInput.value = '';
    build();
    draftInput.focus();
    updateToolbar();
  }

  /**
   * Write a new item and put the place on its title. The anchor is in
   * post-edit coordinates: the last character the insert wrote, which is on
   * the new line whether rows put the line break before it or after it.
   */
  function insert(td: HTMLElement | null, where: { beforeLine: number } | 'end', indent: number, title: string): boolean {
    const edits = write(td, (current) => insertItem(current, where, indent, title));
    if (!edits) return false;
    if (edits.length === 0) return true;
    at = { anchor: edits[0].from + edits[0].insert.length - 1, column: TITLE };
    held = true;
    restore();
    return true;
  }

  function commitDraft(): void {
    const pending = draft;
    if (!pending) return;
    const title = draftInput.value;
    if (title.trim() === '') {
      draft = null;
      draftInput.value = '';
      build();
      restore();
      return;
    }
    // A refused insert keeps the draft and what was typed, with the reason beside it.
    draft = null;
    if (!insert(draftInput.parentElement, { beforeLine: lineAt(buffer.text(), pending.anchor) }, pending.indent, title)) {
      draft = pending;
      return;
    }
    draftInput.value = '';
  }

  function addTask(): void {
    const value = newTask.value;
    // Cleared first: the focus move after the insert blurs this input, which adds a task again.
    newTask.value = '';
    // At the indent of the last item line, not of a trailing comment or blank (§4b.1).
    const last = [...rows].reverse().find((row) => row.kind === 'item');
    // A refused insert keeps what was typed, with the reason beside it.
    if (!insert(newTask.parentElement, 'end', last?.indent ?? 0, value)) newTask.value = value;
  }

  /** Put the place back where it was, following the line if it moved. */
  function restore(): void {
    if (draft) {
      draftInput.focus();
      updateToolbar();
      return;
    }
    if (!at) return;
    const line = lineAt(buffer.text(), at.anchor);
    // A deleted row hands the place to whatever took its line, or to the row above.
    const row = byLine.get(line) ?? [...rows].reverse().find((r) => r.line <= line) ?? rows[0];
    if (!row) return;
    at = { anchor: lineEndOf(buffer.text(), row.line), column: nearest(row, at.column) };
    markPlace();
    if (held) focusCell(row.line, at.column);
    updateToolbar();
  }

  /**
   * The toolbar (§4b.5). A button is enabled only when its operation would
   * change something, which for most of them is "the edit is not empty".
   */
  const actions: { id: string; label: string; run(row: Row): void; enabled(row: Row): boolean }[] = [
    { id: 'insert', label: 'Insert row', run: startDraft, enabled: () => true },
    {
      id: 'delete',
      label: 'Delete row',
      run: (row) => apply(deleteLines(buffer.text(), range(row))),
      enabled: () => true,
    },
    {
      id: 'indent',
      label: 'Indent',
      run: (row) => apply(indent(buffer.text(), range(row))),
      // Only a row that has a row above it at the same or greater indent can move deeper.
      enabled: (row) => {
        const previous = rows[rowIndex(row.line) - 1];
        return previous !== undefined && previous.indent >= row.indent;
      },
    },
    {
      id: 'outdent',
      label: 'Outdent',
      run: (row) => apply(outdent(buffer.text(), range(row))),
      // The same conditions the operations use, without re-reading the document
      // on every focus move: there is indentation to remove, a line above, a line below.
      enabled: (row) => row.indent > 0,
    },
    {
      id: 'up',
      label: 'Move up',
      run: (row) => apply(moveUp(buffer.text(), range(row))),
      enabled: (row) => row.line > 1,
    },
    {
      id: 'down',
      label: 'Move down',
      run: (row) => apply(moveDown(buffer.text(), range(row))),
      enabled: (row) => row.line < (model?.lines.length ?? 0),
    },
    {
      id: 'done',
      label: 'Toggle done',
      run: (row) => row.kind === 'item' && write(cellFor(row.line, DONE), (current) => setDone(current, row.node, !row.node.done)),
      // A row done through an ancestor has no marker of its own to clear.
      enabled: (row) => row.kind === 'item' && canMarkDone(model!) && (!row.node.done || row.node.source.done),
    },
  ];

  /** Run a structural operation on the current row, if it applies. */
  function act(id: string): void {
    const action = actions.find((a) => a.id === id);
    const row = target();
    if (action && row && action.enabled(row)) action.run(row);
  }

  const buttons = actions.map((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.id;
    button.textContent = action.label;
    button.addEventListener('click', () => act(action.id));
    bar.append(button);
    return button;
  });

  function updateToolbar(): void {
    const row = draft ? null : target();
    buttons.forEach((button, i) => (button.disabled = row === null || !actions[i].enabled(row)));
  }

  function cellAt(event: Event): { row: Row; column: number } | null {
    const td = (event.target as HTMLElement).closest('td');
    const line = Number(td?.parentElement && (td.parentElement as HTMLTableRowElement).dataset.line);
    const row = byLine.get(line);
    if (!td || !row || td.dataset.column === undefined) return null;
    return { row, column: Number(td.dataset.column) };
  }

  // The key table, spec §4b.4. The editing-cell column lives in beginEdit;
  // this handles a focused cell and a selected row, which differ only where
  // the table says they do.
  table.addEventListener('keydown', (event) => {
    // Cell editors, the draft and new-task rows and the checkbox take their own keys.
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const row = target();
    if (!row || !at) return;
    const column = at.column;
    const selected = column === WBS;
    const columns = columnsOf(row);
    const handled = (): void => event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') handled(), buffer.undo();
      else if (event.key === 'y') handled(), buffer.redo();
      return;
    }
    if (event.altKey) {
      if (event.shiftKey && event.key === 'ArrowRight') handled(), act('indent');
      else if (event.shiftKey && event.key === 'ArrowLeft') handled(), act('outdent');
      else if (event.key === 'ArrowUp') handled(), act('up');
      else if (event.key === 'ArrowDown') handled(), act('down');
      return;
    }

    switch (event.key) {
      case 'ArrowUp':
        return handled(), step(row.line, -1, column);
      case 'ArrowDown':
        return handled(), step(row.line, 1, column);
      case 'ArrowLeft':
        return handled(), place(row.line, columns[Math.max(0, columns.indexOf(column) - 1)]);
      case 'ArrowRight':
        return handled(), place(row.line, columns[Math.min(columns.length - 1, columns.indexOf(column) + 1)]);
      case 'Enter':
        // Unbound on a selected row (§4b.4).
        if (selected) return;
        return handled(), step(row.line, 1, column);
      case 'Tab':
        // Unbound on a selected row, which is how the keyboard leaves the grid.
        if (selected) return;
        return handled(), tab(row, column, event.shiftKey);
      case 'Escape':
        if (!selected) return;
        return handled(), clearPlace();
      case 'Delete':
        if (selected) return handled(), act('delete');
        if (rawOf(row, column) === null) return;
        return handled(), commit(row, column, '');
      case 'Insert':
        return handled(), act('insert');
      case 'F2':
        return handled(), beginEdit(row, column, '');
      case ' ':
        if (column !== DONE) break;
        return handled(), act('done');
    }
    // Any other printable key starts an edit, replacing the cell's content.
    if (event.key.length === 1) handled(), beginEdit(row, column, event.key);
  });

  table.addEventListener('click', (event) => {
    const hit = cellAt(event);
    if (hit && !editing) place(hit.row.line, hit.column);
  });
  table.addEventListener('dblclick', (event) => {
    const hit = cellAt(event);
    if (hit && hit.column !== DONE && hit.column !== WBS) beginEdit(hit.row, hit.column);
  });
  table.addEventListener('focusin', (event) => {
    held = true;
    // The keyboard can land on the tab stop without going through a click.
    const hit = cellAt(event);
    if (!hit || editing) return;
    if (at && at.column === hit.column && lineAt(buffer.text(), at.anchor) === hit.row.line) return;
    place(hit.row.line, hit.column);
  });
  table.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !table.contains(next as unknown as globalThis.Node)) held = false;
  });

  draftInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      draftInput.value = '';
      commitDraft();
    }
  });
  draftInput.addEventListener('blur', commitDraft);

  newTask.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTask();
      return;
    }
    // Back into the grid: up to the last row, or back across it with Shift+Tab.
    const back = event.key === 'Tab' && event.shiftKey;
    if (event.key !== 'ArrowUp' && !back) return;
    const typed = newTask.value.trim() !== '';
    addTask();
    const last = rows[rows.length - 1];
    // A committed task already took the place; with no rows there is nothing to go back to.
    if (typed || !last) {
      if (typed) event.preventDefault();
      return;
    }
    event.preventDefault();
    place(last.line, back ? lastColumn(last) : nearest(last, at?.column ?? TITLE));
  });
  newTask.addEventListener('blur', addTask);

  /** Every line of the file becomes a row; front matter collapses into one. */
  function readModel(next: Model): void {
    const text = buffer.text();
    const depths = new Map<number, number>();
    const visit = (node: ModelNode, depth: number): void => {
      depths.set(node.line, depth);
      node.children.forEach((child) => visit(child, depth + 1));
    };
    next.roots.forEach((root) => visit(root, 0));
    const items = new Map<number, ModelNode>();
    const collect = (node: ModelNode): void => void (items.set(node.line, node), node.children.forEach(collect));
    next.roots.forEach(collect);

    rows = [];
    frontMatter = null;
    const block: Node[] = [];
    for (const node of next.lines) {
      if (node.kind === 'front-matter') {
        block.push(node);
        continue;
      }
      const item = node.kind === 'item' ? items.get(node.line) : undefined;
      if (item) {
        rows.push({ kind: 'item', line: node.line, span: node.span, indent: item.indent, node: item, depth: depths.get(node.line) ?? 0 });
      } else {
        const raw = text.slice(node.span.from, node.span.to);
        rows.push({ kind: 'line', line: node.line, span: node.span, indent: indentOf(raw), text: raw, blank: node.kind === 'blank' });
      }
    }
    if (block.length > 0) {
      const span = { from: block[0].span.from, to: block[block.length - 1].span.to };
      frontMatter = { span, text: text.slice(span.from, span.to).split('\n').join(' ') };
    }

    // Diagnostics land on the cell their span belongs to; the rest on the WBS
    // cell, and anything inside the front matter on its collapsed row (§4b.2).
    marks = new Map();
    const lineRows = new Map(rows.map((row) => [row.line, row]));
    for (const diagnostic of next.diagnostics) {
      const row = lineRows.get(diagnostic.line);
      if (!row) {
        if (frontMatter && !frontMatter.diagnostic) frontMatter.diagnostic = diagnostic;
        continue;
      }
      const key = `${diagnostic.line}:${columnFor(row, diagnostic)}`;
      if (!marks.has(key)) marks.set(key, diagnostic);
    }
  }

  function columnFor(row: Row, diagnostic: Diagnostic): number {
    if (!diagnostic.span) return WBS;
    if (row.kind === 'line') return TITLE;
    if (within(row.node.titleSpan, diagnostic.span)) return TITLE;
    const i = row.node.cells.findIndex((cell) => cell.span && within(cell.span, diagnostic.span as Span));
    return i >= 0 ? DECLARED + i : WBS;
  }

  return {
    update(next) {
      model = next;
      readModel(next);
      build();
      restore();
      updateToolbar();
    },
    setCursorLine(line) {
      const row = byLine.get(line);
      if (row) place(row.line, nearest(row, at?.column ?? TITLE), true);
    },
    destroy() {
      off();
      parent.replaceChildren();
    },
  };
}
