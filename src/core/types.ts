// Core data types. Spec §2 and §3. This module imports only the rows library's types.

import type { Row, RowsDocument, TextEdit, TypeKind } from 'rows';
import type { Bindings } from './bindings';
import type { Calendar } from './calendar';
import type { FieldKey } from './fields';

export type Severity = 'error' | 'warning' | 'info';

/** Absolute character offsets into `Tree.text` (the normalised source). */
export interface Span {
  from: number;
  to: number;
}

/** How a fix is applied (spec §4b.6.1): with a grid edit to its line, on a click, or after a preview. */
export type FixTier = 'auto' | 'click' | 'confirm';

/** A labelled edit that resolves a diagnostic (spec §2.9, §4b.6.2). */
export interface Fix {
  label: string;
  tier: FixTier;
  edits: TextEdit[];
  /** Required for `confirm`: the affected lines before (`- `) and after (`+ `). */
  preview?: string;
  /** Shown with the preview: what the change may do beyond the lines it shows. */
  warning?: string;
  /**
   * A fix that writes a value in place of `span`, between `before` and `after`: `edits` and
   * `preview` are for the suggested `value`. With `suggest: 'today'`, the editor fills in today's
   * date when it shows the fix (`resolveFix`), since analysis never reads the clock.
   */
  input?: { span: Span; value: string; suggest?: 'today'; before?: string; after?: string };
}

export interface Diagnostic {
  line: number; // 1-based
  span?: Span;
  severity: Severity;
  /** A rows error code, or one of the plan's own (spec §2.9). */
  code: string;
  message: string;
  fixes?: Fix[];
  /** The plugin whose stage gave it; unset for core's diagnostics (PLUGINS.md §5). */
  source?: string;
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
  /** Own `done` marker or `done=true` (spec §2.5). */
  ownDone: boolean;
  /** Own, or inherited from an ancestor (spec §2.8). */
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

/** A stage the runner skipped, and why, in plain words (PLUGINS.md §5). */
export interface Inactive {
  stage: string;
  reason: string;
}

/** What a stage may read of the model: the tree and the fields written so far. */
export interface ModelReader {
  readonly roots: readonly ItemNode[];
  readonly columns: readonly Column[];
  /** A node-scope field's value; undefined when its stage didn't set it on this node. */
  get<T>(node: ItemNode, key: FieldKey<T>): T | undefined;
  /** A document-scope field's value. */
  value<T>(key: FieldKey<T>): T | undefined;
}

/** The fixed core, plus the plugin fields behind `get` and `value` (PLUGINS.md §4). */
export interface Model extends ModelReader {
  /** The rows document the model was read from: its text, schema and spans. Editors ask the rows edit API and tokenizer for edits and tokens against it. */
  doc: RowsDocument;
  columns: Column[];
  roots: ItemNode[];
  /** Every line of the file in order, as parsed. Lossless, like the tree: an
   *  editor showing the file needs the comment, blank and front matter lines
   *  too, and must not classify them again for itself. */
  lines: readonly Node[];
  /** Roles, keys and markers, after profile and file merge (PLUGINS.md §6). */
  bindings: Bindings;
  /** Present when project-start is set; renderers use it for dates. */
  calendar?: Calendar;
  diagnostics: Diagnostic[];
  /** Stages that were skipped, in stage order. */
  inactive: Inactive[];
  /** The buffer version `analyze` read (spec §3.7); 0 when the caller passes none. */
  version: number;
  /** The keys written in this analysis, in stage order: those of every stage that ran. */
  fields(): FieldKey<unknown>[];
}

// Renderer seam. Spec §3.3.

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
  // The follower part, present only for a renderer that `follows` (spec §3.3).
  /** Where the leading pane's rows are. Replaces any earlier callback, and is called at once with the latest layout, if any. */
  onRowLayout?(cb: (layout: RowLayout) => void): void;
  /** The renderer's body was scrolled to `top`. */
  reportScroll?(top: number): void;
  /** The renderer's natural header height: where its body would start if nothing else had a taller header. */
  reportHeaderHeight?(px: number): void;
}

/**
 * Where a leading pane's rows are, so a following pane can draw its rows beside them (spec §3.3,
 * §3.4). A row on screen is at `bodyTop + top - scrollTop` from the pane's top.
 */
export interface RowLayout {
  /** The buffer version this layout was measured at. */
  version: number;
  /** px from the pane's top to where its scrolling body starts, at scrollTop 0. */
  bodyTop: number;
  /** The scrolling body's full height. */
  contentHeight: number;
  scrollTop: number;
  /**
   * The visible rows (a leader may add a margin either side), in content coordinates: from the
   * top of the body, not of the viewport. `at` is null for a row with no line, such as the
   * grid's draft row; `{ line }` can gain a file in M3.
   */
  rows: { at: { line: number } | null; top: number; height: number }[];
}

export interface Renderer {
  id: string;
  label: string;
  /** The fields it reads; greyed out when one wasn't computed (PLUGINS.md §5). */
  requires: FieldKey<unknown>[];
  /** Draws its rows where a leading pane's rows are (spec §3.3). */
  follows?: true;
  render(model: Model, host: HTMLElement, ctx: RenderContext): void;
}

// Exporter seam. Spec §3.6.

export interface Exporter {
  id: string;
  label: string; // e.g. "Copy for Excel"
  requires: FieldKey<unknown>[];
  export(model: Model): { mime: string; data: string };
}
