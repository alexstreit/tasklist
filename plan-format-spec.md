# Plan File — Specification

A text-driven project estimating tool. The plan is a plain text file; the app is one or more editors over that file plus one or more read-only renderers and exporters of it.

## 1. Principles

- **Text is canonical.** The file is the data model. Everything else is derived from it and nothing writes to it except through text edits.
- **Indentation is the tree.** No bullets, no brackets.
- **Terse by default, tunable by front matter.** A file with no header must work with sane defaults.
- **One write path.** Every editor (the text editor, the grid editor) produces text edits against the same buffer. Only one editor is active at a time.
- **Compute once, render many.** Roll-ups are calculated in one pass and attached to the tree; renderers and exporters only read.

## 2. File format

### 2.1 Encoding and whitespace

- UTF-8, LF line endings (CRLF normalised on load).
- Indentation is **spaces only**. Tabs are converted to 4 spaces on load and on paste.
- Trailing whitespace is ignored. Blank lines are ignored and preserved.

### 2.2 Line types

Each line is exactly one of:

| Line                   | Recognised by                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Front matter delimiter | `---` alone on a line, only at the very top of the file                            |
| Front matter content   | Any line between the two delimiters (or to end of file if unclosed)                |
| Blank                  | Only whitespace                                                                    |
| Comment                | First non-space character sequence is `//`                                         |
| Comment (markdown)     | Line starts with `<!--` and ends with `-->`                                        |
| Reserved               | First non-space character is `#` — raises a warning (reserved for future headings) |
| Item                   | Anything else                                                                      |

### 2.3 Item grammar

```
item     := indent [ "~" ] title { "|" field }
indent   := " "*
title    := text without "|"
field    := text without "|"   (leading/trailing whitespace trimmed)
```

- `~` immediately after the indent marks the item **done**. Whitespace between `~` and the title is allowed.
- Fields are **positional** and map to the columns declared in the front matter, in order. The title is column 0 and is implicit.
- A missing field is empty. A single trailing `|` is permitted and produces nothing; interior empty fields are kept.
- More fields than declared columns → warning; the extra fields are ignored.
- `|` cannot appear in a title or field (no escaping yet).

### 2.4 Hierarchy

The parent of an item is the nearest preceding item with a strictly smaller indent. "Any deeper is a child" — the exact number of spaces doesn't matter.

```
A               (indent 0)
        B       (indent 8, child of A)
    C           (indent 4, child of A — sibling of B, not its child)
```

The third case is legal and raises no diagnostic.

### 2.5 Front matter

Optional. Must begin on line 1 with `---` and end with the next `---`. Contents are simple `key: value` lines. The only key currently is `columns`.

```
---
columns: est:duration | owner:text | notes:text
---
```

Each column is `name:type`. Names must be unique and contain no `|` or `:`.

**Default when absent or when `columns` is not given:**

```
columns: est:duration | owner:text | notes:text
```

Unknown keys raise a warning and are ignored, so future keys (`calendar`, `unit`, roles) degrade gracefully in older builds.

If the opening `---` is never closed, the rest of the file is treated as front matter and a single warning is raised on line 1. Per-line unknown-key warnings are suppressed in that case.

### 2.6 Column types

| Type       | Parses                                                    | Roll-up | Display                                |
| ---------- | --------------------------------------------------------- | ------- | -------------------------------------- |
| `duration` | see below                                                 | sum     | mixed units, largest first: `1w 2d 4h` |
| `number`   | non-negative decimal number, optionally prefixed with `+` | sum     | as entered                             |
| `text`     | anything                                                  | none    | as entered                             |

**Duration grammar.** A `duration` is one or more terms, each a number followed by a unit (`h`, `d`, `w`), with optional whitespace between number and unit and between terms. Each unit may appear at most once, in any order. A value consisting of a single bare number is hours. A bare number anywhere in a multi-term value is an error, since `4 2d` is too easily misread as `4h 2d`. A leading `+` applies to the whole value.

| Valid                       | Hours       | Invalid                    | Reason                  |
| --------------------------- | ----------- | -------------------------- | ----------------------- |
| `4`                         | 4           | `4 2d`, `2d 4`, `2 d 4`    | bare number in compound |
| `4h`, `4 h`                 | 4           | `2d 2d`                    | repeated unit           |
| `2d 4h`, `4h 2d`, `2 d 4 h` | 20          | `2dh`, `d 2`, `4x`, `1..5` | unparseable             |
| `1w 2d 4h`                  | 60          |                            |                         |
| `+2d 4h`                    | additive 20 |                            |                         |
| `1.5d 4h`                   | 16          |                            |                         |

Units are fixed: `1d = 8h`, `1w = 5d = 40h`. Internally every duration is stored in hours.

An invalid value in a `duration` or `number` field raises a warning (with the specific message where one exists) and is treated as empty.

### 2.7 Roll-up semantics

For each node and each summable column, compute an **effective value**:

```
childSum = sum(effective value of each child)          // 0 if no children

if field is empty:          effective = childSum
elif field starts with "+": effective = childSum + value   // additive
else:                       effective = value              // override
```

Attach to the node, per summable column:

- `effective` — the number renderers display
- `childSum` — what the children add up to
- `mode` — `derived` | `override` | `additive`
- `childrenHaveValue` — true when any child has `hasValue`
- `hasValue` — true when the node's own field parses to a value, or `childrenHaveValue` is true. An unparseable field counts as empty.
- if `mode == override` and `childrenHaveValue` and `value != childSum` → informational diagnostic "override differs from children (X vs Y)"

A parent with an estimate whose children have no estimates raises no diagnostic — that is the normal "estimate first, decompose later" workflow.

Leaves with `+` behave as `0 + value`, i.e. the same as an override. No diagnostic.

### 2.8 Done

- A node is **done** if it has the `~` prefix or any ancestor does. Children of a done parent are implicitly done.
- No status roll-up: a parent with all children done is **not** automatically done.
- Per node and per summable column, compute `doneSum`:

```
if node is done:  doneSum = effective
else:             doneSum = sum(doneSum of children)
```

`doneSum` may exceed `effective` when an override is smaller than the children's sum. This is reported as-is; the override diagnostic already flags the disagreement.

### 2.9 Diagnostics

All diagnostics carry a line number, a severity, a message, and optionally a span. Severities: `warning`, `info`.

| Condition                                                                         | Severity                           |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| Tabs converted on load                                                            | info (see note)                    |
| Line starts with `#`                                                              | warning                            |
| More fields than columns                                                          | warning                            |
| Unparseable duration/number                                                       | warning                            |
| Bare number in compound duration (`bare number not allowed in compound duration`) | warning                            |
| Unknown front matter key (suppressed when front matter is unclosed)               | warning                            |
| Unknown column type                                                               | warning (column treated as `text`) |
| Duplicate column name                                                             | warning                            |
| Front matter opened but not closed (line 1, span on the opening `---`)            | warning                            |
| Override differs from child sum (only when `childrenHaveValue`)                   | info                               |

Note: the editors convert tabs before text reaches the buffer (on paste and on file open), so the tab diagnostic is reachable from `parse` and tests but not normally from the UI. This is by design.

### 2.10 Example

```
---
columns: est:duration | owner:text | notes:text
---
// Q4 auth work. Estimates are rough.
Auth                        | 2d
    ~Login page             | 4h  | alice
    Password reset          | 6h  | alice
    OAuth (Google)          | +1d |       | may not need for v1
        Consent screen      | 2h
        Token refresh       | 3h
Admin                       |     | bob
    User list               | 1d
    // Audit log            | 2d     <- dropped for now
```

Computed:

| #     | Node           | effective   | childSum    | mode                     | doneSum |
| ----- | -------------- | ----------- | ----------- | ------------------------ | ------- |
| 1     | Auth           | 2d (16h)    | 2d 7h (23h) | override (info: differs) | 4h      |
| 1.1   | Login page     | 4h          | —           | override                 | 4h      |
| 1.2   | Password reset | 6h          | —           | override                 | 0       |
| 1.3   | OAuth (Google) | 1d 5h (13h) | 5h          | additive                 | 0       |
| 1.3.1 | Consent screen | 2h          | —           | override                 | 0       |
| 1.3.2 | Token refresh  | 3h          | —           | override                 | 0       |
| 2     | Admin          | 1d          | 1d          | derived                  | 0       |
| 2.1   | User list      | 1d          | —           | override                 | 0       |
|       | **Document**   | **3d**      |             |                          | **4h**  |

The fixture lives at `examples/example.plan` and is shared by tests and the app.

## 3. Architecture

```
            ┌──────────── PlanBuffer (one per document) ────────────┐
            │                                                        │
 editors ───┤ apply(edits) / undo / redo            onChange ────────┼──► analyze ──► model ──► renderer(s)
 text, grid │                                                        │    (parse →            tree, table
            └────────────────────────────────────────────────────────┘     parseColumns →      (future: gantt)
                                                                            compute)        ──► exporter(s)
                                                                                                TSV
```

### 3.1 Parse

`parse(text) → Tree`. Pure function. Every node records the line it came from and the character span of each field (absolute offsets into the normalised text), so that:

- the preview can highlight the node under the cursor,
- diagnostics point at the right column,
- the grid editor can turn "change this cell" into a precise text replacement without touching anything else on the line.

Comments, blank lines, reserved lines and front matter are retained as non-item nodes so the tree is a lossless representation of the file.

Each item node carries `outlineNumber: string` (`1`, `1.2`, `2.1.5`). Only item nodes are counted; other line types consume no numbers. Outline numbers are structural references and shift when lines are inserted above; they are not stable IDs.

### 3.2 Compute

`compute(tree, columns) → Model`. Pure function. Walks the tree bottom-up and attaches `effective`, `childSum`, `mode`, `hasValue`, `childrenHaveValue`, `done`, `doneSum` and diagnostics to each node, plus document totals. No renderer or exporter performs arithmetic.

`analyze(text) → Model` composes `parse`, `parseColumns` and `compute` and is the single entry point the app shell and any tooling call. Nothing outside `src/core/` imports `parse` or `compute` directly (lint-enforced).

`src/core/` has no imports outside itself and the standard library (lint-enforced).

### 3.3 Renderers

```ts
interface Renderer {
  id: string;
  label: string;
  requires: ColumnRequirement[]; // empty for tree and table
  render(model: Model, host: HTMLElement, ctx: RenderContext): void;
}
```

`requires` lets the app grey out a renderer whose needs aren't met ("add a `date` column to enable Gantt") instead of rendering nonsense; an unsatisfied renderer is never called.

`RenderContext` carries the current cursor line, whether the last cursor change originated in the preview (so the preview doesn't scroll under a click), and `setCursorLine(line)` for click-to-line. It is renderer-agnostic.

### 3.4 Editors

Exactly one editor is active at a time. Every editor writes to the shared `PlanBuffer` (§3.7); switching editors unmounts one and mounts the other over the same buffer. There is no editor-owned model that serialises back to text.

### 3.5 Multi-user (future, stated now so nothing blocks it)

The shared thing is the text buffer, not the model. A CRDT over the text (e.g. Yjs, via `y-codemirror.next`) gives collaboration without the sync layer knowing anything about the format. Each client parses and computes locally. Under collaboration, undo is replaced by a per-user undo manager behind `PlanBuffer.undo()`.

### 3.6 Exporters

```ts
interface Exporter {
  id: string;
  label: string; // e.g. "Copy for Excel"
  export(model: Model): { mime: string; data: string };
}
```

Exporters live in `src/exporters/`, are registered in the app shell exactly like renderers, and appear as buttons on the preview toolbar. Failures (clipboard permission, framed contexts) are shown visibly.

**TSV exporter ("Copy for Excel").** Tab-separated text, one header row then one row per item in document order:

- `#` — outline number prefixed with `'` so spreadsheets keep it as text (otherwise `1.10` pastes as the number 1.1)
- `level` — 1-based depth
- `title`
- each declared column: summable cells emit `effective` as a plain decimal number of hours (duration headers read `name (h)`), empty when `hasValue` is false; text cells emit the text as entered, with any tab or newline replaced by a space
- `done` — `TRUE` / `FALSE`

No totals row: it breaks sorting and filtering, and `=SUM()` is one keystroke.

### 3.7 PlanBuffer

The app owns exactly one document buffer. Editors never hold their own copy of the text.

```ts
interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

interface BufferChange {
  text: string; // document after the change
  edits: TextEdit[]; // what changed, in original coordinates
  mapPos(pos: number): number; // position before → position after
  origin: string; // "text-editor" | "grid" | "undo" | "redo" | "load" | future: "remote"
}

interface PlanBuffer {
  text(): string;
  apply(edits: TextEdit[], origin: string): void;
  undo(): void;
  redo(): void;
  onChange(listener: (c: BufferChange) => void): () => void; // returns unsubscribe
}
```

- `CodeMirrorBuffer` is the production implementation. It wraps a CodeMirror `EditorState` and is the **only** module outside `src/editor/` that imports from CodeMirror. `EditorState`, `Transaction` and `ChangeSet` never appear in its public types.
- `InMemoryBuffer` is a test implementation with a simple undo stack. Both pass one shared test suite.
- An edit with origin `load` replaces the whole document and clears the undo history: the recorded edits no longer describe the new text.
- The text editor mounts its `EditorView` on the state owned by `CodeMirrorBuffer`; its edits arrive at the buffer like any other, with origin `text-editor`.
- Undo and redo are buffer operations. No editor calls CodeMirror's history commands directly.
- The buffer knows characters only. Lines, nodes and columns are `analyze()`'s business.

### 3.8 Line operations

Structural edits are pure functions in `src/editing/`:

```ts
type LineRange = { fromLine: number; toLine: number }; // 1-based, inclusive
function indent(text: string, r: LineRange): TextEdit[];
// likewise: outdent, moveUp, moveDown, insertLineAbove, deleteLines, toggleComment
```

Both the text editor keymap and the grid call them; neither reimplements them. The text editor derives the range from its selection; the grid from its selected row.

## 4. Text editor (CodeMirror 6)

### 4.1 Language mode

Highlighting for: done lines (dimmed, including implicitly done descendants), comment lines, the `~` prefix, column separators, duration values, `+` prefix, front matter block.

### 4.2 Folding

Indent-based folding on items that have child items. Indented comment lines following a parent fold with it.

### 4.3 Keymap

| Keys                  | Action                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Alt+Up` / `Alt+Down` | Move the current line, or all lines touched by the selection, up/down                                                             |
| `Tab` / `Shift+Tab`   | Indent / outdent current line or selection by 4 spaces                                                                            |
| `Ctrl+/`              | Toggle `// ` on current line or selection                                                                                         |
| `Ctrl+Shift+Up`       | Extend selection to the enclosing subtree (bound literally to Ctrl on every platform, so Cmd+Shift+Up on macOS keeps its meaning) |
| `Ctrl+Z` / `Ctrl+Y`   | Buffer undo / redo                                                                                                                |
| `Ctrl+S`              | Save                                                                                                                              |
| `Escape` then `Tab`   | Leave the editor (CodeMirror's built-in accessibility escape)                                                                     |

`Alt+Left/Right` is **not** bound on Windows or Linux (browser back/forward). macOS keeps its native Alt word-jump.

### 4.4 Diagnostics

Via `@codemirror/lint`, fed from the model produced by the shell's single `analyze()` call (no second analysis). Diagnostics with a span underline only that span; span-less diagnostics get a gutter marker only. Hover shows the model's message verbatim. The reserved `#` warning comes through this path, not the tokenizer.

## 4b. Grid editor

A second editor over the same `PlanBuffer`: a task sheet in the style of MS Project, one row per line, roll-ups shown inline. When the grid is active the text editor is unmounted, and vice versa. The preview pane is unaffected by which editor is active. The grid never imports CodeMirror.

### 4b.1 Rows

- One row per **item** line. Columns, left to right: WBS (outline number, read-only, doubles as the row selector), done (checkbox), title, then each declared column in order.
- Comment and blank lines render as greyed full-width rows showing the raw line text. They are editable as raw text and can be selected, deleted and moved like any row. They have no WBS number.
- Front matter renders as a single collapsed greyed row at the top, read-only.
- A read-only **total** row at the bottom shows document `effective` and `doneSum` per summable column.
- Below the total row is one blank **new task** row. Typing into it inserts a new item line at the end of the document at the indent of the last item line (or indent 0 if none).

### 4b.2 Cells

- **Title** edits replace the title span.
- **Done** checkbox inserts or removes the `~` marker. A child of a done parent shows a checked, disabled checkbox.
- **Summable cells** display the formatted `effective` (empty when `hasValue` is false; muted when `mode` is `derived`). Editing shows the **raw field text** from the file, spreadsheet-formula style. Committing a non-empty value on a parent creates an override; committing an empty value on a parent restores derived. An additive value (`+…`) is shown with a marker and is read-only.
- **Text cells** display and edit the raw field text.
- Committing to a column whose field does not yet exist on the line pads the line with empty fields so the value lands in the right position. Trailing empty fields created this way are trimmed when the committed value is itself empty.
- A cell with a diagnostic has a coloured outline (warning or info) and shows the message on hover. A span-less diagnostic is shown on the row's WBS cell.

### 4b.3 Selection and focus

- Exactly one of: a focused cell (navigation), an editing cell (input open), or a selected row (structural operations). Clicking a WBS cell selects the row; clicking any other cell focuses it.
- One selected row at a time.
- After every buffer change the grid rebuilds and restores focus to the same line and column, using `mapPos` when the change moved lines.

### 4b.4 Keys

MS Project conventions; where Project has no default, the text editor's binding is used.

| Key                     | Focused cell                                                                              | Editing cell                                   | Selected row                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Enter                   | move down one row (from the last item row: to the new-task row)                           | commit, then move down                         | —                                                                 |
| Tab / Shift+Tab         | next / previous cell (wraps across rows)                                                  | commit, then next / previous cell              | —                                                                 |
| F2 or any printable key | start editing (printable key replaces the content; F2 keeps it, caret at end)             | —                                              | —                                                                 |
| Escape                  | —                                                                                         | cancel edit, restore display, buffer untouched | clear selection                                                   |
| Delete                  | clear cell (commit empty)                                                                 | —                                              | delete the row's line; children re-attach upward, as in text mode |
| Insert                  | insert a blank item row **above** at the current row's indent and start editing its title | —                                              | same                                                              |
| Alt+Shift+Right / Left  | indent / outdent the row                                                                  | —                                              | same                                                              |
| Alt+Up / Alt+Down       | move the row's line up / down                                                             | —                                              | same                                                              |
| Space                   | toggle done when the focused cell is the checkbox                                         | —                                              | —                                                                 |
| Ctrl+Z / Ctrl+Y         | buffer undo / redo                                                                        | Ctrl+Z cancels the edit                        | same as focused                                                   |
| Arrow keys              | move focus                                                                                | —                                              | move selection                                                    |

Insert-above is deliberate: inserting directly **below** a parent at the parent's indent would capture the parent's children; inserting above never does.

### 4b.5 Toolbar

Buttons for Insert row, Delete row, Indent, Outdent, Move up, Move down, Toggle done. Each mirrors a key above and is enabled only when it applies. The editor toggle (Text / Grid) is in the app toolbar.

## 5. Preview

### 5.1 Tree renderer

- One row per item, comments and blank lines omitted. Nesting shown by title indentation.
- Columns: `#` (outline number, muted, not selectable), title, then each declared column. Text cells as entered.
- Summable cells show `effective`, or an empty cell when `hasValue` is false. When `childrenHaveValue` is true **and** `mode` is `override` or `additive`, the computed `childSum` is shown alongside in a muted style, e.g. `2d ⟨Σ 2d 7h⟩`. Derived parents and leaves never show it.
- Done rows are struck through and dimmed.
- A total row shows document `effective`, with `doneSum` muted alongside, per summable column.
- The row for the item on the editor's cursor line is highlighted, and the highlight wins over done styling. When the cursor is on a comment or blank line, the nearest item at or before it gets a distinct, softer "near" highlight.
- When the highlighted row changes because of an editor cursor move, it is scrolled into view with `block: 'nearest'`. It is not scrolled when the change came from a click in the preview. No proportional scroll-linking.
- Clicking a row moves the editor cursor to that line and focuses the editor.
- Updates on every buffer change (debounced ~50 ms).

### 5.2 Table renderer

Same data as the tree, flat: `#`, `level`, title, declared columns. Same cell, highlight and click rules via `RenderContext`. Tree and table share a row builder in `src/renderers/shared/`.

### 5.3 Theming

All colours are CSS custom properties defined in `src/app/theme.css` on `:root`, with a complete dark set under `prefers-color-scheme: dark`, plus `color-scheme: light dark`. CodeMirror's chrome and lint decorations read the same tokens, and its dark flag follows the media query live. A test fails on any hex or `rgb(` literal outside the theme file and on any light token without a dark counterpart. No manual toggle yet.

## 6. Persistence and deployment

- Single user, files on disk. Open/save via the File System Access API where available, falling back to file input and download.
- Save writes the buffer as-is. Nothing re-serialises from the tree. A saved file is byte-identical to the opened one except for tab-to-space and CRLF-to-LF normalisation.
- In contexts where the API is unavailable or blocked (e.g. a cross-origin iframe such as the VS Code Simple Browser), failures are reported visibly, never swallowed.
- Deployed as a static build to GitHub Pages via GitHub Actions on push to the `deploy` branch (`git push origin main:deploy`). Vite `base` is `/tasklist/` under Actions and `/` locally.

## 7. Deferred

Listed so the syntax leaves room:

- Additional prefix markers (`?` uncertain, `!` blocked, `-` dropped)
- Estimate ranges / confidence, PERT roll-up
- Named fields (`est=4h`) alongside positional
- Markdown headings (`#`) as un-indented parents
- Status roll-up (all children done ⇒ parent done)
- Custom units and calendar in front matter (`unit:`, `calendar:`)
- Column **roles** (`start:date(role=start)`) for renderers such as Gantt
- Additional roll-up types: `max`, `count`, `done%`, `remaining`
- Negative additive values
- `\|` escaping
- Renderers: Gantt; exports to Excel files, Word, HTML, MS Project
- Manual light/dark toggle
- Multi-user via text CRDT
- Desktop packaging (Electron)
- **Grid v2:** multi-row selection and bulk operations; subtree move and subtree delete; add / rename / remove / reorder columns from the header (writes `columns:`); paste TSV rows from a spreadsheet; drag-to-reorder; persisted column widths; editing additive values; front matter editing; full `role="grid"` accessibility
- Rich-text decoration layer for the text editor (proportional font, rendered checkbox, aligned columns)

## 8. Build order

See `TASKS.md`.
