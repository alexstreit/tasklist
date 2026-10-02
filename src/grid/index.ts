// Grid editor. A task sheet over the shared buffer: every change it makes is
// a text edit like any other. Spec §4b. Over a composed buffer (spec §3.7) it
// shows every file the root mounts, in composed order, and edits each row in
// its own file with `applyFile`.

import { readFlag } from 'rows';
import type { Cell as RowsCell, Column as RowsColumn, EditResult } from 'rows';
import { formatDuration, preview } from '../core';
import type { Column, Diagnostic, FileLine, Fix, ItemNode, Model, Node, Pinnable, Span } from '../core';
import type { PlanBuffer, TextEdit } from '../buffer';
import type { PieceMap, Segment } from '../buffer/pieces';
import { deleteLines, indent, moveDown, moveUp, outdent } from '../editing';
import type { LineRange } from '../editing';
import {
  canMarkDone,
  cellColumn,
  deleteItem,
  docOf,
  fileLabel,
  hasMarker,
  insertIndent,
  insertItem,
  levels,
  moveItem,
  noColumn,
  setDone,
  setField,
  setFlag,
  setLine,
  setTitle,
  setToggle,
  shiftItem,
  unmount,
  withRepairs,
} from './edits';
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

/**
 * Where a row is: `vline` is its line in the buffer the grid shows (the composed text, or the
 * file's own text), which is how the grid finds it; `file` and `line` are its own file's and its
 * line there, which is how the model, the cursor and the other panes name it. `mount` is its
 * mount depth: 0 in the root, 1 in a file the root mounts, and so on.
 */
interface Placed {
  vline: number;
  file: string;
  line: number;
  mount: number;
}

/** An item line, or any other line shown as one editable full-width cell. */
type Row =
  // `depth` is the level the row is shown at, `level` the one rows' structure edits use (edits.ts `levels`);
  // `base` is the depth its file's roots are shown at.
  | (Placed & { kind: 'item'; span: Span; indent: number; node: ItemNode; depth: number; level: number; base: number })
  | (Placed & { kind: 'line'; span: Span; indent: number; text: string; blank: boolean; base: number });

/** A file's front matter, shown as one collapsed, read-only row on its first line. */
type FrontMatter = Placed & { kind: 'front'; span: Span; text: string; diagnostic?: Diagnostic };

/** The header above a mounted file's rows: its file, its mount row and its mount depth. It is no line. */
type Header = { kind: 'header'; file: string; mountRow: FileLine; depth: number };

/** What the grid needs of a composed buffer (spec §3.7): its piece map, and edits in a file's own offsets. */
export interface ComposedSource {
  pieces(): PieceMap;
  applyFile(file: string, edits: readonly TextEdit[], origin: string): void;
}

export interface GridHooks {
  /** `fromApi` is true when the move came from setCursorLine rather than the user. */
  onCursorLine(at: FileLine, fromApi: boolean): void;
  /** Make a mounted file the active file: its mount row's file badge (Open). */
  onOpenFile?(path: string): void;
  /** Say something on the status line: a deleted mounted task names its file. */
  status?(message: string): void;
}

/** The grid leads (spec §3.4): its rows are its table's body rows. */
export interface GridEditor extends Leader {
  /** Also republishes the row layout. */
  update(model: Model): void;
  /** The files with unsaved changes: the mounted files' headers mark them. */
  showUnsaved(files: ReadonlySet<string>): void;
  setCursorLine(at: FileLine): void;
  /** Band the row on `line`, hovered in the other pane; null clears it. */
  setHoverLine(at: FileLine | null): void;
  /** The line of the row under the pointer; null off the rows, or on one with no line. Replaces any earlier callback. */
  onHoverLine(cb: (at: FileLine | null) => void): void;
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
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) line++;
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

const keyOf = (file: string, line: number): string => `${file}\n${line}`;
const sameLine = (a: FileLine | null, b: FileLine | null): boolean => a === b || (!!a && !!b && a.file === b.file && a.line === b.line);

/**
 * `buffer` is the buffer the grid shows. A composed buffer (spec §3.7) also gives its piece map,
 * and the grid shows every file in it and writes each with `applyFile`; any other buffer is the
 * root file's own text.
 */
export function mountGrid(buffer: PlanBuffer & Partial<ComposedSource>, parent: HTMLElement, hooks: GridHooks): GridEditor {
  const bar = document.createElement('div');
  bar.className = 'sheet-toolbar';
  // The settings banner and the problems list, with their fixes (spec §4b.6.3, §4b.6.6).
  const problems = mountProblems({
    write: (host, file, make) => write(host, file, make) !== null,
    titleOf: (line) => {
      const row = byFile.get(keyOf(root(), line));
      return row?.kind === 'item' && row.node.title !== '' ? row.node.title : null;
    },
    // Focuses the row, in its own file, or the cell the diagnostic's span falls in.
    focus: (diagnostic) => {
      const row = byFile.get(keyOf(diagnostic.file ?? root(), diagnostic.line));
      if (row && row.kind !== 'front') place(row.vline, diagnostic.span ? columnFor(row, diagnostic) : WBS);
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
  // The rows the place can be on, in the order shown; with each file's front matter, every body row.
  let rows: Row[] = [];
  let shown: (Row | FrontMatter | Header)[] = [];
  // The files with unsaved changes, for the headers' markers (the shell says, as for the text editor).
  let unsaved: ReadonlySet<string> = new Set();
  // Rows by vline, and rows and front matter by their own file and line.
  const byLine = new Map<number, Row>();
  const byFile = new Map<string, Row | FrontMatter>();
  // Each body row's element by vline, as last built, and back.
  const trs = new Map<number, HTMLTableRowElement>();
  const vlineOf = new WeakMap<HTMLTableRowElement, number>();
  // The root file's front matter, shown collapsed and read-only above the rows.
  let frontMatter: FrontMatter | null = null;
  // Diagnostics by `vline:column`; spec §4b.2.
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
  let hovered: FileLine | null = null;
  let onHover: ((at: FileLine | null) => void) | null = null;
  let relayed: FileLine | null = null;
  // A row being typed into that is not in the buffer yet: the insert-above
  // row and the new-task row. Nothing is written until a title is committed.
  // `base` is the depth its file's roots are shown at.
  let draft: { anchor: number; indent: number; base: number } | null = null;

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
      kept = [];
      return;
    }
    if (at) at = { anchor: change.mapPos(at.anchor), column: at.column };
    for (const k of kept) k.pos = change.mapPos(k.pos);
    if (draft) draft = { ...draft, anchor: change.mapPos(draft.anchor) };
  });

  function cellFor(vline: number, column: number): HTMLTableCellElement | null {
    const row = trs.get(vline);
    return row?.querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`) ?? null;
  }

  /** A file's current text: its pieces of the composed text, or the buffer's own. */
  function textOf(file: string): string {
    const map = buffer.pieces?.();
    if (!map) return buffer.text();
    const text = buffer.text();
    return map.runs
      .filter((r) => !r.joint && r.file === file)
      .map((r) => text.slice(r.at, r.at + r.to - r.from))
      .join('');
  }

  /** A position in a file's own text, in the buffer the grid shows. */
  function shownPos(file: string, offset: number): number {
    return buffer.pieces ? buffer.pieces().toComposed(file, offset) : offset;
  }

  /**
   * Focusing a cell blurs whatever held the focus, and a blur handler may
   * commit an edit and rebuild the table underneath us. Then the cell we were
   * focusing is detached and the focus lands nowhere, so resolve it again.
   */
  function focusCell(vline: number, column: number): void {
    const td = cellFor(vline, column);
    td?.focus();
    if (td && !td.isConnected) cellFor(vline, column)?.focus();
  }

  /** The row the toolbar and the structural keys act on. */
  function target(): Row | null {
    return at ? (byLine.get(lineAt(buffer.text(), at.anchor)) ?? null) : null;
  }

  function range(row: Row): LineRange {
    return { fromLine: row.line, toLine: row.line };
  }

  /** Edits in `file`'s own offsets. */
  function apply(file: string, edits: readonly TextEdit[]): void {
    if (edits.length === 0) return;
    if (buffer.applyFile) buffer.applyFile(file, edits, 'grid');
    else buffer.apply(edits, 'grid');
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
   * Make a rows edit to `file` against the document the model read it from, and
   * return the edits applied; or show why it can't be made, leave the cell as
   * it was, and return null. The model trails the buffer by the shell's
   * debounce, and edits against an older text would land in the wrong place.
   */
  function write(td: HTMLElement | null, file: string, make: (current: Model) => EditResult): TextEdit[] | null {
    const read = model?.files.get(file)?.doc ?? (model?.file === file ? model.doc : undefined);
    const result: EditResult =
      model && read && read.text === textOf(file) ? make(model) : { refused: 'the grid is still reading the last change; try again' };
    if ('refused' in result) {
      notice(td, plainRefusal(result.refused));
      return null;
    }
    apply(file, result.edits);
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

  /** Why a declared cell can't be typed into: its file has no column for it (spec §4b.2); null when it can. */
  function unmapped(row: Row, column: number): string | null {
    if (row.kind !== 'item' || column < DECLARED || !model?.columns[column - DECLARED]) return null;
    return cellColumn(model, row.node, column - DECLARED) ? null : plainRefusal(noColumn(model, row.node, column - DECLARED).refused);
  }

  /** The text a cell edits, or null when the cell is not text-editable. */
  function rawOf(row: Row, column: number): string | null {
    if (row.kind === 'line') return column === TITLE ? row.text : null;
    if (column === TITLE) return row.node.title;
    const index = column - DECLARED;
    if (!model?.columns[index] || unmapped(row, column)) return null;
    // Editing a ref cell shows its outline numbers, as it is shown: the one exception to the raw text (§4b.2).
    if (isRefColumn(model, row.node, index)) return refText(model, row.node, index);
    const text = model.field(row.node, index)?.text ?? '';
    const cell = rollupOf(row.node, index);
    // A bool the checkbox shows is toggled, not typed; any other text is edited as text.
    if (!cell) return boolColumn(row.node, column) && isFlag(text) ? null : text;
    // An additive value rolls its children in; editing it in place would be a lie.
    return cell.mode === 'additive' ? null : text;
  }

  /** The roll-up of a summable cell; undefined for any other. */
  function rollupOf(node: ItemNode, index: number): Pinnable<number> | undefined {
    return model!.get(node, rollup)?.get(model!.columns[index].name);
  }

  /** The rows column behind a node's grid column, in its own file, when it is bool, whose cells show a checkbox; null otherwise. */
  function boolColumn(node: ItemNode, column: number): RowsColumn | null {
    if (!model || column < DECLARED) return null;
    const rowsColumn = cellColumn(model, node, column - DECLARED);
    return rowsColumn?.kind === 'bool' ? rowsColumn : null;
  }

  const isFlag = (text: string) => text === '' || text === 'true' || text === 'false';

  // Rows are described before they are drawn (spec §4b.1): each cell as a CellSpec, which says
  // everything the cell shows. A rebuild keeps each row's element, found by its file and line (the
  // line followed through every edit since the last build), and redraws only the cells whose spec
  // changed, so a commit or an insert touches a few cells, not the whole portfolio. Checkboxes and
  // badges are handled on the table (below), so a kept cell never acts on an older model's node.

  /** What a cell shows, in order. */
  type Part =
    | { kind: 'text'; text: string }
    | { kind: 'muted'; text: string }
    | { kind: 'check'; checked: boolean; disabled: boolean; label?: string }
    // The WBS cell's extra values (spec §4b.6.6), and a mount row's file badge.
    | { kind: 'extra'; text: string }
    | { kind: 'file'; path: string }
    // A mounted file's header: its name, its unsaved marker, and its buttons.
    | { kind: 'path'; text: string }
    | { kind: 'unsaved' }
    | { kind: 'action'; action: 'open' | 'unmount'; label: string; title: string; disabled: boolean };

  /** A cell: `column` is its data-column, absent for a front matter row's cells, which take no place. */
  interface CellSpec {
    column?: number;
    className: string;
    title?: string;
    why?: string;
    colSpan?: number;
    padding?: string;
    parts: Part[];
  }

  /** A body row: `line` is null for a header, which is no line. */
  interface RowSpec {
    className: string;
    file: string;
    line: number | null;
    cells: CellSpec[];
  }

  /** A cell with its diagnostic, if one marks it (spec §4b.2). */
  function cellSpec(vline: number, column: number, className: string, parts: Part[] = [], extra: Partial<CellSpec> = {}): CellSpec {
    const diagnostic = marks.get(`${vline}:${column}`);
    return {
      column,
      className: diagnostic ? [className, diagnostic.severity].filter(Boolean).join(' ') : className,
      ...(diagnostic ? { title: diagnostic.message } : {}),
      ...extra,
      parts,
    };
  }

  /** A declared cell: a ref cell's outline numbers, a bool's checkbox, text, or a roll-up. */
  function declaredSpec(vline: number, node: ItemNode, index: number): CellSpec {
    const columnAt = DECLARED + index;
    const column = model!.columns[index];
    const text = model!.field(node, index)?.text ?? '';
    const cell = rollupOf(node, index);
    if (!cell) {
      if (isRefColumn(model!, node, index)) return cellSpec(vline, columnAt, '', [{ kind: 'text', text: refText(model!, node, index) }]);
      const bool = boolColumn(node, columnAt);
      // A bool is a checkbox (spec §4b.6.5), unless its text is no bool; then it shows as written.
      if (bool && isFlag(text)) {
        const checked = readFlag(docOf(model!, node), node.row, bool) === true;
        const spec = cellSpec(vline, columnAt, '', [{ kind: 'check', checked, disabled: false }]);
        return { ...spec, className: [spec.className, 'check'].filter(Boolean).join(' ') };
      }
      return cellSpec(vline, columnAt, '', [{ kind: 'text', text }]);
    }
    const classes: string[] = [];
    const parts: Part[] = [];
    let title: string | undefined;
    if (cell.mode === 'additive') {
      classes.push('additive');
      title = `additive value "${text}" — edit it in the text editor`;
      parts.push({ kind: 'muted', text: '+' });
    }
    // An unestimated subtree shows nothing rather than "0h".
    if (model!.get(node, hasValue)?.get(column.name)) {
      parts.push({ kind: 'text', text: format(column, cell.effective) });
      if (cell.mode === 'derived') classes.push('derived');
      // Derived cells render bare: effective already is the child sum.
      else if (cell.derived !== undefined) parts.push({ kind: 'muted', text: `⟨Σ ${format(column, cell.derived)}⟩` });
    }
    const spec = cellSpec(vline, columnAt, '', parts);
    return { ...spec, className: [spec.className, ...classes].filter(Boolean).join(' '), ...(title !== undefined ? { title } : {}) };
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
      const column = model ? docOf(model, node).schema.columns.find((x) => x.name === c.name?.text && x.index > 0) : undefined;
      const first = column ? row.cells[column.index] : null;
      parts.push(`${c.name!.text}: ${first?.text ?? ''} / ${c.text ?? ''}`);
    }
    return parts.join(' · ');
  }

  /** A title cell's parts: the title, and on a mount row the file badge, whose menu opens or unmounts its file (spec §4b.4). */
  function titleParts(node: ItemNode): Part[] {
    return [{ kind: 'text', text: node.title }, ...(node.mount !== undefined ? [{ kind: 'file' as const, path: node.mount }] : [])];
  }

  function itemSpec(row: Row & { kind: 'item' }): RowSpec {
    const { node, vline } = row;
    const mounted = node.file !== root();
    const cells: CellSpec[] = [];

    const wbs = cellSpec(vline, WBS, 'wbs');
    // The ID, so a grid user can name the task to a text user (spec §4b.1).
    const title = node.row.anchors.length > 0 ? [`#${node.row.anchors[0].id}`, wbs.title].filter(Boolean).join('\n') : wbs.title;
    const extra = extraValues(node);
    // The values rows kept as overflow, or a column's two values (spec §4b.6.6).
    cells.push({ ...wbs, ...(title ? { title } : {}), parts: [...(extra ? [{ kind: 'extra' as const, text: extra }] : []), { kind: 'text', text: node.outlineNumber }] });

    // Done through an ancestor: shown, but only the ancestor's marker can clear it.
    const markable = canMarkDone(model!, node.file);
    const done = cellSpec(vline, DONE, 'check', [{ kind: 'check', checked: node.done, disabled: !markable || (node.done && !node.ownDone) }]);
    // A mounted file without the marker says so (spec §4b.5).
    const noDone = mounted && !markable ? plainRefusal(`file ${fileLabel(model!, node.file)} has no marker done`) : null;
    cells.push(noDone ? { ...done, title: noDone, why: noDone } : done);

    toggles().forEach((marker, i) => {
      // The marker is the row's file's, by name; a file that doesn't declare it can't take it (spec §4b.5).
      const own = docOf(model!, node).schema.markers.find((m) => m.name === marker.name);
      const checked = own ? readFlag(docOf(model!, node), node.row, own.column) === true : false;
      const spec = cellSpec(vline, MARKER - i, 'check', [{ kind: 'check', checked, disabled: !own, label: marker.name }]);
      const reason = own ? null : plainRefusal(`file ${fileLabel(model!, node.file)} has no marker ${marker.name}`);
      cells.push(reason ? { ...spec, title: reason, why: reason } : spec);
    });

    cells.push(cellSpec(vline, TITLE, 'title', titleParts(node), { padding: `${0.5 + row.depth * 1.25}em` }));
    model!.columns.forEach((_, i) => cells.push(declaredSpec(vline, node, i)));
    return { className: rowClass(row, node.done ? 'item done' : 'item'), file: row.file, line: row.line, cells };
  }

  /** A comment or blank line: one full-width cell holding the raw text. */
  function lineSpec(row: Row & { kind: 'line' }): RowSpec {
    const cells = [cellSpec(row.vline, WBS, 'wbs'), cellSpec(row.vline, TITLE, 'raw', [{ kind: 'text', text: row.text }], { colSpan: leading() + model!.columns.length })];
    return { className: rowClass(row, row.blank ? 'line blank' : 'line'), file: row.file, line: row.line, cells };
  }

  /** A file's front matter: one collapsed, read-only row. */
  function frontSpec(block: FrontMatter): RowSpec {
    const d = block.diagnostic;
    const raw: CellSpec = {
      className: d ? `raw ${d.severity}` : 'raw',
      ...(d ? { title: d.message } : {}),
      colSpan: leading() + model!.columns.length,
      parts: [{ kind: 'text', text: block.text }],
    };
    return { className: rowClass(block, 'front-matter'), file: block.file, line: block.line, cells: [{ className: '', parts: [] }, raw] };
  }

  /**
   * A mounted file's header, above its rows (spec §4b.7): its name, as messages name it, its
   * unsaved marker, Open and Unmount. It spans every column, and nothing in it takes the place.
   */
  function headerSpec(header: Header): RowSpec {
    const parts: Part[] = [{ kind: 'path', text: fileLabel(model!, header.file) }];
    if (unsaved.has(header.file)) parts.push({ kind: 'unsaved' });
    parts.push(
      { kind: 'action', action: 'open', label: 'Open', title: `Open ${header.file}`, disabled: !hooks.onOpenFile },
      { kind: 'action', action: 'unmount', label: 'Unmount', title: `Stop showing ${header.file} here; the file stays as it is`, disabled: false },
    );
    const cell: CellSpec = { className: 'segment', colSpan: leading() + 1 + model!.columns.length, parts };
    return { className: `segment-header segment-depth-${header.depth}`, file: header.file, line: null, cells: [cell] };
  }

  /** A row's classes: its kind's, and its shading when it is a mounted file's (spec §4b.1). */
  function rowClass(row: Placed, kind: string): string {
    return row.mount > 0 ? `${kind} mounted segment-depth-${row.mount}` : kind;
  }

  function partElement(part: Part): globalThis.Node {
    switch (part.kind) {
      case 'text':
        return document.createTextNode(part.text);
      case 'muted':
        return muted(part.text);
      case 'check': {
        // The cell is the focusable thing (Space toggles it); a tabbable checkbox
        // would make Tab walk the checkbox column instead of the grid.
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.tabIndex = -1;
        box.checked = part.checked;
        box.disabled = part.disabled;
        if (part.label) box.setAttribute('aria-label', part.label);
        return box;
      }
      case 'extra': {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = part.text;
        badge.title = part.text;
        return badge;
      }
      case 'file': {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'file-badge';
        badge.tabIndex = -1;
        badge.textContent = part.path.split('/').pop()!;
        badge.title = `Open ${part.path}`;
        badge.disabled = !hooks.onOpenFile;
        return badge;
      }
      case 'path': {
        const path = document.createElement('span');
        path.className = 'segment-path';
        path.textContent = part.text;
        return path;
      }
      case 'unsaved': {
        const marker = document.createElement('span');
        marker.className = 'segment-unsaved';
        marker.textContent = '●';
        marker.title = 'Unsaved changes';
        return marker;
      }
      case 'action': {
        // The header isn't in the tab order; its buttons are for the pointer, and the toolbar has Unmount.
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment-action';
        button.dataset.action = part.action;
        button.tabIndex = -1;
        button.textContent = part.label;
        button.title = part.title;
        button.disabled = part.disabled;
        return button;
      }
    }
  }

  /** Each drawn cell's spec, as a key: a cell whose key is unchanged is left as it is. */
  const drawn = new WeakMap<HTMLTableCellElement, string>();

  /** Draw a cell from its spec, unless it already shows it; `force` draws it anyway (after an editor was in it). */
  function drawCell(td: HTMLTableCellElement, spec: CellSpec, force = false): void {
    const key = JSON.stringify(spec);
    if (!force && drawn.get(td) === key) return;
    drawn.set(td, key);
    td.className = spec.className;
    if (!spec.className) td.removeAttribute('class');
    if (spec.column !== undefined) td.dataset.column = String(spec.column);
    if (spec.title !== undefined) td.title = spec.title;
    else td.removeAttribute('title');
    if (spec.why !== undefined) td.dataset.why = spec.why;
    else delete td.dataset.why;
    if (spec.colSpan !== undefined) td.colSpan = spec.colSpan;
    else td.removeAttribute('colspan');
    if (spec.padding !== undefined) td.style.paddingLeft = spec.padding;
    else td.removeAttribute('style');
    td.replaceChildren(...spec.parts.map(partElement));
  }

  /** A new cell for a spec: one with a column takes part in the place, so it is focusable. */
  function newCell(spec: CellSpec): HTMLTableCellElement {
    const td = document.createElement('td');
    if (spec.column !== undefined) td.tabIndex = -1;
    return td;
  }

  /** The classes the place and hover put on a row, which a redraw keeps. */
  const STATE = ['at-cursor', 'selected', 'hover'];

  /**
   * What each kept row was last drawn with, so an unchanged row is checked without reading the
   * DOM back (slow in jsdom): its classes, file and line, its cells, and their columns.
   */
  const drawnRows = new WeakMap<HTMLTableRowElement, { className: string; file: string | null; line: number | null | undefined; shape: string; cells: HTMLTableCellElement[] }>();

  /** Draw a row from its spec into `tr`, a kept row or a new one: only what changed is touched. */
  function drawRow(tr: HTMLTableRowElement, spec: RowSpec): void {
    const shape = spec.cells.map((c) => c.column ?? '').join(',');
    let was = drawnRows.get(tr);
    // A row whose cells no longer line up (another kind of row now, or other columns) is drawn afresh.
    if (!was || was.shape !== shape) {
      const cells = spec.cells.map(newCell);
      tr.replaceChildren(...cells);
      was = { className: '', file: null, line: undefined, shape, cells };
      drawnRows.set(tr, was);
    }
    if (was.className !== spec.className) {
      tr.className = [spec.className, ...STATE.filter((c) => tr.classList.contains(c))].join(' ');
      was.className = spec.className;
    }
    if (was.file !== spec.file) tr.dataset.file = was.file = spec.file;
    if (was.line !== spec.line) {
      if (spec.line === null) delete tr.dataset.line;
      else tr.dataset.line = String(spec.line);
      was.line = spec.line;
    }
    const { cells } = was;
    spec.cells.forEach((c, i) => drawCell(cells[i], c));
  }

  /** The spec a grid cell is drawn from now: an editor's cell is drawn back from it. */
  function specOf(row: Row, column: number): CellSpec | undefined {
    return (row.kind === 'item' ? itemSpec(row) : lineSpec(row)).cells.find((c) => c.column === column);
  }

  // Body rows are kept here, in order, rather than walked through tBodies[0].rows: in jsdom each
  // read of that live collection scans it, so walking a portfolio's thousands of rows was quadratic.
  let bodyRows: HTMLTableRowElement[] = [];
  // The rows drawn last, each by the end of its line in the shown text, followed through every
  // change since: the next build finds a row's element there, so an insert above it keeps it.
  let kept: { pos: number; tr: HTMLTableRowElement }[] = [];
  // Each mounted file's header row, by its file, and back.
  let keptHeaders = new Map<string, HTMLTableRowElement>();
  const headerOf = new WeakMap<HTMLTableRowElement, Header>();

  /** A plain row: the draft and new-task rows, drawn afresh each time. */
  function plainRow(className: string, columns: Column[], title?: (td: HTMLTableCellElement) => void): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.className = className;
    const cell = () => tr.appendChild(document.createElement('td'));
    for (let i = 0; i < leading(); i++) cell();
    title?.(cell());
    columns.forEach(cell);
    return tr;
  }

  /** The placeholder row for a title that has not been written to the buffer yet. */
  function draftRow(columns: Column[]): HTMLTableRowElement {
    return plainRow('draft', columns, (title) => {
      title.style.paddingLeft = `${0.5 + (draft ? draft.base + draft.indent / 4 : 0) * 1.25}em`;
      title.append(draftInput);
    });
  }

  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const tfoot = document.createElement('tfoot');

  function build(): void {
    if (!model) return;
    const columns = model.columns;
    const text = buffer.text();
    const draftLine = draft ? lineAt(text, draft.anchor) : null;
    note.remove();
    if (!table.tBodies[0]) table.append(thead, tbody, tfoot);
    const head = document.createElement('tr');
    for (const name of ['#', '', ...toggles().map((m) => m.char), 'Task', ...columns.map((c) => c.name)]) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    thead.replaceChildren(head);

    // Where each line of the shown text ends, to find the row kept for it.
    const ends: number[] = [];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) ends.push(i);
    ends.push(text.length);
    const old = new Map<number, HTMLTableRowElement>();
    for (const { pos, tr } of kept) if (!old.has(pos)) old.set(pos, tr);

    const wanted: HTMLTableRowElement[] = [];
    const next: typeof kept = [];
    const nextHeaders = new Map<string, HTMLTableRowElement>();
    trs.clear();
    let drafted = false;
    for (const row of shown) {
      if (row.kind === 'header') {
        // Kept by its file, which is shown once.
        const tr = keptHeaders.get(row.file) ?? document.createElement('tr');
        drawRow(tr, headerSpec(row));
        headerOf.set(tr, row);
        nextHeaders.set(row.file, tr);
        wanted.push(tr);
        continue;
      }
      if (row.kind !== 'front' && row.vline === draftLine) wanted.push(draftRow(columns)), (drafted = true);
      const pos = ends[row.vline - 1] ?? text.length;
      const tr = old.get(pos) ?? document.createElement('tr');
      old.delete(pos);
      drawRow(tr, row.kind === 'front' ? frontSpec(row) : row.kind === 'item' ? itemSpec(row) : lineSpec(row));
      wanted.push(tr);
      next.push({ pos, tr });
      if (row.kind === 'front') continue;
      trs.set(row.vline, tr);
      vlineOf.set(tr, row.vline);
    }
    kept = next;
    keptHeaders = nextHeaders;
    // The line the draft was anchored to is no longer a row (an undo, say).
    // Keep the draft on screen rather than dropping what was typed.
    if (draftLine !== null && !drafted) wanted.push(draftRow(columns));
    // The last body row; the total row below it stays at the bottom of the pane (spec §4b.1).
    wanted.push(plainRow('new-task', columns, (td) => td.append(newTask)));

    // Into the body in this order: rows that went are removed first, so the rest mostly stay put.
    const keep = new Set(wanted);
    for (const tr of bodyRows) if (!keep.has(tr)) tr.remove();
    let cursor = tbody.firstChild;
    for (const tr of wanted) {
      if (cursor === tr) cursor = cursor.nextSibling;
      else tbody.insertBefore(tr, cursor);
    }
    bodyRows = wanted;

    const total = document.createElement('tr');
    total.className = 'total';
    const cell = () => total.appendChild(document.createElement('td'));
    for (let i = 0; i < leading(); i++) cell();
    cell().textContent = 'Total';
    columns.forEach((column) => {
      const td = cell();
      const sum = model?.value(totals)?.get(column.name);
      if (!sum) return;
      td.append(format(column, sum.effective), muted(`done ${format(column, sum.doneSum)}`));
    });
    tfoot.replaceChildren(total);
    markPlace();
    markHover();
  }

  /** The root file's path. */
  function root(): string {
    return model?.file ?? '';
  }

  /** The file and line a body row is on: the front matter's first line, or its own; null for the draft and new-task rows. */
  function lineOf(tr: HTMLTableRowElement): FileLine | null {
    return tr.dataset.line === undefined ? null : { file: tr.dataset.file!, line: Number(tr.dataset.line) };
  }

  /** The file and line of a row the grid shows, by vline. */
  function placeOf(vline: number): FileLine {
    const row = byLine.get(vline);
    return row ? { file: row.file, line: row.line } : { file: root(), line: vline };
  }

  /** Band the row hovered in the other pane. */
  function markHover(): void {
    for (const tr of bodyRows) tr.classList.toggle('hover', relayed !== null && sameLine(lineOf(tr), relayed));
  }

  function hover(at: FileLine | null): void {
    if (sameLine(at, hovered)) return;
    hovered = at;
    onHover?.(at);
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
    for (const tr of bodyRows) {
      const rect = tr.getBoundingClientRect();
      // Off screen: above the pane's top, or below its bottom.
      if (rect.bottom <= paneTop || rect.top >= paneTop + parent.clientHeight) continue;
      rows.push({ at: lineOf(tr), top: rect.top - paneTop + scrollTop - bodyTop, height: rect.height });
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

    const stop = line === null ? cellFor(rows[0]?.vline ?? 0, WBS) : cellFor(line, at?.column ?? WBS);
    if (stop === tabStop) return;
    if (tabStop?.isConnected) tabStop.tabIndex = -1;
    tabStop = stop;
    if (stop) stop.tabIndex = 0;
  }

  /**
   * Put the place on a cell. The anchor comes from the buffer as it stands,
   * not from the model, which may predate the edit that led here.
   */
  function place(vline: number, column: number, fromApi = false): void {
    at = { anchor: lineEndOf(buffer.text(), vline), column };
    held = true;
    markPlace();
    focusCell(vline, column);
    updateToolbar();
    hooks.onCursorLine(placeOf(vline), fromApi);
  }

  function clearPlace(): void {
    at = null;
    held = false;
    markPlace();
    updateToolbar();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function rowIndex(vline: number): number {
    return rows.findIndex((row) => row.vline === vline);
  }

  function lastColumn(row: Row): number {
    const columns = columnsOf(row);
    return columns[columns.length - 1];
  }

  /** Move the place `delta` rows, or to the new-task row when it runs off the end. */
  function step(vline: number, delta: number, column: number): void {
    const next = rows[rowIndex(vline) + delta];
    if (next) place(next.vline, nearest(next, column));
    else if (delta > 0) newTask.focus();
  }

  /** The next or previous editable cell, wrapping across rows. */
  function tab(row: Row, column: number, back: boolean): void {
    const columns = columnsOf(row).filter((c) => c !== WBS);
    const i = columns.indexOf(column);
    const next = columns[i + (back ? -1 : 1)];
    if (next !== undefined) {
      place(row.vline, next);
      return;
    }
    const sibling = rows[rowIndex(row.vline) + (back ? -1 : 1)];
    if (sibling) place(sibling.vline, back ? lastColumn(sibling) : columnsOf(sibling)[1]);
    else if (!back) newTask.focus();
  }

  function endEdit(row: Row, column: number): void {
    editing = null;
    const td = cellFor(row.vline, column);
    if (!td) return;
    // Shows the model as it stands; the rebuild after the edit corrects it.
    const spec = model ? specOf(row, column) : undefined;
    if (spec) drawCell(td, spec, true);
    td.focus();
  }

  function commit(row: Row, column: number, value: string): void {
    endEdit(row, column);
    if (row.kind === 'line') return apply(row.file, setLine(textOf(row.file), row.span, value));
    const { node } = row;
    write(cellFor(row.vline, column), row.file, (current) => {
      const index = column - DECLARED;
      if (column >= DECLARED && isRefColumn(current, node, index)) {
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
  function cellEditor(row: Row, column: number, value: string, typed: string | null): { element: HTMLElement; focus: HTMLInputElement | HTMLSelectElement } {
    const input = document.createElement('input');
    input.className = 'cell-input';
    // The row's own file's column: a mounted file's may differ from the root's.
    const rowsColumn = model && row.kind === 'item' && column >= DECLARED ? cellColumn(model, row.node, column - DECLARED) : undefined;
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
    if (raw === null) {
      // A cell its file has no column for can't be typed into; say why.
      const refusal = unmapped(row, column);
      if (refusal) place(row.vline, column), notice(cellFor(row.vline, column), refusal);
      return;
    }
    place(row.vline, column);
    const td = cellFor(row.vline, column);
    if (!td) return;
    editing = { line: row.vline, column };
    // Spreadsheet rule: editing shows the text as written, not the computed value.
    const { element, focus: input } = cellEditor(row, column, raw, typed);
    // The cell no longer shows its spec: the next build draws it again.
    drawn.delete(td);
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
        step(row.vline, 1, column);
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
      if (editing?.line === row.vline && editing.column === column) commit(row, column, input.value);
    });
  }

  // Structural operations. Spec §4b.4. On item rows they work in levels
  // (§4b.6.4); comment and blank rows have none, so theirs are src/editing's.

  function startDraft(row: Row): void {
    const indent = row.kind === 'item' && model ? insertIndent(model, row.node, row.level) : row.indent;
    draft = { anchor: shownPos(row.file, row.span.from), indent, base: row.base };
    draftInput.value = '';
    // Only the draft row comes in, above the row: nothing else changed, so nothing else is drawn.
    const above = trs.get(row.vline);
    if (above && model) {
      const tr = draftRow(model.columns);
      above.before(tr);
      bodyRows.splice(bodyRows.indexOf(above), 0, tr);
    } else build();
    layout.publish();
    draftInput.focus();
    updateToolbar();
  }

  /**
   * Write a new item, with the repairs of the row it goes above, and put the
   * place on its title. The anchor is in post-edit coordinates: the last
   * character the insert wrote, which is on the new line whether rows put the
   * line break before it or after it. The repairs all come after it. The
   * item goes in `file`, the file of the row it goes above.
   */
  function insert(td: HTMLElement | null, file: string, where: { beforeLine: number } | 'end', indent: number, title: string, above?: Row): boolean {
    let line: TextEdit | undefined;
    const edits = write(td, file, (current) => {
      const result = insertItem(current, where, indent, title, file);
      if ('refused' in result || result.edits.length === 0) return result;
      line = result.edits[0];
      return withRepairs(current, result, above?.kind === 'item' ? [above.node] : []);
    });
    if (!edits) return false;
    if (!line) return true;
    at = { anchor: shownPos(file, line.from + line.insert.length - 1), column: TITLE };
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
    // The file and line the draft goes above: the piece its anchor is in.
    const where = buffer.pieces ? buffer.pieces().toFile(pending.anchor) : { file: root(), offset: pending.anchor };
    const line = lineAt(textOf(where.file), where.offset);
    const above = byFile.get(keyOf(where.file, line));
    if (!insert(draftInput.parentElement, where.file, { beforeLine: line }, pending.indent, title, above?.kind === 'front' ? undefined : above)) {
      draft = pending;
      return;
    }
    draftInput.value = '';
  }

  function addTask(): void {
    const value = newTask.value;
    // Cleared first: the focus move after the insert blurs this input, which adds a task again.
    newTask.value = '';
    // At the end of the root file, at the indent of its last item line, not of a trailing comment or blank (§4b.1).
    const last = [...rows].reverse().find((row) => row.kind === 'item' && row.file === root());
    // A refused insert keeps what was typed, with the reason beside it.
    if (!insert(newTask.parentElement, root(), 'end', last?.indent ?? 0, value)) newTask.value = value;
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
    const row = byLine.get(line) ?? [...rows].reverse().find((r) => r.vline <= line) ?? rows[0];
    if (!row) return;
    at = { anchor: lineEndOf(buffer.text(), row.vline), column: nearest(row, at.column) };
    markPlace();
    if (held) focusCell(row.vline, at.column);
    updateToolbar();
  }

  /** A level-based operation on an item row, in its own file; a refusal is shown by the current cell. True when it was made. */
  function structure(row: Row & { kind: 'item' }, make: (current: Model) => EditResult): boolean {
    return write(cellFor(row.vline, at?.column ?? WBS), row.file, make) !== null;
  }

  /**
   * Delete an item row. When other rows refer to it, or it is a mount row, ask first, with a preview:
   * applying removes the row and those references as one change, and cancelling writes nothing
   * (spec §4b.4). A mounted task's delete names its file on the status line.
   */
  function remove(row: Row & { kind: 'item' }): void {
    const current = model;
    const plain = current && docOf(current, row.node).text === textOf(row.file) ? deleteItem(current, row.node) : null;
    const full = current && plain ? deleteItem(current, row.node, true) : null;
    const deleted = () => {
      if (current && row.file !== current.file) hooks.status?.(`Deleted ${nameOf(row.node)} from ${fileLabel(current, row.file)}.`);
    };
    if (!current || !plain || !full || 'refused' in plain || 'refused' in full) {
      if (structure(row, (m) => deleteItem(m, row.node, true))) deleted();
      return;
    }
    const kept = new Set(plain.edits.map((e) => JSON.stringify(e)));
    const references = full.edits.filter((e) => !kept.has(JSON.stringify(e)));
    if (references.length === 0 && !row.node.row.mount) {
      if (structure(row, () => full)) deleted();
      return;
    }
    const fix: Fix = {
      label: 'Delete row',
      tier: 'confirm',
      edits: full.edits,
      preview: preview(docOf(current, row.node).text, full.edits),
      warning: deleteQuestion(current, row.node, references),
    };
    confirmBox.replaceChildren();
    // Cancel puts the focus back on the row it was opened from, as Apply does.
    problems.run(confirmBox, fix, row.file, {
      onCancel: () => {
        held = true;
        restore();
      },
      onApply: deleted,
    });
  }

  const nameOf = (n: ItemNode) => (n.title !== '' ? n.title : `Line ${n.line}`);

  /**
   * "Delete Review? API and UI refer to it in deps; those references will be removed." By column, in
   * column order, among the rows of its own file. A mounted row names its file ("Delete API from
   * alpha.plan?"), and a mount row says its file stays as it is.
   */
  function deleteQuestion(current: Model, node: ItemNode, references: TextEdit[]): string {
    const groups = new Map<string, string[]>();
    for (const column of docOf(current, node).schema.columns.filter((c) => c.kind === 'ref')) {
      for (const other of [...byLine.values()]) {
        if (other.kind !== 'item' || other.node === node || other.file !== node.file) continue;
        const cell = other.node.row.cells[column.index];
        if (cell?.text && references.some((e) => e.from < cell.valueTo && cell.valueFrom < e.to)) groups.set(column.name, [...(groups.get(column.name) ?? []), nameOf(other.node)]);
      }
    }
    const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const count = [...groups.values()].reduce((n, titles) => n + titles.length, 0);
    const these = count === 1 ? 'that reference' : 'those references';
    const [only] = groups.size === 1 ? [...groups] : [];
    const who = only
      ? `${list(only[1])} ${count === 1 ? 'refers' : 'refer'} to it in ${only[0]}`
      : `${[...groups].map(([column, titles]) => `${list(titles)} in ${column}`).join(', ')} refer to it`;
    const from = node.file !== current.file ? ` from ${fileLabel(current, node.file)}` : '';
    const parts = [`Delete ${nameOf(node)}${from}?`];
    if (node.row.mount) parts.push(`${node.mount ?? node.row.mount.path} stays as it is; it just won't be shown here.`);
    if (count > 0) parts.push(`${who}; ${these} will be removed.`);
    return parts.join(' ');
  }

  /** The row before `row` in its own file, among the rows the place can be on. */
  function previousInFile(row: Row, item: boolean): Row | undefined {
    return rows
      .slice(0, rowIndex(row.vline))
      .reverse()
      .find((r) => r.file === row.file && (!item || r.kind === 'item'));
  }

  /** The lines of a row's own file, as the model read them. */
  const linesOf = (row: Row) => model?.files.get(row.file)?.lines ?? model?.lines ?? [];

  /**
   * The toolbar (§4b.5). A button is enabled only when its operation would change something, which
   * for most of them is "the edit is not empty". Where a mounted file is the reason, `why` says so:
   * the button's tooltip, and the note its key gives.
   */
  const actions: { id: string; label: string; run(row: Row): void; enabled(row: Row): boolean; why?(row: Row): string | null }[] = [
    { id: 'insert', label: 'Insert row', run: startDraft, enabled: () => true },
    {
      id: 'delete',
      label: 'Delete row',
      run: (row) => (row.kind === 'item' ? remove(row) : apply(row.file, deleteLines(textOf(row.file), range(row)))),
      enabled: () => true,
    },
    {
      id: 'indent',
      label: 'Indent',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, shiftItem(m, row.node, row.level, 1), [row.node], false))
          : apply(row.file, indent(textOf(row.file), range(row))),
      // An item row needs a previous sibling to become its child: an item row above at the same or a greater level, in its file.
      enabled: (row) => {
        const previous = previousInFile(row, row.kind === 'item');
        if (row.kind === 'item') return previous?.kind === 'item' && previous.level >= row.level;
        return previous !== undefined && previous.indent >= row.indent;
      },
    },
    {
      id: 'outdent',
      label: 'Outdent',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, shiftItem(m, row.node, row.level, -1), [row.node], false))
          : apply(row.file, outdent(textOf(row.file), range(row))),
      // The same conditions the operations use, without re-reading the document
      // on every focus move: a level or indentation to remove, a line above, a line below.
      enabled: (row) => (row.kind === 'item' ? row.level > 0 : row.indent > 0),
      // A mounted file's root can't leave its file.
      why: (row) => (row.kind === 'item' && row.level === 0 && row.file !== root() && model ? plainRefusal(`it would leave file ${fileLabel(model, row.file)}`) : null),
    },
    {
      id: 'up',
      label: 'Move up',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, moveItem(m, row.node, 'up'), [row.node], false))
          : apply(row.file, moveUp(textOf(row.file), range(row))),
      // An item row swaps with its previous sibling in its file, so there must be one; a line never goes into the front matter.
      enabled: (row) =>
        row.kind === 'item' ? model !== null && !('refused' in moveItem(model, row.node, 'up')) : row.line > 1 && linesOf(row)[row.line - 2]?.kind !== 'front-matter',
    },
    {
      id: 'down',
      label: 'Move down',
      run: (row) =>
        row.kind === 'item'
          ? structure(row, (m) => withRepairs(m, moveItem(m, row.node, 'down'), [row.node], false))
          : apply(row.file, moveDown(textOf(row.file), range(row))),
      enabled: (row) => (row.kind === 'item' ? model !== null && !('refused' in moveItem(model, row.node, 'down')) : row.line < linesOf(row).length),
    },
    {
      id: 'done',
      label: 'Toggle done',
      run: (row) =>
        row.kind === 'item' && write(cellFor(row.vline, DONE), row.file, (current) => withRepairs(current, setDone(current, row.node, !row.node.done), [row.node])),
      // A row done through an ancestor has no marker of its own to clear.
      enabled: (row) => row.kind === 'item' && canMarkDone(model!, row.file) && (!row.node.done || row.node.ownDone),
      why: (row) => (row.file !== root() && model && !canMarkDone(model, row.file) ? plainRefusal(`file ${fileLabel(model, row.file)} has no marker done`) : null),
    },
    {
      id: 'unmount',
      label: 'Unmount',
      // Clears the mount cell: the segment goes, and the file stays as it is. One undo step, no confirm.
      run: (row) => row.kind === 'item' && structure(row, (m) => withRepairs(m, unmount(m, row.node), [row.node])),
      enabled: (row) => row.kind === 'item' && row.node.row.mount !== undefined,
    },
  ];

  /** Run a structural operation on the current row, if it applies; when a mounted file is why it doesn't, say so. */
  function act(id: string): void {
    const action = actions.find((a) => a.id === id);
    const row = target();
    if (!action || !row) return;
    if (action.enabled(row)) return action.run(row);
    const reason = action.why?.(row);
    if (reason) notice(cellFor(row.vline, at?.column ?? WBS), reason);
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
    buttons.forEach((button, i) => {
      button.disabled = row === null || !actions[i].enabled(row);
      button.title = (row && button.disabled && actions[i].why?.(row)) || '';
    });
  }

  /** A header's buttons: Open makes its file active; Unmount clears its mount row's `mount=` cell (spec §4b.7). */
  function headerAction(header: Header, action: string | undefined): void {
    if (action === 'open') return hooks.onOpenFile?.(header.file);
    const row = byFile.get(keyOf(header.mountRow.file, header.mountRow.line));
    if (action === 'unmount' && row?.kind === 'item') structure(row, (m) => withRepairs(m, unmount(m, row.node), [row.node]));
  }

  function cellAt(event: Event): { row: Row; column: number } | null {
    const td = (event.target as HTMLElement).closest('td');
    const tr = td?.parentElement as HTMLTableRowElement | undefined;
    const row = tr ? byLine.get(vlineOf.get(tr) ?? -1) : undefined;
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
        return handled(), step(row.vline, -1, column);
      case 'ArrowDown':
        return handled(), step(row.vline, 1, column);
      case 'ArrowLeft':
        return handled(), place(row.vline, columns[Math.max(0, columns.indexOf(column) - 1)]);
      case 'ArrowRight':
        return handled(), place(row.vline, columns[Math.min(columns.length - 1, columns.indexOf(column) + 1)]);
      case 'Enter':
        // Unbound on a selected row (§4b.4).
        if (selected) return;
        return handled(), step(row.vline, 1, column);
      case 'Tab':
        // Unbound on a selected row, which is how the keyboard leaves the grid.
        if (selected) return;
        return handled(), tab(row, column, event.shiftKey);
      case 'Escape':
        if (!selected) return;
        return handled(), clearPlace();
      case 'Delete':
        if (selected) return handled(), act('delete');
        if (rawOf(row, column) === null && !(row.kind === 'item' && boolColumn(row.node, column))) return;
        return handled(), commit(row, column, '');
      case 'Insert':
        return handled(), act('insert');
      case 'F2':
        return handled(), beginEdit(row, column, '');
      case ' ': {
        if (column === DONE) return handled(), act('done');
        // A bool cell's checkbox (spec §4b.6.5), or a marker's toggle; a disabled one says why, when it can.
        const td = cellFor(row.vline, column);
        const box = td?.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!box) break;
        if (box.disabled && td?.dataset.why) return handled(), notice(td, td.dataset.why);
        return handled(), box.click();
      }
    }
    // Any other printable key starts an edit, replacing the cell's content.
    if (event.key.length === 1) handled(), beginEdit(row, column, event.key);
  });

  table.addEventListener('click', (event) => {
    const hit = cellAt(event);
    // A mount row's file badge opens its file, as in the views; it doesn't move the place.
    if ((event.target as HTMLElement).closest('.file-badge')) {
      if (hit?.row.kind === 'item' && hit.row.node.mount !== undefined) hooks.onOpenFile?.(hit.row.node.mount);
      return;
    }
    // A header's buttons; the header itself takes no place.
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('.segment-header button');
    const header = action && headerOf.get(action.closest('tr')!);
    if (header) return headerAction(header, action.dataset.action);
    if (hit && !editing) place(hit.row.vline, hit.column);
  });
  // A checkbox on any row: done, a marker's toggle, or a bool cell (spec §4b.1, §4b.6.5). Handled
  // here rather than on the box, so a kept cell writes the current model's row. Captured, so a
  // change event that doesn't bubble still arrives.
  table.addEventListener(
    'change',
    (event) => {
    const box = event.target as HTMLInputElement;
    const hit = box.type === 'checkbox' ? cellAt(event) : null;
    if (!hit || hit.row.kind !== 'item') return;
    const { node } = hit.row;
    const column = hit.column;
    const on = box.checked;
    const make = (m: Model): EditResult =>
      withRepairs(
        m,
        column === DONE ? setDone(m, node, on) : column <= MARKER ? setToggle(m, node, toggles()[MARKER - column].name, on) : setFlag(m, node, column - DECLARED, on),
        [node],
      );
    if (!write(cellFor(hit.row.vline, column), node.file, make)) box.checked = !on;
    },
    true,
  );
  table.addEventListener('mouseover', (event) => {
    const tr = (event.target as HTMLElement).closest('tr');
    hover(tr && tr.parentElement === table.tBodies[0] ? lineOf(tr) : null);
  });
  table.addEventListener('mouseleave', () => hover(null));
  table.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('.file-badge, .segment-header')) return;
    const hit = cellAt(event);
    if (hit && hit.column !== DONE && hit.column !== WBS) beginEdit(hit.row, hit.column);
  });
  table.addEventListener('focusin', (event) => {
    held = true;
    // The keyboard can land on the tab stop without going through a click.
    const hit = cellAt(event);
    if (!hit || editing) return;
    if (at && at.column === hit.column && lineAt(buffer.text(), at.anchor) === hit.row.vline) return;
    place(hit.row.vline, hit.column);
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
    place(last.vline, back ? lastColumn(last) : nearest(last, at?.column ?? TITLE));
  });
  newTask.addEventListener('blur', addTask);

  /**
   * Every line becomes a row, in the order the buffer shows them; each file's front matter collapses
   * into one. Over a composed buffer that is composed order, from the piece map: the root's lines,
   * with each mounted file's lines in its segment (spec §4b.1).
   */
  function readModel(next: Model): void {
    const text = buffer.text();
    const map = buffer.pieces?.();
    // Where each line of the shown text starts, to number the rows by vline.
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    const vlineAt = (pos: number): number => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
    // Each line of the model's files, with its file, its vline and its mount depth.
    const placed: ({ node: Node; file: string; vline: number; mount: number } | { segment: Segment })[] = [];
    if (!map) {
      for (const node of next.lines) placed.push({ node, file: next.file, vline: node.line, mount: 0 });
    } else {
      // A file's runs come in its own order, so one cursor per file walks its lines once.
      const cursor = new Map<string, number>();
      for (const [ri, run] of map.runs.entries()) {
        // A mounted file's header goes above its segment's first line.
        for (const segment of map.segments) if (segment.first === ri && next.files.has(segment.file)) placed.push({ segment });
        const lines = run.joint ? undefined : next.files.get(run.file)?.lines;
        if (!lines) continue;
        let i = cursor.get(run.file) ?? 0;
        while (i < lines.length && lines[i].span.from < run.from) i++;
        for (; i < lines.length && lines[i].span.from < run.to; i++) {
          placed.push({ node: lines[i], file: run.file, vline: vlineAt(run.at + lines[i].span.from - run.from), mount: run.depth });
        }
        cursor.set(run.file, i);
      }
    }

    const level = new Map<string, Map<number, { shown: number; indent: number }>>();
    const levelOf = (file: string) => level.get(file) ?? (level.set(file, levels(next, file)), level.get(file)!);
    // The depth a file's roots are shown at: 0 for the root, one below its mount row for a mounted file.
    const bases = new Map<string, number>();

    rows = [];
    shown = [];
    byLine.clear();
    byFile.clear();
    frontMatter = null;
    const fileText = (file: string) => next.files.get(file)?.doc.text ?? next.doc.text;
    let block: { file: string; vline: number; mount: number; nodes: Node[] } | null = null;
    const closeBlock = (): void => {
      if (!block) return;
      const { file, nodes } = block;
      const span = { from: nodes[0].span.from, to: nodes[nodes.length - 1].span.to };
      const front: FrontMatter = {
        kind: 'front',
        vline: block.vline,
        file,
        line: nodes[0].line,
        mount: block.mount,
        span,
        text: fileText(file).slice(span.from, span.to).split('\n').join(' '),
      };
      shown.push(front);
      byFile.set(keyOf(file, front.line), front);
      if (file === next.file && !frontMatter) frontMatter = front;
      block = null;
    };
    for (const entry of placed) {
      if ('segment' in entry) {
        closeBlock();
        const { file, mount, depth } = entry.segment;
        shown.push({ kind: 'header', file, mountRow: mount, depth });
        continue;
      }
      const { node, file, vline, mount } = entry;
      if (node.kind === 'front-matter') {
        if (block && block.file !== file) closeBlock();
        if (!block) block = { file, vline, mount, nodes: [] };
        block.nodes.push(node);
        continue;
      }
      closeBlock();
      const where = { vline, file, line: node.line, mount };
      let row: Row;
      if (node.kind === 'item') {
        const lv = levelOf(file).get(node.line);
        const depth = lv?.shown ?? 0;
        const indent = lv?.indent ?? 0;
        if (!bases.has(file)) bases.set(file, depth - indent);
        row = { kind: 'item', ...where, span: node.span, indent: node.indent, node, depth, level: indent, base: bases.get(file)! };
      } else {
        const raw = fileText(file).slice(node.span.from, node.span.to);
        row = { kind: 'line', ...where, span: node.span, indent: indentOf(raw), text: raw, blank: node.kind === 'blank', base: bases.get(file) ?? mount };
      }
      rows.push(row);
      shown.push(row);
      byLine.set(vline, row);
      byFile.set(keyOf(file, node.line), row);
    }
    closeBlock();

    // Diagnostics land on the cell their span belongs to; the rest on the WBS cell, and anything
    // inside a file's front matter on its collapsed row (§4b.2). Each is on its own file's row.
    marks = new Map();
    const fronts = new Map(shown.flatMap((r) => (r.kind === 'front' ? [[r.file, r] as const] : [])));
    for (const diagnostic of next.diagnostics) {
      const file = diagnostic.file ?? next.file;
      const row = byFile.get(keyOf(file, diagnostic.line));
      if (!row || row.kind === 'front') {
        const front = fronts.get(file);
        if (front && !front.diagnostic) front.diagnostic = diagnostic;
        continue;
      }
      const key = `${row.vline}:${columnFor(row, diagnostic)}`;
      if (!marks.has(key)) marks.set(key, diagnostic);
    }
  }

  function columnFor(row: Row, diagnostic: Diagnostic): number {
    if (!diagnostic.span) return WBS;
    if (row.kind === 'line') return TITLE;
    if (within(row.node.titleSpan, diagnostic.span)) return TITLE;
    // The whole cell, so a named cell's `NAME=` counts as in it; each root column's cell in the row's own file.
    const i = (model?.columns ?? []).findIndex((_, k) => {
      const column = model ? cellColumn(model, row.node, k) : null;
      const cell = column ? row.node.row.cells[column.index] : null;
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
    showUnsaved(files) {
      unsaved = files;
      // Only the headers show it: each is drawn again, and redraws only if its marker changed.
      if (!model) return;
      for (const row of shown) {
        const tr = row.kind === 'header' ? keptHeaders.get(row.file) : undefined;
        if (tr && row.kind === 'header') drawRow(tr, headerSpec(row));
      }
    },
    setCursorLine({ file, line }) {
      const row = byFile.get(keyOf(file, line));
      if (row && row.kind !== 'front') place(row.vline, nearest(row, at?.column ?? TITLE), true);
    },
    setHoverLine(at) {
      relayed = at;
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
