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
    markSelection();
  }

  /** Row selection is the WBS cell being the current place; mark it without rebuilding. */
  function markSelection(): void {
    const line = at && at.column === WBS ? String(lineAt(buffer.text(), at.anchor)) : null;
    for (const row of table.tBodies[0]?.rows ?? []) row.classList.toggle('selected', row.dataset.line === line);
  }

  function focusCell(node: ModelNode, column: number, fromApi = false): void {
    at = { anchor: node.span.to, column };
    held = true;
    markSelection();
    cellFor(node.line, column)?.focus();
    updateToolbar();
    hooks.onCursorLine(node.line, fromApi);
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
    markSelection();
    if (held) cellFor(node.line, at.column)?.focus();
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

  function beginEdit(node: ModelNode, column: number): void {
    const raw = rawOf(node, column);
    if (raw === null) return;
    focusCell(node, column);
    const td = cellFor(node.line, column);
    if (!td) return;
    editing = { line: node.line, column };
    const input = document.createElement('input');
    input.className = 'cell-input';
    // Spreadsheet rule: editing shows the text as written, not the computed value.
    input.value = raw;
    td.replaceChildren(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(node, column, input.value);
      } else if (event.key === 'Escape') {
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

  const buttons = actions.map((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.id;
    button.textContent = action.label;
    button.addEventListener('click', () => {
      const node = target();
      if (node && action.enabled(node)) action.run(node);
    });
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
    if (hit && !editing) focusCell(hit.node, hit.column);
  });
  table.addEventListener('dblclick', (event) => {
    const hit = cellAt(event);
    if (hit && hit.column !== DONE && hit.column !== WBS) beginEdit(hit.node, hit.column);
  });
  table.addEventListener('focusin', () => (held = true));
  table.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !table.contains(next)) held = false;
  });

  for (const [input, submit] of [
    [draftInput, commitDraft],
    [newTask, addTask],
  ] as const) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape' && input === draftInput) {
        event.preventDefault();
        draftInput.value = '';
        commitDraft();
      }
    });
    input.addEventListener('blur', submit);
  }

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
      if (node) focusCell(node, at?.column ?? TITLE, true);
    },
    destroy() {
      off();
      parent.replaceChildren();
    },
  };
}
