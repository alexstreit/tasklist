# TASKS.md

Work these in order. Each task is one Claude Code session. A task is done only when every acceptance criterion is met and the human has reviewed.

**Status:** Tasks 1–23 complete. Tasks 24, 25 and 26 awaiting review.

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

**Superseded by Task 21:** `parse` and `parseColumns` are deleted; rows reads the file. An unclosed frontmatter and a duplicate column name are now rows errors (severity `error`), and an unclosed frontmatter no longer swallows the rows after it.

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

- [x] Typing the §2.10 example shows distinct styling for: done lines, comments, `~`, `|`, duration values, `+`, front matter, and a warning underline on a `#` line (an error underline since Task 21).
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
- [x] Closing the tab with unsaved changes prompts (via `beforeunload`). (Changed by Task 27: after a download, the indicator stays on, and leaving prompts only once the buffer differs from what was downloaded.)
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

**Follow-ups applied:** uses `@codemirror/lint` fed from the shell's single `analyze()`; span-less diagnostics are gutter-only; `#` warning moved from tokenizer to lint (since Task 21, a `#` line is a row with a rows `heading-line` error); per-line unknown-key warnings suppressed under unclosed front matter (since Task 21, unknown keys are info, and an unclosed block has no keys); override-differs only when `childrenHaveValue`; child sum shown only when `childrenHaveValue` and mode is override/additive. Tab-conversion diagnostic is unreachable from the editor by design.

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

**Superseded by Task 21:** the duration grammar is now rows base §5 and this parser is deleted. Invalid values are the rows validation error `invalid-value`, without the separate bare-number message. `+ 2 d 4 h` (whitespace after the sign) is still valid: rows base 0.9 allows it (A5).

---

## Task 8 — Outline numbers ✅ `c640f5b`

Add a structural reference to every item node and show it in both renderers.

**Deliverables**

- `outlineNumber: string` on each item node, computed in `parse` (it is structure, not arithmetic): `1`, `1.1`, `1.2`, `2`, `2.1.5`. Only item nodes are counted; comment, blank, reserved and front-matter lines consume no numbers. (Since Task 21: computed in `readPlan` from the rows parent relation; a `#` line is an item and takes a number.)
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

**Superseded by Task 22:** `insertLineAbove` is deleted; the grid inserts rows with rows' `insertRow`.

**Decisions taken:** keymap tests that asserted identity with CodeMirror's commands now point at the commands in `src/editor/keymap.ts`; the line commands act on the main selection range only (multi-cursor line edits were never a documented behaviour); `origin: 'load'` clears the undo history in both buffers (spec §3.7) — previously undo after Open replayed edits from the previous document.

**Human review:** in the browser, check Alt+Up/Down, Tab/Shift+Tab, Ctrl+/ and Ctrl+Z/Ctrl+Y against Task 2's acceptance list.

---

## Task 12 — Grid: display and cell editing

**Deliverables**

- `src/grid/`: a grid editor over `PlanBuffer` per spec §4b.1–4b.3, items only in this task (comment/blank rows come in Task 15).
- Columns: WBS, done checkbox, title, declared columns. Total row. New-task row. _(Task 31: a toggle for each other marker follows the done checkbox.)_ _(Task 32: the new-task row is the last body row, and the total row below it is pinned to the bottom of the pane.)_
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

**Superseded by Task 22:** cell edits go through the rows edit API. A column that isn't the next slot is written by name (`Auth | notes=later`), never padded, and clearing it removes it. `src/grid/edits.ts` no longer counts `|`.

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
- [x] Move up/down of a row with children moves only that line — same semantics as the text editor. (v2 may move subtrees; already listed under Grid v2 in §7.) (Changed by Task 24: the row moves with its subtree.)
- [x] After each operation the selection follows the row to its new line.
- [x] Manual: every toolbar button does what its key does. — the keys arrive in Task 14; **browser pass on the buttons pending review**.

**Decisions taken:** an inserted row is a draft until its title is committed (spec §4b.4) — writing a blank line first would produce a blank node, not an item row to type into. Row selection is the WBS cell being the focused place (column `-1`), so selection and cell focus share one anchor and one restore path. Indent is disabled when the row above is at a shallower indent (MS Project's rule), which also covers "the first root row is a no-op".

**Human review:** in the browser, walk the toolbar on the §2.10 example — insert above a parent and above a first child, delete a parent, indent/outdent, move a parent row, toggle done.

**Changed by Task 23:** on item rows the operations work in levels through the rows edit API (spec §4b.6.4); comment and blank rows still use `src/editing/`. Deleting a parent promotes its children one level instead of leaving them at their indent. Indent and outdent take the row's descendants with it.

**Changed by Task 24:** Move up and Move down on an item row move it with its subtree, swapping with the previous or next sibling's subtree, and are enabled only when that sibling exists; moving across levels is indent and outdent. They no longer move only the line, and are never refused for the indentation. Comment and blank rows still move as single lines, and the text editor's Alt+Up/Down stay raw line moves. Refusals are shown in plain words ("Other rows refer to this task by its ID, so it can't be deleted yet.") instead of rows' reasons. _(Task 31 reworded that one; see Task 24's notes.)_

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
- [x] Manual, Edge and Firefox: none of the bound keys trigger browser defaults (in particular Alt+Shift+Left/Right, Insert, Tab). — `defaultPrevented` is asserted for those keys in jsdom; **browser pass pending review**.

**Decisions taken:** Tab and Enter stay unbound on a selected row, as the table says, and that is the keyboard's way out of the grid (spec §4b.4) — cells are not in the tab order, so a focused cell would otherwise trap Tab. Arrow keys move across cells as well as rows, so ArrowLeft from the checkbox selects the row. The place is re-anchored from the live buffer text rather than the model, because a commit that shortens a line would leave the old line-end anchor pointing into the next row.

**Fixed on the way:** focusing a cell blurs an open editor, whose blur handler commits and rebuilds the table, leaving the browser focusing a detached cell. `focusCell` now re-resolves the cell when that happens (`src/grid/index.ts`); it showed up as lost focus after Insert, and would have bitten any synchronous rebuild.

**Found in review:** the checkboxes were in the native tab order while the cells were not, so Tab and Shift+Tab walked the checkbox column instead of the grid; checkboxes are now `tabIndex = -1` and the cell is the focusable thing. The new-task row only handled Enter, so there was no way back off it: ArrowUp now returns to the last row and Shift+Tab to its last cell, committing anything typed on the way. The grid now carries a roving tab stop (spec §4b.4): one cell is in the page's tab order and follows the place, so the keyboard enters the grid once and leaves once; focusing that cell from the keyboard places the grid there.

**Human review:** in Edge and Firefox, walk the §4b.4 table on the example file — especially Alt+Shift+Left/Right, Insert, Tab and Space.

---

## Task 15 — Grid: comment rows, diagnostics, polish

**Deliverables**

- Comment and blank lines as greyed full-width editable rows; front matter as one collapsed read-only row.
- Diagnostics on cells per §4b.2; span-less diagnostics on the WBS cell.
- Dark mode for the grid via the existing tokens (the Task 10 colour test must still pass).
- The app remembers the last-used editor (per-viewer convenience only).

**Acceptance criteria**

- [x] A comment row edited to remove the `//` becomes an item row on the next render, and vice versa. (Since Task 22, not the other way: a title cell edits only the title, so `//` typed there is quoted and stays in the title; spec §4b.1.)
- [x] Deleting a comment row deletes exactly that line.
- [x] A blank row between two items renders and can be deleted; inserting above an item with a blank line above it inserts directly above the item, not above the blank.
- [x] `4 hours` in an estimate cell shows a warning outline with the correct message on hover; fixing it clears immediately.
- [x] The unclosed-front-matter warning shows on the front matter row. (Since Task 21 it is an error, and the lines after the opening `---` are rows.)
- [x] Manual, both themes: derived vs override vs additive summable cells, done rows, focused cell, selected row, editing cell, comment rows, warning and info outlines are all distinguishable. — **browser pass pending review** (the automated colour-token test still passes; the grid adds no literals).
- [x] Manual: 500-line file; arrow-key navigation and typing feel instant. — measured in jsdom: 1.3 ms per arrow key, 70 ms for a full 500-row rebuild (jsdom builds DOM several times slower than a browser; a rebuild happens once per committed edit, never per keystroke). **Browser pass pending review.**

**Core change:** `Model` gained `lines` — every line of the file as `parse` classified it (spec §3.2). The grid shows comment, blank and front matter lines, and the alternative was re-implementing §2.2 line classification outside core. Renderers ignore it.

**Decisions taken:** a non-item row is a WBS cell plus one cell spanning the rest, holding the raw line text including its indentation; editing it is a whole-line replacement (`setLine`), which is what makes a comment turn into an item and back. Front matter is one collapsed, non-navigable row — it is read-only, so it has no cells the keyboard can land on, and any diagnostic inside the block shows there. The trailing blank line that a file ending in a newline always has is a row like any other, which is what the text editor shows too. (Removed deliberately in Task 21: `Model.lines` comes from rows, which has no line for the empty text after a final newline, so the grid no longer shows a row for it.)

**Fixed on the way:** cells set `className` after `addCell` had added the diagnostic class, so warnings on the WBS and raw cells were invisible (the `title` was there, the outline was not). `addCell` now takes the class name. Toolbar enablement was re-splitting the whole document three times per focus move; it now uses the row's own indent and line number, which are the same conditions the operations apply (the disabled-state tests cover the equivalence). Arrow-key cost went from 8.6 ms to 1.3 ms on 500 lines in jsdom.

**Human review:** in both themes, check a file with comments, a blank line, front matter, a `4 hours` estimate and an override that differs — and try a 500-line file.

---

## Task 16 — Workspace, specs and conformance suite

No implementation code. This task turns the specs into tests before anything is built, so spec bugs surface as failing fixtures rather than as design arguments halfway through the parser.

**Deliverables**

- npm workspaces: the app stays at the root; `packages/rows/` gets its own `package.json` (no runtime dependencies), `tsconfig`, and Vitest config. `npm test` at the root runs both.
- `packages/rows/spec/`: `rows.md` (0.6), `rows_extensions.md` (0.3), `text_anchors.md` (0.2). `packages/rows/DESIGN.md` from `rows-library-design.md`.
- `profiles/plan.rows` at the repo root.
- `packages/rows/conformance/`: cases per DESIGN §8, plus a runner (`conformance.test.ts`) that loads every case and, for now, expects `parseRows` to be missing (the suite is skipped until Task 17).
- ESLint: `packages/rows/src` imports nothing outside itself; the app imports `rows` only through its entry point.
- CLAUDE.md: add the rows boundary rules above; add "rows behaviour lives in `packages/rows` and its specs — if the plan tool needs different behaviour, change the spec first."

**Acceptance criteria**

- [x] A case exists for every example in all three specs, every row of both recovery tables in base §6, and every error named in extensions §3–§7. — 143 cases. Case names start with the spec section they come from, and each `expected.json` names its sources in `spec`.
- [x] Every structural-error case has a strict variant expecting `failed: true`. — 58 `--strict` variants expecting `failed: true`, covering syntax errors too, plus three validation-only variants expecting `failed: false`. The runner checks that every case with a syntax or structural error has one, and that it matches its tolerant case.
- [x] `examples/example.plan` (with `profile: plan`) is a case, run with the plan profile supplied as a built-in named profile. — `plan-example`. The fixture file itself is unchanged; see below.
- [x] `expected.json` files were written by hand from the specs, not generated.
- [x] `npm test` is green at the root; the app's tests are unchanged. — app 342 tests as before; rows 269 shape checks, with the 204 case runs skipped until `parseRows` exists.

**Spec questions:** 23 raised and all settled; none open. The specs are now base 0.7 and extensions 0.4; Text Anchors is unchanged. Each decision and the sections it changed are under Resolved in `packages/rows/conformance/QUESTIONS.md`. No case is disputed.

**Decisions taken:** the error codes live in the table in `conformance/README.md`. The specs define only classes, so the fixtures needed a vocabulary; Task 17's `errors.ts` must use it. Beyond DESIGN §8, `expected.json` can assert `table` and `columns` (the resolved schema), because several frontmatter recoveries are visible only there. It also carries `needs: types | extensions`, so Task 17 can run only the cases it covers. `options.json` adds `profileFiles` (path profiles, since a callback can't be JSON) and `defaultProfile`. The runner's projection from `RowsDocument` to the fixture shape assumes DESIGN §4's types; Task 17 fixes it to the real ones.

**Not done, deliberately:** `examples/example.plan` still has `columns:` rather than `profile: plan`. Changing it fails two app tests, because the current parser reports `profile:` as an unknown key. It switches in Task 21, when the old parser goes. `plan-example` is the file as plan spec §2.10 shows it.

**Spec fix:** extensions §3.2, `Auth | id=auth → the same row (in a file where identity applies)`.

**Human review:** read the `expected.json` files. Each one is a claim about what the spec means; any you disagree with is a spec change.

---

## Task 17 — rows: frontmatter, schema and tokenizer

**Deliverables**

- `parseRows` per DESIGN §4, up to typed values: normalisation, frontmatter grammar (base §2.1), keys, profiles (named via `profiles`, paths via `resolveProfile`, the forbidden-key list in §2.3), column declarations and options (base §4), `tokenizeLine`, cells, quoting and escapes, named cells, overflow, both recovery tables, strict and tolerant modes.
- Every span per DESIGN §4. Stable error codes in `errors.ts`.
- `Value` for `text` only in this task; other types come in Task 18.

**Acceptance criteria**

- [x] All base conformance cases that don't depend on types or extensions pass. — every case now has a `stage` (base, types or extensions) in place of `needs`, and the runner runs only `ENABLED_STAGES`, which is `base` for now. 66 base cases, plus their strict variants, pass; the 113 types and extensions runs show as skipped.
- [x] Property test: for generated files, the concatenation of every `Line`'s text with newlines reproduces `doc.text` exactly. — 2,000 generated files plus every conformance input (`tests/properties.test.ts`).
- [x] Every cell's `valueFrom..valueTo` slice, decoded, equals its `text`. — checked with a decoder written independently in the test.
- [x] `tokenizeLine` and `parseRows` agree on every token boundary for every conformance input. — and on every line kind, over the generated files too. The parser scans rows with the same `scanRow` that `tokenizeLine` flattens.
- [x] Strict mode never throws.

Each property test was checked by planting a bug (an off-by-one in value spans, then a wrong line offset) and confirming it fails.

**Open spec questions:** Q24–Q30 in `packages/rows/conformance/QUESTIONS.md`, raised by implementing the base stage: delimiter lines and whitespace, quoted option values, empty declarations, how many errors for several unnamed cells after a named one, profile files without frontmatter or with an unclosed one, what counts as whitespace, and trailing whitespace in an unterminated quote. Each has a disputed base case, and the parser implements the used reading.

**Decisions taken (DESIGN-level, not spec):**

- `Row.cells` includes the lead at index 0, so `cells[i]` lines up with `schema.columns[i]`.
- `Schema` is `{ table, format, sep, comment, keys, lead, columns }`. `Column.type` is the type string as written until Task 18, except that `ref` reads as `text` in a base-only parse (base §9). `Column.from`/`to` exist only for a declaration written unquoted in this file.
- An unclosed opening `---` is a line of kind `fm-malformed`, since DESIGN's kinds have none for "ignored".
- `tokenizeLine` takes `state: 'start' | 'frontmatter' | 'body'` and returns `next`. A highlighter can't know that a frontmatter block is never closed, so it shows such a file as frontmatter to the end. Tokens don't overlap; a quoted value carries its escapes as sub-spans.
- An unresolvable `defaultProfile`, or one with errors, is reported on line 1, because it has no line in the file.
- `Cell.value` is set for text columns only; the types stage fills in the rest.

---

## Task 18 — rows: types and validation

**Deliverables**

- Typed values for every base type, including the duration grammar with `unit=`, `hpd=` and `dpw=`; `durationToMinutes`.
- `required`, `unique`, `default=` and invalid-option recovery.
- Unknown and malformed types per base §5 and §6.

**Acceptance criteria**

- [x] All base conformance cases pass. — `ENABLED_STAGES` is now base and types. The 87 extensions cases, and their strict variants, are the only ones skipped.
- [x] Duration table: `4h`, `4 h`, `1d 4h`, `2 d 4 h`, `+2d 4h`, `1.5d 4h`, `-30m` valid; `4 2d`, `2d 4`, `1d1d`, `2dh`, `d 2`, `4x` invalid; `4` valid only with `unit=`. — `tests/values.test.ts`, and the `base-5-duration*` cases.
- [x] `durationToMinutes` converts m↔h always, d↔h only with `hpd`, w↔d only with `dpw`, and otherwise reports which option is missing. — `w` needs both `dpw` and `hpd`; `needs-dpw` is reported first. A term counts when it is present, even as `0w`.
- [x] A `default=` that doesn't match its type is a structural error and the option is ignored.

Real calendar dates (Q12) apply: `2026-02-30` is invalid, `2028-02-29` valid. `datetime` follows RFC 3339 §5.6, including lower-case `t` and `z` and a seconds value of 60. `order` comparisons are left to Task 19.

**Spec questions:** Q31–Q36, raised by Tasks 17 and 18, were settled after review (see Resolved in `packages/rows/conformance/QUESTIONS.md`). They added `empty-value` and `duplicate-option` to the error codes, and value equality to base §5. Settling them raised Q37 (duration equality details) and Q38 (enum value edges), which are open with disputed cases.

**Decisions taken (DESIGN-level):** `Column` gains `kind`, `enumValues`, `required`, `unique`, `default` (a `Value`), `unit`, `hpd` and `dpw`. `type` is the type after recovery, with enum values trimmed, so `enum[ low , high ]` reads as `enum[low,high]`. `ref` columns keep `kind: 'ref'` with a null value until Task 19. Declaration errors that come from a profile still collapse into `profile-has-errors` (base §2.3), so an unknown type in a profile fails strict mode.

---

## Task 19 — rows: extensions

**Deliverables**

- Implicit columns (extensions §2); key and anchors including aliases and the "identity applies only when…" rule (§3); markers (§5); nesting with tolerant recovery and "a recovered row opens its own indent" (§6); `ref` columns within the file, with `many` and `qualifier` (§4.2–4.3); `order` (§7).
- `include` is parsed but never resolved in v1: each include is a structural error and references into it are validation errors, per §4.1.

**Acceptance criteria**

- [x] All conformance cases pass, including the plan example. — every stage is enabled, and nothing is skipped.
- [x] The `A / B / C / D` nesting example in extensions §6.2 gives exactly the tree the spec describes, in tolerant mode, and fails in strict mode. — `ext-6.2-example` and its strict variant.
- [x] `~ Login page`, `~~Login`, `"~Login page"` and `~!Login page` match the extensions §5 examples. — `ext-5-example`, `ext-5-repeated-marker`.
- [x] A file with a declared `id:number` column and no anchors and no `key:` has no identity and no uniqueness check on `id`. — `ext-3.1-no-identity`.
- [x] Cycles via the parent column are validation errors and do not hang the parser. — `ext-6.2-parent-cycle`, a 500-row cycle in `tests/extensions.test.ts`, and 1,000 generated nested files in which rows reference each other (138 of them have cycles).

**How it's built:** markers and anchors are part of the lead cell, so `scanRow` reads them, and `tokenizeLine` gains `marker` and `anchor` tokens. Its context takes the document's markers, and `extensions: false` for a base-only parse. Whether identity applies depends on whether any lead has an anchor, so `parseRows` scans every row before it adds the implicit columns. `src/extensions.ts` then handles marker conflicts, IDs, references, nesting and order. Ordering uses `compareValues` in `values.ts`, next to `equalityKey`, so `order` and `unique` share one definition of values.

**Settled by analogy** (Resolved in `QUESTIONS.md`, each with spec text and cases):

- A1: an empty `order:` takes its default, an empty `key:` is treated as unset, and empty `nest:`/`markers:`/`include:` declare nothing (Q31; adjusted after review so that an empty `key:` doesn't make identity apply).
- A2: a repeated marker name or character is an invalid entry (Q38).
- A3: `many` and `qualifier` misused as the base options are, and a qualifier written `NAME[:TYPE]` like a declaration (Q36, base §4).
- A4: invalid values under `order` compare as text with each other, and are skipped against valid ones (Q34).

The extensions spec is at 0.6, after the analogies and the Q40/Q41 settlement. The references to base 0.8, which I missed when bumping base, are fixed in DESIGN, the plan spec and the conformance README.

**Spec questions:** Q40 (a marker character is one code point, not a Unicode letter or digit) and Q41 (a `ref` qualifier type is reserved) were raised and settled. None are open.

**Decisions taken (DESIGN-level):** `Schema` gains `identity`, `key`, `nest` (`{ column, valid }`), `markers`, `order` and `includes`. `Column` gains `refTable`, `refCurrent`, `refKnown`, `many` and `qualifier`. A reference's value exists whenever its syntax is valid, with `target: null` when it doesn't resolve. A cell with several references and no `many` has no value. Errors on references use the cell's span.

---

## Task 20 — rows: edit API

**Deliverables**

- `setLead`, `setCell`, `setMarker`, `insertRow` and `formatValue` per DESIGN §6.

**Acceptance criteria**

- [x] The property test in DESIGN §6 runs over at least 1,000 generated documents and edits per function. — it reuses Task 19's generators (now `tests/generators.ts`): 4,000 files, general and nested, with markers, anchors and references. One edit per file: `setLead` on 3,556 files, `setCell` writing on over 1,000, `setMarker` on over 1,000, and `insertRow` on over 3,000 (the rest refused for their indent). After parsing, the target reads back as intended, every other row, cell, marker, anchor and non-row line is unchanged, and the text has no syntax or structural error it didn't have before (counted by code). A refusal must be a documented one, and an empty edit list a real no-op. A planted bug (appending after a trailing delimiter) fails it.
- [x] `setLead` on `    ~Login page {#login} | 4h` changes only the title; the indent, marker, anchor and cells are untouched.
- [x] `setLead` with a title beginning `~` (when `~` is a marker), `# ` or ending `{#x}` produces a quoted lead that reads back as that exact title.
- [x] `setCell` on `Auth | 2d` for `notes` (third column) writes `notes=…`, not padding; for `owner` (next slot) writes ` | bob`.
- [x] `setCell` with a value containing `|` quotes it.
- [x] `setCell(null)` on a trailing cell removes it and its delimiter; on an interior cell empties it.
- [x] `setMarker(done, false)` on `~Login` removes the `~`; on a row with `done=true` by name removes the named cell.

**Decisions taken:** in DESIGN §6, under "Details the rules above leave open". Every edit function returns `EditResult = { edits: TextEdit[] } | { refused: string }`: `{ edits: [] }` when there is nothing to change, `{ refused }` with the reason when the edit can't be made. They throw on host mistakes (an unknown column or marker name) and refuse on document states. The only refusals:

- `setCell` on the key of an anchored row, set to null or a non-ID, since a valid ID renames the anchor instead (the anchor only; in-file references aren't rewritten, `renameId` is deferred in plan spec §7).
- `setCell` on a column that can't be named when it isn't the next slot, since writing it would need padding. `setMarker` refuses in the same case for a column without a marker, and when a contradicting cell can't be corrected.
- `insertRow` at an indent that nesting doesn't allow there, for the new row or a row after it. The check uses the parser's own indent walk, `indentLevels` in `extensions.ts`.

**Changed by Task 23:** `setCell` now pads with empty cells up to a column that can't be named (DESIGN §6), and refuses only when the row has a named or overflow cell for the padding to follow; `setMarker` likewise. Emptying a named cell before an overflow cell writes `NAME=` with no space before the next delimiter, and also applies before a repeat of the same column.

Removing the only marker before an empty lead writes the lead as `""` (`~` becomes `""`, `~ | 1d` becomes `"" | 1d`), so the row doesn't begin with the delimiter. A setLead on a quoted lead with an anchor keeps the anchor after the closing quote (Q13). No spec questions came up.

---

## Task 21 — Plan core on rows

Replace the plan's own parser with the rows library. `compute`, renderers and exporters should not need to change beyond the type of the tree they read.

**Deliverables**

- `readPlan(doc) → Tree` per spec §2.4–§2.6 and §3.1, with outline numbers from the rows parent relation.
- `analyze(text, filename?)` per spec §3.2 (since Task 29, `analyze(text, { filename })`); the plan profile built in as a named profile; `defaultProfile` applied per spec §2.1.
- Diagnostics per spec §2.9, including the `error` severity and the `fixes` field; the three fixes in §2.3 and §2.6.
- `Model.lines` built from rows lines; the `reserved` line kind is gone.
- The old `parse`, `parseColumns` and duration parser are deleted.
- Spec updated wherever the implementation disagreed.

**Acceptance criteria**

- [x] The §2.10 example computes exactly the table in the spec. — `tests/core/example.test.ts`, unchanged, on `examples/example.plan`, which now says `profile: plan` and is byte-identical to the `plan-example` conformance input (a test checks this).
- [x] Every compute, renderer and exporter test passes. Tests that asserted old parse behaviour are rewritten against the new spec, and each rewrite is listed in the task notes with the reason. — compute, renderer and exporter tests are unchanged. Rewrites are listed below.
- [x] A legacy file (no `profile:`, `columns: est:duration | owner:text`, values `2d` and `4`) opened as `.plan` shows the conversion warnings, and applying the fix makes them disappear and the totals appear. — `tests/core/diagnostics.test.ts`: `unconvertible-duration` on `2d` and rows `invalid-value` on `4`, both with the fix "Add unit=h hpd=8 dpw=5". After the fix there are no diagnostics and the total is 20h.
- [x] `<!-- note -->` shows an info with a working fix to `// note`. — `tests/core/diagnostics.test.ts`.
- [x] The `0 / 8 / 4` file gives the same tree and outline numbers as before, plus one structural error. — `tests/core/parse.test.ts`: `bad-indent` on line 3.
- [x] Unclosed frontmatter leaves every row visible. — `tests/core/diagnostics.test.ts` and `tests/grid/grid.test.ts`. The lines after the opening `---` are rows, with one `unclosed-frontmatter` error on line 1.

**How it's built:** `src/core/read.ts` has `readPlan`, and `src/core/profile.ts` has the built-in plan profile, identical to `profiles/plan.rows` (a test checks this). `analyze` calls `parsePlan` (tab conversion, then `parseRows` with the plan profile and `defaultProfile`), then `readPlan` and `compute`. `parse.ts` and `columns.ts` are deleted, and `duration.ts` keeps only `formatDuration`. Each `ItemNode` keeps its rows `Row`. `titleSpan`, `span`, `indent` and the per-column field spans are rows spans, so `src/grid/edits.ts`, which counts `|`, keeps working on files without named or quoted cells. Fields are now one per declared column, with `null` for an unset cell. `compute` no longer parses: it reads each field's `amount` (hours, or the number) and `additive`. The shell passes the file name to `analyze`. Lint lets `src/core` import `rows`, and outside core forbids `parseRows`, `parsePlan`, `readPlan` and `compute`.

**Timing** (`analyze` on a 500-line plan with 444 items, Node, median of 1,000 runs after warm-up): before 0.32 ms (p99 0.75 ms), after 1.33 ms (p99 2.1 ms). About 4× slower, and well inside the 50 ms debounce.

**Decisions taken:**

- Model columns are the declared columns only. `done` is read as each item's own done flag: the `done` marker, or `done=true` by name. Every type other than `duration` and `number` is a text cell showing its decoded text.
- A negative value is checked from the text, for `number` as well as `duration` columns.
- The conversion fix adds only the options the declaration lacks. It is offered only when the declaration is in the file (spec §2.6 updated).
- The plan's own diagnostic codes are listed in spec §2.9.
- `analyze` still converts tabs with an info. The app already converts them on load and paste, so this only matters for text that bypasses those (spec §3.2 updated).
- Items follow `row.children` from rows. Roots are the rows with no parent, in file order.

**Rewritten tests:**

- `tests/core/helpers.ts`: `load` builds the tree with `parsePlan` and `readPlan`, since `parse` is deleted. It takes an optional filename.
- `tests/core/parse.test.ts`:
  - "0 / 8 / 4 … no diagnostic" now expects one `bad-indent` error (§2.4).
  - "a comment line between siblings…": `# heading` is now an item with a `heading-line` error, since the `reserved` kind is gone. It takes number 2, and the next root is 3.
  - The two lossless round-trip tests expect one fewer line, since rows has no line for the empty text after a final newline. `<!-- -->` and `#` lines are now items.
  - "trailing |…": fields are one per declared column, and an empty cell is `null` (rows base §3), where it used to be `''`.
  - "fields carry…": `Field.value` is now `Field.text`.
  - "front matter must start on line 1": reads `tree.doc.frontmatter`.
- `tests/core/diagnostics.test.ts`:
  - `#` line: `error`, was `warning`.
  - More cells than columns: `error` (`too-many-cells`), was `warning`.
  - Invalid compound durations: assert the rows code `invalid-value`, not the old parser's messages. The separate bare-number message is gone.
  - Unknown key: `info`, was `warning`. The test also checks that `x-` and extension keys are known.
  - Duplicate column name: `error`, was `warning`.
  - Unclosed frontmatter: one `error`, and the rows stay visible. The old test asserted that every line was front matter.
  - Added: `<!--` with its fix, the legacy file, fix options, and negative values.
- `tests/core/columns.test.ts`: rewritten, since `parseColumns` is deleted. It covers the same cases through `analyze().columns`. An unknown type is rows' `unknown-type` warning, and duplicate names are an error. Added: non-summable types, the plan profile and `defaultProfile` by file name, done by name, and the example matching the conformance case.
- `tests/core/duration.test.ts`: the `parseDuration`/`parseNumber` tests went with the parser. The grammar is rows' and covered by the conformance suite. They are replaced by tests that read values as hours through `analyze`. `+ 2 d 4 h` was dropped at first, since rows didn't allow whitespace after the sign. It is back since base 0.9 (A5). The `formatDuration` tests are unchanged.
- `tests/editor/diagnostics.test.ts`: in the §2.9 table, `#`, overflow, duplicate column and unclosed frontmatter are now `error`. The unclosed one underlines `---`. An unknown key is `info` and underlines the key. Added: HTML comment and unconvertible duration.
- `tests/editor/language.test.ts`: line 2 of the example is now `profile: plan`.
- `tests/grid/grid.test.ts`:
  - Enter and ArrowUp/Shift+Tab on the last row: there is no trailing blank row any more, so the last row is line 3.
  - The offending-cell hover: the message is now rows'.
  - Overflow on the WBS cell: now an `error` spanning the overflow cell (§4b.2).
  - Unclosed frontmatter: `error`, and the lines after it are items.
  - `#` line: an item, with the error on its title cell.
- `tests/app/shell.test.ts`: the `#` line is an `error` and `4x` a `warning` with rows' message, so ranges and gutter markers are counted per severity.

**Left for Task 22:** the grid has no style for the `error` class yet, so errors outline only in the text editor (spec §5.3 tokens). `src/editor/lines.ts` still has its own `reserved` line kind, for the old highlighter that Task 22 deletes. Fixes aren't shown as lint actions yet.

**Spec questions:** none. Nothing in the rows specs was ambiguous for this task, so `QUESTIONS.md` is unchanged.

---

## Task 22 — Editors on rows

**Deliverables**

- Text editor highlighting from `tokenizeLine` (spec §4.1); the old tokenizer is deleted.
- Lint severities including `error`; fixes as lint actions (spec §4.4). Theme tokens for the error colour in both themes.
- Grid cell edits through the rows edit API (spec §4b.2); `src/grid/edits.ts` shrinks to calls into it. Error outlines in the grid.
- Open accepts `.plan` and `.rows`; Save As defaults to `.plan`; new documents start with `profile: plan` (spec §6).
- `toggleComment` takes its marker from the document.
- The highlighter takes the frontmatter extent from the latest parsed document when one exists.

**Acceptance criteria**

- [x] Highlighting distinguishes markers, anchors, cell names, quoted values and escapes, and never disagrees with the parser (a test runs both over every conformance input). — `tests/editor/syntax.test.ts`, over all 253 cases: line kinds, and per row the markers, anchors, names, quoted values and which values get a type colour. It failed first on `base-6-row-invalid-cell-name` (see below).
- [x] In the grid, typing `a | b` into notes produces `notes="a | b"` or a quoted positional cell, and reads back as `a | b`. — both, in `tests/grid/grid.test.ts`: named on a row that sets `owner=bob`, positional where notes is the next slot.
- [x] Renaming a titled row with an anchor in the grid keeps the anchor. — and the marker and cells.
- [x] Toggling done in the grid on a row with markers and anchors changes only the marker. — asserted on the whole text, both ways.
- [x] Lint action "Add unit=h hpd=8 dpw=5" is undoable with one Ctrl+Z. — `tests/editor/fixes.test.ts`, through the mounted text editor and a `CodeMirrorBuffer`: one buffer change with origin `text-editor`, and one Ctrl+Z keydown restores the text and both diagnostics.
- [x] The colour-token test still passes.
- [x] Manual, both themes: error, warning and info are distinguishable in the text editor and the grid. — checked in the browser, with the rest of the Task 22 manual checklist (token colours, done dimming, unclosed frontmatter, lint fix undo, `comment:` toggling, named/quoted/anchored grid edits, refusal notes, a refused insert kept as a draft, Open/Save As file types).

**How it's built:**

- `Model` gained `doc`, the rows document it was read from (spec §3.2). The grid needs it for the edit API and the highlighter for its context. Renderers ignore it.
- Highlighting: the `StreamLanguage` is gone, since it can't see the parsed document. `src/editor/syntax.ts` is a pure `styleLine(text, state, syntax)` over `tokenizeLine`. `src/editor/language.ts` keeps the latest model's syntax (sep, comment, markers, column types, frontmatter end) and done lines in a state field, mapped through edits until the next model. A view plugin decorates the visible lines. Done lines, own or inherited, come from the model as line decorations.
- Lint: `error` has its own underline and gutter marker. Fixes are lint actions that apply through `buffer.apply(…, 'text-editor')`, and do nothing if the text changed since the diagnostic was made.
- Grid: `src/grid/edits.ts` is `setTitle`/`setField`/`setDone`/`insertItem` over `setLead`/`setCell`/`setMarker`/`insertRow`, each returning `EditResult`, plus `setLine` for comment and blank rows. One `write` path in the grid applies the edits or shows `Not changed: <reason>` in a `role="status"` note beside the cell, leaving the cell and buffer as they were. The note goes on the next redraw or after 4 s. A refused checkbox is unticked again. A refused inserted row stays a draft with its text. The done checkbox and toolbar button are disabled when the document has neither a `done` marker nor a bool `done` column.
- `toggleComment(text, range, comment = '//')`; the keymap passes the document's marker. Folding and Ctrl+Shift+Up classify lines with it too, and `src/editor/lines.ts` lost `reserved`.
- Open accepts `.plan` and `.rows`; Save As still defaults to `untitled.plan`.
- Theme: `--tok-done-marker` is now `--tok-marker` (every marker gets it). New `--tok-anchor`, `--tok-name`, `--tok-quoted`, `--tok-escape`, `--diag-error`.

**Decisions taken:**

- The highlighter resolves cells with the parser's rules, not just token positions. The tokenizer marks `ratio=` as a cell name, but the parser reads an undeclared name as part of an unnamed cell, and an unnamed cell after a named one, or past the declared columns, as overflow. The conformance test caught this, and DESIGN §7 now says so.
- The grid refuses an edit while its model trails the buffer (the shell's 50 ms debounce), with the same note. Before this task that case silently wrote at stale offsets.
- Typed values are trimmed and tabs become spaces before they go to rows. A title that is unchanged after trimming is a no-op.
- "New documents start with `profile: plan`": the only document the app creates is the startup one, `examples/example.plan`, which already says `profile: plan`. There is no New command, so nothing else changed.

**Rewritten tests:**

- `tests/editor/language.test.ts`: rewritten for the decoration highlighter in a jsdom view. The token-class checks moved to `tests/editor/syntax.test.ts`. `~` is `cm-plan-marker` (was `cm-plan-done-marker`), and done is a line class. "leaves reserved `#` lines to the diagnostics layer" is gone: a `#` line is a row.
- `tests/grid/edits.test.ts`: rewritten for `EditResult` and the rows rules: named rather than padded cells, quoting, anchors kept, `done=true` removed, `insertItem` refusals.
- `tests/grid/grid.test.ts`: "pads a title-only line…" now expects `Auth | notes=later`. "turns a comment row into an item row…, and back again" drops the "back again": `// Audit log` typed into a title is quoted.

**Cleanups after review:** `Model.doc` is for editors only (spec §3.2, CLAUDE.md non-negotiable 10); lint forbids `src/renderers/` and `src/exporters/` from importing `rows`. `insertLineAbove`, which had no caller left, is deleted with its tests and removed from spec §3.8. The `@lezer/highlight` devDependency is removed.

**Spec questions:** none opened. The DESIGN §7 addition describes existing parser behaviour.

---

## Task 23 — Repair model and structure operations

**Deliverables**

- rows: `setLevel`, `moveRow`, `deleteRow`, `repairRow` and the `setCell` padding exception (DESIGN §6 additions), with the property tests extended to cover them. The fuzz generators must include files with bad indents, overflow and syntax errors.
- The `Fix` model with tiers (spec §4b.6.2). Existing fixes get tiers: the hpd fix is `click` and the `<!--` fix is `confirm`.
- The grid's structure operations use the level-based edits (spec §4b.6.4), and every grid edit applies `repairRow` to the rows it touches, in the same transaction.
- The problems list (spec §4b.6.3).
- The tree and title fixes from spec §4b.6.6.

**Acceptance criteria**

- [x] Property test: `setLevel`, `moveRow`, `deleteRow` and `repairRow` never add a syntax or structural error, and `repairRow` is idempotent. — `packages/rows/tests/edit.test.ts`. The generators gained `generateBroken`: 1,000 nested files with bad indents, tabs, overflow, unnamed cells after named ones, undeclared names, repeated markers, heading titles, unterminated quotes, text after a quote, unknown escapes and rows beginning with the delimiter. Every property test now runs over 5,000 files. `setLevel` writes on at least 1,000 of the 2,151 nested files, `moveRow` moves on at least 2,000 files, `deleteRow` deletes on at least 3,000, and `repairRow` repairs at least 1,000 rows (every row with an error). After parsing, no syntax or structural error is added (counted by code), and every value is unchanged apart from indents. The tree keeps its shape: `setLevel` keeps the row's descendants its descendants; after `deleteRow` its children take its parent; after `repairRow` every row keeps its parent. A refusal must be a documented one. `repairRow` on its own output returns nothing. A planted bug (snapping the row without the rows at its level) fails it.
- [x] `A / B / C / D` (from extensions §6.2): deleting `B` gives a valid file whose tree is `A` with children `C` and `D`. — in rows and through the grid (`tests/grid/repair.test.ts`).
- [x] On a `0 / 8 / 4` file, "Insert above" on the third row succeeds, and the third row is rewritten to a valid indent in the same undo step. — the draft shows at indent 8, the result is `A / B / X / C` with `B`, `X` and `C` at 8, the file is valid, and one undo restores the original.
- [x] Moving a first child above its parent gives a valid file. — `Auth / Login` becomes `Login / Auth`, both at indent 0. (Since Task 24: by Outdent, then Move up; Move up is disabled on a first child.)
- [x] A grid edit to a row with an unterminated quote in another cell leaves that cell's text unchanged and removes the error. — editing the estimate of `Login | 4h | alice | "call Bob | then Alice` closes the quote; notes still reads `call Bob | then Alice`.
- [x] Opening a file with errors, or applying a remote change (simulated with `buffer.apply` using origin `remote`), writes nothing. — the grid test records every buffer change: none on opening `tests/fixtures/repair-cases.plan`, and only the `remote` one after it. Repairs are made only by grid edits (`withRepairs`), never by `analyze`.
- [x] Every diagnostic on a fixture with one of each case in spec §4b.6.6 appears in the problems list, and clicking it focuses the right row. — `tests/fixtures/repair-cases.plan` has every case but the unclosed `---`, which can't coexist with the other settings cases and has its own test. Entries are in document order. Clicking one focuses a cell in its row, and a front matter entry has no row to focus.
- [x] A grid edit plus its `auto` fixes undo with one Ctrl+Z. — over a `CodeMirrorBuffer`: one buffer change with origin `grid`, and one Ctrl+Z in the grid restores the text.

**How it's built:**

- rows (`packages/rows/src/edit.ts`): `setLevel`, `moveRow`, `deleteRow`, `repairRow` and `levelIndent`, all on the parser's `indentLevels`. `setCell` pads up to a column that can't be named. `formatValue`'s quoting is shared with `repairRow` for overflow cells.
- core: `Fix` has a `tier` and an optional `preview` (spec §4b.6.2). `src/core/fixes.ts` adds the tree and title fixes to the diagnostics of the rows errors they resolve: `Rewrite the indent` or `Indent 0`, `Quote the title` and `Rewrite the cell` (auto, from `repairRow`), `Use indentation` and `Remove extra marker` (click). The hpd fix is `click`; the `<!--` fix is `confirm`, with a preview of the lines before and after.
- grid (`src/grid/edits.ts`): `insertIndent`, `shiftItem`, `moveItem` and `deleteItem` over the rows functions, and `withRepairs`, which adds the repairs of the touched rows to an edit as one change. Cell, done and fix edits touch their row. "Insert above" touches the row it goes above, and structure operations touch the row they act on, taking only its cell repairs. Refusals show in the usual note. Comment and blank rows keep the `src/editing/` line operations.
- grid (`src/grid/index.ts`): the problems list is a `<details>` between the toolbar and the sheet, `Problems (n)` in its summary, closed by default. Each entry shows the severity, the row's title (or `Line n`), the message and a button per fix. A `confirm` fix shows its preview with Apply and Cancel first.

**Decisions taken** (spec §4b.5, §4b.6.1 and §4b.6.4, and DESIGN §6):

- Indent and outdent move the row's descendants with it, as MS Project does. Moving only the row would hand its children to another parent or leave them at no level. Rows after the subtree keep their indent, so outdenting a row makes its later siblings its children.
- Move up and down move the row alone, as the spec says, and refuse when no indent for it avoids a new indent error. The common case is a parent moved below its first child. The snapped indent is the valid one nearest the row's old level, then nearest its old indent. (Changed by Task 24: they move the row's subtree past its sibling's, and never refuse for the indentation. A first child moves above its parent by outdent, then Move up.)
- The indent repair moves the rows the parser put at the repaired row's level, or below it, by the same amount. Snapping only the row would give those rows a bad indent, or new parents: in `A / B(8) / C(4) / D(4)`, `D` must move to 8 with `C`. When that would still change a parent, there is no indent repair.
- A repair that collides with the grid edit is left out, and the edit is kept. In a cell, that is one that overlaps or touches the edit, since an append after a broken cell already closes it. For the indent repairs, which go together, it is one that overlaps the edit.
- "Level" is the depth in the indentation tree, not the `parent=` relation. Rows added `levelIndent` for "Insert above", since `insertRow` takes an indent.
- `deleteRow` refuses to delete the last anchor while another row sets the implicit `id` by name. Without identity (ext §3.1), that cell would name no column: a new structural error. The generator found this.
- Fix buttons apply the fix's edits alone, with no repairs added, so a `confirm` fix writes exactly what its preview showed.
- The cell `auto` repairs are already offered in the problems list (`Rewrite the cell`), since `repairRow` makes them for this task anyway. The other cell fixes, and the settings and identity fixes, are Task 24's.

**Bugs the new generator found in existing rows code:**

- `parseDuration` threw on a quoted duration containing an escaped newline. `(.*)$` doesn't match across `\n`, and the regex is now `[\s\S]*`. The value is invalid, as it should be (`tests/values.test.ts`).
- `setCell(null)` on a named cell before an overflow cell wrote `NAME= |`. The space after `=` unnamed the cell (base §3), so one structural error turned into another. It now writes `NAME=|`.
- `setCell(null)` on a cell whose column is set again later removed it, and the repeat became the value. It now empties the cell.

**Rewritten tests:**

- `tests/grid/grid.test.ts`:
  - "deletes a row and re-attaches its children…" now expects the children promoted one level (`Auth / Deep`).
  - "moves a row with children by itself…" is now two tests: a leaf moved up and back with the selection following it, and a parent moved below its first child being refused with a note.
  - "Delete … deletes the line of a selected row" expects `Login` promoted to indent 0.
  - "shows why rows refused a cell edit…" now expects `Auth |  |  | later` for the unnamable `my.notes`, and the refusal on a row with a named cell.
- `tests/core/diagnostics.test.ts`: the `<!--` and conversion fixes assert their tiers, and the `<!--` fix its preview.
- `packages/rows/tests/edit.test.ts`: the `setCell` and `setMarker` properties accept a refusal only when padding would follow a named or overflow cell.

**Left for Task 24:** the text editor still applies every fix as a lint action straight away, `confirm` fixes included (their previews in the text editor are Task 24's). The problems list is not yet checked in a browser, in either theme.

**Spec questions:** none opened. The decisions above are about the plan tool's grid and the rows edit API. None of them touches the rows specs or the conformance suite.

---

## Task 24 — Typed cell editors, overflow and settings fixes

**Deliverables**

- The typed cell editors and duration normalisation (spec §4b.6.5).
- The cell, settings and identity fixes from spec §4b.6.6, with previews for `confirm`.
- The settings banner.
- The text editor offers every fix as a lint action; `confirm` fixes show their preview first.

**Acceptance criteria**

- [x] `4 Hours`, `1.5 days`, `2 wks 3d` and `90 mins` commit as `4h`, `1.5d`, `2w 3d` and `90m`. `soon` is written as typed and shows a warning. — `tests/grid/typed.test.ts`, through the grid, plus a table for `normaliseDuration`.
- [x] Normalisation never changes a cell the user didn't edit. — editing another row's estimate, or another cell of the row, leaves `4 hours` as it is, and committing it unchanged writes nothing.
- [x] `Login page | 4h | alice | call Bob | then Alice`: "Rejoin into notes" gives `notes = "call Bob | then Alice"`, which reads back exactly. — the line becomes `Login page | 4h | alice | "call Bob | then Alice"` with no diagnostics left, in core and through the grid.
- [x] Every `confirm` fix shows its preview, and cancelling writes nothing. — in the grid, every confirm fix of the three messy fixtures, with no buffer change at all; in the text editor, a panel with the preview, where Cancel, Escape and any text edit write nothing (`tests/editor/confirm.test.ts`).
- [x] "Close settings" on an unclosed block inserts `---` after the last `key: value` line, and the settings lines leave the grid. — `messy-unclosed.plan`: `---` after line 3, the two settings rows become the front matter row, and the banner goes.
- [x] "Rename the later one" on a duplicate ID warns when the ID is referenced. — `A row refers to #login. It isn't clear which task it meant, so check it after renaming.`, in the grid and the text editor; no warning when nothing refers to it.
- [x] Manual, both themes: the problems list, the banner, the badges and the previews are readable, and every fixture case can be fixed without leaving the grid. — **browser pass pending review.** Automated in part: `tests/grid/fixes.test.ts` applies the first fix in the problems list, confirming previews, until none is left, on each messy fixture; what remains is only what the spec gives no fix (values to edit, a title to type, an unknown key, an override that differs) and the profile error below. The colour-token test still passes; the new CSS uses only tokens.

**Changed first, at the start of this task** (see the Task 13 and Task 23 notes): Move up and Move down move a row with its subtree past its previous or next sibling's, enabled only when that sibling exists. rows `moveRow` swaps the two subtrees, keeping the lines between them in place, and gives each subtree the indent the other's first row had, so the tree and its errors stay as they were and it never refuses for the indentation. Its property test now checks the swapped line order and that every row keeps its parent (over 2,000 of the 5,000 generated files move; a planted bug that skips the indent swap fails it). Grid refusals are shown in plain words, mapped from rows' reasons in `src/grid/messages.ts`; a test produces each reason from rows itself, so a change of wording there fails it.

**How it's built:**

- Typed editors (`src/grid/index.ts`, `src/grid/typed.ts`): `setField` normalises typed durations; enum cells open a `<select>`, date cells a text input with a calendar button beside it that opens the browser's picker from a hidden date input (leaving the input for the button isn't a commit; the visible date input showed its own date fields squeezed under its icon), bool cells show a checkbox that a click or Space toggles through `setMarker`.
- Fixes (`src/core/fixes.ts`, `src/core/settings.ts`): overflow ("Rejoin into NOTES", "Delete extra values"), column set twice ("Keep owner=sam", "Keep owner=priya"), identity ("Rename the later one", with a `warning` when anything refers to the ID), and the settings fixes ("Close settings", "Rename column…", "Remove this setting", "Remove this option"). `Fix` gained `warning` and `input` (spec §4b.6.2): a rename takes a typed name, starting from a free one, and the preview follows it.
- rows: an error in a column declaration now spans the `:TYPE` or the option it is about (DESIGN §4), so "Remove this option" removes exactly that. The text editor underlines it too.
- Grid: the settings banner sits between the toolbar and the problems list. It groups the conversion fix, which 12 diagnostics share in `messy.plan`, into one entry. The WBS cell carries a badge with the extra values (`+ then Alice`) or a column's two values (`owner: sam / priya`).
- Text editor: a `confirm` lint action opens a panel with the preview, warning and input instead of applying.

**Decisions taken** (spec §4.4, §4b.6.2, §4b.6.5 and §4b.6.6 updated):

- "Rejoin into NOTES" starts at the notes cell. It is offered only when nothing but extra values follows, so it never absorbs another column's value. A trailing delimiter isn't part of the text. (Changed after review: no longer offered without a notes cell.)
- A cell named after an undeclared column (`priority=high`) counts as an extra value where rows put it, so rejoining a notes value quotes it.
- The two "Keep this value" buttons are labelled with their values.
- An unknown type (`due:dat`) gets "Remove this option" like a malformed one, removing the `:TYPE` so the column reads as text, as it already does. The spec's table listed only malformed types; the key asked for a fix. (Changed after review: "Change type to date" and "Remove the type", both click.)
- A repeated option: "Remove this option" removes the one rows flags, the later, so the earlier value applies afterwards. The preview shows it.
- The `<!--` fix is labelled "Make it a comment", as spec §4b.6.6 says (it was "Change to a // comment").
- An enum commits on Enter, Tab or leaving it, not on each change, so arrowing through the choices doesn't write every one.

**The messy fixtures:** `tests/core/messy.test.ts` is their reference: what each line reports and which fixes it offers. The answer key they came with was compared line by line in review and then deleted.

**Changed after review:**

- Q42 (rows): a conflict between a profile's key and the file's own declarations is reported on the file's declaration, not as `profile-has-errors`, which is only for errors in the profile's frontmatter taken alone. Base 0.10 §2.3 and §6, extensions 0.7 §5, §6.1, §7 and §10; six new conformance cases, each with a strict variant, all failing before the change. It covers a marker or nest column the file declares with the wrong type, a profile's marker character that the file's `sep` or `comment` uses, a profile's `order` naming a column the file's `columns` or `lead` replaced, and a profile column repeating the name of the file's `lead`. The plan offers "Make done a checkbox column" (`done:text` → `done:bool`, confirm) for the marker case.
- The fix invariant (spec §4b.6.1): every fix removes the diagnostic it is offered on and adds no syntax or structural error. `tests/core/fix-invariant.test.ts` checks every fix on every fixture and on every conformance input, read as a plan and as a plain rows file. It found two problems. The conversion fix was offered when `unit`, `hpd` or `dpw` was written but invalid, where it repeated the option or didn't help; it isn't offered then. "Remove this setting" on an unresolvable `profile:` in a plan document let the plan profile apply, which could conflict with the file's keys. Since what a settings fix does depends on the whole file, `readPlan` now checks each settings fix by reading the edited text, and offers it only when it holds; `analyze` passes the reader. That also covers removing `profile: plan` from a `.plan` file.
- Unknown types: "Change type to X" when a known type other than `enum` is within edit distance 2, then "Remove the type"; both click.
- `messy-settings.plan` gained `    Review`, a row with only a title; editing its second `owner` pads to `    Review |  |  | erin` (`tests/grid/fixes.test.ts`).
- "Rejoin into NOTES" is offered only when the row has a cell in NOTES; the path that rejoined from the first extra value and wrote `notes=…` is gone (spec §4b.6.6).
- Refactor, no change in behaviour: the app uses rows' exports instead of copies (`removeCell`, `isWs`, `NAME`, `RECOVERED_CODES`, `KNOWN_KEYS`, `TYPE_NAMES`, `parseDuration`, `readFlag`, column `typeFrom`/`typeTo`); `rowFixes` and `withRepairs` use rows' labelled `repairs` (`repairRow` stays, as their flattened edits, since the rows tests use it); `normaliseDuration` keeps only the unit words and asks rows whether the result is a duration (a test checks it against the old grammar on 20,000 inputs); the grid's two notions of a row's level are behind one documented helper, `levels` in `src/grid/edits.ts`; the problems list, banner and fix previews moved to `src/grid/problems.ts`.
- Fixed: the grid passed a row's shown level (its depth in the tree, which follows `parent=`) to rows' structure edits, which work in indentation levels. On an indent-0 row placed under another by `parent=`, and on its descendants, Indent was off when it should apply, Outdent did nothing, and Insert above wrote the new row one level too deep. The grid now passes the indentation level to Indent, Outdent and Insert above, and enables Indent and Outdent by it; titles are still shown at the tree depth (`tests/grid/levels.test.ts`).

**Changed by Task 31:** the plain message for `deleteRow`'s last-anchor refusal said "Other rows refer to this task by its ID, so it can't be deleted yet.", but that refusal is about identity, not references: `deleteRow` never refused a row other rows refer to. It now reads "Deleting this task would turn off task IDs in this file, and other tasks still use them. Give another task an ID first." (`tests/grid/messages.test.ts`). A row others refer to is deleted after a confirm, with its references (Task 31).

**Rewritten tests:**

- `packages/rows/tests/edit.test.ts`: the `moveRow` examples and property, for the subtree swap.
- `tests/grid/grid.test.ts`: "moves a row by itself…" now also moves a parent with its subtree; "refuses to move a parent below its first child…" became "enables move up and move down only when there is a sibling on that side"; "Alt+Up/Down move the row line" moves Admin past Auth's subtree; the three refusal notes expect the plain wording.
- `tests/grid/repair.test.ts`: "moving a first child above its parent…" does it by Outdent then Move up.
- `tests/editor/diagnostics.test.ts`: an unknown type underlines `:money`, not the declaration.

**Spec questions:** none. The rows change is to error spans, which the rows specs don't define; `QUESTIONS.md` is unchanged.

---

## Task 25 — rows: roles and qualified names

**Serves:** M1 (VISION.md §4.1). The mechanism only: rows learns to bind roles to columns and to read qualified key names. It knows no project concepts. Which roles and keys exist, and what they mean, is the plan's business and comes in Task 26.

This is spec first, as in Task 16, but small enough to implement in the same task, so the conformance suite never has skipped stages.

**Deliverables**

- **Base spec, key names (§2.1):** a frontmatter key may be a **qualified name**, a NAME, one dot, a NAME (`propricer.rate-table`). Unknown keys, qualified or not, are ignored as today. A key with more than one dot, an empty part, or a leading or trailing dot is not a valid key, and is reported the way the base spec already reports an invalid key name.
- **Column names and `name=` cells are unchanged.** A dot is still not allowed in a column name, and `my.notes=x` still reads as it does now. Add a line to the spec saying so, so nobody widens it by accident.
- **Extensions spec, new section "Roles":** the `roles:` key binds role names to columns, `roles: effort=est, duration=dur`.
  - Entry syntax, list syntax and whitespace follow `markers:`.
  - A role name is a NAME or a qualified name. rows gives no role a meaning and accepts any valid name.
  - The column is any column of the resolved schema, including the lead and implicit columns.
  - One column may carry several roles. One role may be bound only once.
  - Profile and file `roles:` combine the way `markers:` does. (Changed by Q43: merged per role.)
- **Errors**, each settled by analogy wherever an existing rule fits (record it under Resolved in `QUESTIONS.md`, "settled by analogy with Qn", and list it in your end-of-task summary):
  - a role bound to a column that doesn't exist: as `nest:` or `order:` naming a missing column;
  - a role bound twice: as a repeated marker name (A2);
  - a malformed entry or role name: as an invalid `markers:` entry;
  - a profile's role bound to a column the file's `columns:` or `lead:` replaced: reported on the file's declaration (Q42);
  - an empty `roles:`: declares nothing (A1).

  Open a question only if a case needs a genuinely new rule.

- **DESIGN §4:** `Schema.roles`, each entry with its role name, column name, and the spans of both. `Schema.keys` carries qualified keys as written.
- **`tokenizeLine`:** qualified keys tokenise as keys, and `roles:` entries tokenise like `markers:` entries (name, `=`, value).
- **Versions:** base and extensions each get a draft version bump. Update the "Depends on" line in `plan-format-spec.md`, and the version references in DESIGN and the conformance README (Task 19 missed these once).

**Acceptance criteria**

- [x] Conformance cases, written by hand from the spec, for:
  - a valid qualified key;
  - each kind of invalid qualified key;
  - `my.notes` still unnamable as a column and as a cell name;
  - a valid `roles:`, including a qualified role, a role on the lead, and two roles on one column;
  - each error above;
  - a profile and file `roles:` combining;
  - a profile's role on a replaced column.

  Every case with a syntax or structural error has its strict variant. — `base-2.1-qualified-key`, `base-2.1-invalid-qualified-key`, `base-4-dot-not-in-names`, and the `ext-11-roles*` cases (valid; unknown column; bound twice; invalid entries; empty; from a profile; file adds a role; file rebinds a profile role; profile column replaced; estimate-only file with its own columns). `base-9-reserved-base-only` gained a `roles:` line. Expected files gained an optional `roles` field.

- [x] Every conformance case passes, with no stage skipped.
- [x] The property tests' generators include qualified keys and `roles:` blocks, valid and broken, and every existing property still holds. `tokenizeLine` agrees with `parseRows` on every token boundary. — a new property checks every frontmatter key token and every bound role's name and column tokens.
- [x] No app code changes. The app's tests pass unchanged. Until Task 27, a qualified key in a plan file still gets the plan's `unknown-key` info; that is expected. (Task 27: it gets `missing-plugin` when its plugin isn't registered, and nothing when it is.)
- [x] `npm test` is green at the root.

**Notes**

- Base 0.11, extensions 0.9 (0.8 for the task, 0.9 for Q43). Roles are a new ext §11, so §8–§10 and the case names citing them keep their numbers; the errors are also in §10. `roles` joins the keys reserved in base §9 and `KNOWN_KEYS`, so the plan's `unknown-key` info no longer fires on `roles:` (it still fired on qualified keys until Task 27's `missing-plugin`).
- Settled by analogy (QUESTIONS.md A6–A10): no column → as `order` (Q16); bound twice → as a repeated marker (A2); malformed entry → as an invalid marker entry; empty `roles:` → A1. A9 (profile role on a replaced column → Q42) is superseded by Q43. New codes `invalid-role` and `unknown-role-column`.
- **Changed by Q43 (spec owner):** profile and file `roles:` merge per role, the file's binding winning, instead of the file's replacing the profile's as `markers:` does. A profile role whose column the file's `columns:` or `lead:` replaced is dropped with no error, so an estimate-only file with its own `columns:` gets no role errors.
- `tokenizeLine` splits unquoted `markers:` and `roles:` values into `name`, `equals` and `value` tokens. Markers were a single `fm-value` before; they now match, as this task assumed they already did.

**Human review:** read the new `expected.json` files and the Resolved entries. Each analogy is a claim about what the spec means.

---

## Task 26 — Plugin seams

**Serves:** M1 (VISION §4; `PLUGINS.md` §3–§5 and §8). A refactor with no visible change: the plugin machinery goes in, and today's roll-ups move out of core into the **estimate** plugin. Reading the format stays in core. The vocabulary, the workspace and the calendar are Task 27.

**Deliverables**

- **Fields** (`src/core/fields.ts`): `FieldKey`, `defineField`, `definePinnable`, `definePinnableByColumn` and `Pinnable`, per `PLUGINS.md` §4.
- **Model:** the fixed core (`doc`, `lines`, `roots`, `columns`, `diagnostics`, `inactive`) plus `get` and `value`. `bindings` and `calendar` arrive in Task 27.
- **Plugin, Stage, StageContext and the registry**, per §3 and §5, without what needs the vocabulary. In this task:
  - `StageContext` has `model`, `hours`, `set`, `setValue` and `diagnose`. `bindings`, `cell`, `marked` and `calendar` come in Task 27.
  - `createRegistry` checks unique ids, that `requires` names registered plugins with no cycles, one owner per field, that a stage's reads are owned by its plugin or one it requires, and no stage cycles. It throws with the plugin's name. The vocabulary and qualified-name checks come in Task 27.
- **The stage runner:** a topological order computed once, with ties broken by registration order and then stage id. A stage whose read field was never written is skipped, and the skip is recorded in `inactive` with a plain reason. `set` and `setValue` throw on a key that isn't in `writes`, or that has the other scope.
- **`createAnalyzer(registry)`** replaces `analyze`. The app builds its registry in `src/app/registry.ts` and nowhere else.
- **Reading:** `readPlan` is renamed `readTree` and otherwise keeps its reading, including hours per summable cell and the plan spec §2.6 diagnostics. Inherited `done` moves into it from `compute`. `hours(node, column)` is a lookup of its result.
- **The estimate plugin** (`src/plugins/estimate/`), with no roles:
  - `rollup` is a by-column `Pinnable` holding each column's `effective`, `childSum` (as `derived`) and `mode`. `derived` is absent when no child has a value. `childrenHaveValue` goes; it is `derived !== undefined`.
  - `hasValue` and `doneSum` are estimate fields beside it.
  - The document totals are a document-scope field.
  - `override-differs` is emitted by its stage, unchanged.
  - `compute` is deleted.
- **Renderers and exporters:** tree, table, `renderers/shared` and the TSV exporter move into the estimate plugin and read through keys. `Renderer.requires` and `Exporter.requires` become `FieldKey[]`, replacing `ColumnRequirement`. A renderer or exporter is greyed out with the reason of the first skipped stage in stage order, or "needs the estimate plugin" when the owning plugin isn't registered.
- **Grid:** reads roll-ups through the keys. Accessors change and behaviour doesn't.
- **Enforcement,** per `PLUGINS.md` §8:
  - ESLint: `core/` imports nothing from `plugins/`, `views/`, `app/` or the editors; `app/` imports `plugins/` only in `registry.ts`; renderers and exporters don't import `rows` (new paths); no `Date.now()` or argument-less `new Date()` in `core/` or a plugin's stages.
  - A test compares each plugin folder's imports with its `requires`.
- **Spec:** update plan-format-spec §3.2, §3.3 and §3.6 for stages, field keys and `requires`. Non-negotiable 5 now names the estimate fields by key.

**Acceptance criteria**

- [x] Every existing test passes. A test is rewritten only where it read a moved value, and each rewrite is listed in the task notes with the reason. — see "Rewritten tests" below.
- [x] The §2.10 example gives exactly the table in the spec, read through `rollup`, `doneSum` and the totals field, including `Auth`'s override with `derived` 23h. — `tests/core/example.test.ts`. The table's `—` is `derived` absent, and its `override` is `pinned`.
- [x] A leaf estimate has `mode: 'pinned'` and no `derived`. A parent with estimated children has `derived`. A parent whose children have no estimates has no `derived` and no diagnostic. — `tests/core/compute.test.ts`, "the rollup field".
- [x] One test per registry check, each asserting the plugin's name in the message. — `tests/core/plugins.test.ts`: repeated id, unregistered `requires`, `requires` cycle, a field with two owners, a stage writing a field its plugin doesn't own, a read from a plugin not required, a stage cycle (and a stage reading its own write).
- [x] The runner's order is the same across repeated registrations. A stage reading a field whose stage was skipped is recorded in `inactive`. `set` with an undeclared key, and `set` with a document-scope key, both throw. — `tests/core/plugins.test.ts`; also `setValue` with a node-scope key.
- [x] With an empty registry, `analyze` returns the tree, lines and `readTree`'s diagnostics without error, and the tree renderer is greyed out with "needs the estimate plugin". — `tests/core/plugins.test.ts`.
- [x] The import test fails on a planted import of an undeclared plugin. Each new lint rule fails on a planted probe. — `tests/plugins/imports.test.ts` and `tests/plugins/lint.test.ts` (ESLint's API on probe text, with a passing counterpart for each rule).
- [x] `analyze` on the 500-line plan is at most twice Task 21's 1.33 ms median. — 1.01 ms median (p99 1.65 ms) on a 500-line plan with 445 items, against 0.94 ms (p99 1.60 ms) for HEAD on the same machine and file, median of 1,000 runs after warm-up. Measured once; there is no timing test.
- [ ] Nothing visible changes in the browser. **Manual pass pending review.** One known change: the Gantt tab's tooltip reads "needs the schedule plugin" instead of "needs a date column" (see Decisions).

**Human review:** read `src/core/fields.ts`, the `Stage` and `StageContext` types, and the estimate plugin's manifest before the rest. They are the contract every later plugin follows.

**How it's built:**

- `src/core/fields.ts`: `FieldKey`, `Pinnable`, `defineField`, `definePinnable`, `definePinnableByColumn`. Keys are frozen objects compared by identity.
- `src/core/plugin.ts`: `Plugin`, `Stage`, `StageContext`, `Registry`, `createRegistry` and `unmetReason`. The order is computed once in `createRegistry`.
- `src/core/analyze.ts`: `createAnalyzer(registry)` runs `parsePlan`, `readTree`, then the stages. Node fields are a `Map` per key, keyed by node. `hours(node, column)` returns the field's `amount`. `set` and `setValue` check `writes` and scope, and a diagnostic from `diagnose` is sorted by line with the rest, as `compute` did.
- `readTree` (`src/core/read.ts`) is `readPlan` renamed. It also sets inherited done: `ItemNode.done` is own or inherited, and the new `ItemNode.ownDone` is the item's own marker (the old `ItemNode.done`). `Model.roots` is `ItemNode[]`: `ModelNode`, `Cell`, `SummableCell`, `TextCell`, `DocumentTotal`, `RollupMode` and `ColumnRequirement` are gone. Text cells are read from `node.fields[i].text`.
- `src/plugins/estimate/`: `fields.ts` (`rollup`, `hasValue`, `doneSum` as `has-value` and `done-sum`, `totals`), `rollup.ts` (one stage, `estimate.rollup`, which is `compute` with the new shapes), `renderers/` (tree, table, `shared.ts` and `shared.css`, moved from `src/renderers/`), `exporters/tsv.ts`, and `index.ts`, the manifest. _(Task 28: the row builder, cursor highlight, click-to-line and their CSS moved on to `src/ui/`; `rollup.ts` now declares the optional `duration` role and leaves its column out.)_
- `src/app/registry.ts` builds the registry, `analyze`, and the renderer and exporter lists, which add the views' renderers after the plugins'. The shell asks `unmetReason` for every renderer and exporter. Exporter buttons are now made once and greyed out like renderer tabs. They are never greyed out with estimate registered.
- Grid (`src/grid/index.ts`, `edits.ts`): reads `rollup`, `hasValue` and `totals` through the keys. A column counts as summable when it has a roll-up. `node.source.*` became `node.*`.
- Lint (`eslint.config.js`): `app/` may import `plugins/` only in `registry.ts`; `views/` import only core _(and `src/ui/`, since Task 28)_; renderers and exporters in `plugins/*/renderers`, `plugins/*/exporters` and `views/` may not import `rows`; no `Date.now()` or argument-less `new Date()` in `core/` or `plugins/` outside renderers and exporters. The core rule already forbade everything but `./` and `rows`, so it is unchanged. `parsePlan` and `readTree` are the core names forbidden outside core.

**Decisions taken:**

- **Gantt stub:** it can't require "a date column" any more, so it moved to `src/views/gantt/` and requires a stand-in for the schedule plugin's `start` field, defined in the stub. Its tooltip is now "needs the schedule plugin". This also fixes a latent crash: before, a file with a `date` column enabled the tab, and clicking it threw. Task 28 replaces the stub. _(Done in Task 28: the stub and its placeholder key are deleted, and the Schedule tab takes its place.)_
- **A skipped stage's reason passes on.** A stage skipped because an input's writer was skipped gets that writer's reason, so `inactive` and a greyed-out view name the cause ("needs project-start"), not the chain. In this task nothing can skip a stage in the app: roles and keys arrive in Task 27. The only way to skip one now is a field that a plugin owns but no stage writes, whose readers get "needs estimate.x, which no stage writes". The tests use that.
- **An extra registry check:** a stage may write only fields its own plugin owns. Without it, "one owner per field" didn't stop another plugin writing the field.
- **Field names are kebab-case** (`has-value`, `done-sum`), like rows names. The exported constants are `hasValue` and `doneSum`.
- **`Diagnostic.source`** (PLUGINS.md §5) is not added. The task says `override-differs` is unchanged, and nothing groups by plugin yet.
- **Tests import `analyze` from `src/app/registry`**, so they run the app's own registry.

**Rewritten tests:**

- Every test that imported `analyze` from `src/core` now imports it from `src/app/registry`, and the renderer and exporter tests import from their new paths. These are import lines only.
- `tests/core/helpers.ts`: `est(model, node, column?)` returns the node's `rollup` entry with `hasValue` and `doneSum`, read through the keys (it took only the node and returned `cells[0]`). `total(model, column?)` reads `totals`. `flatten` and `byTitle` return `ItemNode`s.
- `tests/core/compute.test.ts`: `est` takes the model. `childSum` became `derived`, and "childrenHaveValue reflects the children only" became "derived reflects the children only" (`derived` present or absent).
- `tests/core/example.test.ts`: the table's `childSum` column is `derived` (`undefined` on leaves, which the spec shows as `—`) and `override` is `pinned`. Totals come from `totals`, with no entry for text columns (they were `null`). Text cells come from `fields[i].text`, and an unset one is `null` (it was `''`).
- `tests/core/duration.test.ts`: reads through `est`; `override` is `pinned`.
- `tests/core/diagnostics.test.ts`, `columns.test.ts`, `parse.test.ts`, `messy.test.ts`: `cells[i]` became `est(...)` or `fields[i]`, and `totals[i]` became `total(...)`. "every rows type is a column" asserts an empty `rollup` map and empty `totals` in place of `null` totals.
- `tests/renderers/tree.test.ts`, `table.test.ts`: "declares no requirements" became "requires estimate's roll-ups and totals". The Gantt test asserts a schedule-plugin requirement in place of `{ type: 'date' }`.
- `tests/app/shell.test.ts`: the Gantt tooltip is "needs the schedule plugin".
- `tests/exporters/tsv.test.ts`: the forged tab-and-newline value is set on `fields[1].text` (it was set on `cells[1].value`).
- `tests/grid/repair.test.ts`: the rejoined notes value is read from `fields[2].text`.
- `tests/grid/edits.test.ts`: `ModelNode` became `ItemNode` in its helper types.

**Follow-up (Task 28):** move the Gantt renderer into `src/plugins/schedule/` and delete the placeholder `schedule.start` key in `src/views/gantt/index.ts`. The renderer then requires the schedule plugin's own field. _(Done in Task 28: the placeholder is deleted and the schedule table requires the plugin's own fields. The Gantt renderer itself is Task 29.)_

**Spec:** plan-format-spec §3.1 (`readTree`, `ownDone` and inherited `done`), §3.2 (stages, field keys, the estimate fields and how they map to §2.7's terms, `createAnalyzer`), §3.3 and §3.6 (`requires: FieldKey[]`, greying reasons, where renderers and exporters live), and the §5.2 path. CLAUDE.md non-negotiable 5 names the estimate fields by key, and non-negotiable 10 and the repo layout have the new paths. §2.7 keeps its terms (`childSum`, `override`), since its semantics are unchanged. No rows spec is touched, and there are no spec questions.

---

## Task 27 — Vocabulary, workspace and calendar

**Serves:** M1 (`PLUGINS.md` §3, §5–§7). Completes the plugin seams. Scheduling code comes in Task 28.

**Deliverables**

- **Core vocabulary** (`src/core/vocabulary.ts`):
  - roles `effort` (duration or number), `duration` (duration), `start` (date), `deps` (ref) and `deadline` (date);
  - the key `project-start` (date);
  - the markers `done` and `milestone`.
- **Registry:** a bare role, key or marker name a stage declares must be in the vocabulary, and a qualified one must start with the plugin's id. The plugin's read sets are the union of its stages' declarations.
- **`bindVocabulary`** runs after `readTree` and produces `Model.bindings` (roles to columns, keys to values, marker names), with the diagnostics in `PLUGINS.md` §6:
  - a bare name outside the vocabulary: info, `unknown-key`, `unknown-role` or `unknown-marker`;
  - a qualified name whose plugin isn't registered: info, `missing-plugin`, "needs the propricer plugin";
  - a role on a column of the wrong type: warning, `role-type`, and the role is left unbound.

  These replace the plan's current `unknown-key` check for frontmatter keys.

- **Stages:** `roles`, `keys` and `markers` declarations. The runner skips a stage with a missing required role or key, with the reason. `StageContext` gains `bindings`, `cell`, `marked` and `calendar`.
- **Plan profile:** gains `roles: effort=est`, in both `profiles/plan.rows` and the built-in copy, which a test keeps identical. The `milestone=^` marker waits for Task 28.
- **`project-start`:** an invalid date is a warning, and the key counts as absent. When the key is valid, `Model.calendar` is set.
- **Calendar** (`src/core/calendar.ts`): the interface in `PLUGINS.md` §7.2, and the naive calendar, which works Monday to Friday, takes `hpd` from the column bound to `effort` (8 if unset) and ignores `dpw`.
- **`includesOf(text)`:** returns the include paths rows reports, and `[]` when there are none.
- **Workspace:** the interface in `PLUGINS.md` §7.1, with `can` and `WriteResult`. The single-file implementation wraps Task 4's open and save code. The shell uses only the interface, checks `can` rather than the kind, and runs the `includesOf` loop before `analyze`, which is a no-op until M3.
- **Spec:** plan-format-spec §2.1 (`roles: effort=est` in the profile; `project-start`), §2.9 (the new codes) and §3.

**Acceptance criteria**

- [x] Each `bindVocabulary` diagnostic has a test asserting its line, severity and code. A qualified key whose plugin is registered gets no diagnostic. — `tests/core/vocabulary.test.ts`, "bindVocabulary": `unknown-key`, `unknown-role`, `unknown-marker`, `missing-plugin` (key and role), `role-type`, `key-type`; `probe.setting` and `probe.who` get nothing with the probe plugin registered.
- [x] A test stage requiring `effort` runs on the §2.10 example and is skipped, with "needs a column with the effort role", on a file whose own `columns:` has no `est`. `cell` returns `undefined` for an optional role that isn't bound. — `tests/core/vocabulary.test.ts`, "required roles and keys" and "the stage context". A mistyped `est` gives the column's type as the reason (see Decisions).
- [x] Registry tests: a bare undeclared name throws, and so does another plugin's prefix. — `tests/core/plugins.test.ts`, for a role, a key and a marker, and for another plugin's key and role.
- [x] Calendar tests: — `tests/core/calendar.test.ts`, plus a year end and a leap day.
  - `add` across a weekend, and from a weekend `project-start`;
  - negative `add` for the backward pass;
  - `fromDate` at `'start'` and at `'end'`;
  - a task finishing at the end of a deadline day is not late (`add(start, d) <= fromDate(deadline, 'end')`);
  - an 8-hour task starting Monday shows Monday for both `toDate(start, 'start')` and `toDate(finish, 'end')`;
  - `hpd=6` on the effort column gives 6-hour days. — also through `analyze`, in `tests/core/vocabulary.test.ts`.
- [x] Nothing in `core/` or a plugin's stages reads the clock (lint). `analyze` on the same text gives the same model on different days (a test with the clock faked). — Task 26's lint rule and its probe test cover `calendar.ts`; "analysis never reads the clock" in `tests/core/vocabulary.test.ts`.
- [x] The Task 4 criteria still pass through the workspace. In the download fallback, `write` returns `downloaded` and the unsaved-changes indicator stays on. **Browser pass pending review**, in Chrome and Firefox. — jsdom: `tests/app/workspace.test.ts`, `tests/app/shell.test.ts` (unchanged) and `tests/app/shell-download.test.ts`. In the Firefox pass, also check the leave-page prompt after a download (see Visible changes).
- [x] The app's other tests pass unchanged, apart from the unknown-key diagnostics, which are listed. — no `unknown-key` expectation changed: the existing ones are bare keys outside the vocabulary. The one rewritten test file is listed below.

**Visible changes:**

- After saving by download, the unsaved-changes indicator stays on.
- Leaving the page after a download doesn't prompt; it prompts again once the buffer is edited. The prompt now compares the buffer with the text last opened, saved or downloaded, and the indicator with the text last opened or saved in place.
- Qualified keys get `missing-plugin` in place of `unknown-key`: `propricer.rate-table` is "frontmatter key "propricer.rate-table" needs the propricer plugin".
- Unknown roles and markers are now reported: `markers: done=~ blocked=!` gets `unknown-marker` on `blocked`.
- A role the file binds to a column of the wrong type gets a `role-type` warning, and `project-start` that isn't a date gets `key-type`. _(Task 28 changed its message and added a fix.)_
- The plan profile binds `roles: effort=est`. Nothing shows it yet.

**Human review:** read the vocabulary file and the calendar tests first. They fix what a day and a deadline mean for everything after.

**How it's built:**

- `src/core/vocabulary.ts`: `CORE_ROLES` (each with its column types), `CORE_KEYS` (with its value type), `CORE_MARKERS`, and `pluginOf(name)`, the part before the dot.
- `src/core/bindings.ts`: `Bindings` (`roles`, role → column name; `mistyped`, role → reason; `keys`, key → value; `markers`; _Task 28 adds `mistypedKeys`, key → reason_) and `bindVocabulary(doc, plugins)`. Key diagnostics go on the key's span, role diagnostics on the whole `role=column` entry, and marker diagnostics on the marker name, which it finds with rows' `tokenizeLine`, since `Schema.markers` has no spans. `keys` holds the core keys whose values read as their type, and the qualified keys of registered plugins, as written.
- `src/core/calendar.ts`: `Calendar`, `IsoDate`, `WorkHours`, `Edge` and `naiveCalendar(start, hoursPerDay)`. It counts working days from a fixed Monday, so a weekend day counts as the Monday after it. Hour 0 is the first working hour on or after `project-start`. `toDate(t, 'end')` takes the day of the instant just before `t` (`ceil(t / hpd) - 1`), which is PLUGINS.md's "hour t − 1" for whole hours, and keeps a part-day finish on its own day.
- `src/core/plugin.ts`: `Stage` gains `roles`, `keys` and `markers`. `StageContext` gains `bindings`, `calendar`, `cell` and `marked`. `pluginReads(plugin)` is the union of the plugin's stages' declarations, and `createRegistry` checks it against the vocabulary and the plugin's id.
- `src/core/analyze.ts`: after `readTree`, `bindVocabulary`, then the calendar when `project-start` is bound, with `hpd` from the effort column (8 if unset). The runner checks required roles, then required keys, then reads. `cell` returns the rows `Value` in the role's column. `marked` is rows' `readFlag` on the marker's column, so `done=true` counts, as for `ownDone`. `includesOf(text)` returns rows' include paths. `analyze` takes `files`, which is unused until M3.
- `readTree` no longer reports `unknown-key`, which moved to `bindVocabulary`. Vocabulary diagnostics are listed after `readTree`'s and before the tab infos, then sorted by line as before.
- `src/core/workspace.ts`: `Workspace`, `OpenedFile` (`path`, `text`) and `WriteResult`. `src/app/workspace.ts` (`createSingleFileWorkspace`) replaces `src/app/files.ts`. A native write that fails returns `failed` with the browser's message. `read` or `write` of any path other than the open file's fails, saying a folder workspace is needed. `resolve` joins a relative path to the file's folder.
- `src/app/includes.ts`: `createIncludes(workspace, onGathered)`, the cached include loop (see Decisions). The shell calls `snapshot(path, text)` before every `analyze`.
- `src/app/main.ts`: the shell tracks the open file's `path`, and saves with `write(path)` or `saveAs(text, path ?? 'untitled.plan')`. It reports `failed` in the status line, as it reported a thrown error before, and it checks `can.saveInPlace`, not the kind of workspace.
- rows: `readValue(text, type)` is exported, with `ValueType = Pick<Column, 'kind' | 'enumValues' | 'unit'>`. A `Column` is one, so cells call it as before, and a key passes `{ kind: 'date' }`. It is listed among DESIGN §4's helpers, with unit tests in `packages/rows/tests/values.test.ts`.
- Timing, measured once: `analyze` on a 500-line plan has a 0.79 ms median (p99 1.37 ms), and the shell's extra `includesOf` adds 0.55 ms (p99 0.99 ms).

**Decisions taken** (by the spec owner, when asked):

- **`project-start` is read by rows (an API change, not a spec change).** rows exports `readValue`, the function cells use, so frontmatter values of a declared type go through the same code: `project-start` now, plugin keys of date, number and text type later. There is no spec text, no conformance case and no version bump, since no rule changes. Date arithmetic (weekdays, adding days) stays in core's calendar. It is calendar logic, not grammar. `readValue` takes a type as `{ kind, enumValues?, unit? }`, because an enum needs its values and a duration its unit, so a `Column` passes as is.
- **`role-type` only for a binding written in the file.** A profile's binding on the file's column of the wrong type is left unbound with no diagnostic, following rows' Q43. `Bindings.mistyped` records the reason, and a stage requiring the role is skipped with it: "the effort role's column est is text, not a duration or number". "needs a column with the effort role" is only for a role that isn't bound at all. PLUGINS.md §6 says so.
- **Includes: a cached snapshot, and render stays synchronous.** The shell gathers only when the set of include paths differs from the last set gathered, and failures are cached with it. Each gather has a generation number, and a gather overtaken by a newer one is dropped. A finished gather re-analyzes the current buffer text. The loop follows includes of included files, never reads a path twice (so a cycle stops), and never reads the open file. With the single-file workspace every read fails, so it does nothing until M3. PLUGINS.md §6 says so.
- **Leave-page prompt after a download:** the indicator stays on, but leaving prompts only when the buffer differs from the text last saved or downloaded. The shell keeps that text beside the last text saved in place.

**Decisions taken** (by me, within the task):

- **Code `key-type`** for a core key whose value isn't its type, parallel to `role-type`, since plugin keys will declare types too.
- **`Bindings.roles` maps a role to its column's name**, the name `hours` takes, rather than to a column object.
- **Unknown names from the profile get no diagnostic**, as they have no line in the file. The built-in plan profile has none.
- **No `Diagnostic.source` yet**, as in Task 26.

**Rewritten tests:**

- `tests/app/files.test.ts` became `tests/app/workspace.test.ts`: the same cases through the `Workspace` interface. `open` returns `path` in place of `name`. `save` and `saveAs` returning `true` or `false` became `write` and `saveAs` returning a `WriteResult` (`saved` with the path, `downloaded`, `cancelled`). `store.name` and `store.inPlace` became `list()` and `can.saveInPlace`. New cases cover a failed write, a path other than the open file, and `resolve`.

**New tests:** `tests/core/vocabulary.test.ts`, `tests/core/calendar.test.ts`, `tests/app/includes.test.ts`, `tests/app/shell-download.test.ts`, the vocabulary and read-set cases in `tests/core/plugins.test.ts`, and `readValue` in `packages/rows/tests/values.test.ts`.

**Noticed, not changed:** VISION §4.1 says a plugin's own marker names are qualified, but a rows marker name is a column name, and column names can't contain a dot (rows base §4), so no file can use a qualified marker. The registry accepts one a plugin declares. It needs a rows spec change once a plugin wants its own marker.

**Spec:** plan-format-spec §2.1 (`roles: effort=est`, the vocabulary, `project-start`), §2.9 (`unknown-role`, `unknown-marker`, `missing-plugin`, `role-type`, `key-type`), §3.1–§3.2 (the diagram, `bindVocabulary`, bindings, stage declarations, the calendar, `analyze`'s `files` and `includesOf`), §3.9 (`readValue`) and §6 (the workspace, the indicator and the leave-page prompt). PLUGINS.md §6 records the `role-type` and include decisions. rows DESIGN §4 lists `readValue`. No spec version changes.

---

## Task 28 — Schedule plugin: compute and schedule table

**Serves:** M1 (VISION §5; `PLUGINS.md` §4–§7). The schedule plugin computes dates, slack and lateness from dependencies, pins, milestones and deadlines, and shows them in a plain schedule table. The Gantt chart and the pin review come in Task 29, and editing IDs and dependencies in the grid in Task 30.

**Deliverables**

- **A second built-in profile, `schedule`** (`profiles/schedule.rows`, plus the built-in copy, which a test keeps identical). It is the plan profile plus the scheduling columns and roles:
  ```
  lead: title:text
  nest: parent
  markers: done=~ milestone=^
  columns: est:duration unit=h hpd=8 dpw=5 | dur:duration unit=h hpd=8 dpw=5 | start:date | deps:ref many qualifier=lag:duration | due:date | owner:text | notes:text
  roles: effort=est duration=dur start=start deps=deps deadline=due
  ```
  A PM writes `profile: schedule`. Files that say `profile: plan`, and `.plan` files with no `profile:`, are unchanged: estimate-only files stay terse, and `^` in their titles means what it did. Document the profile in plan-format-spec §2.1.
- **The schedule plugin** (`src/plugins/schedule/`), which requires no other plugin:
  - It requires the key `project-start`. The roles `effort`, `duration`, `start`, `deps` and `deadline` are all optional, and so is the marker `milestone`.
  - Fields (`fields.ts`):
    - `start`, a `Pinnable<WorkHours>`;
    - `duration`, a `Pinnable<number>` (hours);
    - `finish`, `lateStart`, `lateFinish` and `slack`, all `WorkHours`;
    - `critical` (`slack <= 0`, for every row, summaries included) and `late` (the finish passes the row's own deadline), both booleans;
    - `milestone`, a boolean, for the schedule table (see Decisions);
    - the document-scope `projectFinish`.
  - Two stages, `schedule.forward` and `schedule.backward`, following the rules below.
- **Forward pass rules:**
  - **Duration of a leaf.**
    - Derived: the leaf's effort hours, at one full-time person. It is 0 when there is no effort.
    - Pinned: the `dur` cell.
    - A leaf with a duration of 0 that isn't a milestone gets the info `schedule-no-duration`.
  - **Milestones.**
    - A row with the milestone marker has a duration of 0. A filled `est` or `dur` on it gets the warning `schedule-milestone-effort`, and is ignored.
    - A milestone marker on a parent row gets the warning `schedule-milestone-parent`, and the row is treated as a summary.
  - **Start.** The derived start is the latest of: the project start (hour 0); each dependency's `finish`, plus its lag; and the effective start of each ancestor. The start pin is a floor: the effective start is the later of the pin and the derived start. Convert a pin with `fromDate(d, 'start')`, with a one-line comment saying why that edge.
  - **Pins and dependencies on a parent row** act as floors for every descendant. A `dur` pin on a parent gets the info `schedule-summary-duration` and is ignored, because a summary's span comes from its children.
  - **Pin diagnostics**, both info:
    - `schedule-pin-no-effect` when `effective > pin`;
    - `schedule-pin-equals-derived` when a start or duration pin equals its derived value, in `pinned` mode.
  - **Lag.** A lag is calendar time, so the schedule plugin converts it with the calendar's `hoursPerDay` and 5 days a week. It is a reading only this plugin needs, so it is a pure function in the plugin. A negative lag is treated as zero, with a warning, as in plan spec §2.6.
  - **Dependency targets.**
    - A dependency on a parent (summary) row gets the warning `schedule-dep-on-summary`, and is ignored.
    - A dependency that can't be resolved is already a rows validation error; the schedule ignores it.
    - The dependencies in a cycle are ignored, and each row in the cycle gets the error `schedule-dep-cycle`. This must be deterministic.
  - **Finish.** Every finish is `calendar.add(start, duration)`. No stage adds hours itself.
  - **Summaries.** A summary's start is its earliest descendant start, and its finish its latest descendant finish. `projectFinish` is the latest finish of all.
  - **Done** has no effect on dates in this task (the open question in PLUGINS.md §9, for M2).
- **Backward pass rules:**
  - A leaf's late finish is the earliest of: `projectFinish`; each successor's late start, minus its lag; its own deadline, `fromDate(d, 'end')` (comment why that edge); and any ancestor's deadline.
  - A leaf's late start is `calendar.add(lateFinish, -duration)`.
  - Slack is `lateStart - start`, and `critical` is `slack <= 0`.
  - A summary's slack is the smallest slack among its descendants.
  - A row whose finish passes its own deadline gets the warning `schedule-late`, for example "finishes 2026-10-13, after its deadline 2026-10-12". Negative slack on the rows upstream is visible in the fields, and gets no diagnostic of its own.
- **Missing or invalid start** (as decided; see Decisions):
  - Core, not a stage, reports it: `project-start` records in the vocabulary that it is expected when `duration`, `start`, `deps` or `deadline` is bound. When one is and the key isn't written, core gives the info `no-project-start` on line 1, with no span: "Set a project start to compute the schedule". Estimate-only files are never told about it.
  - When the key is written but isn't a date, only `key-type` fires. `Bindings` records mistyped keys, so a skipped stage's reason is "project-start isn't a date" rather than "needs project-start".
  - Both `no-project-start` and `key-type` get the click fix "Set project start to today", from one core helper. `key-type`'s message becomes "project-start must be a date like 2026-10-05; 'soon' is ignored, so the schedule isn't computed."
  - `analyze` must not read the clock, so the fix carries no date. `Fix.input` gains `suggest?: 'today'`, plus `before?` and `after?` around the value. The text editor and the grid fill in today's date when they show the fix, and they may read the clock because they are UI code.
- **Schedule table renderer** (in the schedule plugin), replacing the Gantt stub. Delete the stub and its placeholder key from `src/views/`.
  - Columns: `#`, title, start, finish, duration and slack.
  - Starts show with `toDate(t, 'start')`, and finishes and milestones with `toDate(t, 'end')`.
  - Durations and slack show in days and hours, using the calendar's `hoursPerDay`.
  - A pinned start or duration shows the derived value muted beside it, as the tree shows `⟨Σ …⟩`.
  - Critical rows are marked, and late rows outlined.
  - It shares the cursor highlight and click-to-line rules through `RenderContext`, using the shared UI layer `src/ui/` (see Decisions), and is greyed out with the skip reason ("needs project-start") when a stage is skipped.
- **Estimate and the duration role** (as decided): estimate declares `duration` as an optional role and doesn't roll up the column bound to it. Durations are spans, and don't add up across parallel tasks.
- **`Diagnostic.source`:** the runner sets it to the plugin's id on every stage diagnostic. Core's diagnostics leave it unset.
- **Spec:** plan-format-spec gains a scheduling section (§2.11 or its own section) stating the rules above, the new codes in §2.9, and the `schedule` profile in §2.1. VISION is unchanged.

**The reference fixture: `examples/schedule.plan`**

It is written by hand. Its expected values below were worked out by hand, so never generate them from output.

`profile: schedule`, `project-start: 2026-10-05` (a Monday), 8-hour days. Hour 0 is Monday 5 October at the start of the day; each working day adds 8 hours, and weekends are skipped.

| #   | Row                     | Cells                                      |
| --- | ----------------------- | ------------------------------------------ |
| 1   | Design                  | parent                                     |
| 1.1 | Wireframes `{#wire}`    | est 1d, start 2026-10-05                   |
| 1.2 | Review `{#review}`      | est 4h, deps `#wire`                       |
| 2   | Build                   | parent                                     |
| 2.1 | API `{#api}`            | est 3d, start 2026-10-05, deps `#review`   |
| 2.2 | UI `{#ui}`              | est 2d, start 2026-10-12, deps `#review`   |
| 2.3 | `^`Beta ready `{#beta}` | deps `#api` and `#ui`, due 2026-10-12      |
| 3   | Docs                    | est 1d, dur 3d, deps `#review` with lag 1d |

Expected, in work hours, with the displayed dates:

| Row              | start (derived / pin / effective) | duration                  | finish | late start | late finish | slack              | shown                   | diagnostics                                  |
| ---------------- | --------------------------------- | ------------------------- | ------ | ---------- | ----------- | ------------------ | ----------------------- | -------------------------------------------- |
| Wireframes       | 0 / 0 / 0, pinned                 | 8                         | 8      | 12         | 20          | 12                 | Mon 5 Oct – Mon 5 Oct   | `schedule-pin-equals-derived`                |
| Review           | 8 / – / 8                         | 4                         | 12     | 20         | 24          | 12                 | Tue 6 Oct – Tue 6 Oct   |                                              |
| API              | 12 / 0 / 12, pinned               | 24                        | 36     | 24         | 48          | 12                 | Tue 6 Oct – Fri 9 Oct   | `schedule-pin-no-effect`                     |
| UI               | 12 / 40 / 40, pinned              | 16                        | 56     | 32         | 48          | −8, critical       | Mon 12 Oct – Tue 13 Oct |                                              |
| Beta ready       | 56 / – / 56                       | 0 (milestone)             | 56     | 48         | 48          | −8, critical, late | Tue 13 Oct              | `schedule-late` (deadline 12 Oct is hour 48) |
| Docs             | 20 / – / 20                       | 24 (derived 8, pinned 24) | 44     | 32         | 56          | 12                 | Wed 7 Oct – Mon 12 Oct  |                                              |
| Design (summary) | 0 / – / 0                         |                           | 12     |            |             | 12                 | Mon 5 Oct – Tue 6 Oct   |                                              |
| Build (summary)  | 0 / – / 12                        |                           | 56     |            |             | −8, critical       | Tue 6 Oct – Tue 13 Oct  |                                              |

`projectFinish` is 56, shown as Tue 13 Oct. Where the numbers come from:

- Review's late finish is the earliest of API's late start (24), UI's (32), Docs' late start minus its lag (32 − 8 = 24) and the project finish (56).
- Docs starts at Review's finish plus a 1-day lag: `add(12, 8)`, which is 20, on Wednesday.
- A summary's start is derived / pin / effective: derived is the floor the rest of the file gives it (hour 0 for both), and effective its earliest descendant start. Summaries have no duration, late start or late finish; the blank cells are asserted absent. Build is critical, like every row with `slack <= 0`.

**Acceptance criteria**

- [x] The fixture test asserts every cell of the table above, the displayed dates, and each diagnostic's code, row and severity. — `tests/schedule/fixture.test.ts`, written from the table; the code agreed with every value on the first run. It also asserts `source: 'schedule'`, that the blank summary cells are absent, and the `schedule-late` message.
- [x] A test for each diagnostic in this task, each asserting its line and severity. The dependency cycle test asserts the same result regardless of row order. — `tests/schedule/schedule.test.ts`, "diagnostics" and "dependency cycles" (three row orders; also a self-dependency and a parent depending on its own child); `key-type` in `tests/core/vocabulary.test.ts`.
- [x] A dependency or start pin on a parent row pushes all its descendants. A deadline on a parent row limits all its descendants' late finish. — "parent rows" in `tests/schedule/schedule.test.ts`, which also covers a parent as a successor in the backward pass.
- [x] Sensible degradation: — "degradation" in `tests/schedule/schedule.test.ts`.
  - an estimate-only file (`profile: plan`) gets no schedule diagnostics;
  - a `profile: schedule` file with no `project-start` gets `no-project-start` and a greyed schedule table;
  - a file with no `deps` column schedules everything from hour 0.
- [x] The "Set project start to today" fix writes the date shown when it was offered, in both editors. With the clock faked to two different days, `analyze` gives the same model, and neither day appears in its output. — `tests/app/today-fix.test.ts`: offered at 23:59 and applied at 00:01, for a missing key and for one that isn't a date, in the text editor and in the grid (banner and problems list). "analysis never reads the clock" in `tests/schedule/registries.test.ts`: the same diagnostics and schedule fields on both days, and neither day in the output. (Reworded before commit: it said the output "contains no date the file didn't hold", which the computed dates the task specifies, such as `schedule-late`'s "finishes 2026-10-13", would break.)
- [x] With only the estimate plugin registered, the example and every estimate test are unchanged. With only the schedule plugin registered, the fixture still schedules. — `tests/schedule/registries.test.ts`: on every fixture and example, estimate's fields and every non-schedule diagnostic are the same with estimate alone as with both plugins; with schedule alone, the fixture's schedule fields and diagnostics equal the full registry's. Every existing estimate test passes, unchanged apart from those listed below.
- [x] `analyze` on a 500-line `profile: schedule` file with dependencies stays under 5 ms median. — 4.39 ms median (p99 8.78 ms), median of 1,000 runs after warm-up, on 50 phases of 9 chained tasks (lags, pins, `dur` pins, deadlines, phase-to-phase links). On the same file: 2.92 ms with no plugins, 3.02 ms with estimate alone, 4.25 ms with schedule alone. Most of the cost is reading the wider rows, not scheduling. Measured once; there is no timing test.
- [x] Manual: the schedule table on the fixture matches the expected table, in both themes. **Browser pass pending review.** Also check the late row's outline, drawn with `outline` on a `tr`, in Chrome and Firefox.

**Visible changes:**

- The Gantt tab is replaced by a Schedule tab. On a file without a schedule it is greyed out with "needs project-start", or "project-start isn't a date".
- The `schedule` profile is available.
- `key-type` on `project-start` has a new message and a fix, "Set project start to today (DATE)", whose label shows the date it writes.
- A file that binds `duration`, `start`, `deps` or `deadline` without `project-start` gets the info `no-project-start` on line 1, with the same fix, in the grid's settings banner too.
- In a file that binds the `duration` role (`profile: schedule`), the tree, the table, the grid and the TSV export show that column's cells as written: no sum on parents, no total, and no `override-differs` on it.
- Diagnostics from a plugin carry `source`. Nothing shows it yet.

**Not in this task:**

- Gantt bars.
- The pin review.
- Editing IDs and dependencies in the grid.
- `done` affecting dates.
- Link types other than finish-to-start.
- The follow-up from Task 27 that takes include paths from the model rather than parsing the text again. It waits for M3.

**Human review:** read the fixture test against the table above first. Any disagreement is a question about the rules, not the code.

**How it's built:**

- `src/core/vocabulary.ts`: a core key is a `CoreKey` (`type`, `example`, `ignored`, `expectedWith`, `missing`, `fix`), so `project-start`'s messages, its expectation and its fix label are vocabulary data.
- `src/core/bindings.ts`: `Bindings.mistypedKeys`; `key-type`'s new message and fix; `no-project-start` for each core key that isn't written while a role in its `expectedWith` is bound. A key written with the wrong type never gets `no-…`.
- `src/core/fixes.ts`: `todayFix(doc, key, label)` replaces the key's value when it is written, else inserts `KEY: ` + date + newline before the closing `---`; the date is left empty. `resolveFix(fix, date)` fills it in, in the edits, the value and the label, and drops `suggest`, so resolving twice changes nothing; it is pure, since the date is passed in. `inputEdit(input, value)` is the `before + value + after` edit both of them, and the confirm panels, use.
- `src/core/types.ts`: `Fix.input` gains `suggest`, `before` and `after`; `Diagnostic.source`. `src/core/analyze.ts`: the runner sets `source` on stage diagnostics, a mistyped required key gives its reason, and `parsePlan` knows both profiles. `src/core/profile.ts`: `SCHEDULE_PROFILE`, published as `profiles/schedule.rows`.
- `src/plugins/schedule/`: `fields.ts`; `lag.ts` (`lagHours`, a pure reading); `network.ts` (`readNetwork`: the links, the ignored ones with their diagnostics, Tarjan's strongly connected components over the links plus parent → child, and a topological order, a reverse post-order walk in document order); `forward.ts` and `backward.ts`, the two stages; `renderers/table.ts` and `table.css`; `index.ts`, the manifest. Both stages read the network: `schedule.backward` reads it again without reporting, rather than passing it through a field.
- `src/ui/`, shared UI code for renderers and editors: `grid.ts` (`createGrid(className, headers)`, `addItemRow`, `mount`, `muted`) and `grid.css`, moved from estimate's `renderers/shared.*` unchanged. Estimate's `shared.css` keeps only the total row and level column rules. `today.ts` is the one UI function that reads the clock.
- Editors: `src/editor/diagnostics.ts` and `src/grid/problems.ts` pass every fix through `resolveFix` with `today()` when they show it: the text editor when it builds lint actions, the grid on each model update. Their confirm panels call it too, and write a typed value with `inputEdit`, so they honour `before` and `after`.
- Estimate: `rollup.ts` declares `roles: { optional: ['duration'] }` and leaves that column out of the roll-ups and totals, so its cells show as written, like a text column.
- Lint (`eslint.config.js`): `src/ui/` may import only type-only imports from core and its own files (`@typescript-eslint/no-restricted-imports`, `allowTypeImports`); `src/views/` may import core and `src/ui/`. The plugin import test allows `ui/`.
- `src/views/gantt/` is deleted; `src/views/` is empty until the pin review. `src/app/registry.ts` registers estimate and schedule.

**Decisions taken** (by the spec owner, when asked):

- **A summary's start:** `derived` is the floor the rest of the file gives it (hour 0, its links, its parent's floor), `pin` its start cell, and `effective` its earliest descendant start. It passes `max(derived, pin)` down. The pin diagnostics then apply unchanged: "no effect" when no descendant starts at the pin. Build in the fixture is 0 / – / 12.
- **Summaries in the backward pass:** they get start, finish, `slack` (the smallest among their descendants), `late` (against their own deadline) and `critical`, which is `slack <= 0` for every row, so a PM sees which phase is on the critical path. They get no `duration`, `lateStart` or `lateFinish`.
- **A parent as successor:** its predecessor's late finish is bounded by the earliest late start among the parent's descendants, minus the lag. A parent that depends on its own descendant is `schedule-dep-cycle`; cycles are strongly connected components.
- **The missing start is core's**, not a `schedule.check` stage: the condition is vocabulary. The code is `no-project-start` (not `schedule-no-start`), info, line 1, no span. No `StageContext` change.
- **Only `key-type` on an invalid date,** with mistyped keys recorded in `Bindings`.
- **`Fix.input`** gains `suggest?: 'today'` and `before?`/`after?`.
- **`schedule-negative-lag`**, warning.
- **Dates** read `Mon 5 Oct`, with the year when it isn't project-start's year (`Mon 4 Jan 2027`).
- **The shared UI layer `src/ui/`** for the cursor highlight, click-to-line, the basic row builder and their CSS, rather than copying estimate's helpers. Plugins and `views/` may import it; it imports only core types.
- **Estimate leaves the `duration` role's column out**, as above.
- **Before commit:** core's pure `resolveFix(fix, date)` completes a "today" fix, and both editors and their confirm panels call it with `today()`; the fix-invariant test calls it with a fixed date and covers two new schedule fixtures; the clock criterion is reworded to what its test checks; PLUGINS.md §8 says `src/ui/` holds shared UI code for renderers and editors.
- Accepted defaults: `no-project-start` on line 1; the fix label shows its date; a milestone shows its date (end edge) in both date columns and "milestone" as its duration; durations and slack in days and hours only (`1d 4h`, `−1d`, `0h`); a `+` on a lag or `dur` is read as the value; rows without a deadline get `late: false`.

**Decisions taken** (by me, within the task):

- **A `milestone` field.** The schedule table shows a milestone as a point, and a renderer can't read markers (CLAUDE.md non-negotiable 5), so the forward stage writes `milestone`: true for a leaf with the marker, false otherwise (a parent with the marker is a summary).
- **The `key-type` message is built from the vocabulary**, so its wording for `project-start` is the task's, and a later core key needs only data.
- **`no-project-start` counts a key as written when the file or the profile sets it,** as `schedule.keys` does.
- **Where a pin is both without effect and equal to its derived value** (only possible on a summary), only `schedule-pin-no-effect` is reported.
- **Message wording:** each names its column by the name the file gives it ("the dur column's value is ignored"), per PLUGINS.md §5. A cycle's message lists the other rows' titles sorted, so it is the same in any row order.
- **Critical and late styling** reuse the diagnostic colours (`--diag-error` for a critical row's slack, `--diag-warning` for the late outline), so the theme gains no tokens.
- **`today()` lives in `src/ui/`** and the text editor and the grid import it, as PLUGINS.md §8 now allows.
- **`resolveFix` drops `suggest`** once it has filled the date in, so a panel that resolves a fix the list already resolved changes nothing, and the label never shows two dates.

**Rewritten tests:**

- `tests/core/vocabulary.test.ts`: "warns on a project-start that is not a date" asserts the new `key-type` message (it was `project-start "2026-02-30" is not a date; it is ignored`) and `mistypedKeys`.
- `tests/app/shell.test.ts`: the third tab is "Schedule" (was "Gantt"), greyed out with "needs project-start" (was "needs the schedule plugin").
- `tests/renderers/table.test.ts`: the "gantt stub" test is deleted with the stub.
- `tests/plugins/lint.test.ts`: "views import only core" became "views import only core and src/ui", with the new message and a passing `src/ui` import; its probe path is `src/views/probe/` (was `src/views/gantt/`).
- `tests/plugins/imports.test.ts`: `ui/` is allowed, and the planted-import case includes an allowed `src/ui` import.
- `tests/core/fix-invariant.test.ts`: `check` resolves each fix with `resolveFix(fix, '2026-10-05')` before applying it (it applied the edits as offered). Its fixtures gain `tests/fixtures/schedule-no-start.plan` (`no-project-start`) and `schedule-bad-start.plan` (`project-start: soon`, `key-type`); both fixes pass.
- `tests/schedule/registries.test.ts`: the clock test's comment and criterion say what it checks (above).

**New tests:** `tests/schedule/fixture.test.ts`, `schedule.test.ts`, `table.test.ts` and `registries.test.ts`; `tests/app/today-fix.test.ts`; the schedule profile's identity in `tests/core/columns.test.ts`; the fix, `resolveFix` (including that a second resolve changes nothing) and the "project-start isn't a date" skip reason in `tests/core/vocabulary.test.ts`; the duration role in `tests/core/compute.test.ts` and `tests/renderers/tree.test.ts`; the `src/ui` rule and a core probe of `src/ui` in `tests/plugins/lint.test.ts`.

**Spec:** plan-format-spec §2.1 (the schedule profile, `project-start` expected), §2.9 (`no-project-start`, the scheduling codes, `key-type`'s message, `source`), the new §2.11 Scheduling, §3.2 (estimate and the duration role, the schedule stages), §3.3 (`src/ui/`), §4b.6.2 (`Fix.input`, `resolveFix`, `inputEdit`), §5.2 and the new §5.4 Schedule table, and §7. PLUGINS.md §5 (`source`, fixes that need today), §6 (estimate's role, the missing start) and §8 (`src/ui/`, its lint rule). CLAUDE.md's repo layout and non-negotiable 5 name `src/ui/` and the schedule fields. VISION is unchanged. No rows spec is touched, and rows is unchanged.

---

## Task 29 — Row alignment between panes

**Serves:** M1. The Gantt in Task 30 must line up row for row with the editor beside it. This task builds the contract and the two leaders, and tests them with a stub follower. It has no visible change: no registered view follows yet.

**The idea:** a pane may **lead**, publishing where its rows are; **follow**, drawing its rows where it's told; both; or neither. Rows are keyed by line. A follower always draws from a `RowLayout`: when nothing leads, it builds one itself from the model. So there is one drawing path, with no aligned and standalone modes. The shell connects a leader to a follower by declared capability, and never by which view it is.

**Deliverables**

- **`src/ui/row-layout.ts`**, a name chosen to avoid "rows", which already means the library:

  ```ts
  interface RowLayout {
    version: number; // the buffer version this layout was measured at
    bodyTop: number; // px from the pane's top to where its scrolling body starts
    contentHeight: number; // the scrolling body's full height
    scrollTop: number;
    rows: { at: { line: number } | null; top: number; height: number }[];
    // the visible rows, in CONTENT coordinates (from the top of the body, not of the viewport)
    // at: null for a grid draft row; { line } can gain a file in M3
  }
  ```

  - Helpers: `naturalLayout(model, version, viewport)` builds a follower's own layout, with one row per item at `--row-height`. `ScrollEcho` drops a reported scroll within 1px of the value the shell last set, comparing values rather than using a boolean guard.
  - `--row-height` is one theme token, which the grid and followers share.

- **Buffer and model versions:** `PlanBuffer` counts its changes, and `Model.version` records the version that `analyze` read.
- **Leaders:** the grid and the text editor. `PlanEditor` gains optional `onRowLayout(cb)`, `scrollTo(top)` and `setMinBodyTop(px)`.
  - The text editor uses CodeMirror's line blocks, which cover wrapped lines. Folded lines are absent.
  - The grid includes comment, blank and frontmatter rows, plus a draft row as `at: null`.
  - Both publish after a scroll, an edit, a fold, and a resize. Resizes use a `ResizeObserver` on the pane, so the problems list and settings banner opening or closing count.
- **Followers:** `Renderer` gains `follows?: true`. A following renderer's `RenderContext` has `onRowLayout(cb)` and `reportScroll(top)`. It re-renders on a new model and repositions on a new layout, never re-rendering per scroll event.
  - It draws a layout only when `layout.version === model.version`, and otherwise keeps its last frame.
  - A layout row whose line has no item is left empty. An item whose line isn't in the layout isn't drawn.
- **The shell:** one connecting function, checked by capability:
  - When one side leads and the other follows, connect them. When both could lead, the left one does. Two editors side by side, or two renderers that don't follow, stay unconnected.
  - Each side reports its natural header height, and the shell sets both to the larger with `setMinBodyTop`.
  - Scrolling syncs in both directions through `ScrollEcho`.
  - After each analysis, the shell asks the leader to publish again, so the layout and model versions agree within one debounce.
- **Test-only stub follower** (`tests/support/`, not registered) that records what it would draw.
- **Spec:** plan-format-spec §3.3 (the follower part of `RenderContext`), §3.4 (the leader part of `PlanEditor`) and §3.7 (the buffer version). PLUGINS.md §8 lists `row-layout.ts`.

**Acceptance criteria** (jsdom, with injected measurements, since jsdom can't lay pages out)

- [x] Text editor leading the stub:
  - comment, blank and frontmatter lines are rows with no item;
  - a wrapped line has its own height;
  - folding a parent removes its children's rows, while the model still has their dates, which the Task 30 summary bar needs.

  — `tests/align/text-editor.test.ts`. CodeMirror itself measures the injected line heights (20px, 40px for the line that wraps), so the line blocks are real ones. Folding and unfolding a parent; the folded children's `start` and `finish` are asserted on the model. The empty text after the final newline is a CodeMirror line and no model line, so it is a row with no item.

- [x] Grid leading the stub:
  - comment rows are present;
  - a draft row is `at: null`;
  - opening the problems list republishes with a larger `bodyTop` (mocked `ResizeObserver`).

  — `tests/align/grid.test.ts`, with block layout injected. Also: the front matter is one row, on its first line; only rows on screen are published.

- [x] Coordinates: a layout published after scrolling has the same `top` values as before, and only `scrollTop` differs. — "publishes a scroll with the same row tops" in both leaders' tests.
- [x] Versions: after an insert or an Alt+Up move, the stub keeps its last frame until the model catches up, then draws. It never draws a layout against the wrong model. — The insert in the text editor's tests, Alt+Up in the grid's. Each checks there is no new frame between the edit and the model reaching the stub, including after the editor has the new model and the stub doesn't yet. Every frame records the model version it was drawn with, which is the layout's.
- [x] Scroll sync both ways, including an echo delivered after a delay (simulated): no loop, and no drift beyond 1px. — `tests/align/connect.test.ts`, with a fake leader that rounds to whole pixels and delivers its scroll events only when told: one `scrollTo` per user scroll, and a stub at 300.4 stays there when the leader's late echo says 300.
- [x] `bodyTop`: with a 40px leader header and a 64px follower header, both bodies start at 64px. — With the grid ("starts both bodies at the larger header", which also opens and closes the problems list over it) and with the text editor ("starts its body below a taller follower header").
- [x] Unconnected cases: two non-following renderers, and the stub with no leader, which draws its natural layout. — `tests/align/connect.test.ts`, which also covers two leaders, a follower on the left, and both sides able to lead.
- [x] No visible change in the app, and every existing test passes. — 1781 tests pass (1750 before), with typecheck and lint clean. No registered renderer follows, so the shell connects nothing. **Browser pass pending review:** grid rows now have `height: var(--row-height)`, 22px, as a minimum. I chose 22px to match today's rows, but haven't measured it in a browser.

**Not in this task:** the Gantt (Task 30). Overscan for dependency arrows, which have no off-screen endpoints until arrows exist (after M1). Choosing which view goes on which side; the shell's rule is written for any pairing, but the layout stays editor on the left and views on the right.

**Human review:** read `row-layout.ts` and the shell's connecting function first. They are the contract every aligned view follows.

**Decisions taken** (by me, within the task):

- **`RowLayout` lives in `src/core/types.ts`,** beside `RenderContext`, which needs it and which core can't import from `src/ui`. `src/ui/row-layout.ts` re-exports it with the helpers (`naturalLayout`, `ScrollEcho`, `layoutPublisher`) and the `Leader` interface, the optional part of `PlanEditor`.
- **The connecting function is `connectPanes(left, right)` in `src/app/align.ts`,** not inside `main.ts`, so it is tested without booting the app. It is given what each pane can do: `leads` (a `Leader`) and `follows` (the shell's end of a follower, from `followerChannel()`).
- **A follower also reports its header height,** through a third `RenderContext` member, `reportHeaderHeight(px)`. The task lists only `onRowLayout` and `reportScroll`, but the follower needs a way to report its header. The shell passes that height to the leader's `setMinBodyTop`, and the follower starts its body at the layout's `bodyTop`, so both start at the larger header without the shell knowing the leader's natural height. The follower has no `setMinBodyTop` of its own.
- **`update` is how the shell asks the leader to publish again:** both editors republish at the end of `update`, which the shell already calls after each analysis. `PlanEditor` gains only the three methods the task names.
- **The leader publishes at once to a new subscriber, and the follower channel replays its latest layout and header height,** so a connection made after an editor or view switch doesn't wait for the next scroll.
- **A layout's `version` is what its rows show:** the buffer's version for the text editor, whose view always shows the buffer, and its model's version for the grid, whose rows are drawn from the model.
- **A leader's scroll echo still passes its layout on,** with `scrollTop` replaced by the value the shell set. A scroll can show new rows, so the echo can't be dropped, and the follower stays where the user scrolled it.
- **`analyze` takes its optional arguments as an object,** `analyze(text, { filename, files, version })`; without a version the model records 0. Every caller is updated. `tests/app/shell.test.ts` wraps the registry's `analyze` and checks that every model the shell builds carries the buffer's version at that moment.
- **The text editor's `setMinBodyTop` sets the content's top padding** through a compartment, and keeps CodeMirror's own 4px when that's more. The gutters follow the padding.
- **The grid's `setMinBodyTop` sizes a spacer between the problems list and the table.** The grid's whole pane scrolls, header included, so its `bodyTop` is in the pane's content. That fits the same formula as the text editor's: on screen, a row is at `bodyTop + top - scrollTop`.
- **`--row-height` is in `src/app/style.css`, not `theme.css`:** theme.css holds colours, and its test requires every token there to have a dark value too.

- **Leaders measure only while something subscribes.** Checked before commit. The text editor already measured only through `publish`, which returns early with no subscriber, except in `setMinBodyTop`, which read two rects. The grid measured in `fitBodyTop` on every `update` and every resize, subscriber or not. Both changed: with no subscriber, nothing is measured, and a minimum body top waits for one (a minimum of 0 still clears the space, without measuring). When something subscribes, the grid fits its spacer before the first layout goes out, and the text editor sets its padding, which republishes. `tests/align/idle.test.ts` checks, for both editors, that a scroll, an edit, an update, a resize and `setMinBodyTop` measure nothing with no subscriber, and that scrolling does measure once something subscribes and stops when it unsubscribes.

**New tests:** `tests/align/text-editor.test.ts`, `grid.test.ts`, `connect.test.ts` and `idle.test.ts`; "model versions" in `tests/app/shell.test.ts`; `tests/ui/row-layout.test.ts` (`naturalLayout`, `ScrollEcho`); the buffer's version in `tests/buffer/shared.test.ts`. Test support: `tests/support/stub-follower.ts` (the stub, not registered), `layout.ts` (injected measurements and a mock `ResizeObserver`) and `panes.ts` (an editor leading the stub, connected as the shell connects them). No existing test was rewritten in substance: callers of `analyze` across the tests now pass `{ filename }`, and `tests/app/shell.test.ts` mocks the registry to record models.

**Changed by Task 32:** the grid's new-task row is the last body row, so the grid also publishes it as `at: null`, after the last line's row. The first grid test ("has comment, blank and front matter rows…") gained that row. `contentHeight` is unchanged: it already included the total row, which is now pinned.

**Changed by Task 30:** the shell converts between the two hosts' tops. A `bodyTop` or a header height is measured from its own host, `connectPanes` takes each pane's `host`, and it remeasures when either host is resized. Task 29 had assumed both panes start at the same height.

**Spec:** plan-format-spec §3.2 (`Model.version`, `analyze`'s options object), §3.3 (`follows`, the follower part of `RenderContext`, `RowLayout` and the follower rules), §3.4 (the leader part of `PlanEditor`, both leaders, measuring only with a subscriber, the connecting rules) and §3.7 (`version()`). PLUGINS.md §4 and §6 add `Model.version` and `analyze`'s options object, and §8 lists `row-layout.ts` and `app/align.ts`. CLAUDE.md's repo layout names row alignment under `ui/`. VISION is unchanged.

---

## Task 30 — Gantt chart and pin review

**Serves:** M1 (VISION §5; `PLUGINS.md` §4). The Gantt is the first view that follows another pane's rows (Task 29). The pin review lists every pin from any plugin. This task completes "a PM can read a schedule"; editing IDs and dependencies in the grid is Task 31.

**Deliverables**

- **Gantt geometry, as a pure function** (`src/plugins/schedule/renderers/gantt/geometry.ts`): `ganttGeometry(model, layout, dayWidth, today)` returns plain data with no DOM:
  - per row: a bar (x, width), a summary bracket, or a milestone diamond (x); whether it is critical, late, done or pinned, where pinned means the start's mode isn't `derived` (`PLUGINS.md` §4); for a pinned start, `pinX`, the pin's own date; and its row's `top` and `height` from the layout;
  - full-height lines for the project finish and for each distinct deadline date;
  - the date scale: week separators and day labels.

  The drawing code only places what it returns. Every geometry test runs without a browser.

- **The chart's extent** runs from hour 0 to the later of the project finish and the latest deadline, rounded up to a whole working day, plus one working day of padding.
- **The x axis is working days.** A position is `WorkHours / calendar.hoursPerDay × dayWidth`, so weekends take no space, and every bar matches the schedule's own axis exactly. The scale shows a separator and a date label (`Mon 5 Oct`, with the year shown when it differs from `project-start`'s) at each week's first working day, and the day letters below. `dayWidth` is fixed at 24px for now, and the chart scrolls horizontally on its own. Zoom comes later.
- **Marks:**
  - Leaf bars run from start to finish.
  - Summary rows get a bracket from their start to their finish.
  - Milestones are a diamond at their finish.
  - Critical leaf bars and summary brackets use the critical colour.
  - A late row's mark is outlined in the warning colour, and a small marker sits at its deadline on that row.
  - Done rows are dimmed.
  - A pinned start has a small pin mark at the pin's own date (`pinX`), not at the start of the bar. A pin that had no effect sits left of its bar, which shows it.
  - Each deadline date is a dashed full-height line, labelled in the scale. The project finish is a solid line.
- **A today line**, read from `today()` in `src/ui/`. The renderer is UI code, so it may read the clock; the geometry function takes `today` as a parameter, so it stays pure and testable. The line is drawn only when today falls inside the extent.
- **A `deadline` field** in the schedule plugin: `schedule.backward` writes `deadline: WorkHours`, the deadline date's `'end'` edge, on each row whose deadline cell is set. It already converts the date for the late finish, so the conversion happens once, in one place. The geometry collects the distinct values for the lines and the scale labels.
- **The Gantt renderer** (`src/plugins/schedule/renderers/gantt/`): it declares `follows: true` and requires the schedule fields it reads.
  - It draws from its `RowLayout`: the editor's layout when one leads, otherwise its natural layout. A row with no item stays empty, and only rows in the layout are drawn.
  - It reports its header height (the date scale) through `reportHeaderHeight`.
  - The cursor band and click-to-line work through `RenderContext`, as in the other views. Clicking a mark or its row moves the cursor to that line.
  - Hovering a mark gives a tooltip with the title, start and finish dates, duration and slack, formatted as in the schedule table.
  - When the schedule's stages were skipped, it is greyed out with the reason, as now.
- **Theme tokens** for the bar, critical, summary, milestone, deadline, project finish, today, pin and the scale's lines, in both themes. The colour-token test still passes.
- **Pin review** (`src/views/pins/`), with no requires, so it's always available, and showing "No pins" when the list is empty:
  - **What it lists:** for every node field whose key is pinnable (single or by column), each value with both a `pin` and a `derived`. Leaf estimates never appear. For each, it shows the outline number, title, what is pinned, pin, derived and effective, in document order. A pinned value whose effective value differs from its pin (a floor that had no effect) is marked; an additive one never is, since adding is what it's for.
  - **Interaction:** click-to-line and the cursor band, as in the other views.
  - **How it finds the pinnable fields:** `Model` gains `fields(): FieldKey<unknown>[]`, listing the keys written in this analysis.
  - **How it labels and formats them without knowing the plugin:** single pinnable keys gain a `label` ('Start', 'Duration') and a `kind` (`'duration'` or `'date'`). A by-column key carries neither: it shows its column's name, and the column's type decides the format, a duration column through `formatDuration` and a number column as the plain number. Durations are formatted with `formatDuration`, and dates with `calendar.toDate(t, 'start')`.
  - Estimate's `rollup` is labelled with the column name and formatted by the column's type. Schedule's `start` is 'Start', `kind: 'date'`, and its `duration` is 'Duration', `kind: 'duration'`.
- **Spec:** plan-format-spec §5.5 (Gantt) and §5.6 (pin review), §3.2 for `fields()`, and §2.11 for the `deadline` field. PLUGINS.md §4 for `label`, `kind` (single keys only; a by-column value is formatted by its column's type) and `fields()`.

**Acceptance criteria**

- [x] Geometry on `examples/schedule.plan` with its natural layout, in days at `dayWidth` 1:

  | Row        | Mark                      | x   | width | pinX |
  | ---------- | ------------------------- | --- | ----- | ---- |
  | Design     | summary                   | 0   | 1.5   | —    |
  | Wireframes | bar, pinned               | 0   | 1     | 0    |
  | Review     | bar                       | 1   | 0.5   | —    |
  | Build      | summary, critical         | 1.5 | 5.5   | —    |
  | API        | bar, pinned               | 1.5 | 3     | 0    |
  | UI         | bar, critical, pinned     | 5   | 2     | 5    |
  | Beta ready | milestone, critical, late | 7   | —     | —    |
  | Docs       | bar                       | 2.5 | 3     | —    |

  Deadline line at 6 (12 Oct); Beta ready's deadline field is 48. Project finish at 7. Extent 8 (finish 7, deadline 6, rounded 7, padded 8). Week separators at 0 and 5, labelled `Mon 5 Oct` and `Mon 12 Oct`. Today passed as `2026-10-07` gives a line at 2. Today outside the chart gives no line.

  Like Task 28's, these values were worked out by hand. Write the test from the table, never from output.

  — `tests/schedule/gantt-geometry.test.ts`, written from this table. The code agreed with every value on the first run. The table's "pinned" column and `pinX` were corrected before any code was written (see decisions). It also checks that the rows keep the layout's order, `top` and `height`, that the day letters span the extent, and that positions scale with `dayWidth`.

- [x] Geometry against a leader's layout: comment and frontmatter rows give no mark. A folded parent's children give no mark, but the parent's summary bracket still spans their dates. A draft row (`at: null`) gives no mark. Marks take each row's `top` and `height` from the layout. — "Gantt geometry against a leader's layout" in the same file, on a layout written by hand: front matter, the comment, Design folded, a draft row, and Build.
- [x] The Gantt follows through the Task 29 contract: it draws only when the layout's version matches the model's, and reports its scale height through `reportHeaderHeight`. — `tests/schedule/gantt.test.ts`, which also covers the natural layout, empty rows, repositioning without redrawing, click-to-line, the cursor band, the tooltips, done rows and its scroll report. In `tests/app/shell.test.ts`, the booted app's Gantt lines its rows up with the text editor's line blocks.
- [x] Pin review on the fixture lists exactly four entries: the Wireframes, API and UI starts, and Docs' duration. Leaf estimates have no derived value, so none appears. API's row is marked as differing (pin Mon 5 Oct, effective Tue 6 Oct). — `tests/views/pins.test.ts`, with the derived values from Task 28's hand-worked table; the code agreed on the first run.
- [x] A pinned number column shows its plain value in the pin review, not hours. — `tests/views/pins.test.ts`.
- [x] Pin review on `examples/example.plan` lists exactly `Auth`'s `est` override (pin 2d, derived 2d 7h) and `OAuth (Google)`'s additive `est` (pin +1d, derived 5h, effective 1d 5h), and no leaf estimate. — `tests/views/pins.test.ts`.
- [x] The colour-token test passes, and every new token has a dark value. — Nine `--gantt-*` tokens, each with a dark value.
- [x] **Browser pass, Chrome and Firefox, both themes:**
  - Gantt beside the grid: bars line up row for row, including with the problems list open and closed.
  - Gantt beside the text editor: comment lines give empty rows, and folding a parent hides its children's bars and keeps its bracket.
  - Scrolling either pane scrolls the other, with no drift or stutter, on a 500-line file.
  - The fixture's marks match the table above.
  - The pin review lists the pins, and clicking a row moves the cursor.
  - The tab bar and the export button stay put while each view scrolls.
  - The Gantt still lines up after the tab bar wraps (narrow the window) and after it unwraps.

  **Pending review.** There is no browser here.

**Visible changes:** a Gantt tab and a Pins tab.

**Not in this task:**

- Dependency arrows (after M1).
- Zoom levels.
- Dragging bars (M2).
- Showing weekends as calendar time.
- Editing IDs and dependencies in the grid (Task 31).

**Human review:** read the geometry test against the table first. It's the one place the chart's meaning is pinned down.

**Decisions taken** (asked and answered before any code was written):

- **Pinned is the start's mode.** A row is pinned when its start's mode isn't `derived` (`PLUGINS.md` §4). The table had API unmarked and Docs marked (Docs' pin is on its duration), so it was corrected: API is `bar, pinned`, and Docs is `bar`. The pin mark sits at the pin's own date, which geometry reports as `pinX`, not at the start of the bar. Wireframes is at 0, UI at 5, and API at 0, left of its bar at 1.5, which shows the pin had no effect.
- **A by-column key carries no kind.** In the pin review, the column's type decides the format: a duration column through `formatDuration`, a number column as the plain number. Only single keys have `label` and `kind`. Estimate also rolls up number columns, and `kind: 'duration'` on `rollup` would have shown a pinned 16 as `2d`.
- **A `deadline` field in the schedule plugin.** `schedule.backward` writes `deadline: WorkHours`, the date's `'end'` edge, on each row whose deadline cell is set. It already converted the date for the late finish, so the conversion happens once, in one place. The Gantt couldn't read the cell itself (non-negotiable 5). On the fixture, Beta ready's is 48.
- **The extent** runs from hour 0 to the later of the project finish and the latest deadline, rounded up to a whole working day, plus one working day. On the fixture it is 8. Today is drawn only inside it.
- **The Gantt lives in `src/plugins/schedule/renderers/gantt/`**, geometry included, where the renderer lint rules already apply (no `rows`). The task had `src/plugins/schedule/gantt/`, which they don't cover. The schedule table was already in `renderers/`.
- **The shell converts between the two hosts' tops.** It completes Task 29's contract (below). A layout's `bodyTop` and a header height are each measured from their own host's content top. `connectPanes` takes each pane's `host`, measures both against the page, and converts in either direction: it subtracts the offset from each forwarded `bodyTop` and adds it to the header height it passes to `setMinBodyTop`. A `ResizeObserver` on both hosts redoes the conversion when either moves, for example when the tab bar wraps. Editors and renderers never see the shell's markup.
- **The preview is a flex column:** a fixed tab bar, with `#host` filling the rest as the scroll container. The Gantt's body scrolls inside it: in sync vertically, on its own horizontally.

**Decisions taken** (by me, within the task):

- **`formatDate` moved from the schedule table to `src/ui/dates.ts`**, since the pin review belongs to no plugin and can't import one. `formatDays` stays in the schedule table, and the Gantt's tooltip imports it from there, in the same plugin.
- **The geometry takes `today`** as its fourth argument: `ganttGeometry(model, layout, dayWidth, today)`. Today's line is at the start of its working day (`fromDate(today, 'start')`), so a weekend's falls on the Monday after.
- **The scale is 40px:** week labels and deadline dates on top, day letters below. The Gantt reports that as its header height. With a leader, its body starts at the layout's `bodyTop`, and the scale fills the height above it.
- **A new layout repositions the Gantt's rows without redrawing them.** Row elements are kept by line and only moved. Rows that leave the layout are removed, and new ones are drawn. A new model redraws everything. The cursor band is a class on each row, updated on every render.
- **The tooltip** is the mark's `title`: the title; the start and finish dates (a milestone shows one date); the duration (`milestone` for a milestone; a summary has none); and the slack. All as the schedule table formats them.
- **The pin review** shows an additive pin with its `+` and marks a differing row with a muted "differs from the pin" in its effective cell. `Model.fields()` is the set of keys every stage that ran declares in `writes`, in stage order.
- **The pin review's tab comes after the plugins' renderers.** `app/registry.ts` lists the views after them.

**Visible changes:**

- A Gantt tab and a Pins tab. The Gantt is greyed out with the schedule's reason, as the schedule table is.
- The preview's tab bar and export button stay put while a view scrolls. The view's host scrolls, not the whole preview pane.
- With the Gantt showing, the editor's body starts lower, level with the Gantt's: the 40px scale plus the tab bar's height. The text editor gets top padding, the grid a spacer above its table.
- Nine new theme tokens (`--gantt-bar`, `-critical`, `-summary`, `-milestone`, `-deadline`, `-finish`, `-today`, `-pin`, `-scale-line`), used only by the Gantt.

**Rewritten tests:**

- `tests/app/shell.test.ts`, "lists every registered renderer, greying out one whose requirements are unmet": the tabs are Tree, Table, Schedule, Gantt and Pins (were Tree, Table and Schedule). The Gantt is greyed out with "needs project-start", and Pins is enabled.

**New tests:** `tests/schedule/gantt-geometry.test.ts` and `gantt.test.ts`; `tests/views/pins.test.ts`; `tests/core/fields.test.ts` (`Model.fields()`, `label` and `kind`); `tests/renderers/scroll-to-cursor.test.ts`, which checks that the tree, table and schedule views still scroll their cursor row into view, `nearest`, now that `#host` scrolls (only the tree's had a test); in `tests/align/connect.test.ts`, "hosts at different heights" (follower host 32px lower, leader host 32px lower, and a host moving after connection); and in `tests/app/shell.test.ts`, "lines the Gantt up with the text editor's lines, and shows the pin review".

**Changed by Task 32:** the cursor band is no longer on the Gantt's `.gantt-row`, but on a separate `.gantt-band`, drawn below the week lines; `.gantt-row` holds an item's marks and takes its clicks. Every layout row with a line has a band, including a row with no item, which still has no marks. `ganttGeometry` returns those as `bands`. The deadline, finish and today lines are drawn over the marks. "bands the cursor row" in `tests/schedule/gantt.test.ts` now reads `.gantt-band.at-cursor`.

**Spec:** plan-format-spec §2.11 (the `deadline` field), §3.2 (`fields()`), §3.3 and §3.4 (hosts at different heights, converted by the shell), §5.3 (the preview as a column), and the new §5.5 Gantt and §5.6 Pin review. PLUGINS.md §4 (`label`, `kind` for single keys only, `fields()`, `definePinnable`'s signature) and §8 (the Gantt in `renderers/`, `views/pins/`, dates in `ui/`). CLAUDE.md's non-negotiable 5 lists `deadline` and `projectFinish` among the schedule fields renderers read. No rows spec is touched, and rows is unchanged.

---

## Task 31 — Dependencies, IDs and milestones in the grid

**Serves:** M1, its last task. After it, a grid user can build and schedule a plan without the text editor. Dependencies are typed as outline numbers, as in MS Project's Predecessors column. The tool gives the target rows IDs as needed, and IDs stay hidden. Milestones get a toggle like done.

**Why IDs and not outline numbers:** the file stores references by ID, so dependencies survive rows being inserted, moved and deleted. The grid shows and accepts outline numbers, which are what a grid user sees, and translates both ways. Grid users never need to see an ID.

**Deliverables**

- **rows edit API** (DESIGN §6, with property tests; no spec change, since the anchor syntax exists):
  - `setAnchor(doc, row, id)` gives a row an anchor, or replaces its anchor. It refuses an ID that's invalid or already used, ignoring case. (A third refusal was added when asked; see Decisions.)
  - `deleteRow(doc, row, { removeReferences: true })` also removes every in-file reference to the row's ID. A cell left with no reference is cleared, and a `many` cell keeps its other references. Without the option, `deleteRow` is unchanged: it deletes the row and leaves any reference to it pointing at nothing, with the existing warning. _(Corrected: this said "today's refusal stands", but `deleteRow` has never refused a referenced row. Its one nearby refusal, the last anchor while other rows set `id=` by name, stays in both modes.)_
  - The property tests extend to both: no new syntax or structural errors, and after `removeReferences`, no dangling reference to the deleted ID.
- **ID minting, in core** (`mintId(doc, title)`, pure): a slug of the title, made valid by the ID grammar and unique ignoring case.
  - Characters outside the grammar are dropped or turned into hyphens, and accents are folded (`Écran d'accueil` gives `ecran-d-accueil`).
  - An ID that's taken gets `-2`, `-3` and so on.
  - An empty slug gives `task`, which then follows the same rule.
  - It's deterministic, so two clients mint the same ID from the same text.
  - An ID never changes when the title does. Rewriting references on rename stays deferred (`renameId`, spec §7).
- **Ref cells in the grid.** This is generic for any `ref` column, so the grid knows nothing about scheduling.
  - **Display:** each target's outline number, plus its qualifier when there is one: `1.2, 2.1 +1d`. A reference that doesn't resolve shows as written (`#missing`), with its existing warning.
  - **Input:** targets separated by commas, each an outline number or `#id`, optionally followed by a qualifier value (a signed duration for `lag`). Commit resolves every outline number against the current model.
    - A target without an anchor gets one from `mintId`.
    - The cell is written with `setCell`, so quoting and qualifiers are rows' business.
    - The new anchors and the cell edit are one transaction, undone with one Ctrl+Z.
  - **Refusals:** the edit is refused only when it can't be written: a number that matches no row ("There's no task 4.7"), more than one target in a column without `many`, or a qualifier the column doesn't declare. Everything else, such as a dependency on a parent or on itself, is written, and the schedule's diagnostics report it as usual.
  - **Editing** shows the outline-number form, not the raw `#id` text. This is the one exception to spec §4b.2's "editing shows the raw cell text", and the spec says so.
- **Marker toggles.** The grid shows a toggle column for each declared marker, with `done` first as today's checkbox, then the others in declaration order, headed by their glyph (`^`). It uses `setMarker`, and Space toggles it. The toolbar's Toggle done is unchanged.
- **IDs on hover.** Hovering the WBS cell of a row with an anchor shows its ID (`#review`), so grid users can talk to text users.
- **Deleting a referenced row.** Instead of deleting it and leaving its references pointing at nothing, the grid offers a `confirm` with a preview: "Delete _Review_? _API_ and _UI_ refer to it in deps; those references will be removed." When references come from more than one column, each is listed: "… _API_ in deps, _Spec_ in related …". Applying it calls `deleteRow` with `removeReferences`, as one transaction. Cancelling writes nothing. Task 24's plain message for `deleteRow`'s last-anchor refusal, which was worded as if it were about references, is reworded to say what it is. _(Corrected: the wording was "depend on it; their dependencies on it will be removed", which fits only `deps` while ref cells are generic; and the message was to go, but the refusal it shows remains.)_
- **Spec:**
  - plan-format-spec §4b.1 (marker toggles), §4b.2 (ref cells and the editing exception) and §4b.4 (deleting a referenced row).
  - Remove "showing and editing anchors, IDs and `ref` columns in the grid" and "ID minting" from §7. Keep `renameId`, and showing implicit columns.

**Acceptance criteria**

- [x] On a `profile: schedule` file with no anchors, typing `1.1` into Review's `deps` gives Wireframes `{#wireframes}` and Review `#wireframes`. One Ctrl+Z restores both. — `tests/grid/refs.test.ts`, over a `CodeMirrorBuffer`: `    Wireframes {#wireframes} | 1d` and `    Review | 4h | deps=#wireframes` (by name, since `deps` isn't Review's next slot), one buffer change with origin `grid`, and one Ctrl+Z in the grid restores the text.
- [x] `1.1, 2.1 +1d` writes two references, with a lag on the second, and displays exactly that. A target that already has an anchor is reused, and no second anchor is written. — `deps=#wireframes, #api +1d`, shown as `1.1, 2.1 +1d`; a `{#wire}` target is written `#wire`, and the file then has exactly the two anchors it needs.
- [x] After moving rows with Alt+Up, the deps cells show the new outline numbers, and the references in the file are unchanged. — UI depends on API (2.1); after Alt+Up on UI its line is unchanged, it is 2.1, and its cell shows `2.2`.
- [x] Each refusal leaves the cell and buffer as they were and shows its plain note. — no buffer change, the cell as it was, and the note: "There's no task 4.7.", "The "deps" column holds only one task.", "The "deps" column takes only task numbers, with nothing after them." and the first-anchor note (see Decisions).
- [x] `mintId` table: two rows both titled `Review` (`review`, `review-2`), `REVIEW` when `review` exists (`review-2`), the accented title above, `2027 plan`, an empty title (`task`), and a title of only punctuation. Each result is checked against the ID grammar by parsing it back. — `tests/core/ids.test.ts`: each result is written as `X {#id}`, read back as the row's ID with no diagnostic. Also: the second `Review` minted in the same edit and after the first is written, `review` when `REVIEW` exists, `task-2`, the next free number, an ID in a key cell, and underscores and edge trimming. After review: a long title cut at its last hyphen within 24 characters, a long title that collides after cutting (`-2`), a long title with no hyphen cut at 24, and a hyphen at the 25th character.
- [x] Deleting a row that two others depend on: the preview names both, Apply removes the row and the two references with no dangling reference, one Ctrl+Z restores it all, and Cancel writes nothing. — "Delete Review? API and UI refer to it in deps; those references will be removed.", with the preview of the lines; Apply leaves `    API {#api} | 3d` and `    UI | 2d | deps=#api` and no `unresolved-ref`, one Ctrl+Z over a `CodeMirrorBuffer` restores it all; Cancel writes nothing and, after review, puts the focus back on the row it was opened from, as Apply does. Also: one reference, references from two columns, a row nothing refers to (deleted at once), and a buffer change dropping the confirm.
- [x] A marker toggle on `^` writes and removes the marker, and Space toggles it. — `    ^UI | 2d` and back, by the checkbox and by Space on its cell; headed `^`; a file whose only marker is done has no toggle column.
- [x] **The M1 test.** A scripted grid session, with no text-editor input, builds `examples/schedule.plan`'s plan from a file holding only its frontmatter:
  - rows and indents, estimates, the `dur` pin, start pins, dependencies typed as outline numbers (including the 1-day lag), the deadline, and the milestone toggle;
  - its schedule then matches Task 28's table cell for cell.

  The text may differ from the example only in the minted IDs and cell spacing. The test asserts the model, not the bytes.

  — `tests/grid/m1.test.ts`. Rows are typed into the new-task row and placed with Alt+Shift+Right and Left; cells are typed into; the milestone is its `^` toggle. The model matches the example's row for row (outline number, title, markers, every cell, and each dependency by its target's title with its lag), and the schedule matches Task 28's table, copied from it by hand: every start, duration, finish, late start, late finish, slack, flag and shown date, `projectFinish` 56 (Tue 13 Oct), and exactly the table's three diagnostics. The code agreed with every value on the first run. The text it builds:

  ```
  ---
  profile: schedule
  project-start: 2026-10-05
  ---
  Design
      Wireframes {#wireframes} | 1d | start=2026-10-05
      Review {#review} | 4h | deps=#wireframes
  Build
      API {#api} | 3d | start=2026-10-05 | deps=#review
      UI {#ui} | 2d | start=2026-10-12 | deps=#review
      ^Beta ready | deps=#api, #ui | due=2026-10-12
  Docs | 1d | 3d | deps=#review 1d
  ```

  Beta ready has no anchor, since nothing refers to it; the example's comment line is the text editor's business.

- [x] The text editor is unaffected, and every existing test passes. — 1,894 tests pass (1,829 before), with typecheck and lint clean. No text-editor file changed. Rewritten tests are listed below.
- [ ] **Browser pass, Chrome and Firefox:** build a small schedule in the grid alone, with the Gantt beside it; delete a predecessor through the confirm; undo. **Pending review.** There is no browser here.

**Visible changes:**

- `deps` cells, and every other `ref` cell, show outline numbers, and editing one starts from them. Typing outline numbers writes IDs, and gives the targets anchors as needed.
- Marker toggle columns: in a `profile: schedule` file, a `^` column between done and the title.
- IDs on hover over the WBS cell, above any diagnostic message there.
- Deleting a row others refer to asks first, in a panel below the toolbar, instead of leaving their references pointing at nothing.
- New refusal notes for ref cells, and the reworded last-anchor note (Task 24's notes).
- A diagnostic on a named cell (`deps=#missing`, `est=4 hours`) now outlines that cell. It used to land on the WBS cell, since its span includes `NAME=` and the grid compared it with the value alone (spec §4b.2 now says so).

**Not in this task:**

- Picking a predecessor by clicking a row.
- Link types other than finish-to-start.
- Rewriting references when an ID is renamed.
- Showing the implicit `id` and `parent` columns.

**Human review:** the M1 test first. It's the milestone's definition of done, written as a test.

**How it's built:**

- rows (`packages/rows/src/edit.ts`): `setAnchor` inserts ` {#id}` straight after the lead value, before any padding, or replaces the first anchor's ID, and sets a written key cell to the same ID. It closes an unterminated lead's quote first, as appending a cell does. `deleteRow`'s `removeReferences` adds, for every other row's ref cell of the current table (the nest column included), a `setCell` that drops the references to the row with their qualifiers and a comma, or clears the cell. In a cell that reads as references they are matched by target; in one that doesn't (a part that isn't a reference, or several in a column without `many`), by the text of an ID the row is the first to declare. DESIGN §6 has both, and the refusals.
- core (`src/core/ids.ts`): `mintId(doc, title, taken?)`. `taken` holds IDs minted for the same edit and not written yet, so `1, 2` on two rows titled `Review` gives `review` and `review-2`.
- grid (`src/grid/refs.ts`): `refText` shows a ref cell, and is what editing starts from; `setRefs` reads what was typed, resolves outline numbers, mints and anchors targets with no ID, and writes the cell with `setCell`, as one change with the repairs of every row it touches. Inserts at one place (an anchor on a lead-only row that is also the cell's row) are joined in order.
- grid (`src/grid/index.ts`): marker toggle columns are numbered `-2`, `-3`… (`MARKER - i`), between done (0) and the title (1), so existing column numbers are unchanged. The WBS cell's `title` carries the ID. The delete confirm is the problems list's own confirm flow (`problems.run`, exposed for it), shown in a `.sheet-confirm` panel below the toolbar; a delete compares `deleteRow` with and without `removeReferences`, and asks only when the edits differ, naming each row whose ref cell the extra edits touch, by column. Any model update clears the panel. Focus moving into it doesn't count as leaving the grid, so after Apply the grid takes the focus back. _(Changed in review: Cancel does too. `problems.run` takes an `onCancel`, and the grid restores its place on it.)_
- `src/grid/messages.ts`: the new refusals' plain messages, and the reworded last-anchor one.

**Decisions taken** (by the spec owner, when asked):

- **`deleteRow` without the option is unchanged.** The task said "today's refusal stands" and that Task 24's message "goes", but `deleteRow` never refused a referenced row: it deleted it and left an `unresolved-ref`. Its one nearby refusal (the last anchor while other rows set `id=` by name) stays in both modes, and its message is reworded to say what it is. The grid confirms whenever other rows refer to the row, so a grid delete never leaves a dangling reference. The deliverables above are corrected.
- **A third `setAnchor` refusal, mirroring `deleteRow`'s:** the file's first anchor, in a file without `key`, while a row has a cell written `id=…`. Without identity that cell reads as text (`owner` = `id=x`); with it, it becomes the row's key, changing another row's meaning. The generators contain `id=a`, so the "every other row unchanged" property found it, and it keeps that property with no exemption. In the grid, a ref edit needing such an anchor is refused as a whole: "Another task has a cell written as id=…, which would start to mean a task ID. Change that cell first." It counts the target row's own `id=` cell too, since that would also change.
- **The confirm names the column,** since ref cells are generic: "Delete Review? API and UI refer to it in deps; those references will be removed.", and "… API and Docs in deps, UI and Docs in related refer to it …" across columns. One reference reads "UI refers to it in deps; that reference will be removed."

**Decisions taken** (by me, within the task):

- **A target that already has an ID reuses it,** from an anchor or from a key cell. Only a target with no ID gets an anchor.
- **A duration qualifier typed into a ref cell is normalised** as a typed duration is (`1 day` → `1d`), by analogy with spec §4b.6.5. Any other qualifier, and every `#id`, is written as typed; a part that is neither an outline number nor `#id` is written as typed too, and shows rows' warning.
- **`mintId`** turns each run of characters outside `[a-z0-9_-]` into one hyphen after folding accents (NFD, marks dropped) and lowering case, and trims what can't begin an ID and trailing hyphens. _(Changed in review: it then cuts the slug at the last hyphen at or before 24 characters, or hard at 24 when there is none, before the uniqueness suffix, since ext §3.3 says a minted ID SHOULD be short. `Migrate the billing database to Postgres` gives `migrate-the-billing`, and a second long title that cuts to the same slug gives `migrate-the-billing-2`.)_
- **`setAnchor` changing an anchor's case** (`review` → `Review` on the same row) is allowed: the ID it replaces doesn't count as used. Its own aliases do.
- **`removeReferences` covers the nest column,** as "every in-file reference" says: a `parent=#review` on another row is removed, and that row falls back to its indentation.
- **The ID on hover** is the first anchor's, above any diagnostic message the WBS cell already shows.
- **A diagnostic on a named cell outlines the cell** (above, Visible changes). Without it, every unresolved `deps=#…` the grid writes would have marked the WBS cell instead, since the grid writes `deps` by name.

**Rewritten tests:**

- `tests/grid/messages.test.ts`: "the example wording" expects the reworded last-anchor message, and the first-anchor one; the cases gain the last-anchor refusal with `removeReferences` and `setAnchor`'s first-anchor refusal.
- `packages/rows/tests/edit.test.ts`: the `deleteRow` property now runs half its files with `removeReferences`, and its expected projection drops exactly the references to the row from the other rows' ref cells (compared by their trimmed parts), then checks that no reference to the row's IDs is left pointing at nothing. Over 1,500 files delete with the option. A planted bug (skipping cells that don't read as references) fails it.
- `packages/rows/tests/generators.ts`: nested files now and then get a ref cell that doesn't read as references (`#a, x`, and `parent="#a, #b"` in a column without `many`); it was added because the planted bug above passed without it. Every property still holds.

**New tests:** `tests/grid/refs.test.ts` (ref cells, refusals, marker toggles, IDs on hover, the delete confirm), `tests/grid/m1.test.ts` (the M1 test), `tests/core/ids.test.ts` (`mintId`); in `packages/rows/tests/edit.test.ts`, the `setAnchor` examples and property (over 4,554 files, at least 1,000 written; a planted bug that drops the first-anchor refusal fails it) and two `deleteRow` examples.

**Spec:** plan-format-spec §3.9 (`setAnchor`, `removeReferences`), §4b.1 (marker toggles, IDs on hover), §4b.2 (ref cells, their input and refusals, `mintId`, the editing exception, and diagnostics on named cells), §4b.4 (Space on a toggle, deleting a referenced row) and §4b.6.6's identity note; §7 loses "showing and editing anchors, IDs and `ref` columns in the grid" and "ID minting", and keeps `renameId` and showing the implicit `id` and `parent` columns. rows DESIGN §6: `setAnchor`, `deleteRow`'s option, both refusals and the property. No rows spec is touched, so no version changes, and there are no spec questions.

**Changed in review** (from what was noticed above): DESIGN §1 no longer lists minting IDs under rows' "Later", and says it lives in the plan's core; PLUGINS.md §8 lists `mintId` among core's contents; plan-format-spec §4b.2 has the 24-character cut. Escape on the delete confirm still does nothing; Cancel is the way out.

---

## Task 32 — Demo polish: grid and Gantt reading

**Serves:** the M1 demos (the demo kit). The grid and the Gantt are read together, so these four changes make that easier. There are no new features.

**Deliverables**

- **Pinned total row.** The grid's total row sticks to the bottom of the grid's scroll area, and the new-task row becomes the last row of the body.
  - The total row's cells are `position: sticky; bottom: 0`, with a background so rows don't show through. The row keeps its own place at the end of the table, and that place is what lets the last task and the new-task row scroll clear of it, so the body gets no extra padding. _(Corrected in the task: it first asked for bottom padding equal to the total row's height. With the row in the flow, that padding would leave a blank, row-high gap above the total row.)_
  - The grid's published `contentHeight` stays `scrollHeight − bodyTop`, which includes the total row. A follower whose content is shorter (the Gantt) pads to the leader's `contentHeight`, so both scroll to the same end.
  - The keyboard rules for the new-task row (spec §4b.1, §4b.4) are unchanged, apart from the new order.
- **Grid row band.** The current row gets the same full-width band the views use, behind the cells, as well as the focused cell's outline. A selected row (WBS cell) keeps its own style. Done rows keep their band, as in the tree.
- **Gantt layer order.** From bottom to top: the cursor and hover bands, the scale's week lines, the bars and marks, then the deadline, today and project-finish lines. Labels stay readable over the band.
- **Hover across panes,** a generic mechanism like the cursor line:
  - `RenderContext` gains `setHoverLine(line | null)` and `onHoverLine(cb)`.
  - `PlanEditor` gains optional `setHoverLine(line | null)` and `onHoverLine(cb)`.
  - The shell relays a hover line from either pane to the other, and never names a view.
  - **Implementers:** the grid (hovering a row reports its line, and a relayed line gets a hover band), the Gantt (both ways, hovering anywhere on a row) and the other views (show the band). The text editor stays out for now, since the interfaces are optional.
  - Leaving a pane reports `null`. The hover band is lighter than the cursor band, in both themes.
- **Spec:** §4b.1 (the total row and new-task row), §3.3 and §3.4 (hover), §5.5 (the Gantt's layers).

**Acceptance criteria**

- [x] The total row stays at the bottom while the grid scrolls, and the new-task row is the last body row. ArrowUp from it, Enter on the last item, and Tab wrapping behave as before. — `tests/grid/demo-polish.test.ts`: the new-task row is the body's last row and the total row is alone in the footer. Enter on the last item and Tab off its last cell reach the new-task row; ArrowUp and Shift+Tab come back. The existing new-task tests in `tests/grid/grid.test.ts` pass unchanged. Whether the row stays pinned while scrolling is CSS, so the browser pass checks it.
- [x] Scrolled to the end, the last row in both the grid and the Gantt is fully visible, and the two panes' rows still line up (Task 29 test with injected measurements). — `tests/align/end-of-scroll.test.ts`: the grid leads the real Gantt, with 30 tasks in a 400px pane. At the end of the scroll, the last task and the new-task row end where the pinned total row begins. The Gantt's canvas is the grid's `contentHeight` (total row included), so its own furthest scroll is the grid's. Its last row's band is level with the grid's row and inside the pane. Task 29's alignment tests pass; one is rewritten (below).
- [x] The grid's current row has a full-width band. Moving focus moves the band, and a done row still shows it. — `tests/grid/demo-polish.test.ts`: it moves with ArrowDown onto a comment row, stays on a done row and on a selected row (which also keeps `selected`), and survives a rebuild.
- [x] Gantt geometry and draw order: the band is drawn before the lines (a DOM order test). — `tests/schedule/gantt.test.ts`, "draws, bottom to top…": in document order, bands, week lines, mark rows, then the deadline, finish and today lines, with no `z-index` in the canvas. Geometry returns a band for every layout row with a line ("bands every layout row with a line…").
- [x] Hovering a Gantt row highlights the matching grid row, and the reverse. Leaving clears both. With a non-following view, hover still relays by line, and nothing breaks when a pane doesn't implement hover. — `tests/app/shell.test.ts`, "hover across panes", on the booted app: Gantt to grid, grid to Gantt, and a grid comment row to the Gantt's empty row on that line. Leaving either pane clears the other. The tree beside the grid bands the hovered item. Hovering the Gantt beside the text editor, which has no hover, breaks nothing. Unit tests: the grid's report and band in `tests/grid/demo-polish.test.ts`, the Gantt's both ways in `tests/schedule/gantt.test.ts`, and the four non-following views (exact line; a comment shows nothing) in `tests/renderers/hover.test.ts`.
- [x] The colour-token test passes, and every new token has a dark value. — No new token: the hover band is `--hover`, and the grid's band is `--cursor-row-bg` and `--cursor-row-fg`, as in the views.
- [x] Every existing test passes, and rewritten tests are listed in the notes. — 1918 tests pass (1894 before, 24 new). Typecheck and lint are clean.
- [ ] **Browser pass, Chrome and Firefox, both themes, on `examples/demo.plan`:** **Pending review.** There is no browser here. `examples/demo.plan` was added for this pass (below). Also check that the hover band (`--hover`) is visible in dark mode against `--bg`, both on its own and next to the cursor band. If it isn't, raise it then rather than adding a token.
  - the total row stays pinned;
  - the bands are visible;
  - the lines show over the band;
  - hover follows across the panes;
  - alignment holds at the end of the scroll.

**Visible changes:** all four.

**Not in this task:** hover in the text editor, and anything about progress or the deps cell, which wait for the demos.

**Decisions taken** (asked and answered before any code was written):

- **The total row is sticky in the flow, with no extra padding.** Its cells are `position: sticky; bottom: 0` with `--bg` behind them. Its own place at the end of the table keeps the last rows clear of it, and `contentHeight` (`scrollHeight − bodyTop`, unchanged) includes it. The deliverable's wording is corrected above.
- **The new-task row is published as `at: null`,** like the draft row.
- **The hover band reuses `--hover`,** the colour of today's local hover, for both the relayed band and the Gantt's own. No new token. The browser pass checks it in dark mode.
- **Hover is by exact line.** The grid reports any body row's line: comment, blank and front matter rows too, and null for the draft and new-task rows. A following Gantt has a row for every line in its layout, so hovering a grid comment bands the Gantt's empty row on that line, and the two panes stay visibly paired. The tree and the tables have no such rows, so they show nothing.

**Decisions taken** (by me, within the task):

- **`setHoverLine` and `onHoverLine` are optional on `RenderContext`,** like its follower part, so a renderer that ignores hover, and a test's context, need nothing. The shell always passes both. On `PlanEditor` they're optional, as the task says. `onHoverLine` replaces any earlier callback and returns nothing, because the shell destroys an editor rather than unsubscribing.
- **The relay is in `main.ts`, beside the cursor relay.** `ctx.setHoverLine` goes to `editor.setHoverLine`. The editor's `onHoverLine` goes to the view's latest `onHoverLine` callback. The shell keeps the editor's latest line, and `ctx.onHoverLine` replays it at once, as `onRowLayout` replays its layout, so a view rebuilt by a render keeps the band. Mounting an editor relays null, and switching views drops the old view's callback. The shell names no view or editor.
- **The Gantt keeps its own hover apart from the relayed one** and shows its own first. Each render replays the editor's line, which is null while the pointer is on the Gantt. Without the split, clicking a Gantt row would clear its hover band until the pointer moved.
- **Gantt structure:** the canvas holds a band layer (`.gantt-band`, one per layout row with a line), the week lines, a mark layer, then the deadline, finish and today lines. Layers are 0px high, so only their rows take the pointer. `.gantt-row` is now a transparent, full-width row of an item's marks: it takes clicks and dims a done row's marks, and the band under it carries the cursor and hover classes. `ganttGeometry` returns `bands`, so the renderer still only places what the geometry gives it.
- **The grid's current-row band is the class `at-cursor`,** with the views' `--cursor-row-bg` and `--cursor-row-fg`. It is on the row of the place, whatever the column, and goes when the place is cleared (Escape on a selected row). A selected row's cells paint `--accent-bg` over it.
- **The total row's top rule is now an inset shadow** rather than a collapsed border, which a sticky cell leaves behind when it moves. It looks the same.
- **The views' item rows carry `data-line`,** which the hover band matches on.

**Visible changes:**

- Grid: the total row stays at the bottom of the pane while the grid scrolls, and the new-task row is now above it, as the last row of the body (it was below the total row).
- Grid: the current row (focused cell or selected row) has the cursor band across its full width, on done rows too. A selected row still shows its own colour.
- Gantt: the cursor band is drawn under the week lines and the marks. The deadline, project-finish and today lines are drawn over the bars, which used to cover them.
- Gantt: hovering any row, including an empty one for a comment or blank line beside a leading editor, bands it with `--hover` (before, only rows with marks highlighted, and the highlight covered the week lines).
- Hover across panes: hovering a grid row bands the matching row in the Gantt, the tree, the table, the schedule table or the pin review. Hovering a Gantt row bands the matching grid row. Leaving a pane clears the other's band. The text editor doesn't take part.
- No new theme tokens.

**Rewritten tests:**

- `tests/align/grid.test.ts`, "has comment, blank and front matter rows; front matter is one row on its first line": the published rows end with the new-task row, `[null, null, 154, 22]`, and the comment names the new-task and total rows in their new order. `contentHeight` is unchanged.
- `tests/grid/grid.test.ts`, "does not open an editor on an additive cell" and "Ctrl+Z and Ctrl+Y undo and redo the buffer, but Ctrl+Z in an editor cancels the edit": the check that no cell editor is open now selects `tbody td[data-column] input.cell-input`, because the new-task row's input is now in the body too.
- `tests/schedule/gantt.test.ts`, "bands the cursor row": reads `.gantt-band.at-cursor` instead of `.gantt-row.at-cursor`.

**Added for the browser pass:** `examples/demo.plan`, a 23-row schedule (`profile: schedule`, `project-start: 2026-09-21`) with anchors, dependencies, a lag, a start pin, three milestones, a done row and a deadline, written as `examples/schedule.plan` writes them. `tests/schedule/demo.test.ts` checks the values worked out by hand: Data migration runs Mon 19 – Wed 21 Oct and is critical; System test starts Thu 22 Oct; UAT runs Fri 30 Oct – Tue 3 Nov; Go-live shows Wed 4 Nov and is late against 2 Nov; with Data migration's start pin removed, Go-live shows Wed 28 Oct and is not late. The code agreed with every value on the first run. The test also checks that the file reads with no errors and that its only warning is Go-live's `schedule-late`.

**New tests:** `tests/schedule/demo.test.ts` (6, above); `tests/grid/demo-polish.test.ts` (7: the row order, the keys, the current-row band, the grid's hover both ways); `tests/align/end-of-scroll.test.ts` (1); `tests/renderers/hover.test.ts` (one per non-following view: tree, table, schedule, pins); four in `tests/schedule/gantt.test.ts` (draw order, bands on empty rows, reporting hover, showing a relayed hover); and "hover across panes" in `tests/app/shell.test.ts`.

**Spec:** plan-format-spec §3.3 (hover on `RenderContext`; the `RowLayout` comment names the new-task row), §3.4 (hover on `PlanEditor` and the grid's part; the new-task row as `at: null`; `contentHeight` includes the pinned total row), §4b.1 (the new-task row, then the pinned total row; the current-row band) and §5.5 (`bands`, the layers, and hover both ways). PLUGINS.md, VISION and rows are unchanged. There were no spec questions, so no version changes.

---

## Task 33 — rows: mount rows

**Serves:** M3b (VISION §6). A row can name another file to mount beneath it. This task is rows only: the syntax, the parsed result and the errors. rows reads no files. Resolving mounts, composing the plan and editing segments are the plan tool's work, in later tasks. As in Task 25, it's spec first, but small enough to implement in the same task.

**Deliverables**

- **Extensions spec, new section "Mounts":**
  - A new key, `mount: NAME`, names the mount column, following the same pattern as `nest: parent`.
    - When the named column isn't declared, an implicit column is created, as `nest:` does for a missing parent column. Record this as settled by analogy, with the question that settled `nest:`.
    - The column is never positional. It is written by name: `Product A {#a} | mount=teams/alpha.plan`.
    - An empty `mount:` declares nothing (A1).
  - **The value** is a **mount target**, read after rows' usual decoding, so a quoted value may hold spaces (`mount="Team Alpha/alpha.plan"`). It is a relative path, optionally followed by `#ID`:
    - The path is segments separated by `/`. Each segment is non-empty and holds no `#` and no control character. `.` and `..` segments are allowed syntactically. Whether a path stays inside the workspace is for the host to decide, and the spec says so.
    - Absolute paths are invalid: a leading `/`, or a drive prefix such as `C:`.
    - A trailing `/`, an empty segment (`a//b`), an empty path before `#`, more than one `#`, and an ID not valid under Text Anchors are all invalid.
    - `#ID` names a part, the subtree under the row with that anchor in the target file. rows parses it and resolves nothing. The spec says hosts may support whole-file mounts first.
  - **An invalid target** is a validation error (`invalid-value`), and the row has no mount.
  - **A mount row** is any row with a valid mount cell, at any depth. It may also have children of its own.
  - **What the spec leaves to the host:** what a mount means, where its rows go, and how files are read. The spec also says that two mounts naming the same file are not an error in rows.
- **DESIGN §4:** `Schema.mount` (the column, as `Schema.nest` gives its column) and `Row.mount` (`{ path, part?, span }`, absent when there's no valid mount), with spans for the path and the part.
- **`tokenizeLine`:** a mount cell's value tokenises as a path, with the `#ID` part as an anchor-like token. The tokenizer and the parser still agree, by the existing property.
- **Edit API:** nothing new. Writing and clearing a mount uses `setCell` on the mount column, and clearing it is how a host unmounts. Add `setCell` examples for both to DESIGN §6, and confirm a property test covers the implicit mount column.
- **Errors:** settle each by analogy wherever an existing rule fits. Record these in `QUESTIONS.md` under Resolved, and list them in your end-of-task summary:
  - a declared mount column with the wrong type;
  - `mount:` naming the same column as `nest:` or a marker;
  - a profile's `mount:` conflicting with the file's own declarations (Q42).

  Open a question only for a genuinely new rule.

- **Versions:** bump extensions and DESIGN, and update the version references in the conformance README and plan-format-spec, as before.

**Acceptance criteria**

- [x] Conformance cases, written by hand from the spec:
  - a mount row at the top level, at depth 3, and with children of its own;
  - a quoted path with spaces;
  - a part (`#backend`);
  - `..` segments;
  - each invalid form above;
  - an implicit mount column;
  - a mount cell on a row in a file without `mount:`, which is an ordinary undeclared name, as today;
  - each settled analogy.

  Every case with a syntax or structural error has its strict variant. — 17 new cases, 11 of them with a strict variant (28 directories), listed in the notes. Expected rows gained an optional `mount` field, `{ path, part? }`, default `null`.

- [x] Every conformance case passes, with no stage skipped. — the 18 cases that need mounts failed before the parser change; the four `undeclared` and `empty` ones passed already, since they describe today's behaviour. No case was changed to make it pass.
- [x] The property generators produce mount columns and mount cells, valid and broken, and every existing property still holds. — a new property checks that every mount lies in its cell, and counts over 100 valid and over 100 broken mounts.
- [x] No app code changes, and the app's tests pass unchanged.
- [x] `npm test` is green at the root. — 2013 tests; typecheck and lint clean.

**Not in this task:**

- Reading files or resolving mounts.
- The plan profiles gaining `mount: mount` (that comes with composition).
- Loops and missing files, which are the host's to report.

**Notes**

- Base 0.12: `mount` joins the keys reserved in base §9. `base-9-reserved-base-only` (+ `--strict`) gained a `mount: mount` line, so its later line numbers moved down by one, edited by hand.
- Extensions 0.10: a new §12 Mounts (§12.1 declaration, §12.2 targets, §12.3 mount rows), so §1–§11 and the case names citing them keep their numbers. The intro, §1 (canonical-form keys), §2 (implicit column order), §8 and §10 also changed. Base and extensions version references updated in DESIGN, the conformance README and `plan-format-spec.md`.
- **Reading of "never positional":** the implicit mount column is never positional, as for every implicit column (ext §2). A *declared* mount column is filled like any other declared column, by position or by name, so that canonical form (implicit columns declared) still reads back the same (`ext-12-mount-declared-column`). Making a declared column unfillable by position would be a new rule.
- **Settled by analogy** (QUESTIONS.md A11–A15):
  - A11, implicit `MOUNT:text`: by analogy with ext §6.1's `nest:`. No question settled `nest:`'s implicit column; it has been in the spec since the first draft. Q16 settled what a wrong nest column is.
  - A12, empty `mount:` declares nothing: A1.
  - A13, wrong type or options → `invalid-mount-column` (structural) on the `mount` line; `mount` ignored, column read as declared: Q16 (the nest column). "Without options" comes from the nest rule too, and keeps `unique` from making two mounts of one file an error.
  - A14, `mount:` naming the nest column or a marker column: A13, since those columns are a `ref` and a `bool` and the implicit columns come first.
  - A15, a profile's `mount:` against the file's declaration → on the file's declaration: Q42.
- An invalid target is `invalid-value` (validation), raw text kept, no mount, as the task said; not an analogy. `""` is invalid (an empty path). A drive prefix is one ASCII letter then `:` at the start (`C:/x`, `c:x`). Control characters are U+0000–U+001F and U+007F–U+009F.
- New error code `invalid-mount-column`. `mount` joins `KNOWN_KEYS`, so the plan's `unknown-key` info no longer fires on `mount:` (no app test covers it).
- API: `Schema.mount: { column, valid } | null`; `Row.mount?: { path, part?, pathFrom, pathTo, partFrom?, partTo? }`. Path spans are inside any quotes, and the part span is the `#ID`, as an anchor's is. `LineContext.mount` (the column name) makes `tokenizeLine` split a cell named for it into `path` and `part` tokens. A declared mount column filled by position tokenises as a plain `value` (DESIGN §7).
- **New cases:** `ext-12-mount-rows` (top level, depth 3, with children; implicit columns key, nest, mount), `ext-12-mount-quoted-path`, `ext-12-mount-part`, `ext-12-mount-dot-segments`, `ext-12-mount-invalid-targets` (leading `/`, `C:/`, `c:`, trailing `/`, `a//b`, `#backend`, two `#`, `#-x`, empty ID, `""`, a tab), `ext-12-mount-implicit-column` (+ `--strict`), `ext-12-mount-declared-column`, `ext-12-mount-undeclared` (+ `--strict`), `ext-12-mount-empty` (+ `--strict`), `ext-12-mount-column-not-text` (+ `--strict`), `ext-12-mount-column-with-options` (+ `--strict`), `ext-12-mount-names-nest-column` (+ `--strict`), `ext-12-mount-names-marker-column` (+ `--strict`), `ext-12-mount-column-not-text-from-profile` (+ `--strict`), `ext-12-mount-names-lead` (+ `--strict`), `ext-12-mount-names-key-column` (+ `--strict`), `ext-12-mount-names-key-column-without-identity` (+ `--strict`).
- **Rewritten tests:** `conformance.test.ts` compares the new `mount` row field. In `properties.test.ts`, the token-boundary property takes a cell's value as its `value` token or its `path` and `part` tokens together, and the highlighter context passes `mount`. **New tests:** the mount-token check in that property; the mount-span property; a `tokenizeLine` test for mount cells; a `setCell` test that mounts and unmounts; and the `setCell` property now counts at least 20 writes to an implicit mount column. Generators gained `mount:` lines, mount-column declarations and mount cells, valid and broken. **Rewritten case:** `base-9-reserved-base-only` (+ `--strict`), for its new `mount:` line.
- **Q44 (spec owner):** `mount:` naming the lead, or the key column's name whether or not identity applies (`key`'s value, or `id` when `key` is unset), is `invalid-mount-column`, always on the `mount` line, and `mount` is ignored, as in A13 and A14. The lead is a row's title and the key column its identity, so neither can also be a mount target. In its first version the key part applied only with identity. The `setAnchor` property then failed on `mount: id` with no `key:`: the file's first anchor turned identity on and added the error, so every mount was lost. A rule that changes when the first anchor appears would make anchor edits add or remove errors in other rows, so the name counts whether or not identity applies. The edit API is unchanged. Generators gained `mount: name` and `mount: id`.

**Human review:** read the new spec section and the `expected.json` files first. Each one is a claim about what a mount means.
