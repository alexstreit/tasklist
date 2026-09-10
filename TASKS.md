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

## Later (not scheduled)

See spec §7. When any of these start, add a task here first and update the spec before writing code.
