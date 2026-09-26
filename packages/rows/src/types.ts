// Public types (DESIGN §4). Every offset is into RowsDocument.text, the normalised text.
import type { ErrorClass, ErrorCode } from './errors';

export interface ParseOptions {
  mode?: 'tolerant' | 'strict'; // default tolerant
  filename?: string; // table-name default; path base
  extensions?: boolean; // default true
  profiles?: Record<string, string>; // built-in named profiles: name → frontmatter text
  defaultProfile?: string; // applied when the file has no `profile:` key
  resolveProfile?(path: string): string | undefined; // path profiles; undefined = unresolvable
}

export interface RowsDocument {
  text: string;
  endsWithNewline: boolean;
  lines: Line[]; // every physical line, in order
  frontmatter: Frontmatter | null;
  schema: Schema;
  rows: Row[];
  roots: Row[]; // top-level rows when nest is set; otherwise all rows
  errors: RowsError[];
  failed: boolean; // strict mode only
}

export type LineKind =
  | 'fm-open'
  | 'fm-entry'
  | 'fm-comment'
  | 'fm-blank'
  | 'fm-malformed'
  | 'fm-close'
  | 'blank'
  | 'comment'
  | 'row';

export interface Line {
  kind: LineKind;
  line: number; // 1-based
  from: number;
  to: number; // excluding the newline
  row?: Row;
}

export interface FrontmatterEntry {
  key: string;
  value: string; // unquoted and unescaped
  quoted: boolean;
  line: number;
  from: number;
  to: number;
  keyFrom: number;
  keyTo: number;
  valueFrom: number; // the value as written, quotes included
  valueTo: number;
}

export interface Frontmatter {
  from: number; // start of the opening ---
  to: number; // end of the closing ---
  entries: FrontmatterEntry[];
}

export interface ColumnOption {
  key: string;
  value: string | null; // null for a bare flag
}

export interface Column {
  index: number; // 0 is the lead
  name: string;
  type: string; // as read; `text` when not given
  options: ColumnOption[];
  settable: boolean; // can be set by a named cell
  implicit: boolean;
  from?: number; // the declaration, when it is written unquoted in this file
  to?: number;
}

export interface Schema {
  table: string | null;
  format: string;
  sep: string;
  comment: string;
  keys: Record<string, string>; // resolved keys: the file's, then the profile's
  lead: Column;
  columns: Column[]; // lead first
}

export interface Row {
  line: number;
  from: number;
  to: number;
  indent: { width: number; from: number; to: number };
  markers: { name: string; char: string; from: number; to: number }[];
  lead: Cell; // value span excludes markers and anchors
  anchors: { id: string; from: number; to: number }[];
  cells: (Cell | null)[]; // by column index, lead included; null = not set by the row
  overflow: Cell[];
  id: string | null;
  aliases: string[];
  parent: Row | null;
  children: Row[];
  depth: number;
  errors: RowsError[];
}

export interface Cell {
  column: Column | null; // null for overflow
  from: number;
  to: number; // whole cell, including any NAME=
  valueFrom: number;
  valueTo: number; // the value only, quotes included
  name: { text: string; from: number; to: number } | null;
  quoted: boolean;
  text: string | null; // decoded; null = null cell
  value: Value | null; // typed; null when text is null or invalid
}

export type Value =
  | { type: 'text'; text: string }
  | { type: 'number'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'date' | 'datetime'; text: string }
  | { type: 'enum'; text: string }
  | {
      type: 'duration';
      sign: '+' | '-' | null;
      terms: Partial<Record<'m' | 'h' | 'd' | 'w', number>>;
      bare: boolean;
    }
  | {
      type: 'ref';
      refs: { table: string | null; id: string; target: Row | null; qualifier: Value | null }[];
    };

export interface RowsError {
  class: ErrorClass;
  code: ErrorCode;
  message: string;
  line: number;
  from?: number;
  to?: number;
}
