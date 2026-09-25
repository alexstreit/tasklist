// Core data types. Spec §2 and §3. This module must stay dependency-free.

export type Severity = 'warning' | 'info';

/** Absolute character offsets into `Tree.text` (the normalised source). */
export interface Span {
  from: number;
  to: number;
}

export interface Diagnostic {
  line: number; // 1-based
  span?: Span;
  severity: Severity;
  message: string;
}

export type ColumnType = 'duration' | 'number' | 'text';

export interface Column {
  name: string;
  type: ColumnType;
}

/** One positional field on an item line. `value` is trimmed; `span` covers the trimmed text. */
export interface Field {
  value: string;
  span: Span;
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

/** A `#` line — reserved for future headings (spec §2.2). */
export interface ReservedNode extends NodeBase {
  kind: 'reserved';
}

/** A front matter delimiter or content line, retained for losslessness. */
export interface FrontMatterNode extends NodeBase {
  kind: 'front-matter';
}

export interface ItemNode extends NodeBase {
  kind: 'item';
  indent: number;
  /** Own `~` marker only; inherited done-ness is computed. */
  done: boolean;
  title: string;
  titleSpan: Span;
  fields: Field[];
  children: ItemNode[];
  /** Structural reference: `1`, `1.2`, `2.1.5`. Only item nodes count. */
  outlineNumber: string;
}

export type Node = BlankNode | CommentNode | ReservedNode | FrontMatterNode | ItemNode;

export interface FrontMatterEntry {
  key: string;
  value: string;
  line: number;
  valueSpan: Span;
}

export interface Tree {
  /** Normalised source: CRLF -> LF, tabs -> 4 spaces. All spans index into this. */
  text: string;
  /** Every line of the file, in order. Lossless. */
  nodes: Node[];
  /** Root items of the hierarchy. */
  items: ItemNode[];
  /** null when the file has no front matter block. */
  frontMatter: FrontMatterEntry[] | null;
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
  /** Own `~` or inherited from an ancestor. */
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
