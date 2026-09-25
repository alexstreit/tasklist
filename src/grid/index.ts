// Grid editor. A task sheet over the shared buffer: every change it makes is
// a text edit like any other. Spec §4b.1–4b.3. Items only; comment, blank and
// front matter rows come in Task 15.

import { formatDuration } from '../core';
import type { Cell, Column, Model, ModelNode } from '../core';
import type { PlanBuffer } from '../buffer';
import { appendItem, setDone, setField, setTitle } from './edits';
import './grid.css';

/** Cell columns: the done checkbox, the title, then the declared columns. */
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
  const table = document.createElement('table');
  table.className = 'plan-sheet';
  parent.replaceChildren(table);

  let model: Model | null = null;
  let rows: { node: ModelNode; depth: number }[] = [];
  const byLine = new Map<number, ModelNode>();
  // The focused cell, anchored to the end of its line so that edits and
  // inserted lines above it carry the focus along (spec §4b.3).
  let focus: { anchor: number; column: number } | null = null;
  let held = false; // the grid holds the browser focus
  let editing: { line: number; column: number } | null = null;

  const newTask = document.createElement('input');
  newTask.className = 'cell-input';
  newTask.placeholder = 'New task';

  const off = buffer.onChange((change) => {
    // A loaded file is a different document; the old anchor means nothing in it.
    if (change.origin === 'load') focus = null;
    else if (focus) focus = { anchor: change.mapPos(focus.anchor), column: focus.column };
  });

  function cellFor(line: number, column: number): HTMLTableCellElement | null {
    const row = table.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
    return row?.cells[column + 1] ?? null;
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

  function build(): void {
    if (!model) return;
    const columns = model.columns;
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
      byLine.set(node.line, node);
      const row = body.insertRow();
      row.dataset.line = String(node.line);
      row.classList.toggle('done', node.done);
      const wbs = row.insertCell();
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
  }

  function apply(edits: ReturnType<typeof setTitle>): void {
    if (edits.length > 0) buffer.apply(edits, 'grid');
  }

  function focusCell(node: ModelNode, column: number, fromApi = false): void {
    focus = { anchor: node.span.to, column };
    held = true;
    cellFor(node.line, column)?.focus();
    hooks.onCursorLine(node.line, fromApi);
  }

  /** Put the focus back on the cell it was on, following the line if it moved. */
  function restore(): void {
    if (!focus) return;
    const node = byLine.get(lineAt(buffer.text(), focus.anchor));
    if (!node) return;
    focus = { anchor: node.span.to, column: focus.column };
    if (held) cellFor(node.line, focus.column)?.focus();
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
    const td = cellFor(node.line, column);
    if (raw === null || !td) return;
    focusCell(node, column);
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
    if (hit && hit.column !== DONE) beginEdit(hit.node, hit.column);
  });
  table.addEventListener('focusin', () => (held = true));
  table.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !table.contains(next)) held = false;
  });

  function addTask(): void {
    const value = newTask.value;
    newTask.value = '';
    const edits = appendItem(buffer.text(), value, rows.length > 0 ? rows[rows.length - 1].node.indent : 0);
    if (edits.length === 0) return;
    buffer.apply(edits, 'grid');
    // Post-edit coordinates: the line the insert just created, minus its newline.
    focus = { anchor: edits[0].from + edits[0].insert.length - 1, column: TITLE };
    held = true;
    restore();
  }
  newTask.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTask();
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
    },
    setCursorLine(line) {
      const node = byLine.get(line);
      if (node) focusCell(node, focus?.column ?? TITLE, true);
    },
    destroy() {
      off();
      parent.replaceChildren();
    },
  };
}
