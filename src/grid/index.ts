// Grid editor. A task sheet over the shared buffer: every change it makes is
// a text edit like any other. Spec §4b.

import { readFlag } from 'rows';
import type { Cell as RowsCell, Column as RowsColumn, EditResult } from 'rows';
import { formatDuration, preview } from '../core';
import type { Column, Diagnostic, Fix, ItemNode, Model, Node, Pinnable, Span } from '../core';
import type { PlanBuffer, TextEdit } from '../buffer';
import { deleteLines, indent, moveDown, moveUp, outdent } from '../editing';
import type { LineRange } from '../editing';
import { canMarkDone, columnOf, deleteItem, insertIndent, insertItem, levels, moveItem, setDone, setField, setFlag, setLine, setTitle, setToggle, shiftItem, withRepairs } from './edits';
import { plainRefusal } from './messages';
import { isRefColumn, refText, setRefs } from './refs';
import { hasValue, rollup, totals } from '../plugins/estimate/fields';
import { mountProblems } from './problems';
import { layoutPublisher } from '../ui/row-layout';
import type { Leader, RowLayout } from '../ui/row-layout';
import './grid.css';

/**
 * Cell columns: the WBS cell (which selects the row), the done checkbox, a toggle for each other
 * marker (MARKER, MARKER - 1, …, left to right), the title, then the declared columns.
 */
const WBS = -1;
const DONE = 0;
const TITLE = 1;
const DECLARED = 2;
const MARKER = -2;

/** An item line, or any other line shown as one editable full-width cell. */
type Row =
  // `depth` is the level the row is shown at, `level` the one rows' structure edits use (edits.ts `levels`).
  | { kind: 'item'; line: number; span: Span; indent: number; node: ItemNode; depth: number; level: number }
  | { kind: 'line'; line: number; span: Span; indent: number; text: string; blank: boolean };

export interface GridHooks {
  /** `fromApi` is true when the move came from setCursorLine rather than the user. */
  onCursorLine(line: number, fromApi: boolean): void;
}

/** The grid leads (spec §3.4): its rows are its table's body rows. */
export interface GridEditor extends Leader {
  /** Also republishes the row layout. */
  update(model: Model): void;
  setCursorLine(line: number): void;
  /** Band the row on `line`, hovered in the other pane; null clears it. */
  setHoverLine(line: number | null): void;
  /** The line of the row under the pointer; null off the rows, or on one with no line. Replaces any earlier callback. */
  onHoverLine(cb: (line: number | null) => void): void;
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
  // The settings banner and the problems list, with their fixes (spec §4b.6.3, §4b.6.6).
  const problems = mountProblems({
    write: (host, make) => void write(host, make),
    titleOf: (line) => {
      const row = byLine.get(line);
      return row?.kind === 'item' && row.node.title !== '' ? row.node.title : null;
    },
    // Focuses the row, or the cell the diagnostic's span falls in.
    focus: (diagnostic) => {
      const row = byLine.get(diagnostic.line);
      if (row) place(row.line, diagnostic.span ? columnFor(row, diagnostic) : WBS);
    },
  });
  const table = document.createElement('table');
  table.className = 'plan-sheet';
  // Space above the table when a following pane's header is taller than the grid's (setMinBodyTop).
  const spacer = document.createElement('div');
  // Where the grid asks before deleting a row other rows refer to (spec §4b.4).
  const confirmBox = document.createElement('div');
  confirmBox.className = 'sheet-confirm';
  parent.replaceChildren(bar, confirmBox, problems.banner, problems.list, spacer, table);

  let model: Model | null = null;
  let rows: Row[] = [];
  const byLine = new Map<number, Row>();
  // The front matter block, shown collapsed and read-only above the rows.
  let frontMatter: { line: number; span: Span; text: string; diagnostic?: Diagnostic } | null = null;
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
  // The row the place is on, which has the current-row band.
  let currentRow: HTMLTableRowElement | null = null;
  // Hover across panes: the line under the pointer here, and the one hovered in the other pane.
  let hovered: number | null = null;
  let onHover: ((line: number | null) => void) | null = null;
  let relayed: number | null = null;
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
      notice(td, plainRefusal(result.refused));
      return null;
    }
    apply(result.edits);
    return result.edits;
  }

  /** The markers other than done, each with a toggle column after done's, in declaration order (spec §4b.1). */
  function toggles() {
    return (model?.doc.schema.markers ?? []).filter((m) => m.name !== 'done');
  }

  /** The cells before the title: the WBS cell, done, and the toggles. */
  function leading(): number {
    return 2 + toggles().length;
  }

  /** The cells a row offers, left to right. A non-item line has only its raw cell. */
  function columnsOf(row: Row): number[] {
    if (row.kind === 'line') return [WBS, TITLE];
    return [WBS, DONE, ...toggles().map((_, i) => MARKER - i), TITLE, ...(model?.columns ?? []).map((_, i) => DECLARED + i)];
  }

  /** The column to land on when arriving at a row that may not have the one we left. */
  function nearest(row: Row, column: number): number {
    return columnsOf(row).includes(column) ? column : TITLE;
  }

  /** The text a cell edits, or null when the cell is not text-editable. */
  function rawOf(row: Row, column: number): string | null {
    if (row.kind === 'line') return column === TITLE ? row.text : null;
    if (column === TITLE) return row.node.title;
    const index = column - DECLARED;
    if (!model?.columns[index]) return null;
    // Editing a ref cell shows its outline numbers, as it is shown: the one exception to the raw text (§4b.2).
    if (isRefColumn(model, index)) return refText(model, row.node, index);
    const text = row.node.fields[index]?.text ?? '';
    const cell = rollupOf(row.node, index);
    // A bool the checkbox shows is toggled, not typed; any other text is edited as text.
    if (!cell) return boolColumn(column) && isFlag(text) ? null : text;
    // An additive value rolls its children in; editing it in place would be a lie.
    return cell.mode === 'additive' ? null : text;
  }

  /** The roll-up of a summable cell; undefined for any other. */
  function rollupOf(node: ItemNode, index: number): Pinnable<number> | undefined {
    return model!.get(node, rollup)?.get(model!.columns[index].name);
  }

  /** The rows column behind a grid column when it is bool, whose cells show a checkbox; null otherwise. */
  function boolColumn(column: number): RowsColumn | null {
    if (!model || column < DECLARED) return null;
    const rowsColumn = columnOf(model, column - DECLARED);
    return rowsColumn?.kind === 'bool' ? rowsColumn : null;
  }

  const isFlag = (text: string) => text === '' || text === 'true' || text === 'false';

  function fill(td: HTMLTableCellElement, node: ItemNode, index: number): void {
    td.replaceChildren();
    const column = model!.columns[index];
    const text = node.fields[index]?.text ?? '';
    const cell = rollupOf(node, index);
    if (!cell) {
      if (isRefColumn(model!, index)) {
        td.textContent = refText(model!, node, index);
        return;
      }
      const bool = boolColumn(DECLARED + index);
      // A bool is a checkbox (spec §4b.6.5), unless its text is no bool; then it shows as written.
      if (bool && isFlag(text)) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.tabIndex = -1;
        box.checked = readFlag(model!.doc, node.row, bool) === true;
        box.addEventListener('change', () => {
          if (!write(td, (current) => withRepairs(current, setFlag(current, node, index, box.checked), [node]))) box.checked = !box.checked;
        });
        td.classList.add('check');
        td.append(box);
        return;
      }
      td.textContent = text;
      return;
    }
    if (cell.mode === 'additive') {
      td.classList.add('additive');
      td.title = `additive value "${text}" — edit it in the text editor`;
      td.append(muted('+'));
    }
    // An unestimated subtree shows nothing rather than "0h".
    if (!model!.get(node, hasValue)?.get(column.name)) return;
    td.append(format(column, cell.effective));
    if (cell.mode === 'derived') td.classList.add('derived');
    // Derived cells render bare: effective already is the child sum.
    else if (cell.derived !== undefined) td.append(muted(`⟨Σ ${format(column, cell.derived)}⟩`));
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

  /** What a row's WBS badge lists: its extra values, and each column it sets twice with both values. */
  function extraValues(node: ItemNode): string {
    const row = node.row;
    const repeated = (c: RowsCell) => row.errors.some((e) => e.code === 'column-set-twice' && e.from! >= c.from && e.from! < c.to);
    const shown = (c: RowsCell) => (c.name ? `${c.name.text}=` : '') + (c.text ?? '');
    const parts: string[] = [];
    const extras = row.overflow.filter((c) => !repeated(c));
    if (extras.length > 0) parts.push(`+ ${extras.map(shown).join(' | ')}`);
    for (const c of row.overflow.filter(repeated)) {
      const column = model?.doc.schema.columns.find((x) => x.name === c.name?.text && x.index > 0);
      const first = column ? row.cells[column.index] : null;
      parts.push(`${c.name!.text}: ${first?.text ?? ''} / ${c.text ?? ''}`);
    }
    return parts.join(' · ');
  }

  /** The placeholder row for a title that has not been written to the buffer yet. */
  function addDraftRow(body: HTMLTableSectionElement, columns: Column[]): void {
    const row = body.insertRow();
    row.className = 'draft';
    for (let i = 0; i < leading(); i++) row.insertCell();
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

    const wbs = addCell(tr, node.line, WBS, 'wbs');
    wbs.textContent = node.outlineNumber;
    // The ID, so a grid user can name the task to a text user (spec §4b.1).
    if (node.row.anchors.length > 0) wbs.title = [`#${node.row.anchors[0].id}`, wbs.title].filter(Boolean).join('\n');
    const extra = extraValues(node);
    if (extra) {
      // The values rows kept as overflow, or a column's two values (spec §4b.6.6).
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = extra;
      badge.title = extra;
      wbs.prepend(badge);
    }

    const check = addCell(tr, node.line, DONE, 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = node.done;
    // The cell is the focusable thing (Space toggles it); a tabbable checkbox
    // would make Tab walk the checkbox column instead of the grid.
    box.tabIndex = -1;
    // Done through an ancestor: shown, but only the ancestor's marker can clear it.
    box.disabled = !canMarkDone(model!) || (node.done && !node.ownDone);
    box.addEventListener('change', () => {
      if (!write(check, (current) => withRepairs(current, setDone(current, node, box.checked), [node]))) box.checked = !box.checked;
    });
    check.append(box);

    toggles().forEach((marker, i) => {
      const td = addCell(tr, node.line, MARKER - i, 'check');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.tabIndex = -1;
      toggle.checked = readFlag(model!.doc, node.row, marker.column) === true;
      toggle.setAttribute('aria-label', marker.name);
      toggle.addEventListener('change', () => {
        if (!write(td, (current) => withRepairs(current, setToggle(current, node, marker.name, toggle.checked), [node]))) toggle.checked = !toggle.checked;
      });
      td.append(toggle);
    });

    const title = addCell(tr, node.line, TITLE, 'title');
    title.textContent = node.title;
    title.style.paddingLeft = `${0.5 + row.depth * 1.25}em`;

    columns.forEach((_, i) => fill(addCell(tr, node.line, DECLARED + i), node, i));
  }

  /** A comment or blank line: one full-width cell holding the raw text. */
  function addLineRow(body: HTMLTableSectionElement, row: Row & { kind: 'line' }, columns: Column[]): void {
    const tr = body.insertRow();
    tr.dataset.line = String(row.line);
    tr.className = row.blank ? 'line blank' : 'line';
    addCell(tr, row.line, WBS, 'wbs');
    const raw = addCell(tr, row.line, TITLE, 'raw');
    raw.colSpan = leading() + columns.length;
    raw.textContent = row.text;
  }

  function build(): void {
    if (!model) return;
    const columns = model.columns;
    const text = buffer.text();
    const draftLine = draft ? lineAt(text, draft.anchor) : null;
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    for (const name of ['#', '', ...toggles().map((m) => m.char), 'Task', ...columns.map((c) => c.name)]) {
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
      cell.colSpan = leading() + columns.length;
      cell.textContent = frontMatter.text;
      if (frontMatter.diagnostic) {
        cell.classList.add(frontMatter.diagnostic.severity);
        cell.title = frontMatter.diagnostic.message;
      }
    }

    byLine.clear();
    selectedRow = null;
    currentRow = null;
    for (const row of rows) {
      if (row.line === draftLine) addDraftRow(body, columns);
      byLine.set(row.line, row);
      if (row.kind === 'item') addItemRow(body, row, columns);
      else addLineRow(body, row, columns);
    }
    // The line the draft was anchored to is no longer a row (an undo, say).
    // Keep the draft on screen rather than dropping what was typed.
    if (draftLine !== null && !byLine.has(draftLine)) addDraftRow(body, columns);

    // The last body row; the total row below it stays at the bottom of the pane (spec §4b.1).
    const adder = body.insertRow();
    adder.className = 'new-task';
    for (let i = 0; i < leading(); i++) adder.insertCell();
    adder.insertCell().append(newTask);
    columns.forEach(() => adder.insertCell());

    const foot = table.createTFoot();
    const total = foot.insertRow();
    total.className = 'total';
    for (let i = 0; i < leading(); i++) total.insertCell();
    total.insertCell().textContent = 'Total';
    columns.forEach((column) => {
      const td = total.insertCell();
      const sum = model?.value(totals)?.get(column.name);
      if (!sum) return;
      td.append(format(column, sum.effective), muted(`done ${format(column, sum.doneSum)}`));
    });
    markPlace();
    markHover();
  }

  /** The line a body row is on: the front matter's first line, or its own; null for the draft and new-task rows. */
  function lineOf(tr: HTMLTableRowElement): number | null {
    if (tr.classList.contains('front-matter')) return frontMatter!.line;
    return tr.dataset.line === undefined ? null : Number(tr.dataset.line);
  }

  /** Band the row hovered in the other pane. */
  function markHover(): void {
    for (const tr of table.tBodies[0]?.rows ?? []) tr.classList.toggle('hover', relayed !== null && lineOf(tr) === relayed);
  }

  function hover(line: number | null): void {
    if (line === hovered) return;
    hovered = line;
    onHover?.(line);
  }

  // Row alignment (spec §3.4). The whole pane scrolls, header included, so the body's top is
  // measured in the pane's content.
  let minBodyTop = 0;

  /** The body rows that are on screen: comment, blank and front matter rows too, and the draft and new-task rows as `at: null`. */
  function measure(): RowLayout {
    const scrollTop = parent.scrollTop;
    const paneTop = parent.getBoundingClientRect().top;
    const body = table.tBodies[0];
    // Before the first model there is no body, and no rows.
    const bodyTop = body ? body.getBoundingClientRect().top - paneTop + scrollTop : 0;
    const rows: RowLayout['rows'] = [];
    for (const tr of body?.rows ?? []) {
      const rect = tr.getBoundingClientRect();
      // Off screen: above the pane's top, or below its bottom.
      if (rect.bottom <= paneTop || rect.top >= paneTop + parent.clientHeight) continue;
      const line = lineOf(tr);
      rows.push({ at: line === null ? null : { line }, top: rect.top - paneTop + scrollTop - bodyTop, height: rect.height });
    }
    return { version: model?.version ?? 0, bodyTop, contentHeight: parent.scrollHeight - bodyTop, scrollTop, rows };
  }
  const layout = layoutPublisher(measure);

  /** The spacer makes up what the grid's own header lacks of the minimum. */
  function fitSpacer(): void {
    const spaced = spacer.getBoundingClientRect().height;
    const body = table.tBodies[0];
    if (!body) return;
    const natural = body.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop - spaced;
    const want = Math.max(0, minBodyTop - natural);
    if (want !== spaced) spacer.style.height = want > 0 ? `${want}px` : '';
  }

  /** Fit the spacer and publish, measuring nothing while nothing subscribes; with no minimum, the spacer goes. */
  function fitBodyTop(): void {
    if (minBodyTop === 0) spacer.style.height = '';
    if (!layout.listened()) return;
    fitSpacer();
    layout.publish();
  }

  parent.addEventListener('scroll', layout.publish);
  // The pane, and the header parts above the table: the problems list or the settings banner
  // opening or closing moves the body without resizing the pane. jsdom has no ResizeObserver.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fitBodyTop) : null;
  for (const element of [parent, bar, confirmBox, problems.banner, problems.list]) resize?.observe(element);

  /**
   * Show where the grid is: the selected-row class, and the roving tab stop —
   * the one cell in the table that is in the page's tab order, so the keyboard
   * can reach the grid and leave it again. With no place yet, that is the first
   * row's WBS cell, which is also its row selector.
   */
  function markPlace(): void {
    const line = at ? lineAt(buffer.text(), at.anchor) : null;
    const current = line !== null ? ((cellFor(line, WBS)?.parentElement as HTMLTableRowElement | undefined) ?? null) : null;
    if (current !== currentRow) {
      currentRow?.classList.remove('at-cursor');
      currentRow = current;
      currentRow?.classList.add('at-cursor');
    }
    const row = at?.column === WBS ? current : null;
    if (row !== selectedRow) {
      selectedRow?.classList.remove('selected');
      selectedRow = row;
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
    else if (model) fill(td, row.node, column - DECLARED);
    td.focus();
  }

  function commit(row: Row, column: number, value: string): void {
    endEdit(row, column);
    if (row.kind === 'line') return apply(setLine(buffer.text(), row.span, value));
    const { node } = row;
    write(cellFor(row.line, column), (current) => {
      const index = column - DECLARED;
      if (column >= DECLARED && isRefColumn(current, index)) {
        const { result, touched } = setRefs(current, node, index, value);
        return withRepairs(current, result, touched);
      }
      return withRepairs(current, column === TITLE ? setTitle(current, node, value) : setField(current, node, index, value), [node]);
    });
  }

  /**
   * The input for a cell, by its column's type (spec §4b.6.5): a dropdown of
   * the declared values for an enum, a text input with a date picker beside it
   * for a date, and a plain text input otherwise. Durations are normalised on
   * commit (setField). `focus` is what takes the keyboard.
   */
  function cellEditor(column: number, value: string, typed: string | null): { element: HTMLElement; focus: HTMLInputElement | HTMLSelectElement } {
    const input = document.createElement('input');
    input.className = 'cell-input';
    const rowsColumn = model && column >= DECLARED ? columnOf(model, column - DECLARED) : undefined;
    if (rowsColumn?.kind === 'enum' && rowsColumn.enumValues) {
      const select = document.createElement('select');
      select.className = 'cell-input';
      // An empty choice clears the cell; a value that isn't declared stays choosable, so opening the dropdown loses nothing.
      const choices = ['', ...rowsColumn.enumValues];
      if (!choices.includes(value)) choices.push(value);
      for (const choice of choices) select.add(new Option(choice, choice));
      const key = typed?.toLowerCase();
      select.value = (key && rowsColumn.enumValues.find((v) => v.toLowerCase().startsWith(key))) || value;
      return { element: select, focus: select };
    }
    input.value = typed ? typed : value;
    if (rowsColumn?.kind === 'date') {
      input.placeholder = 'YYYY-MM-DD';
      // The browser's own date input shows its date fields, which don't fit a
      // cell; it stays hidden, and a calendar button opens its picker.
      const picker = document.createElement('input');
      picker.type = 'date';
      picker.className = 'date-picker';
      picker.tabIndex = -1;
      picker.setAttribute('aria-hidden', 'true');
      picker.addEventListener('change', () => {
        input.value = picker.value;
        input.focus();
      });
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'date-button';
      open.tabIndex = -1;
      open.setAttribute('aria-label', 'Pick a date');
      open.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/></svg>';
      open.addEventListener('click', () => {
        picker.value = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : '';
        try {
          picker.showPicker();
        } catch {
          // No showPicker (older browsers, jsdom) or not allowed here (a cross-origin frame).
          picker.focus();
          picker.click();
        }
      });
      const wrap = document.createElement('span');
      wrap.className = 'date-editor';
      wrap.append(input, open, picker);
      return { element: wrap, focus: input };
    }
    return { element: input, focus: input };
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
    // Spreadsheet rule: editing shows the text as written, not the computed value.
    const { element, focus: input } = cellEditor(column, raw, typed);
    td.replaceChildren(element);
    input.focus();
    if (input instanceof HTMLInputElement) {
      if (typed === null) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    }
    const keys: HTMLElement = input;
    keys.addEventListener('keydown', (event) => {
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
    keys.addEventListener('blur', (event) => {
      // Moving to the date picker beside the input is still editing.
      if (element.contains(event.relatedTarget as globalThis.Node | null)) return;
      if (editing?.line === row.line && editing.column === column) commit(row, column, input.value);
    });
  }

  // Structural operations. Spec §4b.4. On item rows they work in levels
  // (§4b.6.4); comment and blank rows have none, so theirs are src/editing's.

  function startDraft(row: Row): void {
    const indent = row.kind === 'item' && model ? insertIndent(model, row.node, row.level) : row.indent;
    draft = { anchor: row.span.from, indent };
    draftInput.value = '';
    build();
    layout.publish();
    draftInput.focus();
    updateToolbar();
  }

  /**
   * Write a new item, with the repairs of the row it goes above, and put the
   * place on its title. The anchor is in post-edit coordinates: the last
   * character the insert wrote, which is on the new line whether rows put the
   * line break before it or after it. The repairs all come after it.
   */
  function insert(td: HTMLElement | null, where: { beforeLine: number } | 'end', indent: number, title: string, above?: Row): boolean {
    let line: TextEdit | undefined;
    const edits = write(td, (current) => {
      const result = insertItem(current, where, indent, title);
      if ('refused' in result || result.edits.length === 0) return result;
      line = result.edits[0];
      return withRepairs(current, result, above?.kind === 'item' ? [above.node] : []);
    });
    if (!edits) return false;
    if (!line) return true;
    at = { anchor: line.from + line.insert.length - 1, column: TITLE };
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
      layout.publish();
      restore();
      return;
    }
    // A refused insert keeps the draft and what was typed, with the reason beside it.
    draft = null;
    const line = lineAt(buffer.text(), pending.anchor);
    if (!insert(draftInput.parentElement, { beforeLine: line }, pending.indent, title, byLine.get(line))) {
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
  /** A level-based operation on an item row; a refusal is shown by the current cell. */
  function structure(row: Row & { kind: 'item' }, make: (current: Model) => EditResult): void {
    write(cellFor(row.line, at?.column ?? WBS), make);
  }

  /**
   * Delete an item row. When other rows refer to it, ask first, with a preview: applying removes
   * the row and those references as one change, and cancelling writes nothing (spec §4b.4).
   */
  function remove(row: Row & { kind: 'item' }): void {
    const current = model;
    const plain = current && current.doc.text === buffer.text() ? deleteItem(current, row.node) : null;
    const full = current && plain ? deleteItem(current, row.node, true) : null;
    if (!current || !plain || !full || 'refused' in plain || 'refused' in full) return structure(row, (m) => deleteItem(m, row.node, true));
    const kept = new Set(plain.edits.map((e) => JSON.stringify(e)));
    const references = full.edits.filter((e) => !kept.has(JSON.stringify(e)));
    if (references.length === 0) return structure(row, () => full);
    const fix: Fix = {
      label: 'Delete row',
      tier: 'confirm',
      edits: full.edits,
      preview: preview(current.doc.text, full.edits),
      warning: deleteQuestion(current, row.node, references),
    };
    confirmBox.replaceChildren();
    // Cancel puts the focus back on the row it was opened from, as Apply does.
    problems.run(confirmBox, fix, () => {
      held = true;
      restore();
    });
  }

  /** "Delete Review? API and UI refer to it in deps; those references will be removed." By column, in column order. */
  function deleteQuestion(current: Model, node: ItemNode, references: TextEdit[]): string {
    const name = (n: ItemNode) => (n.title !== '' ? n.title : `Line ${n.line}`);
    const groups = new Map<string, string[]>();
    for (const column of current.doc.schema.columns.filter((c) => c.kind === 'ref')) {
      for (const other of [...byLine.values()]) {
        if (other.kind !== 'item' || other.node === node) continue;
        const cell = other.node.row.cells[column.index];
        if (cell?.text && references.some((e) => e.from < cell.valueTo && cell.valueFrom < e.to)) groups.set(column.name, [...(groups.get(column.name) ?? []), name(other.node)]);
      }
    }
    const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const count = [...groups.values()].reduce((n, titles) => n + titles.length, 0);
    const these = count === 1 ? 'that reference' : 'those references';
    const [only] = groups.size === 1 ? [...groups] : [];
    const who = only
      ? `${list(only[1])} ${count === 1 ? 'refers' : 'refer'} to it in ${only[0]}`
      : `${[...groups].map(([column, titles]) => `${list(titles)} in ${column}`).join(', ')} refer to it`;
    return `Delete ${name(node)}? ${who}; ${these} will be removed.`;
  }

  const actions: { id: string; label: string; run(row: Row): void; enabled(row: Row): boolean }[] = [
    { id: 'insert', label: 'Insert row', run: startDraft, enabled: () => true },
    {
      id: 'delete',
      label: 'Delete row',
      run: (row) => (row.kind === 'item' ? remove(row) : apply(deleteLines(buffer.text(), range(row)))),
      enabled: () => true,
    },
    {
      id: 'indent',
      label: 'Indent',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, shiftItem(m, row.node, row.level, 1), [row.node], false))
          : apply(indent(buffer.text(), range(row))),
      // An item row needs a previous sibling to become its child: an item row above at the same or a greater level.
      enabled: (row) => {
        if (row.kind === 'item') {
          const previous = rows.slice(0, rowIndex(row.line)).reverse().find((r) => r.kind === 'item');
          return previous?.kind === 'item' && previous.level >= row.level;
        }
        const previous = rows[rowIndex(row.line) - 1];
        return previous !== undefined && previous.indent >= row.indent;
      },
    },
    {
      id: 'outdent',
      label: 'Outdent',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, shiftItem(m, row.node, row.level, -1), [row.node], false))
          : apply(outdent(buffer.text(), range(row))),
      // The same conditions the operations use, without re-reading the document
      // on every focus move: a level or indentation to remove, a line above, a line below.
      enabled: (row) => (row.kind === 'item' ? row.level > 0 : row.indent > 0),
    },
    {
      id: 'up',
      label: 'Move up',
      run: (row) =>
        row.kind === 'item' ? structure(row, (m) => withRepairs(m, moveItem(m, row.node, 'up'), [row.node], false)) : apply(moveUp(buffer.text(), range(row))),
      // An item row swaps with its previous sibling, so there must be one; a line never goes into the front matter.
      enabled: (row) =>
        row.kind === 'item' ? model !== null && !('refused' in moveItem(model, row.node, 'up')) : row.line > 1 && model?.lines[row.line - 2]?.kind !== 'front-matter',
    },
    {
      id: 'down',
      label: 'Move down',
      run: (row) =>
        row.kind === 'item' ? structure(row, (m) => withRepairs(m, moveItem(m, row.node, 'down'), [row.node], false)) : apply(moveDown(buffer.text(), range(row))),
      enabled: (row) => (row.kind === 'item' ? model !== null && !('refused' in moveItem(model, row.node, 'down')) : row.line < (model?.lines.length ?? 0)),
    },
    {
      id: 'done',
      label: 'Toggle done',
      run: (row) => row.kind === 'item' && write(cellFor(row.line, DONE), (current) => withRepairs(current, setDone(current, row.node, !row.node.done), [row.node])),
      // A row done through an ancestor has no marker of its own to clear.
      enabled: (row) => row.kind === 'item' && canMarkDone(model!) && (!row.node.done || row.node.ownDone),
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
    if (['INPUT', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
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
        if (rawOf(row, column) === null && !boolColumn(column)) return;
        return handled(), commit(row, column, '');
      case 'Insert':
        return handled(), act('insert');
      case 'F2':
        return handled(), beginEdit(row, column, '');
      case ' ': {
        if (column === DONE) return handled(), act('done');
        // A bool cell's checkbox (spec §4b.6.5).
        const box = cellFor(row.line, column)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!box) break;
        return handled(), box.click();
      }
    }
    // Any other printable key starts an edit, replacing the cell's content.
    if (event.key.length === 1) handled(), beginEdit(row, column, event.key);
  });

  table.addEventListener('click', (event) => {
    const hit = cellAt(event);
    if (hit && !editing) place(hit.row.line, hit.column);
  });
  table.addEventListener('mouseover', (event) => {
    const tr = (event.target as HTMLElement).closest('tr');
    hover(tr && tr.parentElement === table.tBodies[0] ? lineOf(tr) : null);
  });
  table.addEventListener('mouseleave', () => hover(null));
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
    // The delete confirm is the grid's own question: the grid takes the focus back after it.
    const inside = (el: HTMLElement) => el.contains(next as unknown as globalThis.Node);
    if (next && !inside(table) && !inside(confirmBox)) held = false;
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
    const level = levels(next);
    const items = new Map<number, ItemNode>();
    const collect = (node: ItemNode): void => void (items.set(node.line, node), node.children.forEach(collect));
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
        rows.push({ kind: 'item', line: node.line, span: node.span, indent: item.indent, node: item, depth: level.get(node.line)?.shown ?? 0, level: level.get(node.line)?.indent ?? 0 });
      } else {
        const raw = text.slice(node.span.from, node.span.to);
        rows.push({ kind: 'line', line: node.line, span: node.span, indent: indentOf(raw), text: raw, blank: node.kind === 'blank' });
      }
    }
    if (block.length > 0) {
      const span = { from: block[0].span.from, to: block[block.length - 1].span.to };
      frontMatter = { line: block[0].line, span, text: text.slice(span.from, span.to).split('\n').join(' ') };
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
    // The whole cell, so a named cell's `NAME=` counts as in it.
    const i = row.node.fields.findIndex((field, k) => {
      const cell = field && model ? row.node.row.cells[columnOf(model, k).index] : null;
      return cell && within({ from: cell.from, to: cell.to }, diagnostic.span as Span);
    });
    return i >= 0 ? DECLARED + i : WBS;
  }

  return {
    update(next) {
      model = next;
      // A confirm was made against the last model's text; any change drops it.
      confirmBox.replaceChildren();
      readModel(next);
      build();
      problems.update(next, frontMatter?.span ?? null);
      restore();
      updateToolbar();
      // The problems list may have changed height too.
      fitBodyTop();
    },
    setCursorLine(line) {
      const row = byLine.get(line);
      if (row) place(row.line, nearest(row, at?.column ?? TITLE), true);
    },
    setHoverLine(line) {
      relayed = line;
      markHover();
    },
    onHoverLine(cb) {
      onHover = cb;
    },
    onRowLayout(cb) {
      // The first layout goes out at once, so the spacer is fitted first.
      fitSpacer();
      return layout.onRowLayout(cb);
    },
    scrollTo(top) {
      parent.scrollTop = top;
    },
    setMinBodyTop(px) {
      minBodyTop = px;
      fitBodyTop();
    },
    destroy() {
      off();
      resize?.disconnect();
      parent.removeEventListener('scroll', layout.publish);
      parent.replaceChildren();
    },
  };
}
