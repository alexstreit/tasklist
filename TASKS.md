# TASKS.md

Work these in order. Each task is one Claude Code session. A task is done only when every acceptance criterion is met and the human has reviewed.

**Status:** Tasks 1–10 complete. Next: Task 11.

---

## Task 1 — Parser and compute (no UI) ✅ `e7ad176`, `b726928`

Implement `src/core/` per spec §2 and §3.1–3.2.

**Deliverables**

- `parse(text: string): Tree` — lossless, nodes carry source ranges, comments/blank lines retained, front matter parsed.
- `compute(tree: Tree, columns: Column[]): Model` — attaches `effective`, `childSum`, `mode`, `done`, `doneSum`, diagnostics.
- `parseColumns(frontMatter)` with the default columns when absent.
- `formatDuration(hours): string` producing mixed units (`1w 2d 4h`).
- Types exported for `Tree`, `Node`, `Model`, `Column`, `Diagnostic`, `Renderer`.

**Acceptance criteria**

- [x] The spec §2.10 example, parsed and computed, produces exactly the table in §2.10 (test asserts every cell, including the document total of 3d / doneSum 4h).
- [x] A test for every diagnostic in §2.9, each asserting line number and severity.
- [x] Hierarchy test for the `0 / 8 / 4` indent case in §2.4: third item is a sibling of the second.
- [x] Round-trip test: for a file with comments, blank lines, trailing pipes and mixed indentation, reconstructing text from the tree's source ranges yields the original byte-for-byte (after tab conversion).
- [x] Empty file, file with only front matter, and file with only comments all parse without error and produce an empty model.
- [x] `+` on a leaf equals an override of the same value, no diagnostic.
- [x] `~` on a parent makes all descendants `done: true`; `doneSum` on that parent equals its `effective`.
- [x] Unknown column type falls back to `text` with a warning.
- [x] `src/core/` has zero imports outside itself and the standard library (enforced by lint).
- [x] `npm test` is green.

**Follow-ups applied:** unclosed front matter warning (line 1); duplicate column name warning; `analyze(text)` entry point; spec renamed to `plan-format-spec.md`.

**Human review before Task 2:** read the tests, not the implementation. Check that the roll-up and done semantics match what you meant.

---

## Task 2 — Editor shell ✅ `5bcab9a`

Implement `src/editor/` and a minimal `src/app/` that shows the editor and a raw JSON dump of the model (temporary, replaced in Task 3).

**Deliverables**

- CodeMirror 6 language mode with highlighting per spec §4.1.
- Indent-based folding on items with children.
- Keymap per spec §4.3, including the `Escape`-then-`Tab` accessibility escape.
- On every change (debounced ~50 ms): re-parse, re-compute, hand the model to whatever is on the right.

**Acceptance criteria**

- [x] Typing the §2.10 example shows distinct styling for: done lines, comments, `~`, `|`, duration values, `+`, front matter, and a warning underline on a `#` line.
- [x] Folding works on `Auth` and `OAuth (Google)`; not offered on leaves.
- [x] `Alt+Up/Down` moves a single line, and moves all lines touched by a multi-line selection as a block.
- [x] `Tab`/`Shift+Tab` indents/outdents by exactly 4 spaces; works on a selection; `Shift+Tab` at column 0 is a no-op.
- [x] `Ctrl+/` toggles `// ` on the line or selection; toggling twice restores the original text.
- [x] `Alt+Left/Right` are not bound.
- [x] `Escape` then `Tab` moves focus out of the editor.
- [x] Pasting text containing tabs converts them to spaces.
- [x] The JSON dump updates live and reflects the model after each edit.

**Follow-ups applied:** `Ctrl+Shift+Up` bound literally to Ctrl (not `Mod`); example fixture moved to `examples/example.plan`.

---

## Task 3 — Tree renderer ✅ `bcad18b`, `4de5c7c`, `5db65c6`

Implement `src/renderers/tree/` per spec §5, replacing the JSON dump.

**Deliverables**

- A `Renderer` module with `requires: []`.
- App shell selects and mounts renderers via the `Renderer` interface only.

**Acceptance criteria**

- [x] One row per item; comments and blank lines are not rendered.
- [x] Nesting is visible (indent or tree lines).
- [x] Summable columns show `effective`; when `mode` is `override` or `additive`, `childSum` is shown alongside in a muted style.
- [x] Done rows are struck through or dimmed.
- [x] Document total row shows `effective` and `doneSum` per summable column; for the §2.10 example this reads 3d and 4h.
- [x] Row under the editor cursor is highlighted; moving the cursor updates it.
- [x] Clicking a row moves the editor cursor to that line and focuses the editor.
- [x] Preview updates live while typing without visible lag on a 500-line file.
- [x] The app shell contains no code that mentions the tree renderer by name beyond registering it.

**Follow-ups applied:** `hasValue` in core (empty cells instead of `0h`); cursor highlight visible on done rows; "near" highlight for comment/blank lines; preview scrolls to the cursor row with `block: 'nearest'` except after a preview click.

---

## Task 4 — Open and save ✅ `6d66bac`

**Deliverables**

- Open and save using the File System Access API where available; fallback to `<input type="file">` and download.
- `Ctrl+S` saves to the open file handle, or triggers Save As if none.
- Unsaved-changes indicator in the title.
- Save writes the editor buffer as-is. Never re-serialise from the tree.

**Acceptance criteria**

- [x] Open a file with comments, blank lines, trailing whitespace on some lines, a trailing `|` on one item, and a front matter block; save it unchanged; the file on disk is byte-identical except tab-to-space and CRLF-to-LF normalisation.
- [x] Open a CRLF file, save it; the file on disk now has LF endings.
- [x] `Ctrl+S` on a new document prompts for a location; subsequent saves don't prompt.
- [x] Closing the tab with unsaved changes prompts (via `beforeunload`).
- [x] Works in Chrome and in a browser without File System Access (Firefox) via the fallback.
- [x] In a framed context (VS Code Simple Browser) failure is reported visibly.

---

## Task 5 — Diagnostics gutter ✅ through `20e94dc`

**Deliverables**

- Gutter markers with hover text for each diagnostic on the model.
- Underlines on the offending span where a span exists.
- Severity styling: `warning` vs `info`.

**Acceptance criteria**

- [x] Each diagnostic in spec §2.9 is visible in the gutter with the correct severity when triggered.
- [x] Hover shows the message text from the model verbatim.
- [x] Unparseable duration underlines only the field, not the whole line.
- [x] Diagnostics clear as soon as the line is fixed.

**Follow-ups applied:** uses `@codemirror/lint` fed from the shell's single `analyze()`; span-less diagnostics are gutter-only; `#` warning moved from tokenizer to lint; per-line unknown-key warnings suppressed under unclosed front matter; override-differs only when `childrenHaveValue`; child sum shown only when `childrenHaveValue` and mode is override/additive. Tab-conversion diagnostic is unreachable from the editor by design.

---

## Task 6 — Flat table renderer ✅

A second renderer, to prove the seam.

**Deliverables**

- `src/renderers/table/` with `requires: []`, rendering one row per item with a `level` column plus the declared columns, no nesting.
- A renderer switcher in the app shell (tabs or dropdown).

**Acceptance criteria**

- [x] Switching renderers requires no change to the app shell beyond registration.
- [x] Both renderers show identical numbers for the §2.10 example.
- [x] Cursor highlight and click-to-line work in the table too (via `RenderContext`, not duplicated logic).
- [x] A renderer with a non-empty `requires` that the document doesn't satisfy (add a stub to test) is shown greyed out with an explanation, and is never called to render.

---

## Task 7 — Compound durations ✅ `27037c1`, `40d91a1`

Core only. Extend the `duration` parser so a value may contain several unit terms.

**Deliverables**

- Grammar per spec §2.6: terms of number + unit (`h`/`d`/`w`), optional whitespace between number and unit, any order, each unit at most once; a bare number is hours and only valid as the entire value. A leading `+` applies to the whole value.
- Update spec §2.6 and remove "compound durations" from §7.

**Acceptance criteria**

- [x] `2d 4h`, `4h 2d`, `1w 2d 4h`, `+2d 4h`, `1.5d 4h`, `2 d`, `2 d 4 h` all parse to the expected hours.
- [x] `4 2d`, `2d 4`, `2 d 4` raise `bare number not allowed in compound duration`; `2d 2d`, `2dh`, `4x` raise the generic unparseable warning; all are treated as empty.
- [x] `formatDuration(parseDuration(x)) === formatDuration(hours)` round-trips for all valid inputs.
- [x] The §2.10 example output is unchanged.
- [x] No changes outside `src/core/` and tests.

---

## Task 8 — Outline numbers ✅ `c640f5b`

Add a structural reference to every item node and show it in both renderers.

**Deliverables**

- `outlineNumber: string` on each item node, computed in `parse` (it is structure, not arithmetic): `1`, `1.1`, `1.2`, `2`, `2.1.5`. Only item nodes are counted; comment, blank, reserved and front-matter lines consume no numbers.
- Tree renderer and table renderer each gain a leading column showing it.
- Spec §3.1 documents the field; §5 lists the column.

**Acceptance criteria**

- [x] For the §2.10 example: `Auth` is `1`, `Login page` is `1.1`, `Token refresh` is `1.3.2`, `Admin` is `2`, `User list` is `2.1`. The commented `Audit log` line has no number and `User list` is still `2.1`.
- [x] A comment line between two siblings does not affect their numbering.
- [x] The `0 / 8 / 4` indent case from spec §2.4 numbers the third item as a sibling (`1.2`), not a grandchild.
- [x] Both renderers show the column; the number is not selectable/editable.
- [x] `src/app/` is unchanged.

---

## Task 9 — Exporters and Copy for Excel ✅

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
  - The `#` cell is prefixed with `'` so spreadsheets store it as text (`1.10` would otherwise become 1.1).
  - `duration` and `number` cells emit the node's `effective` as a plain decimal number of hours (no unit, no mixed-unit string). Header for duration columns is `name (h)`. Empty when `hasValue` is false.
  - `text` cells emit the text as entered. Tabs and newlines cannot occur (the format forbids them) but the exporter must still replace any with a space defensively.
  - `done` emits `TRUE` or `FALSE`.
  - A final row `Total` with the document totals in the summable columns and `doneSum` is **not** included — Excel users will sum themselves, and a totals row breaks sorting/filtering. Document this in the spec.
- Preview toolbar: one button per registered exporter. The TSV exporter's button writes `data` to the clipboard via `navigator.clipboard.writeText`, then shows a brief "Copied" confirmation. Failures (permissions, framed context) are surfaced visibly, not swallowed.
- `src/app/` holds an `exporters` list exactly as it holds `renderers`; nothing else in the shell references the TSV exporter by name.
- Spec: new §3.6 "Exporters"; §7 updated.

**Acceptance criteria**

- [x] Unit test: the §2.10 example produces exactly the expected TSV (assert the full string, including header and `Auth` as `16`, `OAuth (Google)` as `13`, `Admin` as `8`).
- [x] A text cell containing a tab or newline is exported with a space instead.
- [x] A `done` parent's implicitly done children export `TRUE`.
- [x] Manual: `1.10` stays `1.10`, left-aligned, after paste.
- [x] Manual: paste into Excel (or Google Sheets); every column lands in its own cell, duration columns are numeric (right-aligned, `=SUM()` works), `done` is a boolean.
- [x] Manual: the button reports failure visibly in the VS Code Simple Browser.
- [x] Adding a second stub exporter requires no change to `src/app/` beyond registration.

---

## Task 10 — Dark mode ✅ `9277d21`

**Deliverables**

- All colours in the app, both renderers, and the `cm-plan-*` token classes move to CSS custom properties defined on `:root`, with a second set under `@media (prefers-color-scheme: dark)`.
- CodeMirror chrome (gutter, selection, cursor, fold markers, lint underline colours) themed via `EditorView.theme(..., { dark: true })` on the same media query, so the editor and the rest of the page switch together.
- No manual toggle in this task.

**Acceptance criteria**

- [x] `grep` for hex colours and `rgb(` outside the `:root` variable definitions returns nothing in `src/`.
- [x] Manual, in both light and dark: done rows, cursor row, "near" cursor row, override sigma, warning and info underlines, gutter markers, fold markers, comment lines and front matter are all distinguishable from each other and from normal text.
- [x] Manual: switching the OS setting while the app is open switches the app without reload.
- [x] Manual: the cursor-row highlight on a done row is still visible in dark mode (this regressed once before in light mode).

---

## Task 11 — PlanBuffer and line operations

Refactor so the app owns one buffer and all structural edits are shared pure functions. No new user-visible behaviour.

**Deliverables**

- `src/buffer/`: `PlanBuffer`, `TextEdit`, `BufferChange` types per spec §3.7; `CodeMirrorBuffer` (wraps an `EditorState`, exposes `mapPos` via `ChangeSet.mapPos`); `InMemoryBuffer` (test double with undo stack).
- `src/editing/`: pure line operations per spec §3.8 — `indent`, `outdent`, `moveUp`, `moveDown`, `insertLineAbove`, `deleteLines`, `toggleComment` — each `(text, LineRange, ...) => TextEdit[]`.
- The text editor keymap calls `src/editing/` functions and dispatches the resulting edits; the previous inline implementations are removed.
- The text editor mounts its view on the buffer's state; undo/redo keys call `buffer.undo()`/`redo()`.
- App shell: creates the buffer, calls `analyze()` on buffer change (debounced as before), and hands the buffer to whichever editor is active.
- ESLint: `@codemirror/*` may be imported only from `src/editor/` and `src/buffer/CodeMirrorBuffer.ts`.

**Acceptance criteria**

- [x] Every existing test still passes (267 green); the Task 2 keymap behaviours are unchanged in the browser — **manual check pending review**.
- [x] `src/editing/` has unit tests for each operation using plain strings, including: indent/outdent of a multi-line range, move up at line 1 and move down at the last line (no-ops), delete of a parent line leaving children re-attached to the previous item, toggle comment round-trip.
- [x] `InMemoryBuffer` and `CodeMirrorBuffer` pass the same shared test suite (apply, undo, redo, onChange payload, `mapPos` after an insert before and after the position, unsubscribe).
- [x] No file outside `src/editor/` and `src/buffer/CodeMirrorBuffer.ts` imports from `@codemirror/*` (lint-enforced, and verified by a probe).
- [x] `git diff --stat` for `src/renderers/` and `src/core/` is empty.

**Decisions taken:** keymap tests that asserted identity with CodeMirror's commands now point at the commands in `src/editor/keymap.ts`; the line commands act on the main selection range only (multi-cursor line edits were never a documented behaviour); `origin: 'load'` clears the undo history in both buffers (spec §3.7) — previously undo after Open replayed edits from the previous document.

**Human review:** in the browser, check Alt+Up/Down, Tab/Shift+Tab, Ctrl+/ and Ctrl+Z/Ctrl+Y against Task 2's acceptance list.

---

## Task 12 — Grid: display and cell editing

**Deliverables**

- `src/grid/`: a grid editor over `PlanBuffer` per spec §4b.1–4b.3, items only in this task (comment/blank rows come in Task 15).
- Columns: WBS, done checkbox, title, declared columns. Total row. New-task row.
- Cell editing per §4b.2, including the raw-text-on-edit rule for summable cells and the pad-to-column helper.
- Focus restoration by line and column after each buffer change, using `mapPos`.
- App toolbar gains a Text / Grid toggle; only one editor is mounted at a time; the preview keeps working with either.

**Acceptance criteria**

- [x] Unit tests (jsdom, `InMemoryBuffer`) for: editing a title; editing an existing estimate; editing an estimate on a line with no pipes (line gains `| 4h`); editing the notes column on a title-only line (line gains two empty fields first); committing empty to a padded column trims the trailing empties; toggling done inserts/removes `~`; a child of a done parent shows a disabled checked box; typing on a derived parent creates an override and the cell shows `⟨Σ …⟩`-style muted computed value afterwards; clearing the override restores derived; editing shows raw text (`2d 4h`) not formatted text.
- [x] Focus test: edit a cell, then `buffer.undo()`; focus is on the same cell. Insert a line above via `buffer.apply`; focus follows to the moved line.
- [x] Typing in the new-task row creates a line at the last item's indent.
- [x] Manual: switch Text → Grid → Text; the text is byte-identical and the undo stack still works across the switch (edit in grid, switch to text, Ctrl+Z undoes the grid edit). — also covered automatically in `tests/app/shell.test.ts`; **still worth a browser pass**.
- [x] Manual: the §2.10 example renders with `Auth` showing an override and the total row reading `3d` / `4h`. — asserted in `tests/grid/grid.test.ts`; **browser check pending review**.

**Decisions taken:** mouse editing is click-to-focus, double-click-to-edit (§4b.4 only defines keyboard entry, which is Task 14; spec §4b.3 updated). Front matter rows are deferred to Task 15 with the other non-item rows. Editors expose `{ update, setCursorLine, destroy }` (spec §3.4) — that replaced the shell's `showDiagnostics` call, so grid diagnostics in Task 15 need no shell change. Cell edits live in `src/grid/edits.ts` (pure, text in / `TextEdit[]` out); field addressing counts the line's `|` positions rather than parsed fields, because a trailing `|` is a slot the parser drops.

**Human review:** in the browser, check the Text/Grid toggle, double-click editing, the derived/override/additive cells on the §2.10 example, and the new-task row.

---

## Task 13 — Grid: structure and selection

**Deliverables**

- Row selection via the WBS cell; single row in v1.
- Structural operations per §4b.4 calling `src/editing/` functions: insert above, delete row, indent, outdent, move up, move down.
- Toolbar per §4b.5 with enable/disable states.

**Acceptance criteria**

- [x] Insert above a parent creates a sibling before it; the parent keeps its children. Insert above a first child creates a new first child. Assert on resulting text.
- [x] Delete a parent row: its children re-attach to the previous item at a shallower indent (or become roots), matching text-mode deletion. Assert on text and on the new outline numbers.
- [x] Indent the first root row is a no-op; outdent a root row is a no-op; the toolbar buttons are disabled in those states.
- [x] Move up/down of a row with children moves only that line — same semantics as the text editor. (v2 may move subtrees; already listed under Grid v2 in §7.)
- [x] After each operation the selection follows the row to its new line.
- [x] Manual: every toolbar button does what its key does. — the keys arrive in Task 14; **browser pass on the buttons pending review**.

**Decisions taken:** an inserted row is a draft until its title is committed (spec §4b.4) — writing a blank line first would produce a blank node, not an item row to type into. Row selection is the WBS cell being the focused place (column `-1`), so selection and cell focus share one anchor and one restore path. Indent is disabled when the row above is at a shallower indent (MS Project's rule), which also covers "the first root row is a no-op".

**Human review:** in the browser, walk the toolbar on the §2.10 example — insert above a parent and above a first child, delete a parent, indent/outdent, move a parent row, toggle done.

---

## Task 14 — Grid: keys

**Deliverables**

- The full key table in §4b.4.

**Acceptance criteria**

- [x] Each row of the §4b.4 table has a test that dispatches the key and asserts the resulting focus/selection/text.
- [x] Enter on the last item row moves focus to the new-task row; Enter there with text commits and creates the line.
- [x] Tab from the last cell of a row wraps to the first editable cell of the next row; Shift+Tab from the first wraps back.
- [x] A printable key on a focused cell starts editing with the cell content replaced by that key; F2 starts editing with the caret at the end of the existing content.
- [x] Escape while editing restores the displayed value and does not touch the buffer.
- [x] Ctrl+Z while editing cancels the edit rather than undoing the buffer (matches spreadsheets).
- [ ] Manual, Edge and Firefox: none of the bound keys trigger browser defaults (in particular Alt+Shift+Left/Right, Insert, Tab). — `defaultPrevented` is asserted for those keys in jsdom; **browser pass pending review**.

**Decisions taken:** Tab and Enter stay unbound on a selected row, as the table says, and that is the keyboard's way out of the grid (spec §4b.4) — cells are not in the tab order, so a focused cell would otherwise trap Tab. Arrow keys move across cells as well as rows, so ArrowLeft from the checkbox selects the row. The place is re-anchored from the live buffer text rather than the model, because a commit that shortens a line would leave the old line-end anchor pointing into the next row.

**Fixed on the way:** focusing a cell blurs an open editor, whose blur handler commits and rebuilds the table, leaving the browser focusing a detached cell. `focusCell` now re-resolves the cell when that happens (`src/grid/index.ts`); it showed up as lost focus after Insert, and would have bitten any synchronous rebuild.

**Found in review:** the checkboxes were in the native tab order while the cells were not, so Tab and Shift+Tab walked the checkbox column instead of the grid; checkboxes are now `tabIndex = -1` and the cell is the focusable thing. The new-task row only handled Enter, so there was no way back off it: ArrowUp now returns to the last row and Shift+Tab to its last cell, committing anything typed on the way. Cells are still not reachable by Tab from outside the grid (they are `tabindex="-1"`); a roving tabindex would fix that and belongs with §7's grid accessibility.

**Human review:** in Edge and Firefox, walk the §4b.4 table on the example file — especially Alt+Shift+Left/Right, Insert, Tab and Space.

---

## Task 15 — Grid: comment rows, diagnostics, polish

**Deliverables**

- Comment and blank lines as greyed full-width editable rows; front matter as one collapsed read-only row.
- Diagnostics on cells per §4b.2; span-less diagnostics on the WBS cell.
- Dark mode for the grid via the existing tokens (the Task 10 colour test must still pass).
- The app remembers the last-used editor (per-viewer convenience only).

**Acceptance criteria**

- [ ] A comment row edited to remove the `//` becomes an item row on the next render, and vice versa.
- [ ] Deleting a comment row deletes exactly that line.
- [ ] A blank row between two items renders and can be deleted; inserting above an item with a blank line above it inserts directly above the item, not above the blank.
- [ ] `4 hours` in an estimate cell shows a warning outline with the correct message on hover; fixing it clears immediately.
- [ ] The unclosed-front-matter warning shows on the front matter row.
- [ ] Manual, both themes: derived vs override vs additive summable cells, done rows, focused cell, selected row, editing cell, comment rows, warning and info outlines are all distinguishable.
- [ ] Manual: 500-line file; arrow-key navigation and typing feel instant.

---

## Later (not scheduled)

See spec §7. When any of these start, add a task here first and update the spec before writing code.
