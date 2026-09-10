# TASKS.md

Work these in order. Each task is one Claude Code session. A task is done only when every acceptance criterion is met and the human has reviewed.

---

## Task 1 — Parser and compute (no UI)

Implement `src/core/` per spec §2 and §3.1–3.2.

**Deliverables**

- `parse(text: string): Tree` — lossless, nodes carry source ranges, comments/blank lines retained, front matter parsed.
- `compute(tree: Tree, columns: Column[]): Model` — attaches `effective`, `childSum`, `mode`, `done`, `doneSum`, diagnostics.
- `parseColumns(frontMatter)` with the default columns when absent.
- `formatDuration(hours): string` producing mixed units (`1w 2d 4h`).
- Types exported for `Tree`, `Node`, `Model`, `Column`, `Diagnostic`, `Renderer`.

**Acceptance criteria**

- [ ] The spec §2.10 example, parsed and computed, produces exactly the table in §2.10 (test asserts every cell, including the document total of 3d / doneSum 4h).
- [ ] A test for every diagnostic in §2.9, each asserting line number and severity.
- [ ] Hierarchy test for the `0 / 8 / 4` indent case in §2.4: third item is a sibling of the second.
- [ ] Round-trip test: for a file with comments, blank lines, trailing pipes and mixed indentation, reconstructing text from the tree's source ranges yields the original byte-for-byte (after tab conversion).
- [ ] Empty file, file with only front matter, and file with only comments all parse without error and produce an empty model.
- [ ] `+` on a leaf equals an override of the same value, no diagnostic.
- [ ] `~` on a parent makes all descendants `done: true`; `doneSum` on that parent equals its `effective`.
- [ ] Unknown column type falls back to `text` with a warning.
- [ ] `src/core/` has zero imports outside itself and the standard library (enforced by lint).
- [ ] `npm test` is green.

**Human review before Task 2:** read the tests, not the implementation. Check that the roll-up and done semantics match what you meant.

---

## Task 2 — Editor shell

Implement `src/editor/` and a minimal `src/app/` that shows the editor and a raw JSON dump of the model (temporary, replaced in Task 3).

**Deliverables**

- CodeMirror 6 language mode with highlighting per spec §4.1.
- Indent-based folding on items with children.
- Keymap per spec §4.3, including the `Escape`-then-`Tab` accessibility escape.
- On every change (debounced ~50 ms): re-parse, re-compute, hand the model to whatever is on the right.

**Acceptance criteria**

- [ ] Typing the §2.10 example shows distinct styling for: done lines, comments, `~`, `|`, duration values, `+`, front matter, and a warning underline on a `#` line.
- [ ] Folding works on `Auth` and `OAuth (Google)`; not offered on leaves.
- [ ] `Alt+Up/Down` moves a single line, and moves all lines touched by a multi-line selection as a block.
- [ ] `Tab`/`Shift+Tab` indents/outdents by exactly 4 spaces; works on a selection; `Shift+Tab` at column 0 is a no-op.
- [ ] `Ctrl+/` toggles `// ` on the line or selection; toggling twice restores the original text.
- [ ] `Alt+Left/Right` are not bound.
- [ ] `Escape` then `Tab` moves focus out of the editor.
- [ ] Pasting text containing tabs converts them to spaces.
- [ ] The JSON dump updates live and reflects the model after each edit.

---

## Task 3 — Tree renderer

Implement `src/renderers/tree/` per spec §5, replacing the JSON dump.

**Deliverables**

- A `Renderer` module with `requires: []`.
- App shell selects and mounts renderers via the `Renderer` interface only.

**Acceptance criteria**

- [ ] One row per item; comments and blank lines are not rendered.
- [ ] Nesting is visible (indent or tree lines).
- [ ] Summable columns show `effective`; when `mode` is `override` or `additive`, `childSum` is shown alongside in a muted style.
- [ ] Done rows are struck through or dimmed.
- [ ] Document total row shows `effective` and `doneSum` per summable column; for the §2.10 example this reads 3d and 4h.
- [ ] Row under the editor cursor is highlighted; moving the cursor updates it.
- [ ] Clicking a row moves the editor cursor to that line and focuses the editor.
- [ ] Preview updates live while typing without visible lag on a 500-line file.
- [ ] The app shell contains no code that mentions the tree renderer by name beyond registering it.

---

## Task 4 — Open and save

**Deliverables**

- Open and save using the File System Access API where available; fallback to `<input type="file">` and download.
- `Ctrl+S` saves to the open file handle, or triggers Save As if none.
- Unsaved-changes indicator in the title.
- Save writes the editor buffer as-is. Never re-serialise from the tree.

**Acceptance criteria**

- [ ] Open a file with comments, blank lines, trailing whitespace on some lines, a trailing `|` on one item, and a front matter block; save it unchanged; the file on disk is byte-identical except tab-to-space and CRLF-to-LF normalisation.
- [ ] Open a CRLF file, save it; the file on disk now has LF endings.
- [ ] `Ctrl+S` on a new document prompts for a location; subsequent saves don't prompt.
- [ ] Closing the tab with unsaved changes prompts (via `beforeunload`).
- [ ] Works in Chrome and in a browser without File System Access (Firefox) via the fallback.

---

## Task 5 — Diagnostics gutter

**Deliverables**

- Gutter markers with hover text for each diagnostic on the model.
- Underlines on the offending span where a span exists.
- Severity styling: `warning` vs `info`.

**Acceptance criteria**

- [ ] Each diagnostic in spec §2.9 except tab conversion (not reachable from the editor; the buffer never holds tabs) is visible in the gutter with the correct severity when triggered.
- [ ] Hover shows the message text from the model verbatim.
- [ ] Unparseable duration underlines only the field, not the whole line.
- [ ] Diagnostics clear as soon as the line is fixed.

---

## Task 6 — Flat table renderer

A second renderer, to prove the seam.

**Deliverables**

- `src/renderers/table/` with `requires: []`, rendering one row per item with a `level` column plus the declared columns, no nesting.
- A renderer switcher in the app shell (tabs or dropdown).

**Acceptance criteria**

- [ ] Switching renderers requires no change to the app shell beyond registration.
- [ ] Both renderers show identical numbers for the §2.10 example.
- [ ] Cursor highlight and click-to-line work in the table too (via `RenderContext`, not duplicated logic).
- [ ] A renderer with a non-empty `requires` that the document doesn't satisfy (add a stub to test) is shown greyed out with an explanation, and is never called to render.

---

## Task 7 — Compound durations

Core only. Extend the `duration` parser so a value may contain several unit terms.

**Deliverables**

- Grammar: one or more whitespace-separated terms, each `number unit` with unit in `h`/`d`/`w`; any order; each unit at most once; a bare number (no unit) is still hours and is only allowed as the sole term. A leading `+` applies to the whole value.
- Update spec §2.6 and remove "compound durations" from §7.

**Acceptance criteria**

- [ ] `2d 4h`, `4h 2d`, `1w 2d 4h`, `+2d 4h`, `1.5d 4h` all parse to the expected hours.
- [ ] `2d 2d`, `2d 4`, `4 2d`, `2dh`, `2 d` produce the existing unparseable-value warning and are treated as empty.
- [ ] `formatDuration(parseDuration(x)) === formatDuration(hours)` round-trips for all valid inputs.
- [ ] The §2.10 example output is unchanged.
- [ ] No changes outside `src/core/` and tests.

---

## Task 8 — Outline numbers

Add a structural reference to every item node and show it in both renderers.

**Deliverables**

- `outlineNumber: string` on each item node, computed in `parse` (it is structure, not arithmetic): `1`, `1.1`, `1.2`, `2`, `2.1.5`. Only item nodes are counted; comment, blank, reserved and front-matter lines consume no numbers.
- Tree renderer and table renderer each gain a leading column showing it.
- Spec §3.1 documents the field; §5 lists the column.

**Acceptance criteria**

- [ ] For the §2.10 example: `Auth` is `1`, `Login page` is `1.1`, `Token refresh` is `1.3.2`, `Admin` is `2`, `User list` is `2.1`. The commented `Audit log` line has no number and `User list` is still `2.1`.
- [ ] A comment line between two siblings does not affect their numbering.
- [ ] The `0 / 8 / 4` indent case from spec §2.4 numbers the third item as a sibling (`1.2`), not a grandchild.
- [ ] Both renderers show the column; the number is not selectable/editable.
- [ ] `src/app/` is unchanged.

---

## Task 9 — Exporters and Copy for Excel

Introduce an exporter seam and ship the first exporter.

**Deliverables**

- `Exporter` interface in `src/core/`:
  ```ts
  interface Exporter {
    id: string;
    label: string; // e.g. "Copy for Excel"
    export(model: Model): { mime: string; data: string };
  }
  ```
- `src/exporters/tsv/`: tab-separated text, one header row then one row per item, in document order. Columns: `#` (outline number), `level` (1-based depth), `title`, then each declared column in order, then `done`.
  - `duration` and `number` cells emit the node's `effective` as a plain decimal number of hours (no unit, no mixed-unit string). Header for duration columns is `name (h)`. Empty when `hasValue` is false.
  - `text` cells emit the text as entered. Tabs and newlines cannot occur (the format forbids them) but the exporter must still replace any with a space defensively.
  - `done` emits `TRUE` or `FALSE`.
  - A final row `Total` with the document totals in the summable columns and `doneSum` is **not** included — Excel users will sum themselves, and a totals row breaks sorting/filtering. Document this in the spec.
- Preview toolbar: one button per registered exporter. The TSV exporter's button writes `data` to the clipboard via `navigator.clipboard.writeText`, then shows a brief "Copied" confirmation. Failures (permissions, framed context) are surfaced visibly, not swallowed.
- `src/app/` holds an `exporters` list exactly as it holds `renderers`; nothing else in the shell references the TSV exporter by name.
- Spec: new §3.6 "Exporters"; §7 updated.

**Acceptance criteria**

- [ ] Unit test: the §2.10 example produces exactly the expected TSV (assert the full string, including header and `Auth` as `16`, `OAuth (Google)` as `13`, `Admin` as `8`).
- [ ] A text cell containing a tab or newline is exported with a space instead.
- [ ] A `done` parent's implicitly done children export `TRUE`.
- [ ] Manual: paste into Excel; every column lands in its own cell, duration columns are numeric (right-aligned, `=SUM()` works), `done` is a boolean.
- [ ] Manual: the button reports failure visibly in the VS Code Simple Browser.
- [ ] Adding a second stub exporter requires no change to `src/app/` beyond registration.

---

## Task 10 — Dark mode

**Deliverables**

- All colours in the app, both renderers, and the `cm-plan-*` token classes move to CSS custom properties defined on `:root`, with a second set under `@media (prefers-color-scheme: dark)`.
- CodeMirror chrome (gutter, selection, cursor, fold markers, lint underline colours) themed via `EditorView.theme(..., { dark: true })` on the same media query, so the editor and the rest of the page switch together.
- No manual toggle in this task.

**Acceptance criteria**

- [ ] `grep` for hex colours and `rgb(` outside the `:root` variable definitions returns nothing in `src/`.
- [ ] Manual, in both light and dark: done rows, cursor row, "near" cursor row, override sigma, warning and info underlines, gutter markers, fold markers, comment lines and front matter are all distinguishable from each other and from normal text.
- [ ] Manual: switching the OS setting while the app is open switches the app without reload.
- [ ] Manual: the cursor-row highlight on a done row is still visible in dark mode (this regressed once before in light mode).
