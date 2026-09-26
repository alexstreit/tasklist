# TASKS.md

Work these in order. Each task is one Claude Code session. A task is done only when every acceptance criterion is met and the human has reviewed.

**Status:** Tasks 1–22 complete.

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

Removing the only marker before an empty lead writes the lead as `""` (`~` becomes `""`, `~ | 1d` becomes `"" | 1d`), so the row doesn't begin with the delimiter. A setLead on a quoted lead with an anchor keeps the anchor after the closing quote (Q13). No spec questions came up.

---

## Task 21 — Plan core on rows

Replace the plan's own parser with the rows library. `compute`, renderers and exporters should not need to change beyond the type of the tree they read.

**Deliverables**

- `readPlan(doc) → Tree` per spec §2.4–§2.6 and §3.1, with outline numbers from the rows parent relation.
- `analyze(text, filename?)` per spec §3.2; the plan profile built in as a named profile; `defaultProfile` applied per spec §2.1.
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

**Not done, deliberately:** `insertLineAbove` in `src/editing` has no caller in `src/` now (the grid uses `insertRow`). It stays because spec §3.8 lists it. The `@lezer/highlight` devDependency is unused by `src/`. Removing it would touch the lockfile, so that's left for review.

**Spec questions:** none opened. The DESIGN §7 addition describes existing parser behaviour.

---

## Later (not scheduled)

See spec §7. When any of these start, add a task here first and update the spec before writing code.
