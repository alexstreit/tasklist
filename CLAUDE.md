# CLAUDE.md

Text-driven project estimating tool. Read `plan-format-spec.md` before touching the parser, compute layer, or file format. Work through `TASKS.md` one task at a time; do not start the next task until the current one's acceptance criteria are met.

## Stack

- Vite + TypeScript (`strict: true`)
- Vitest for tests
- CodeMirror 6 for the editor
- No UI framework in the MVP. Renderers use plain DOM.
- No server, no database. Single user, files on disk.

## Repo layout

```
src/
  core/        parse + compute. Pure TypeScript. NO imports from dom, codemirror, or src/ui.
  editor/      CodeMirror 6 language mode, folding, keymap
  renderers/   one folder per renderer, each exporting a Renderer
  app/         shell: wires buffer -> parse -> compute -> active renderer
tests/
  core/        unit tests for parse and compute
plan-format-spec.md
TASKS.md
```

Enforce the `core/` boundary with an ESLint `no-restricted-imports` rule or equivalent, not just convention.

## Non-negotiables

1. **Text is canonical.** The text buffer is the only source of truth. Nothing writes to it except text edits. There is no editor-owned model that serialises back to text.
2. **`parse` and `compute` are pure functions** with no DOM or CodeMirror dependency. They must be unit-testable in isolation.
3. **Every tree node carries its source range** (line, and character span per field). The preview and diagnostics depend on this; a future grid editor depends on this.
4. **Parsing is lossless.** Comments and blank lines are retained as nodes. Round-tripping a file through parse must not lose anything.
5. **Renderers never do arithmetic.** They read `effective`, `childSum`, `doneSum`, `mode`, `done` and `diagnostics` from the model. If a renderer needs a number that isn't on the model, add it in `compute`.
6. **Renderers implement the `Renderer` interface** from spec §3.3 and declare `requires`. The app shell must not special-case any renderer.
7. **One editor at a time.** Switching editors re-parses the buffer.
8. **Units are fixed in the MVP**: bare number = hours, `1d = 8h`, `1w = 5d`. Store durations internally as hours.
9. **Defaults must work with no front matter**: `columns: est:duration | owner:text | notes:text`.

## Conventions

- Indentation in plan files is 4 spaces. Tabs are converted on load with an `info` diagnostic.
- Diagnostics are data (`{ line, span?, severity, message }`), never `console.warn`.
- Keep the §2.10 example from the spec as a fixture; its expected output is the reference test.
- Prefer small commits per task. Don't refactor across the `core/` boundary without asking.

## Out of scope for MVP

Headings, named fields, ranges/confidence, extra prefix markers, status roll-up, custom units, column roles, Gantt, exports, grid editor, multi-user. Leave room; don't build. See spec §7.
