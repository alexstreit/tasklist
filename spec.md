# Plan File — MVP Specification

A text-driven project estimating tool. The plan is a plain text file; the app is an editor for that file plus one or more read-only renderers of it.

## 1. Principles

- **Text is canonical.** The file is the data model. Everything else is derived from it and nothing else writes to it except through text edits.
- **Indentation is the tree.** No bullets, no brackets.
- **Terse by default, tunable by front matter.** A file with no header must work with sane defaults.
- **One write path.** Every editor — the text editor now, a grid later — produces text edits against the same buffer. Only one editor is active at a time.
- **Compute once, render many.** Roll-ups are calculated in one pass and attached to the tree; renderers only read.

## 2. File format

### 2.1 Encoding and whitespace

- UTF-8, LF line endings (CRLF normalised on load).
- Indentation is **spaces only**. Tabs are converted to 4 spaces on load and a diagnostic is raised.
- Trailing whitespace is ignored. Blank lines are ignored and preserved.

### 2.2 Line types

Each line is exactly one of:

| Line                   | Recognised by                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Front matter delimiter | `---` alone on a line, only at the very top of the file                            |
| Front matter content   | Any line between the two delimiters                                                |
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
- A missing field is empty. A trailing `|` is permitted and produces nothing.
- More fields than declared columns → warning; the extra fields are ignored.
- `|` cannot appear in a title or field in the MVP (no escaping).

### 2.4 Hierarchy

The parent of an item is the nearest preceding item with a strictly smaller indent. "Any deeper is a child" — the exact number of spaces doesn't matter.

```
A               (indent 0)
        B       (indent 8, child of A)
    C           (indent 4, child of A — sibling of B, not its child)
```

The third case is legal and raises no diagnostic.

### 2.5 Front matter

Optional. Must begin on line 1 with `---` and end with the next `---`. Contents are simple `key: value` lines. The only key in the MVP is `columns`.

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

### 2.6 Column types

| Type       | Parses                                                                                          | Roll-up | Display                                |
| ---------- | ----------------------------------------------------------------------------------------------- | ------- | -------------------------------------- |
| `duration` | `4`, `4h`, `2d`, `1.5w` — a number with optional unit `h`/`d`/`w`, optionally prefixed with `+` | sum     | mixed units, largest first: `1w 2d 4h` |
| `number`   | decimal number, optionally prefixed with `+`                                                    | sum     | as entered                             |
| `text`     | anything                                                                                        | none    | as entered                             |

Units are fixed in the MVP: bare number = hours, `1d = 8h`, `1w = 5d = 40h`. Internally every duration is stored in hours. Compound input (`2d 4h`) is deferred.

An unparseable value in a `duration` or `number` field raises a warning and is treated as empty.

### 2.7 Roll-up semantics

For each node and each summable column, compute an **effective value**:

```
childSum = sum(effective value of each child)          // 0 if no children

if field is empty:          effective = childSum
elif field starts with "+": effective = childSum + value   // additive
else:                       effective = value              // override
```

Attach to the node, per column:

- `effective` — the number renderers display
- `childSum` — what the children add up to
- `mode` — `derived` | `override` | `additive`
- if `mode == override` and children exist and `value != childSum` → informational diagnostic "override differs from children (X vs Y)"

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

All diagnostics carry a line number and a severity. MVP severities: `warning`, `info`.

| Condition                       | Severity                           |
| ------------------------------- | ---------------------------------- |
| Tabs converted on load          | info                               |
| Line starts with `#`            | warning                            |
| More fields than columns        | warning                            |
| Unparseable duration/number     | warning                            |
| Unknown front matter key        | warning                            |
| Unknown column type             | warning (column treated as `text`) |
| Override differs from child sum | info                               |

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

| Node           | effective   | childSum    | mode                     | doneSum |
| -------------- | ----------- | ----------- | ------------------------ | ------- |
| Auth           | 2d (16h)    | 2d 1h (17h) | override (info: differs) | 4h      |
| Login page     | 4h          | —           | override                 | 4h      |
| Password reset | 6h          | —           | override                 | 0       |
| OAuth (Google) | 1d 5h (13h) | 5h          | additive                 | 0       |
| Admin          | 1d          | 1d          | derived                  | 0       |
| **Document**   | **3d**      |             |                          | **4h**  |

## 3. Architecture

```
text ──► parse ──► tree ──► compute ──► model ──► renderer(s)
  ▲      (lossless, with source ranges)              tree view (MVP)
  │                                                  flat table, gantt, export (later)
  └── editors emit text edits: CodeMirror (MVP), grid editor (later)
```

### 3.1 Parse

`parse(text) → Tree`. Pure function. Every node records the line it came from and the character span of each field, so that:

- the preview can highlight the node under the cursor,
- diagnostics point at the right column,
- a future grid editor can turn "change this cell" into a precise text replacement without touching anything else on the line.

Comments and blank lines are retained as non-item nodes so the tree is a lossless representation of the file.

### 3.2 Compute

`compute(tree, columns) → Model`. Pure function. Walks the tree bottom-up and attaches `effective`, `childSum`, `mode`, `done`, `doneSum` and diagnostics to each node. No renderer performs arithmetic.

Both `parse` and `compute` are plain TypeScript with no DOM dependency and should be covered by unit tests before any UI exists.

### 3.3 Renderers

A renderer is a module exporting:

```ts
interface Renderer {
  id: string;
  label: string;
  requires: ColumnRequirement[]; // empty for the tree view
  render(model: Model, host: HTMLElement, ctx: RenderContext): void;
}
```

`requires` lets the app grey out a renderer whose needs aren't met ("add a `date` column to enable Gantt") instead of rendering nonsense. `RenderContext` carries the current cursor line so renderers can highlight it.

### 3.4 Editors

Exactly one editor is active at a time. Every editor writes to the shared text buffer; switching editors re-parses. There is no editor-owned model that serialises back to text.

### 3.5 Multi-user (future, stated now so nothing blocks it)

The shared thing is the text buffer, not the model. A CRDT over the text (e.g. Yjs, which has a CodeMirror 6 binding) gives collaboration without the sync layer knowing anything about the format. Each client parses and computes locally.

## 4. Editor (CodeMirror 6)

### 4.1 Language mode

Highlighting for: done lines (dimmed), comment lines, the `~` prefix, column separators, duration values, `+` prefix, front matter block, reserved `#` lines (warning underline).

### 4.2 Folding

Indent-based folding on items that have children.

### 4.3 Keymap

| Keys                  | Action                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `Alt+Up` / `Alt+Down` | Move the current line, or all lines touched by the selection, up/down                     |
| `Tab` / `Shift+Tab`   | Indent / outdent current line or selection by 4 spaces                                    |
| `Ctrl+/`              | Toggle `// ` on current line or selection                                                 |
| `Ctrl+Shift+Up`       | Extend selection to the enclosing subtree (tentative binding)                             |
| `Ctrl+S`              | Save                                                                                      |
| `Escape` then `Tab`   | Leave the editor (accessibility escape hatch required by CodeMirror when Tab is captured) |

`Alt+Left/Right` is **not** used — it is browser back/forward on Windows and Linux.

### 4.4 Diagnostics

Shown as gutter markers with hover text, and as underlines on the offending span where one exists.

## 5. Preview — tree renderer (MVP)

- A tree that mirrors the text one row per item, comments and blank lines omitted.
- Columns: title, then each declared column. Summable columns show `effective`; when `mode` is `override` or `additive` the computed `childSum` is shown alongside in a muted style, e.g. `2d ⟨Σ 2d 1h⟩`.
- Done rows are struck through or dimmed.
- A document total row at the bottom showing `effective` and `doneSum` per summable column.
- The row for the item under the editor cursor is highlighted; clicking a row moves the editor cursor to that line.
- Updates live on every edit (debounced ~50 ms).

## 6. Persistence (MVP)

Single user, files on disk. Open/save via the File System Access API where available, falling back to file input / download. No server.

## 7. Deferred

Decided against for MVP, listed so the syntax leaves room:

- Additional prefix markers (`?` uncertain, `!` blocked, `-` dropped)
- Estimate ranges / confidence, PERT roll-up
- Named fields (`est=4h`) alongside positional
- Markdown headings (`#`) as un-indented parents
- Status roll-up (all children done ⇒ parent done)
- Custom units and calendar in front matter (`unit:`, `calendar:`)
- Column **roles** (`start:date(role=start)`) for renderers such as Gantt
- Additional roll-up types: `max`, `count`, `done%`, `remaining`
- `\|` escaping
- Compound durations (`2d 4h`) as input
- Renderers: flat table, Gantt; exports to Excel, Word, HTML, MS Project
- Grid editor; multi-user via text CRDT

## 8. Build order

1. `parse` + `compute` as a pure TypeScript package with unit tests covering §2.10 and every diagnostic in §2.9.
2. CodeMirror 6 language mode, folding and keymap, wired to a live `parse`/`compute` on change.
3. Tree renderer with cursor sync.
4. Open/save.
5. Diagnostics gutter.
6. Second renderer (flat table) — as a test that the renderer seam holds.
