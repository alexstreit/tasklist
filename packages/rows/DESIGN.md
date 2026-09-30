# rows — Library Design

Lives at `packages/rows/DESIGN.md`. Implements rows base 0.11 and rows extensions 0.9 (which binds Text Anchors 0.2). The specs sit beside it in `packages/rows/spec/`.

## 1. Scope

**v1**

- Base 0.11 in full: frontmatter grammar, profiles, column declarations, every type, quoting, named cells, overflow, both error tables, strict and tolerant modes.
- Extensions: implicit columns, key and anchors (including aliases), markers, nesting, `ref` columns within the file (`many`, `qualifier`), `order`, `roles`.
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

interface Schema {
  // …resolved sep, comment, lead, columns, key, nest, markers, order, includes
  keys: Record<string, string>; // every key, the file's then the profile's; qualified keys as written
  roles: {                       // ext §11: the profile's and the file's merged per role, the file's winning;
                                 // profile order, rebinds in place, then the file's new roles
    name: string;                // the role name, qualified or not
    column: Column;
    from?: number; to?: number;              // the role name, when written unquoted in this file
    columnFrom?: number; columnTo?: number;  // the column name, likewise
  }[];
}

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
parseDuration(text, unit?): Value | null                    // a duration value as a column with that unit reads it
readValue(text, type): Value | null                         // a value as a cell of that type reads it; a Column is a type ({ kind, enumValues?, unit? })
tokenizeLine(text: string, ctx: LineContext): LineTokens    // for highlighters
readFlag(doc, row, column): boolean | null                  // a bool: its marker, then its cell, then its default
rowLevels(doc): Map<Row, number>                            // each row's depth in the indentation tree (§6)
isWs(c), NAME                                               // base whitespace; the column-name grammar
KNOWN_KEYS, TYPE_NAMES, RECOVERED_CODES                     // the keys rows reads; base type names; recovered syntax errors
```

Hosts use these instead of restating the grammar. A column declared unquoted in the file also carries `from`/`to` for its declaration and `typeFrom`/`typeTo` for its `:TYPE` (empty at the end of the name when it has none).

An error in a column declaration written unquoted in the file spans the part it is about: the `:TYPE` for a malformed or unknown type or a bad enum value, the option for an invalid or repeated one, and the whole declaration for a name error. Hosts use the span to remove exactly that part.

Error codes are the library's own. The spec defines classes, not codes. Codes let hosts write specific messages and let conformance fixtures stay stable when wording changes. Consider adding them to the spec at 1.0.

## 5. Offsets

`parseRows` strips a BOM and turns CRLF into LF, and every span refers to the text after that. A host that keeps its own buffer, as the plan tool does, must normalise before it fills the buffer, so its offsets and the library's agree.

## 6. Edits

Hosts never re-serialise a document. They ask the library for `TextEdit[]` against the text it parsed, apply them, and parse again.

```ts
interface TextEdit { from: number; to: number; insert: string }   // offsets into doc.text
type EditResult = { edits: TextEdit[] } | { refused: string }      // edits: [] = nothing to change

setLead(doc, row, text): EditResult
setCell(doc, row, column, text: string | null): EditResult
setMarker(doc, row, name, on: boolean): EditResult
insertRow(doc, at: { beforeLine: number } | 'end', indent: number, lead: string, cells?: Record<string, string>): EditResult
setLevel(doc, row, level: number): EditResult
moveRow(doc, row, dir: 'up' | 'down'): EditResult
deleteRow(doc, row): EditResult
repairRow(doc, row): TextEdit[]
repairs(doc, row): Repair[]      // the same, labelled: { kind: 'cell', cell, edits } | { kind: 'title' | 'indent', edits }
removeCell(doc, row, cell): TextEdit
levelIndent(doc, at: { beforeLine: number } | 'end', level: number): number | null
formatValue(doc, column | 'lead', text): string   // quotes exactly when base §3 requires
```

Rules:

- **`setLead`** replaces only the lead value span, so the indent, markers and anchors survive. It quotes the text if it would otherwise read as a marker, an anchor or a heading.
- **`setCell`** follows these steps, in order:
  1. If the column's cell exists, replace its value span. The `NAME=` prefix and the padding stay.
  2. Otherwise, if the column is the next positional slot and the row has no named cells, append ` | value`.
  3. Otherwise, append a named cell `NAME=value`. This never pads with empty cells, except in the one case below.
  4. `null` removes the cell. It removes a trailing positional cell together with its delimiter. An interior positional cell is emptied, since removing it would shift the cells after it.
- **`setMarker`** inserts or removes the marker character straight after the indent. When the column has no marker, it sets the value by name. A row with both a marker and an explicit `done=false` has both corrected.
- **`setCell` padding exception.** When a column can't be set by name (its name is invalid or duplicated) and the row doesn't reach it, `setCell` pads with empty cells up to it instead of refusing. This is the only case where it pads. It can't pad a row that has a named or overflow cell, since the padding would be unnamed cells after it; that is still a refusal.
- **`setLevel(doc, row, level)`, `moveRow(doc, row, 'up' | 'down')`, `deleteRow(doc, row)`.** These are level-based structure edits, with the behaviour described in plan spec §4b.6.4 and the same `EditResult` return, refusals and no-new-errors invariant as the other edit functions. They are generic, not plan-specific: any host with `nest` needs them.
- **`repairRow(doc, row): TextEdit[]`.** Returns the `auto`-tier repairs for a row (`repairs` returns them labelled by kind, so a host can offer each on the error it resolves): rewriting cells from their recovered text, quoting a heading-like lead, and snapping the indent to the recovered level. It is idempotent: `repairRow` on its own output returns no edits.
- **`levelIndent`** is the indent a row inserted there would take at a level, by the rule in plan spec §4b.6.4, or `null` when that level isn't open there or the document has no `nest`. Hosts pass it to `insertRow`.
- Every edit function is tested by the same property: for random documents and random edits, parsing the edited text gives the intended value in the target, every other row, cell, marker, anchor and comment is unchanged, and the text has no syntax or structural error it didn't have before (counted by code).
- An edit that has nothing to change returns `{ edits: [] }`. An edit that can't be made without breaking the rules above returns `{ refused }` with the reason, and the host leaves the text as it is.

Details the rules above leave open:

- **Edits don't validate.** A value that fails validation is written, and reads back as exactly the text given. `formatValue` quotes a value when base §3 requires it, and a lead when it would otherwise read as a marker, an anchor, a heading, a comment or a `---` delimiter (base §7: "quotes any value that would otherwise be misread").
- **Implicit columns** are only ever written as named cells.
- **`setCell` on the lead** is `setLead`, with `null` written as the empty string: a row always has a lead cell.
- **Appending after an unterminated quote** first closes the quote where its text ends, so that cell's text is unchanged and the new cell isn't swallowed by it.
- **Removing a named cell** empties it (`NAME=`) instead, when an overflow cell follows it: removing it would make an unnamed overflow cell positional, or a later repeat of the same column its value. The emptied cell is written with nothing between the `=` and the next delimiter (`b=| x`), since whitespace after the `=` would unname it (base §3).
- **A row keeps its line.** Removing the last cell of a row that begins with a delimiter leaves the delimiter (`|`), so the row doesn't turn into a blank line; the row already began with the delimiter. Removing the only marker before an empty lead writes the lead as `""`: `~` becomes `""` and `~ | 1d` becomes `"" | 1d`, since a row that begins with the delimiter is a structural error.
- **`insertRow`** writes the declared columns positionally while they run on from the lead, and the rest by name. A column that can't be named is written in position, with empty cells before it. A name in `cells` that isn't a column throws, since that's a mistake in the host.
- **`setMarker`** with a name that is neither a marker nor a column throws, for the same reason.
- **Levels** are depths in the indentation tree of ext §6.2 (the parser's `indentLevels`), not the parent column. A level is open at a position when it is at most one deeper than the row above. Its indent is the one its siblings there already use, or the parent's indent plus the file's usual step: the most common difference between a row's indent and its parent's, or 4 when there is none.
- **`setLevel`** moves the row's descendants with it, by the same number of spaces, so they stay its descendants (MS Project's indent and outdent). Rows after them keep their indent, so outdenting a row can make its later siblings its children.
- **`moveRow`** moves the row with its subtree past its previous or next sibling's subtree. Siblings and subtrees are those of the indentation tree; without `nest`, every row is a sibling with no subtree, so the row swaps with the row before or after it. Non-row lines between the two subtrees stay where they are, and those inside a subtree move with it. Each subtree takes the indent the other's first row had, its descendants shifted by the same amount. Siblings share an indent unless a recovery put one at a bad indent, and then this keeps every row's parent and every error as it was, so a move never adds an indent error and never needs to refuse for one. The moved subtree's text stays where it is in the buffer, so positions in it map through the move.
- **`deleteRow`** removes the line together with the line break after it (the last line takes the one before it only when there is none). Each child of the row takes the row's indent, and the child's subtree moves with it.
- **`repairRow`** rewrites a cell only when a syntax error (`unterminated-quote`, `text-after-quote`, `unknown-escape`) falls inside it. It writes the cell's recovered text through `formatValue`, so it quotes only when needed. The indent is snapped to the level the parser recovered: the indent of the recovered parent's other children there, or 0 for a row with no recovered parent. The rows after it that the recovery put at its level or below move by the same amount, so the tree is unchanged. If the snapped indents would change any row's parent or still leave the row at no level, there is no indent repair.
- **Nothing makes a row the first line if it reads as a `---` delimiter** in a file without frontmatter, since that would open a frontmatter block.
- **`applyEdits(text, edits)`** applies a function's edits, for hosts without an editor of their own.

Edit functions throw on host mistakes, such as an unknown column or marker name, and refuse on document states.

The only refusals:

- **`setCell` on the key of a row whose ID is in an anchor**, set to `null` or to text that isn't an ID. A valid ID renames the anchor, and the key cell too if it is written, so no anchor/key mismatch (ext §3.2) is created. References to the old ID are not rewritten (`renameId` is deferred, plan spec §7). A value the anchor can't hold would have to move the ID out of the anchor, or remove the anchor and so the row's ID, and neither is what a cell edit asks for. Hosts change such an ID by editing the text.
- **`setCell` on a column that can't be named** (base §6: a name that doesn't match the grammar or is already used), when the row doesn't set it, it isn't the next positional slot, and the row has a named or overflow cell, so padding up to it would put unnamed cells after them. `setMarker` refuses in the same case for a column without a marker, and so does a marker change whose contradicting cell can't be corrected.
- **`insertRow` at an indent that nesting doesn't allow there** (ext §6.2), when `nest` is set: the new row's indent matches no open level, or it leaves a later row's indent matching none. Either would be a structural error. The check is the parser's own indent walk (`indentLevels`), run over the row indents with the new one inserted.
- **`setLevel`** without `nest`, at a level that isn't open there, or when moving the subtree would leave a row at an indent that matches no level.
- **`moveRow`** when the row has no previous or next sibling on that side. Moving across levels is `setLevel`'s job.
- **`deleteRow`** when promoting the descendants would leave a row at an indent that matches no level, or when the row holds the last anchor in a file whose identity comes only from anchors (ext §3.1) while another row sets the implicit key by name: without identity that cell would name no column.
- **`setLevel`, `moveRow` and `deleteRow`** when the new first line would read as a `---` delimiter in a file without frontmatter.

## 7. Highlighting

`tokenizeLine` returns token spans: indent, marker, lead, anchor, delimiter, cell name, `=`, quoted value, escape, plain value, and comment. In frontmatter it returns the key, the colon and the value; a qualified key is one key token. An unquoted `markers:` or `roles:` value is split into its entries instead, each as name, `=` and value, like a named cell, with `schema.roles` spans matching them. It also returns a frontmatter-state transition, so a line-at-a-time highlighter (CodeMirror's `StreamLanguage`) can carry state across lines. Value types come from the schema, which the tokenizer doesn't need. A highlighter that wants per-type colours (durations, signs) reads the columns from the latest parsed document. It resolves cells with the parser's rules, because tokens are syntactic: a `name` token whose name no settable column has is read by the parser as part of an unnamed cell (base §6), and an unnamed cell after a named one, or past the declared columns, is overflow with no type. The tokenizer can't know that a frontmatter block is never closed, so carried on its own it shows such a file as frontmatter to the end. A highlighter with a parsed document takes the frontmatter extent from the document's lines instead.

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
