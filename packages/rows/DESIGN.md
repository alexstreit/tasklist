# rows — Library Design

Lives at `packages/rows/DESIGN.md`. Implements rows base 0.8 and rows extensions 0.5 (which binds Text Anchors 0.2). The specs sit beside it in `packages/rows/spec/`.

## 1. Scope

**v1**

- Base 0.8 in full: frontmatter grammar, profiles, column declarations, every type, quoting, named cells, overflow, both error tables, strict and tolerant modes.
- Extensions: implicit columns, key and anchors (including aliases), markers, nesting, `ref` columns within the file (`many`, `qualifier`), `order`.
- Format-preserving edits (§6).
- A language-neutral conformance suite (§8).

**Later**

- `include` resolution. Until then, v1 treats every include as unreadable, which the spec already covers: a structural error, and every reference into that table is a validation error.
- Canonical form writer and reader.
- Minting IDs.

## 2. Boundaries

- Pure TypeScript with zero runtime dependencies. No DOM and no Node APIs.
- Imports nothing from the app. The app imports only from the package's `index.ts` (lint-enforced).
- File access is the host's job. Profiles and, later, includes arrive through callbacks.

## 3. Pipeline

```
text ──► normalise ──► frontmatter ──► schema ──► tokenise rows ──► type ──► extensions ──► RowsDocument
          BOM, CRLF     entries,         lead,       cells, spans,     values,   key, anchors,
                        profile          columns,    named, overflow   validation markers, nest,
                        resolution       options                                 refs, order
```

Each stage is a separate module with its own tests. `tokenise` works one line at a time from a small context (`sep`, `comment`, marker characters, whether extensions are on). It is exported as `tokenizeLine`, so the editor's highlighter uses the same tokenizer as the parser (§7).

## 4. API

```ts
parseRows(text: string, options?: ParseOptions): RowsDocument

interface ParseOptions {
  mode?: 'tolerant' | 'strict';         // default tolerant
  filename?: string;                     // table-name default; path base
  extensions?: boolean;                  // default true
  profiles?: Record<string, string>;     // built-in named profiles: name → frontmatter text
  defaultProfile?: string;               // applied when the file has no `profile:` key
  resolveProfile?(path: string): string | undefined;  // path profiles; undefined = unresolvable
}
```

Strict mode returns the same document with `failed: true` when any syntax or structural error exists. It never throws, so a host can show strict failures with the same code it uses for tolerant errors.

```ts
interface RowsDocument {
  text: string; // normalised text; every span is an offset into it
  endsWithNewline: boolean;
  lines: Line[]; // every physical line, in order — lossless
  frontmatter: Frontmatter | null;
  schema: Schema; // resolved keys + lead + declared and implicit columns
  rows: Row[]; // body rows, in order
  roots: Row[]; // top-level rows when nest is set; otherwise all rows
  errors: RowsError[];
  failed: boolean; // strict mode only
}

interface Line {
  kind:
    | "fm-open"
    | "fm-entry"
    | "fm-comment"
    | "fm-blank"
    | "fm-malformed"
    | "fm-close"
    | "blank"
    | "comment"
    | "row";
  line: number; // 1-based
  from: number;
  to: number; // excluding the newline
  row?: Row;
}

interface Row {
  line: number;
  from: number;
  to: number;
  indent: { width: number; from: number; to: number };
  markers: { name: string; char: string; from: number; to: number }[];
  lead: Cell; // value span excludes markers and anchors
  anchors: { id: string; from: number; to: number }[];
  cells: (Cell | null)[]; // by column index, so cells[0] is the lead; null = not set by the row
  overflow: Cell[];
  id: string | null;
  aliases: string[];
  parent: Row | null;
  children: Row[];
  depth: number;
  errors: RowsError[];
}

interface Cell {
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

type Value =
  | { type: "text"; text: string }
  | { type: "number"; value: number }
  | { type: "bool"; value: boolean }
  | { type: "date" | "datetime"; text: string }
  | { type: "enum"; text: string }
  | {
      type: "duration";
      sign: "+" | "-" | null;
      terms: Partial<Record<"m" | "h" | "d" | "w", number>>;
      bare: boolean;
    }
  | {
      type: "ref";
      refs: {
        table: string | null;
        id: string;
        target: Row | null;
        qualifier: Value | null;
      }[];
    };

interface RowsError {
  class: "syntax" | "structural" | "validation";
  code: string; // stable, e.g. 'unterminated-quote'; listed in errors.ts
  message: string;
  line: number;
  from?: number;
  to?: number;
}
```

Helpers:

```ts
durationToMinutes(v, column): { minutes: number } | { error: 'needs-hpd' | 'needs-dpw' }
tokenizeLine(text: string, ctx: LineContext): LineTokens    // for highlighters
```

Error codes are the library's own. The spec defines classes, not codes. Codes let hosts write specific messages and let conformance fixtures stay stable when wording changes. Consider adding them to the spec at 1.0.

## 5. Offsets

`parseRows` strips a BOM and turns CRLF into LF, and every span refers to the text after that. A host that keeps its own buffer, as the plan tool does, must normalise before it fills the buffer, so its offsets and the library's agree.

## 6. Edits

Hosts never re-serialise a document. They ask the library for `TextEdit[]` against the text it parsed, apply them, and parse again.

```ts
setLead(doc, row, text): TextEdit[]
setCell(doc, row, column, text: string | null): TextEdit[]
setMarker(doc, row, name, on: boolean): TextEdit[]
insertRow(doc, at: { beforeLine: number } | 'end', indent: number, lead: string, cells?: Record<string, string>): TextEdit[]
formatValue(doc, column | 'lead', text): string   // quotes exactly when base §3 requires
```

Rules:

- **`setLead`** replaces only the lead value span, so the indent, markers and anchors survive. It quotes the text if it would otherwise read as a marker, an anchor or a heading.
- **`setCell`** follows these steps, in order:
  1. If the column's cell exists, replace its value span. The `NAME=` prefix and the padding stay.
  2. Otherwise, if the column is the next positional slot and the row has no named cells, append ` | value`.
  3. Otherwise, append a named cell `NAME=value`. This never pads with empty cells.
  4. `null` removes the cell. It removes a trailing positional cell together with its delimiter. An interior positional cell is emptied, since removing it would shift the cells after it.
- **`setMarker`** inserts or removes the marker character straight after the indent. When the column has no marker, it sets the value by name. A row with both a marker and an explicit `done=false` has both corrected.
- Every edit function is tested by the same property: for random documents and random edits, parsing the edited text gives the intended value in the target, and every other row, cell, marker, anchor and comment is unchanged.

## 7. Highlighting

`tokenizeLine` returns token spans: indent, marker, lead, anchor, delimiter, cell name, `=`, quoted value, escape, plain value, and comment. It also returns a frontmatter-state transition, so a line-at-a-time highlighter (CodeMirror's `StreamLanguage`) can carry state across lines. Value types come from the schema, which the tokenizer doesn't need. A highlighter that wants per-type colours (durations, signs) reads the column for each cell index from the latest parsed document.

## 8. Conformance suite

`packages/rows/conformance/` holds one case per directory:

```
case-name/
  input.rows
  options.json      // optional: mode, filename, profiles, extensions
  expected.json     // failed, errors (class, code, line), rows (line, indent, lead,
                    //   values by column as raw text, overflow, markers, id, aliases, parent line)
```

The suite is language-neutral on purpose. A C# or Python implementation can run it unchanged. It is written first, from the specs, before any implementation code, and it covers:

- every example in all three specs;
- every row of both recovery tables in base §6;
- every error named in extensions §3 to §7;
- the strict/tolerant split for each structural error.
