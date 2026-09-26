# Plan File — Specification

**Depends on:** rows 0.8, rows extensions 0.6, Text Anchors 0.2.

A text-driven project estimating tool. The plan is a plain text file; the app is one or more editors over that file plus one or more read-only renderers and exporters of it.

## 1. Principles

- **Text is canonical.** The file is the data model. Everything else is derived from it and nothing writes to it except through text edits.
- **A plan is a rows file.** The generic format is rows; this spec adds the plan profile and roll-ups. Plan behaviour that belongs in rows goes into rows.
- **Indentation is the tree.** No bullets, no brackets.
- **Terse by default, tunable by front matter.** The plan profile supplies sane defaults; a file can override any of them.
- **One write path.** Every editor (the text editor, the grid editor) produces text edits against the same buffer. Only one editor is active at a time.
- **Compute once, render many.** Roll-ups are calculated in one pass and attached to the tree; renderers and exporters only read.

## 2. File format

A plan file is a **rows** file (base 0.8 and extensions 0.6, in `packages/rows/spec/`) read in tolerant mode with the **plan profile**. This section covers only what the plan adds. Everything else, including tokenising, quoting, named cells, errors and recovery, comes from the rows specs and the `rows` library.

### 2.1 The plan profile

`profile: plan` names the profile published as `profiles/plan.rows`:

```
---
lead: title:text
nest: parent
markers: done=~
columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text
---
```

- A file with no `profile:` key uses the plan profile when its name ends in `.plan`, or when it has no name yet (a new, unsaved document). Other files are read as plain rows files.
- The tool writes `profile: plan` into the frontmatter of every file it creates, so the file says what it is even if it is renamed.
- Exports, and later canonical form, write the resolved keys out in full.
- A file may override any key the profile sets. A file's own `columns:` replaces the whole column list, including options, so a duration column declared there needs its own `unit=h hpd=8 dpw=5` (§2.6).

### 2.2 Normalisation

UTF-8, with any BOM stripped and CRLF turned into LF. Tabs in indentation become 4 spaces on load and on paste, before the text reaches the buffer. Rows would otherwise count each tab as one space.

### 2.3 Lines

Every line is frontmatter, blank, a comment (`//`) or a row (rows base §1, §3). A row with errors is still a row. HTML comments are no longer comments: a line beginning `<!--` is a row, with an info diagnostic and a fix that turns it into `//`.

### 2.4 Items and hierarchy

Every row is an **item**. Its title is the lead value, with markers and anchors removed. The hierarchy is rows nesting (extensions §6): indent levels are relative, the rules are strict, and recovery is tolerant.

```
A               (indent 0)
        B       (indent 8, child of A)
    C           (indent 4) structural error; recovered as child of A, sibling of B
```

The recovered tree is the one the plan tool always built. The only change is that the case is now reported. A row may also give its parent by name (`parent=#id`), which needs the parent to have an anchor.

### 2.5 Done

An item is done when its `done` marker (`~`) is present or `done=true` is set by name. Done is inherited as in §2.8.

### 2.6 Estimates

The summable columns are `duration` and `number` columns. Every other type, including text, bool, date, datetime, enum and ref, is shown as written and never summed.

- A duration converts to hours using its column's `hpd` and `dpw`, with minutes at 60. If a value has a term its column can't convert, such as `1d` without `hpd`, the value is treated as empty and gets a warning. The warning has a fix that adds `unit=h hpd=8 dpw=5` to the column declaration, leaving out any of those options the declaration already has. There is no fix when the declaration isn't in the file, as with a column from a path profile.
- A bare number is valid only when the column has `unit=` (the profile sets `unit=h`). Without it, the value is a rows validation error, and the same fix applies.
- A leading `+` makes the value **additive** (§2.7). A leading `-` isn't supported yet: the value is treated as empty, with a warning.
- `number` columns follow the same sign rules.

### 2.7 Roll-up semantics

For each node and each summable column, compute an **effective value**:

```
childSum = sum(effective value of each child)          // 0 if no children

if cell is empty:           effective = childSum
elif value has sign "+":    effective = childSum + value   // additive
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

### 2.8 Done inheritance and done sums

- A node is **done** if it is marked done (§2.5) or any ancestor is. Children of a done parent are implicitly done.
- No status roll-up: a parent with all children done is **not** automatically done.
- Per node and per summable column, compute `doneSum`:

```
if node is done:  doneSum = effective
else:             doneSum = sum(doneSum of children)
```

`doneSum` may exceed `effective` when an override is smaller than the children's sum. This is reported as-is; the override diagnostic already flags the disagreement.

### 2.9 Diagnostics

Every diagnostic carries a line, a severity, a code, a message, a span where one exists, and optional **fixes**, each a label plus `TextEdit[]`. A rows error keeps its rows code and message; the plan's own diagnostics have the codes below.

| Source                                                                                      | Severity | Code                                        |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| rows syntax or structural error (e.g. unterminated quote, overflow cells, bad indent level) | error    | the rows code                               |
| rows validation error (e.g. `4 hours` in a duration column, a dangling `#ref`)              | warning  | the rows code                               |
| Duration term the column can't convert, or a negative value (§2.6)                          | warning  | `unconvertible-duration`, `negative-value`  |
| Unknown frontmatter key that is not rows base, a rows extension key, or `x-`                | info     | `unknown-key`                               |
| Line beginning `<!--` (§2.3)                                                                | info     | `html-comment`                              |
| Tabs converted on load                                                                      | info     | `tabs-converted`                            |
| Override differs from child sum (only when `childrenHaveValue`)                             | info     | `override-differs`                          |

Rows ignores unknown keys silently. The plan tool reports them as info, because in a hand-edited file an unknown key is usually a typo, such as `colums:`.

### 2.10 Example

```
---
profile: plan
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

The fixture lives at `examples/example.plan` and is shared by tests and the app. It is also a rows conformance case.

## 3. Architecture

```
            ┌──────────── PlanBuffer (one per document) ────────────┐
            │                                                        │
 editors ───┤ apply(edits) / undo / redo            onChange ────────┼──► analyze ──► model ──► renderer(s)
 text, grid │                                                        │    (parseRows →        tree, table
            └────────────────────────────────────────────────────────┘     readPlan →          (future: gantt)
                                                                            compute)        ──► exporter(s)
   edits come from src/editing (line ops) and the rows edit API (cells)                         TSV
```

### 3.1 Read

`parseRows(text, { profiles: { plan }, defaultProfile })` from the `rows` library (§3.9) returns a lossless `RowsDocument`: every line classified, every row with its indent, markers, anchors, cells and overflow, all as spans into the text, plus the parent relation and every error.

`readPlan(doc) → Tree` is the plan layer. It turns rows into items and reads summable cells as hours (§2.6), carrying the rows spans through unchanged (each item keeps its rows `Row`), so that:

- the preview can highlight the node under the cursor,
- diagnostics point at the right column,
- the grid can ask the rows edit API for a precise replacement.

The tree's columns are the declared columns in order. Implicit columns (`parent`, `done`, and `id` when identity is on) are not columns of the tree; `done` is read into each item's done flag (§2.5).

Each item carries `outlineNumber: string` (`1`, `1.2`, `2.1.5`), computed from the rows parent relation. Only rows are counted. Outline numbers are structural references and shift when lines are inserted above them. They are not stable IDs; anchors are.

### 3.2 Compute

`compute(tree, columns) → Model`. Pure function. Walks the tree bottom-up and attaches `effective`, `childSum`, `mode`, `hasValue`, `childrenHaveValue`, `done`, `doneSum` and diagnostics to each node, plus document totals. No renderer or exporter performs arithmetic.

The model also carries `lines`: every line of the file in order, exactly as rows classified it — frontmatter, blank, comment or item. As in rows, the empty text after a final newline is not a line. The model is lossless for the same reason the tree is — an editor that shows the file has to show its comment, blank and front matter lines, and must not classify them a second time for itself. Renderers read `roots` and ignore it.

`analyze(text, filename?) → Model` composes `parseRows`, `readPlan` and `compute` and is the single entry point the app shell and any tooling call. The shell passes the current file name, or none for a new document (§2.1). A tab that reaches `analyze` despite §2.2 is converted to 4 spaces there too, with the info in §2.9, so the spans then index the converted text. Nothing outside `src/core/` imports the rows parser, `readPlan` or `compute` directly (lint-enforced).

`src/core/` imports nothing outside itself, the standard library and the `rows` package (lint-enforced).

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

```ts
interface PlanEditor {
  update(model: Model): void; // a fresh model for the buffer's current text
  setCursorLine(line: number): void;
  destroy(): void;
}
```

The shell mounts one editor, hands it every new model, and destroys it when the other is chosen. It holds the editors in a list, exactly as it holds renderers and exporters, and special-cases neither. Undo survives a switch because the history belongs to the buffer, not to the editor.

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

### 3.9 The rows library

`packages/rows/` is an npm workspace package with its specs in `spec/`, its design in `DESIGN.md`, and a language-neutral conformance suite in `conformance/`. It has zero runtime dependencies and imports nothing from the app. The app imports it only through its `index.ts`. It moves to its own repository once the specs reach 1.0.

What the plan tool uses:

- `parseRows` for reading (§3.1);
- `tokenizeLine` for highlighting (§4.1);
- `setLead`, `setCell`, `setMarker` and `insertRow` for every cell-level edit from the grid (§4b.2).

The line operations in `src/editing/` stay in the app. They work on whole lines and don't depend on the format, except `toggleComment`, which takes the comment marker from the document.

## 4. Text editor (CodeMirror 6)

### 4.1 Language mode

Tokens come from the rows library's `tokenizeLine`, the same tokenizer the parser uses. Highlighting covers: done lines (dimmed, including implicitly done descendants), comment lines, markers, anchors (`{#id}`), delimiters, cell names (`owner=`), quoted values and their escapes, duration values, the `+` sign, and the frontmatter block.

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

Via `@codemirror/lint`, fed from the model produced by the shell's single `analyze()` call (no second analysis). Severities `error`, `warning` and `info` map to the lint severities of the same names. Diagnostics with a span underline only that span; span-less diagnostics get a gutter marker only. Hover shows the model's message verbatim. A diagnostic's fixes appear as lint actions, and applying one dispatches its edits through the buffer with origin `text-editor`.

## 4b. Grid editor

A second editor over the same `PlanBuffer`: a task sheet in the style of MS Project, one row per line, roll-ups shown inline. When the grid is active the text editor is unmounted, and vice versa. The preview pane is unaffected by which editor is active. The grid never imports CodeMirror.

### 4b.1 Rows

- One row per **item** line. Columns, left to right: WBS (outline number, read-only, doubles as the row selector), done (checkbox), title, then each declared column in order.
- Comment and blank lines render as greyed rows: a WBS cell with no number, then one cell spanning the remaining columns and holding the raw line text, indentation included. They are editable as raw text — editing one into an item line, or an item line into a comment, is an ordinary text edit and the row changes kind on the next render — and they can be selected, deleted and moved like any row.
- Front matter renders as a single collapsed greyed row at the top, read-only.
- A read-only **total** row at the bottom shows document `effective` and `doneSum` per summable column.
- Below the total row is one blank **new task** row. Typing into it inserts a new item line at the end of the document at the indent of the last item line (or indent 0 if none).

### 4b.2 Cells

Every cell edit goes through the rows edit API (§3.9). The grid never builds row text itself.

- **Title** edits call `setLead`, which keeps the indent, markers and anchors, and quotes the title when it would otherwise read as a marker, an anchor or a heading.
- **Done** checkbox calls `setMarker(done)`. A child of a done parent shows a checked, disabled checkbox.
- **Summable cells** display the formatted `effective` (empty when `hasValue` is false; muted when `mode` is `derived`). Editing shows the **raw cell text** from the file, spreadsheet-formula style. Committing a non-empty value on a parent creates an override; committing an empty value on a parent restores derived. An additive value (`+…`) is shown with a marker and is read-only.
- **Text cells** display and edit the decoded text. A `|` or a leading `"` typed into a cell is quoted automatically.
- Writing a column that the row doesn't set yet follows `setCell`'s rules: append it positionally if it is the next slot, otherwise write it as a named cell (`notes=…`). The grid never pads with empty cells. Clearing a cell removes it, or empties it if later cells depend on its position.
- A cell with a diagnostic has a coloured outline (error, warning or info) and shows the message on hover. A diagnostic whose span falls in a cell marks that cell. One with no span, or on overflow cells, marks the row's WBS cell. Anything inside the frontmatter marks its collapsed row.
- Implicit columns (`parent`, and `id` when identity is on) are not shown in v1.

### 4b.3 Selection and focus

- Exactly one of: a focused cell (navigation), an editing cell (input open), or a selected row (structural operations). Clicking a WBS cell selects the row; clicking any other cell focuses it, and double-clicking it starts editing. From the keyboard, editing starts as in §4b.4.
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

Arrow keys move between cells within a row as well as between rows; left of the done checkbox is the WBS cell, so ArrowLeft from the first cell selects the row. Tab and Enter are deliberately unbound on a selected row, and that is the keyboard's way out of the grid: select a row, then Tab leaves for the next control on the page.

The grid holds a **roving tab stop**: exactly one cell — the current place, or the first row's WBS cell before there is one — carries `tabindex="0"` and every other cell carries `-1`, so the page's tab order enters the grid once and leaves once rather than walking every cell. Focusing that cell from the keyboard places the grid there. Checkboxes are not tabbable; their cell is, and Space toggles them. Full `role="grid"` accessibility is still deferred (§7).

An inserted row is a **draft**: it appears in the grid at the right position and indent, and the buffer gets one complete item line when its title is committed. Escape, or committing nothing, discards it and leaves the buffer untouched. Writing a blank line to the buffer first would not do: a line of only spaces is a blank line, not an item, so there would be no item row to type into.

### 4b.5 Toolbar

Buttons for Insert row, Delete row, Indent, Outdent, Move up, Move down, Toggle done. Each mirrors a key above and is enabled only when it applies: indent only when the row above is at the same or a greater indent (a row directly below its parent is already as deep as it can usefully go), outdent only on an indented row, move up and move down only when there is a line to swap with, toggle done only on a row whose `~` is its own. All of them are disabled when nothing is selected. The toolbar acts on the current row, whether it is selected by its WBS cell or holds the focused cell. The editor toggle (Text / Grid) is in the app toolbar.

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
- Open accepts `.plan` and `.rows`. Save As defaults to `.plan`. A new document starts as `---\nprofile: plan\n---\n`.
- Save writes the buffer as-is. Nothing re-serialises from the tree. A saved file is byte-identical to the opened one except for tab-to-space and CRLF-to-LF normalisation.
- In contexts where the API is unavailable or blocked (e.g. a cross-origin iframe such as the VS Code Simple Browser), failures are reported visibly, never swallowed.
- Deployed as a static build to GitHub Pages via GitHub Actions on push to the `deploy` branch (`git push origin main:deploy`). Vite `base` is `/tasklist/` under Actions and `/` locally.

## 7. Deferred

- Plan meanings for more markers, such as `?` uncertain, `!` blocked and `-` dropped. The syntax is already available through `markers:`.
- Estimate ranges / confidence, PERT roll-up
- Markdown headings (`# `) as un-indented parents. Rows reserves the form.
- Status roll-up (all children done ⇒ parent done)
- Column **roles** for renderers such as Gantt; dependencies from `deps:ref many qualifier=lag:duration`
- Additional roll-up types: `max`, `count`, `done%`, `remaining`
- Negative values and negative additive values
- Showing and editing anchors, IDs and `ref` columns in the grid
- `renameId`: rename an anchor and rewrite in-file references to it. Until then, `setCell` on an anchored key column renames the anchor only.
- rows `include` resolution (needs directory access in the browser), canonical form export, ID minting
- Renderers: Gantt; exports to Excel files, Word, HTML, MS Project
- Manual light/dark toggle
- Multi-user via text CRDT
- Desktop packaging (Electron)
- **Grid v2:** multi-row selection and bulk operations; subtree move and subtree delete; add / rename / remove / reorder columns from the header (writes `columns:`); paste TSV rows from a spreadsheet; drag-to-reorder; persisted column widths; editing additive values; front matter editing; full `role="grid"` accessibility
- Rich-text decoration layer for the text editor (proportional font, rendered checkbox, aligned columns)

## 8. Build order

See `TASKS.md`.
