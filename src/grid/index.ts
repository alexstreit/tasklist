// Grid editor. A task sheet over the shared buffer: every change it makes is
// a text edit like any other. Spec §4b.1–4b.5. Items only; comment, blank and
// front matter rows come in Task 15.

import { formatDuration } from '../core';
import type { Cell, Column, Model, ModelNode } from '../core';
import type { PlanBuffer, TextEdit } from '../buffer';
import { deleteLines, indent, insertLineAbove, moveDown, moveUp, outdent } from '../editing';
import type { LineRange } from '../editing';
import { appendItem, itemLine, setDone, setField, setTitle } from './edits';
import './grid.css';

/** Cell columns: the WBS cell (which selects the row), the done checkbox, the title, then the declared columns. */
const WBS = -1;
const DONE = 0;
const TITLE = 1;
const DECLARED = 2;

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

export function mountGrid(buffer: PlanBuffer, parent: HTMLElement, hooks: GridHooks): GridEditor {
  const bar = document.createElement('div');
  bar.className = 'sheet-toolbar';
  const table = document.createElement('table');
  table.className = 'plan-sheet';
  parent.replaceChildren(bar, table);

  let model: Model | null = null;
  let rows: { node: ModelNode; depth: number }[] = [];
  const byLine = new Map<number, ModelNode>();
  // Where the grid is: a cell of a row, or its WBS cell, which is what row
  // selection is. Anchored to the end of the line so that edits and inserted
  // lines above it carry the place along (spec §4b.3).
  let at: { anchor: number; column: number } | null = null;
  let held = false; // the grid holds the browser focus
  let editing: { line: number; column: number } | null = null;
  // The cell that is in the page's tab order; every other cell is -1.
  let tabStop: HTMLTableCellElement | null = null;
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
    return row?.cells[column + 1] ?? null;
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
  function target(): ModelNode | null {
    return at ? (byLine.get(lineAt(buffer.text(), at.anchor)) ?? null) : null;
  }

  function range(node: ModelNode): LineRange {
    return { fromLine: node.line, toLine: node.line };
  }

  function apply(edits: readonly TextEdit[]): void {
    if (edits.length > 0) buffer.apply(edits, 'grid');
  }

  /** The text a cell edits, or null when the cell is not text-editable. */
  function rawOf(node: ModelNode, column: number): string | null {
    if (column === TITLE) return node.title;
    const cell = node.cells[column - DECLARED] as Cell | undefined;
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

  function addCell(row: HTMLTableRowElement, column: number): HTMLTableCellElement {
    const td = row.insertCell();
    td.dataset.column = String(column);
    td.tabIndex = -1;
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
    byLine.clear();
    for (const { node, depth } of rows) {
      if (node.line === draftLine) addDraftRow(body, columns);
      byLine.set(node.line, node);
      const row = body.insertRow();
      row.dataset.line = String(node.line);
      row.classList.toggle('done', node.done);

      const wbs = addCell(row, WBS);
      wbs.className = 'wbs';
      wbs.textContent = node.outlineNumber;

      const check = addCell(row, DONE);
      check.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = node.done;
      // The cell is the focusable thing (Space toggles it); a tabbable checkbox
      // would make Tab walk the checkbox column instead of the grid.
      box.tabIndex = -1;
      // Done through an ancestor: shown, but only the ancestor's marker can clear it.
      box.disabled = node.done && !node.source.done;
      box.addEventListener('change', () => apply(setDone(buffer.text(), node, box.checked)));
      check.append(box);

      const title = addCell(row, TITLE);
      title.className = 'title';
      title.textContent = node.title;
      title.style.paddingLeft = `${0.5 + depth * 1.25}em`;

      node.cells.forEach((cell, i) => fill(addCell(row, DECLARED + i), columns[i], cell));
    }
    // The line the draft was anchored to is no longer an item row (an undo,
    // say). Keep the draft on screen rather than dropping what was typed.
    if (draftLine !== null && !rows.some(({ node }) => node.line === draftLine)) addDraftRow(body, columns);

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
    const text = buffer.text();
    const line = at ? lineAt(text, at.anchor) : null;
    const selected = at?.column === WBS && line !== null ? String(line) : null;
    for (const row of table.tBodies[0]?.rows ?? []) row.classList.toggle('selected', row.dataset.line === selected);

    const stop = line === null ? cellFor(rows[0]?.node.line ?? 0, WBS) : cellFor(line, at?.column ?? WBS);
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
    return rows.findIndex((row) => row.node.line === line);
  }

  function lastColumn(): number {
    return TITLE + (model?.columns.length ?? 0);
  }

  /** Move the place `delta` rows, or to the new-task row when it runs off the end. */
  function step(line: number, delta: number, column: number): void {
    const next = rows[rowIndex(line) + delta];
    if (next) place(next.node.line, column);
    else if (delta > 0) newTask.focus();
  }

  /** The next or previous editable cell, wrapping across rows. */
  function tab(line: number, column: number, back: boolean): void {
    const last = lastColumn();
    if (back ? column > DONE : column < last) {
      place(line, column + (back ? -1 : 1));
      return;
    }
    const next = rows[rowIndex(line) + (back ? -1 : 1)];
    if (next) place(next.node.line, back ? last : DONE);
    else if (!back) newTask.focus();
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
    const node = byLine.get(line) ?? [...rows].reverse().find(({ node: n }) => n.line <= line)?.node ?? rows[0]?.node;
    if (!node) return;
    at = { anchor: node.span.to, column: at.column };
    markPlace();
    if (held) focusCell(node.line, at.column);
    updateToolbar();
  }

  function endEdit(node: ModelNode, column: number): void {
    editing = null;
    const td = cellFor(node.line, column);
    if (!td) return;
    // Shows the model as it stands; the rebuild after the edit corrects it.
    if (column === TITLE) td.textContent = node.title;
    else if (model) fill(td, model.columns[column - DECLARED], node.cells[column - DECLARED]);
    td.focus();
  }

  function commit(node: ModelNode, column: number, value: string): void {
    const text = buffer.text();
    const edits = column === TITLE ? setTitle(text, node, value) : setField(text, node, column - DECLARED, value);
    endEdit(node, column);
    apply(edits);
  }

  /**
   * Open the cell's editor. `typed` is null when the edit was asked for
   * without a key (a double-click: select the content), '' for F2 (keep the
   * content, caret at the end), or the printable key that started it.
   */
  function beginEdit(node: ModelNode, column: number, typed: string | null = null): void {
    const raw = rawOf(node, column);
    if (raw === null) return;
    place(node.line, column);
    const td = cellFor(node.line, column);
    if (!td) return;
    editing = { line: node.line, column };
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
        commit(node, column, input.value);
        step(node.line, 1, column);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        commit(node, column, input.value);
        tab(node.line, column, event.shiftKey);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        endEdit(node, column);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        // Spreadsheet rule again: this cancels the edit, it does not undo the buffer.
        event.preventDefault();
        endEdit(node, column);
      }
    });
    input.addEventListener('blur', () => {
      if (editing?.line === node.line && editing.column === column) commit(node, column, input.value);
    });
  }

  // Structural operations. Spec §4b.4; the edits themselves are src/editing's.

  function startDraft(node: ModelNode): void {
    draft = { anchor: node.span.from, indent: node.indent };
    draftInput.value = '';
    build();
    draftInput.focus();
    updateToolbar();
  }

  function commitDraft(): void {
    const pending = draft;
    if (!pending) return;
    draft = null;
    const line = itemLine(pending.indent, draftInput.value);
    draftInput.value = '';
    if (line === null) {
      build();
      restore();
      return;
    }
    const edits = insertLineAbove(buffer.text(), { fromLine: lineAt(buffer.text(), pending.anchor), toLine: 0 }, line);
    buffer.apply(edits, 'grid');
    // Post-edit coordinates: the line the insert just created, minus its newline.
    at = { anchor: edits[0].from + edits[0].insert.length - 1, column: TITLE };
    held = true;
    restore();
  }

  function addTask(): void {
    const value = newTask.value;
    newTask.value = '';
    const edits = appendItem(buffer.text(), value, rows.length > 0 ? rows[rows.length - 1].node.indent : 0);
    if (edits.length === 0) return;
    buffer.apply(edits, 'grid');
    at = { anchor: edits[0].from + edits[0].insert.length - 1, column: TITLE };
    held = true;
    restore();
  }

  /**
   * The toolbar (§4b.5). A button is enabled only when its operation would
   * change something, which for most of them is "the edit is not empty".
   */
  const actions: { id: string; label: string; run(node: ModelNode): void; enabled(node: ModelNode): boolean }[] = [
    { id: 'insert', label: 'Insert row', run: startDraft, enabled: () => true },
    {
      id: 'delete',
      label: 'Delete row',
      run: (node) => apply(deleteLines(buffer.text(), range(node))),
      enabled: () => true,
    },
    {
      id: 'indent',
      label: 'Indent',
      run: (node) => apply(indent(buffer.text(), range(node))),
      // Only a row that has a row above it at the same or greater indent can move deeper.
      enabled: (node) => {
        const previous = rows[rows.findIndex((r) => r.node.line === node.line) - 1];
        return previous !== undefined && previous.node.indent >= node.indent;
      },
    },
    {
      id: 'outdent',
      label: 'Outdent',
      run: (node) => apply(outdent(buffer.text(), range(node))),
      enabled: (node) => outdent(buffer.text(), range(node)).length > 0,
    },
    {
      id: 'up',
      label: 'Move up',
      run: (node) => apply(moveUp(buffer.text(), range(node))),
      enabled: (node) => moveUp(buffer.text(), range(node)).length > 0,
    },
    {
      id: 'down',
      label: 'Move down',
      run: (node) => apply(moveDown(buffer.text(), range(node))),
      enabled: (node) => moveDown(buffer.text(), range(node)).length > 0,
    },
    {
      id: 'done',
      label: 'Toggle done',
      run: (node) => apply(setDone(buffer.text(), node, !node.done)),
      // A row done through an ancestor has no marker of its own to clear.
      enabled: (node) => !node.done || node.source.done,
    },
  ];

  /** Run a structural operation on the current row, if it applies. */
  function act(id: string): void {
    const action = actions.find((a) => a.id === id);
    const node = target();
    if (action && node && action.enabled(node)) action.run(node);
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
    const node = draft ? null : target();
    buttons.forEach((button, i) => (button.disabled = node === null || !actions[i].enabled(node)));
  }

  function cellAt(event: Event): { node: ModelNode; column: number } | null {
    const td = (event.target as HTMLElement).closest('td');
    const line = Number(td?.parentElement && (td.parentElement as HTMLTableRowElement).dataset.line);
    const node = byLine.get(line);
    if (!td || !node || td.dataset.column === undefined) return null;
    return { node, column: Number(td.dataset.column) };
  }

  table.addEventListener('click', (event) => {
    const hit = cellAt(event);
    if (hit && !editing) place(hit.node.line, hit.column);
  });
  table.addEventListener('dblclick', (event) => {
    const hit = cellAt(event);
    if (hit && hit.column !== DONE && hit.column !== WBS) beginEdit(hit.node, hit.column);
  });
  // The key table, spec §4b.4. The editing-cell column lives in beginEdit;
  // this handles a focused cell and a selected row, which differ only where
  // the table says they do.
  table.addEventListener('keydown', (event) => {
    // Cell editors, the draft and new-task rows and the checkbox take their own keys.
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const node = target();
    if (!node || !at) return;
    const column = at.column;
    const selected = column === WBS;
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
        return handled(), step(node.line, -1, column);
      case 'ArrowDown':
        return handled(), step(node.line, 1, column);
      case 'ArrowLeft':
        return handled(), place(node.line, Math.max(WBS, column - 1));
      case 'ArrowRight':
        return handled(), place(node.line, Math.min(lastColumn(), column + 1));
      case 'Enter':
        // Unbound on a selected row (§4b.4).
        if (selected) return;
        return handled(), step(node.line, 1, column);
      case 'Tab':
        // Unbound on a selected row, which is how the keyboard leaves the grid.
        if (selected) return;
        return handled(), tab(node.line, column, event.shiftKey);
      case 'Escape':
        if (!selected) return;
        return handled(), clearPlace();
      case 'Delete':
        if (selected) return handled(), act('delete');
        if (rawOf(node, column) === null) return;
        return handled(), commit(node, column, '');
      case 'Insert':
        return handled(), act('insert');
      case 'F2':
        return handled(), beginEdit(node, column, '');
      case ' ':
        if (column !== DONE) break;
        return handled(), act('done');
    }
    // Any other printable key starts an edit, replacing the cell's content.
    if (event.key.length === 1) handled(), beginEdit(node, column, event.key);
  });

  table.addEventListener('focusin', (event) => {
    held = true;
    // The keyboard can land on the tab stop without going through a click.
    const hit = cellAt(event);
    if (!hit || editing) return;
    if (at && at.column === hit.column && lineAt(buffer.text(), at.anchor) === hit.node.line) return;
    place(hit.node.line, hit.column);
  });
  table.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !table.contains(next)) held = false;
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
    place(last.node.line, back ? lastColumn() : (at?.column ?? TITLE));
  });
  newTask.addEventListener('blur', addTask);

  return {
    update(next) {
      model = next;
      rows = [];
      const visit = (node: ModelNode, depth: number): void => {
        rows.push({ node, depth });
        node.children.forEach((child) => visit(child, depth + 1));
      };
      next.roots.forEach((root) => visit(root, 0));
      build();
      restore();
      updateToolbar();
    },
    setCursorLine(line) {
      const node = byLine.get(line);
      if (node) place(node.line, at?.column ?? TITLE, true);
    },
    destroy() {
      off();
      parent.replaceChildren();
    },
  };
}
