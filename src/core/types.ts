// Core data types. Spec §2 and §3. This module imports only the rows library's types.

import type { Row, RowsDocument, TextEdit, TypeKind } from 'rows';

export type Severity = 'error' | 'warning' | 'info';

/** Absolute character offsets into `Tree.text` (the normalised source). */
export interface Span {
  from: number;
  to: number;
}

/** A labelled edit that resolves a diagnostic (spec §2.9). */
export interface Fix {
  label: string;
  edits: TextEdit[];
}

export interface Diagnostic {
  line: number; // 1-based
  span?: Span;
  severity: Severity;
  /** A rows error code, or one of the plan's own (spec §2.9). */
  code: string;
  message: string;
  fixes?: Fix[];
}

/** A declared column. `type` is the rows type kind; only `duration` and `number` are summed (spec §2.6). */
export interface Column {
  name: string;
  type: TypeKind;
}

/** A cell the row sets for a declared column. */
export interface Field {
  /** The decoded text. */
  text: string;
  /** The value as written, quotes included. */
  span: Span;
  /** Summable columns: hours (duration) or the number, without its sign. Null when empty or unreadable. */
  amount: number | null;
  /** A leading `+` (spec §2.6). */
  additive: boolean;
}

interface NodeBase {
  line: number; // 1-based
  span: Span; // the full line, excluding the newline
}

export interface BlankNode extends NodeBase {
  kind: 'blank';
}

export interface CommentNode extends NodeBase {
  kind: 'comment';
}

/** A frontmatter line, retained for losslessness. */
export interface FrontMatterNode extends NodeBase {
  kind: 'front-matter';
}

export interface ItemNode extends NodeBase {
  kind: 'item';
  /** The rows row, with every span. */
  row: Row;
  indent: number;
  /** Own `done` marker or `done=true`; inherited done-ness is computed. */
  done: boolean;
  title: string;
  /** The lead value as written, quotes included; markers and anchors excluded. */
  titleSpan: Span;
  /** One per declared column, in order; null when the row doesn't set it. */
  fields: (Field | null)[];
  children: ItemNode[];
  /** Structural reference: `1`, `1.2`, `2.1.5`. Only item nodes count. */
  outlineNumber: string;
}

export type Node = BlankNode | CommentNode | FrontMatterNode | ItemNode;

export interface Tree {
  /** Normalised source: BOM stripped, CRLF -> LF, tabs -> 4 spaces. All spans index into this. */
  text: string;
  doc: RowsDocument;
  columns: Column[];
  /** Every line of the file, in order. Lossless. */
  nodes: Node[];
  /** Root items of the hierarchy. */
  items: ItemNode[];
  diagnostics: Diagnostic[];
}

export type RollupMode = 'derived' | 'override' | 'additive';

/** Computed cell for a `duration` or `number` column. Spec §2.7–2.8. */
export interface SummableCell {
  kind: 'duration' | 'number';
  effective: number;
  childSum: number;
  mode: RollupMode;
  doneSum: number;
  /** Own field non-empty, or any child has a value. False means there is nothing to display. */
  hasValue: boolean;
  /** True when any child has `hasValue`; renderers show the child sum only then. */
  childrenHaveValue: boolean;
  /** The field text as entered, '' when empty. */
  raw: string;
  span: Span | null;
}

/** A column that isn't summed (text, bool, date, enum, ref…): its decoded text, as written. */
export interface TextCell {
  kind: 'text';
  value: string;
  span: Span | null;
}

export type Cell = SummableCell | TextCell;

export interface ModelNode {
  line: number;
  span: Span;
  indent: number;
  title: string;
  titleSpan: Span;
  /** Own done flag or inherited from an ancestor. */
  done: boolean;
  outlineNumber: string;
  /** One cell per declared column, in order. */
  cells: Cell[];
  children: ModelNode[];
  source: ItemNode;
}

export interface DocumentTotal {
  effective: number;
  doneSum: number;
}

export interface Model {
  columns: Column[];
  roots: ModelNode[];
  /** Every line of the file in order, as parsed. Lossless, like the tree: an
   *  editor showing the file needs the comment, blank and front matter lines
   *  too, and must not classify them again for itself. */
  lines: readonly Node[];
  /** Aligned with `columns`; null for text columns. */
  totals: (DocumentTotal | null)[];
  diagnostics: Diagnostic[];
}

// Renderer seam. Spec §3.3.

export interface ColumnRequirement {
  type: string;
}

/** The item a renderer should highlight for the editor cursor. */
export interface CursorItem {
  line: number;
  /** True when the cursor is on the item's own line; false when it is on a
   *  comment or blank line and this is the nearest item at or before it. */
  exact: boolean;
}

export interface RenderContext {
  cursorLine: number | null;
  cursorItem: CursorItem | null;
  /** True when the highlighted item changed because of an editor cursor move.
   *  Renderers scroll the highlighted row into view. Never true for a move the
   *  renderer itself requested through setCursorLine. */
  scrollToCursor: boolean;
  setCursorLine(line: number): void;
}

export interface Renderer {
  id: string;
  label: string;
  requires: ColumnRequirement[];
  render(model: Model, host: HTMLElement, ctx: RenderContext): void;
}

// Exporter seam. Spec §3.6.

export interface Exporter {
  id: string;
  label: string; // e.g. "Copy for Excel"
  export(model: Model): { mime: string; data: string };
}
