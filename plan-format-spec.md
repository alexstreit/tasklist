# Plan File — Specification

**Depends on:** rows 0.12, rows extensions 0.10, Text Anchors 0.2.

A text-driven project estimating tool. The plan is a plain text file; the app is one or more editors over that file plus one or more read-only renderers and exporters of it.

## 1. Principles

- **Text is canonical.** The file is the data model. Everything else is derived from it and nothing writes to it except through text edits.
- **A plan is a rows file.** The generic format is rows; this spec adds the plan profile and roll-ups. Plan behaviour that belongs in rows goes into rows.
- **Indentation is the tree.** No bullets, no brackets.
- **Terse by default, tunable by front matter.** The plan profile supplies sane defaults; a file can override any of them.
- **One write path.** Every editor (the text editor, the grid editor) produces text edits against the same buffer. Only one editor is active at a time.
- **Compute once, render many.** Roll-ups are calculated in one pass and attached to the tree; renderers and exporters only read.

## 2. File format

A plan file is a **rows** file (base 0.12 and extensions 0.10, in `packages/rows/spec/`) read in tolerant mode with the **plan profile**. This section covers only what the plan adds. Everything else, including tokenising, quoting, named cells, errors and recovery, comes from the rows specs and the `rows` library.

### 2.1 The plan profile

`profile: plan` names the profile published as `profiles/plan.rows`:

```
---
lead: title:text
nest: parent
mount: mount
markers: done=~
columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text
roles: effort=est
---
```

- A file with no `profile:` key uses the plan profile when its name ends in `.plan`, or when it has no name yet (a new, unsaved document). Other files are read as plain rows files.
- The tool writes `profile:` into the frontmatter of every file it creates, through the new plan wizard (§6): `profile: plan` or `profile: schedule`, so the file says what it is even if it is renamed.
- Exports, and later canonical form, write the resolved keys out in full.
- A file may override any key the profile sets. A file's own `columns:` replaces the whole column list, including options, so a duration column declared there needs its own `unit=h hpd=8 dpw=5` (§2.6).
- `mount: mount` names the mount column (rows extensions §12), an implicit column written by name: `Product A {#a} | mount=teams/alpha.plan` mounts another plan beneath the row (§2.12).
- `roles: effort=est` marks `est` as the effort column, which scheduling reads. The plan profile binds no other role and has no milestone marker, so an estimate-only file is never scheduled, and `^` in its titles means what it always did. A file's own `roles:` merges with it per role (rows ext §11). A file whose own `columns:` has no `est` loses the binding, with no error; one whose `est` is not a duration or number column keeps it unbound, also with no error, and whatever needs the effort role says why.

**The schedule profile.** `profile: schedule` names the profile published as `profiles/schedule.rows`, the plan profile plus the scheduling columns, their roles and the milestone marker. A PM writes it to schedule a file (§2.11):

```
---
lead: title:text
nest: parent
mount: mount
markers: done=~ milestone=^
columns: est:duration unit=h hpd=8 dpw=5 | dur:duration unit=h hpd=8 dpw=5 | start:date | deps:ref many qualifier=lag:duration | due:date | owner:text | notes:text
roles: effort=est duration=dur start=start deps=deps deadline=due
---
```

Files that say `profile: plan`, and `.plan` files with no `profile:`, are unchanged.

**Vocabulary.** The plan format owns a fixed set of bare names (`src/core/vocabulary.ts`, `PLUGINS.md` §3):

| Kind   | Name            | Type                 |
| ------ | --------------- | -------------------- |
| role   | `effort`        | duration or number   |
| role   | `duration`      | duration             |
| role   | `start`         | date                 |
| role   | `deps`          | ref                  |
| role   | `deadline`      | date                 |
| key    | `project-start` | date                 |
| marker | `done`          | (every marker: bool) |
| marker | `milestone`     |                      |

A plugin's own roles and keys are qualified with its id (`propricer.rate-table`). `project-start: 2026-10-05` is the first working day of the schedule; with it, the model has a calendar (§3.2). A value that isn't a date is a warning, `key-type`, and the key counts as absent. The key is **expected** when the `duration`, `start`, `deps` or `deadline` role is bound: a file that binds one of them and doesn't write the key gets `no-project-start`, from core, since the rule is vocabulary. Both diagnostics carry the click fix "Set project start to today" (§4b.6.2).

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

- A duration converts to hours using its column's `hpd` and `dpw`, with minutes at 60. If a value has a term its column can't convert, such as `1d` without `hpd`, the value is treated as empty and gets a warning. The warning has a fix that adds `unit=h hpd=8 dpw=5` to the column declaration, leaving out any of those options the declaration already has. There is no fix when the declaration isn't in the file, as with a column from a path profile, or when one of those options is written but invalid (`unit=x`): adding it again would repeat it, and "Remove this option" comes first.
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

Every diagnostic carries a line, a severity, a code, a message, a span where one exists, and optional **fixes**, each a label, a tier and `TextEdit[]` (§4b.6.2). A rows error keeps its rows code and message; the plan's own diagnostics have the codes below.

| Source                                                                                                | Severity | Code                                       |
| ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| rows syntax or structural error (e.g. unterminated quote, overflow cells, bad indent level)           | error    | the rows code                              |
| rows validation error (e.g. `4 hours` in a duration column, a dangling `#ref`)                        | warning  | the rows code                              |
| Duration term the column can't convert, or a negative value (§2.6)                                    | warning  | `unconvertible-duration`, `negative-value` |
| Unknown frontmatter key that is not rows base, a rows extension key, `x-` or in the vocabulary (§2.1) | info     | `unknown-key`                              |
| Unknown bare role or marker name (§2.1)                                                               | info     | `unknown-role`, `unknown-marker`           |
| Qualified key or role whose plugin isn't registered ("needs the propricer plugin")                    | info     | `missing-plugin`                           |
| Role the file's `roles:` binds to a column of the wrong type; the role is left unbound                | warning  | `role-type`                                |
| Core key whose value isn't its type (`project-start` not a date); the key counts as absent            | warning  | `key-type`                                 |
| `project-start` not written while `duration`, `start`, `deps` or `deadline` is bound (§2.1), line 1   | info     | `no-project-start`                         |
| Line beginning `<!--` (§2.3)                                                                          | info     | `html-comment`                             |
| Tabs converted on load                                                                                | info     | `tabs-converted`                           |
| Override differs from child sum (only when `childrenHaveValue`)                                       | info     | `override-differs`                         |
| Scheduling (§2.11)                                                                                    | see §2.11 | `schedule-…`                              |
| Mounts (§2.12)                                                                                        | see §2.12 | `mount-…`                                 |

`key-type` on `project-start` reads "project-start must be a date like 2026-10-05; 'soon' is ignored, so the schedule isn't computed." A diagnostic from a plugin's stage carries `source`, the plugin's id; core's leave it unset. A diagnostic in a mounted file carries `file`, the file's resolved path, and its line and spans are in that file; the root file's leave it unset (§2.12).

Rows ignores unknown keys silently. The plan tool reports them as info, because in a hand-edited file an unknown key is usually a typo, such as `colums:`. A name that belongs to a plugin the reader doesn't have is only an info, since files move between people with different plugins. The vocabulary diagnostics are reported on the line that binds the name; a binding that comes from the profile gets none.

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

### 2.11 Scheduling

The **schedule** plugin (`src/plugins/schedule/`) computes dates, slack and lateness from dependencies, pins, milestones and deadlines. It requires `project-start`; its roles (`effort`, `duration`, `start`, `deps`, `deadline`) and the `milestone` marker are all optional. It works in working hours from the project start (hour 0), and every date conversion and every finish goes through the calendar (§3.2): a start pin converts with `fromDate(d, 'start')`, a milestone's start pin and a deadline with `fromDate(d, 'end')`, so a row that finishes at the end of its deadline day is not late. Dates in its messages read as §5.4 shows them (`Mon 5 Oct`). A parent row is a **summary**. `done` has no effect on dates yet (`PLUGINS.md` §9).

**Duration of a leaf.** Derived: its effort hours, at one full-time person, or 0 with no effort. Pinned: the `dur` cell. A leaf with a duration of 0 that isn't a milestone gets `schedule-no-duration`.

**Milestones.** A leaf with the milestone marker has a duration of 0; a filled `est` or `dur` on it is ignored, with `schedule-milestone-effort`. A milestone marker on a parent row gets `schedule-milestone-parent`, and the row is a summary.

- **A milestone's start pin is the day it happens.** It converts at the end of its day, `fromDate(d, 'end')`, so the milestone shows on that date and work that depends on it starts the next working day. Every other row's start pin converts at `'start'`. It is still a floor: if its predecessors finish later, the milestone moves with them and gets `schedule-pin-no-effect`, as any pin does. Its `start` carries `edge: 'end'` (`PLUGINS.md` §4), so every view and message shows its dates at that edge.
- **A pin on a non-working day** converts to the end of the last working day before it, and gets `schedule-milestone-nonworking` on the start cell: "Show falls on Sat 24 Oct, so it's shown on Fri 23 Oct."
- **A fixed event**, such as a tradeshow, is a milestone with a start pin and a deadline on the same date. No rule of its own: both convert at `'end'`, so a milestone kept on its date isn't late, and one its predecessors push past it is, with `schedule-late`.
- **An undated milestone** has no dependency of its own (a filled `deps` cell), no start pin of its own, and no ancestor with either. It sits at the project start, and gets `schedule-milestone-undated`: "Some task has no date or dependency, so it sits at the project start." When the row has a deadline and its file has a column bound to `start`, it carries the click fix **"Use its due date as its date"**, which writes the deadline's date into the start cell with rows' `setCell`, in the row's own file (through `applyFile` when it is mounted), as one undo step.

**Dependencies.** `deps` holds finish-to-start links, each with an optional lag (`#review 1d`). A lag is calendar time: a day is the calendar's `hoursPerDay` and a week 5 days, whatever the effort column's `dpw`; a negative lag counts as 0, with `schedule-negative-lag`. A link may point at a parent row, so one project can follow another: it waits for the parent's finish, its latest descendant's. A link that doesn't resolve is already a rows validation error, and is ignored. References resolve within the row's own file (§2.12). The graph's points are each row's start and its finish: a parent's start comes before its children's, a leaf's finish after its start, a parent's finish after its children's, and a link runs from one row's finish to another's start. The links inside each strongly connected component of it are ignored, and each row with a point in one gets `schedule-dep-cycle`, so the result doesn't depend on row order. A parent that depends on its own descendant, and a row that depends on its own ancestor, are such cycles.

**Forward pass.**

- A row's derived start is its **floor**: the latest of hour 0, each link's `add(finish, lag)`, and its parent's floor passed down. The start pin is a floor too: a row passes `max(derived, pin)` to its descendants, so pins and links on a parent push every descendant.
- A mounted file's roots also take its own valid `project-start` as a floor, converted with `fromDate(d, 'start')` on the root's calendar, as part of their derived start (§2.12).
- A leaf's effective start is `max(derived, pin)`, and its finish `add(start, duration)`.
- A summary's effective start is its earliest descendant start, and its finish its latest descendant finish. A `dur` pin on a summary is ignored, with `schedule-summary-duration`.
- `projectFinish` is the latest finish of all.

**Backward pass.**

- A row's late finish is the earliest of: `projectFinish`; each successor's late start minus its lag, where a summary successor's late start is the earliest among its descendants; its own deadline; and its parent's late finish. So a parent's deadlines and successors limit every descendant: a link out of a parent holds back the whole subtree.
- A leaf's late start is `add(lateFinish, -duration)`, and its slack `lateStart - start`. A summary's slack is the smallest among its descendants.
- Every row is **critical** when its slack is at most 0, so a phase on the critical path shows as one.
- A row is **late** when its finish passes its own deadline, and gets `schedule-late`: "finishes Tue 13 Oct, after its deadline Mon 12 Oct". Negative slack upstream shows in the fields, with no diagnostic of its own.

**Fields.** `start` (a `Pinnable`: `derived` is the floor, `pin` the start cell, `effective` as above), `duration` (a `Pinnable`, leaves only), `finish`, `lateStart` and `lateFinish` (leaves only), `slack`, `critical`, `late`, `milestone` (a leaf with the marker, for the schedule table), `deadline` (the deadline date's `'end'` edge, on each row whose deadline cell is set; `schedule.backward` writes it, since it already converts the date for the late finish) and the document's `projectFinish`. A summary has no `duration`, `lateStart` or `lateFinish`. `schedule.forward` also writes the dependency network it read as a document-scope field, `network`, which `schedule.backward` reads, so it is read once per analysis; no view reads it.

**Pin diagnostics.** On a start pin: `schedule-pin-no-effect` when the effective start is later than the pin (on a summary, when no descendant starts at it), naming the effective start at its edge; else `schedule-pin-equals-derived` when the pin equals the derived start. On a duration pin: `schedule-pin-equals-derived` when it equals the effort.

| Case                                                        | Severity | Code                          |
| ----------------------------------------------------------- | -------- | ----------------------------- |
| A leaf with no effort or duration that isn't a milestone    | info     | `schedule-no-duration`        |
| A filled `est` or `dur` on a milestone; ignored             | warning  | `schedule-milestone-effort`   |
| A milestone marker on a parent; the row is a summary        | warning  | `schedule-milestone-parent`   |
| A `dur` pin on a parent; ignored                            | info     | `schedule-summary-duration`   |
| A start pin later than nothing it pushes                    | info     | `schedule-pin-no-effect`      |
| A start or duration pin equal to its derived value          | info     | `schedule-pin-equals-derived` |
| A milestone's start pin on a non-working day                | info     | `schedule-milestone-nonworking` |
| A milestone with no date or dependency, its own or an ancestor's | info | `schedule-milestone-undated` |
| A negative lag; counts as 0                                 | warning  | `schedule-negative-lag`       |
| Each row in a dependency cycle; the cycle's links ignored   | error    | `schedule-dep-cycle`          |
| A row that finishes after its own deadline                  | warning  | `schedule-late`               |

The reference fixture is `examples/schedule.plan`, whose values were worked out by hand (`TASKS.md`, Task 28). It is the scheduling counterpart of §2.10.

### 2.12 Mounts and composition

A master plan mounts other plans into its tree (VISION §6). A row with a valid mount cell (rows extensions §12) is a **mount row**: `Product A {#a} | mount=teams/alpha.plan`. The file it is in is read as itself, and the files it mounts are read as themselves, each by its own profile, IDs, columns and diagnostics; composition joins the results into one model. The file the editors show is the **root**.

- **Paths** resolve relative to the file holding the mount row, through the workspace (`PLUGINS.md` §7.1), and must stay inside the folder. Only a workspace that can list files can read mounted ones; in the single-file workspace every mount says so.
- **The tree.** A mount row's children are its own children in its file, followed by the mounted file's roots. Mounts nest: a mounted file's mount rows mount files too. Each item keeps its `line` and spans within its own file and gains `file`, its resolved path (the root's own path, or `''` for a new document). Outline numbers run across the composed tree. A mount row is an ordinary parent: done inherits through it, an estimate on it is the master's top-down figure (compared with the team's by `override-differs`), and a pin, deadline or dependency on it applies to everything under it.
- **Composed order** is document order within each file, a mount row's own children before the file it mounts. A file is shown once: the first mount of it in composed order wins.
- **Columns across files.** The model's columns are the root's. Each maps to a mounted file's column in two passes: first by role (a root column bound to a role takes the mounted column bound to the same role), then by name among the mounted columns not already taken. A mounted column maps to at most one root column, so no total counts a value twice. A root column that maps to nothing is blank on that file's rows, with no diagnostic. Summable cells are read as hours by their own file's column, so its own `hpd` and `dpw` apply. Views and stages read every cell through this mapping (`PLUGINS.md` §4).
- **Roles, markers and references** are each file's own: a row's `deps` cell is read through its own file's bindings, its milestone marker is its own file's, and a reference resolves within its own file, so two files can both have `#api`. Dependencies from one file into another file's rows come later.
- **Scheduling** has one time axis: the root's calendar, from its `project-start`. A mounted file's own valid `project-start` is a floor on its roots (§2.11); a mounted file without one starts where the master puts it.
- **Diagnostics.** A mounted file's own diagnostics are in the model with `file` (§2.9). The composed text editor shows every file's, each in its segment (§4.5); the grid shows every file's inline, on the rows it shows, and its problems list shows all of them, grouped by file, with their fixes (§4b.6.3).
- **What the editors show.** A mount row whose file is composed under it carries `composes`, the file's resolved path; a mount that shows nothing (missing, outside, a loop, an overlap, a `#part`, not gathered yet) has none. The composed text editor puts a segment under exactly these rows (§4.5), so the shell never repeats these rules.

| Case                                                                                       | Severity | Code                     |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------ |
| The file isn't found, or can't be read                                                     | warning  | `mount-missing`          |
| The path resolves outside the folder                                                       | error    | `mount-outside`          |
| The file mounts itself, directly or through other files; reported once, on the mount that closes the loop (the first, in composed order, whose file is already above it) | error    | `mount-loop`             |
| The file is already mounted earlier in composed order; this mount shows nothing            | warning  | `mount-overlap`          |
| A `#part` mount; it shows nothing for now                                                  | info     | `mount-part-unsupported` |
| Any mount in the single-file workspace: "Open the folder to see mounted plans."            | info     | `mount-needs-folder`     |

Each is on the mount row, in the file that holds it, spanning the mount target. A `#part` mount gets only `mount-part-unsupported`, and in the single-file workspace any other mount gets only `mount-needs-folder`. A file the shell hasn't gathered yet (it is still being read) shows nothing, with nothing to report.

The reference fixture is `examples/portfolio/`: `portfolio.plan` mounts `teams/alpha.plan` and `teams/beta.plan`, and its values were worked out by hand (`TASKS.md`, Task 35).

## 3. Architecture

```
            ┌──────────── PlanBuffer (one per document) ────────────┐
            │                                                        │
 editors ───┤ apply(edits) / undo / redo            onChange ────────┼──► analyze ──► model ──► renderer(s)
 text, grid │                                                        │    (parseRows →        tree, table
            └────────────────────────────────────────────────────────┘     readTree →          schedule (Gantt next)
                                                                            bindVocabulary →──► exporter(s)
                                                                            stages)
   edits come from src/editing (line ops) and the rows edit API (cells)                         TSV
```

### 3.1 Read

`parseRows(text, { profiles: { plan }, defaultProfile })` from the `rows` library (§3.9) returns a lossless `RowsDocument`: every line classified, every row with its indent, markers, anchors, cells and overflow, all as spans into the text, plus the parent relation and every error.

`readTree(doc) → Tree` is the plan layer. It turns rows into items and reads summable cells as hours (§2.6), carrying the rows spans through unchanged (each item keeps its rows `Row`), so that:

- the preview can highlight the node under the cursor,
- diagnostics point at the right column,
- the grid can ask the rows edit API for a precise replacement.

The tree's columns are the declared columns in order. Implicit columns (`parent`, `done`, and `id` when identity is on) are not columns of the tree; `done` is read into each item's own done flag (`ownDone`, §2.5), and `done` is set when the item or an ancestor is done (§2.8). Inheritance is structure, not arithmetic, so it is read here, not computed by a plugin.

Each item carries `outlineNumber: string` (`1`, `1.2`, `2.1.5`), computed from the rows parent relation, and across the composed tree once files are mounted (§2.12). Only rows are counted. Outline numbers are structural references and shift when lines are inserted above them. They are not stable IDs; anchors are.

Each file is read this way once, by its own profile, and `analyze` keeps the read while the file's text is unchanged. Composition then joins the reads: each item of the analysis is a fresh copy carrying `file` (§2.12), so a cached read never changes and a model never changes under its holder.

### 3.2 Compute

Computation is done by **plugins** (`PLUGINS.md`). A plugin's **stages** are pure functions that each declare the fields they read and write. A field is a typed key, `FieldKey<T>`, that one plugin owns and exports (`src/core/fields.ts`); a value is read with `model.get(node, key)` for a node-scope field or `model.value(key)` for a document-scope one, never as a property. `createRegistry(plugins)` checks the manifests at startup and orders the stages once, topologically by reads and writes, ties by registration order and then stage id. The app builds its registry in `src/app/registry.ts` and nowhere else.

The **estimate** plugin (`src/plugins/estimate/`) computes §2.7–§2.8 for every summable column, in one stage, `estimate.rollup`:

- `rollup`, a by-column `Pinnable`: per column name, `{ derived?, pin?, effective, mode }`. `derived` is §2.7's `childSum`, present only when a child has a value (§2.7's `childrenHaveValue`); `pin` is the node's own value; `mode` is `derived`, `pinned` (§2.7's `override`) or `additive`.
- `hasValue` and `doneSum`, per column name, beside it.
- The column bound to the `duration` role, an optional role of the stage, is not rolled up: durations are spans, and don't add up across parallel tasks. Its cells show as written.
- `totals`, a document-scope field: per column name, the document's `effective` and `doneSum`.
- the `override-differs` info.

The **schedule** plugin's stages, `schedule.forward` and `schedule.backward`, compute §2.11.

No renderer or exporter performs arithmetic: they read these fields.

The model carries a fixed core: the root file's path (`file`), its rows document (`doc`) and `lines`, `files` (every file in the composed tree, the root first, each with its rows document and lines), `roots` (the composed tree's items), `columns` (the root's), `bindings` (the root's), `calendar`, `diagnostics`, `inactive`, the stages that were skipped with the reason for each, and `version`, the buffer version it was read at (§3.7). `field(node, index)` gives a row's cell for root column `index`, through the column mapping (§2.12), and `column(node, index)` the row's own declared column that root column maps to, or null, so an editor can write a mounted row's cell that is empty (§4b.7). The model carries `doc` so that editors can ask the rows tokenizer and edit API for tokens and edits against the same text and spans. `Model.doc` is for editors only; renderers and exporters read computed fields, never `doc` (lint-enforced: they may not import `rows`).

`bindVocabulary` runs after `readTree`. It reads rows' merged roles, the frontmatter keys and the marker names, checks them against the vocabulary (§2.1) and the registered plugins, and reports §2.9's vocabulary diagnostics. `bindings` holds each bound role's column, each core or registered plugin's key with its value, and the marker names; a core role left unbound for its column's type is kept with the reason. Values are read with rows' `readValue`, as cells are.

A stage declares the roles, keys and markers it reads. It is skipped when a required role is unbound ("needs a column with the effort role", or the column's type when that is why) or a required key is absent ("needs project-start"). Stages read cells through their roles (`cell`), markers through `marked`, and summable cells through `hours`, never through `doc`.

`calendar` is present when `project-start` is set: the naive calendar, Monday to Friday, with the effort column's `hpd` as its day (8 when unset). Scheduling works in working hours from the project start, and every date conversion goes through it (`PLUGINS.md` §7.2).

`fields()` lists the keys written in this analysis, those of every stage that ran, in stage order. The pin review (§5.6) finds the pinnable fields through it without knowing any plugin.

`lines` is every line of the file in order, exactly as rows classified it — frontmatter, blank, comment or item. As in rows, the empty text after a final newline is not a line. The model is lossless for the same reason the tree is — an editor that shows the file has to show its comment, blank and front matter lines, and must not classify them a second time for itself. Renderers read `roots` and ignore it.

`createAnalyzer(registry)` returns `analyze(text, { filename?, files?, resolve?, version? }?) → Model`, which composes `parseRows`, `readTree` and `bindVocabulary` for each file, the composition (§2.12), the calendar and the stages, and is the single entry point the app shell and any tooling call. It is synchronous and pure, and never reads the clock (lint-enforced in `src/core/` and in plugins outside their renderers and exporters). The shell passes the current file name, or none for a new document (§2.1), the buffer's version, which the model records (0 when none is passed), and, when the workspace can list files, a snapshot of the mounted files (`files`, the text by resolved path, or null for a file that can't be read) and the workspace's `resolve`. It gathers the snapshot first, through the workspace (`PLUGINS.md` §6): the root's mounts come from its model (`mountsOf`), and a mounted file's from `readMounts`. Without `files`, every mount gets `mount-needs-folder`. A tab that reaches `analyze` despite §2.2 is converted to 4 spaces there too, with the info in §2.9, so the spans then index the converted text. Nothing outside `src/core/` imports the rows parser, `parsePlan` or `readTree` directly (lint-enforced). With no plugins registered, `analyze` still returns the tree, the lines and `readTree`'s diagnostics.

`src/core/` imports nothing outside itself, the standard library and the `rows` package (lint-enforced).

### 3.3 Renderers

```ts
interface Renderer {
  id: string;
  label: string;
  requires: FieldKey<unknown>[]; // tree and table: estimate's rollup, hasValue and totals
  follows?: true; // draws its rows beside a leading editor's
  render(model: Model, host: HTMLElement, ctx: RenderContext): void;
}
```

`requires` lets the app grey out a renderer whose needs aren't met instead of rendering nonsense; an unsatisfied renderer is never called. When the plugin that owns a required field isn't registered, the reason is "needs the estimate plugin"; when a stage that writes a required field was skipped, it is the reason of the first such stage in stage order. The app asks core for the reason (`unmetReason`) and special-cases no renderer.

Renderers that read a plugin's fields belong to that plugin: tree and table are in `src/plugins/estimate/renderers/`, and the schedule table in `src/plugins/schedule/renderers/`. A renderer that reads only core fields goes in `src/views/`. The row-per-item table, its cursor highlight and click-to-line, and their CSS are in `src/ui/`, shared UI code for renderers and editors, which imports only core's types (`PLUGINS.md` §8).

`RenderContext` carries the current cursor line, whether the last cursor change originated in the preview (so the preview doesn't scroll under a click), `setCursorLine(at)` for click-to-line, `openFile(path)`, which makes a file the active one (a mount row's file badge), and `toolbar(el)`. It is renderer-agnostic.

**Toolbar.** `toolbar?(el: HTMLElement): () => void` places a control of the renderer's in the preview toolbar, beside the exporter buttons, and returns a function that removes it. The renderer places a control once, not on every render, and removes it itself when it unmounts (draws afresh into its host). The shell removes every placed control when another view is chosen, or when no view can show the document, and names no renderer. It is optional, so a renderer without controls ignores it; the Gantt's scale picker (§5.5) is the first. A line is always named with its file, `{ file, line }` (`FileLine`, in `src/core/types.ts`): the cursor line, the cursor item, `setCursorLine` and the hover relays all take one, and the root file's lines are `{ file: root, line }`. So a mounted row's line is never mistaken for the root's line of the same number.

**Mounted rows** (§2.12). The tree, table, schedule table and pin review show the whole composed tree, and their totals include mounted plans. A row from a mounted file has a shaded background. It has the cursor and hover bands and click-to-line like any row, by its own file and line: clicking it moves the composed text editor's cursor to that row in its segment (§4.5), or the grid's place to its row (§4b.1). A mount row's title has a **file badge** naming its file (`alpha.plan`), a button titled "Open _teams/alpha.plan_" that makes that file the active one; a mount row whose path doesn't resolve has none. The shared row and title helpers in `src/ui/grid.ts` do this for every view.

**Hover.** The line under the pointer is relayed between the editor and the view, as the cursor line is, by file and line and never by which view or editor it is:

```ts
setHoverLine?(at: FileLine | null): void; // the pointer is over the row on at; null when it left the rows
onHoverLine?(cb: (at: FileLine | null) => void): void; // the line hovered in the editor; replaces any earlier callback; called at once with the current line
```

A view bands the row on exactly the hovered line, with `--hover`, lighter than the cursor band; a line it has no row for (a comment, in the tree) shows nothing. The Gantt reports its own hover too: anywhere on a row, its band or its marks, including a following row with no item. The other views only show the band. Both members are optional, so a renderer that ignores hover still works.

**Following.** A renderer that declares `follows: true` lines its rows up with a leading editor's (§3.4), row for row. Its `RenderContext` then also has:

```ts
onRowLayout(cb: (layout: RowLayout) => void): void; // replaces any earlier callback; called at once with the latest layout, if any
reportScroll(top: number): void; // its body was scrolled
reportHeaderHeight(px: number): void; // its natural header height
```

```ts
interface RowLayout {
  version: number; // the buffer version this layout was measured at
  bodyTop: number; // px from the pane's top to where its scrolling body starts, at scrollTop 0
  contentHeight: number; // the scrolling body's full height
  scrollTop: number;
  rows: { at: FileLine | null; top: number; height: number }[];
  // the visible rows, in CONTENT coordinates (from the top of the body, not of the viewport);
  // a leader may add a margin either side. at: null for the grid's draft and new-task rows; otherwise the
  // row's file and its line in it: the composed text editor's rows come from every file it shows (§4.5)
}
```

A row on screen is at `bodyTop + top - scrollTop` from the top of its pane's host, the element the editor or view is mounted in, at its content box. The two hosts' tops may differ, either way round (the preview's tab bar sits above the view's host): the shell measures both against the page, converts each layout's `bodyTop` and each header height between them, and measures again when either host is resized. Editors and renderers never see the shell's markup or the offset. `RowLayout` is in `src/core/types.ts`, beside `RenderContext`; its helpers are in `src/ui/row-layout.ts`, a name chosen to avoid "rows", which already means the library.

- A follower always draws from a `RowLayout`. Until a leader's arrives (when nothing leads, always) it builds its own with `naturalLayout(model, version, viewport)`: one row per item, in document order, at `--row-height`, the one row-height token, which the grid shares. So there is one drawing path, with no aligned and standalone modes.
- It re-renders on a new model and repositions on a new layout, never re-rendering per scroll event. It starts its body at the layout's `bodyTop` and scrolls it to the layout's `scrollTop`.
- It draws a layout only when `layout.version === model.version`, and otherwise keeps its last frame: after an edit the leader's layout runs ahead of the model until the next analysis.
- A layout row whose line has no item (a comment, blank or front matter line) is left empty. An item whose line isn't in the layout, such as a folded parent's child, isn't drawn; the model still has its fields.

### 3.4 Editors

Exactly one editor is active at a time. Every editor writes to the shared `PlanBuffer` (§3.7); switching editors unmounts one and mounts the other over the same buffer. In a folder that buffer is the active file's composed buffer: the text editor shows all of it (§4.5), and the grid shows its lines as rows, in composed order, and edits each row in its own file with `applyFile` (§4b.1). There is no editor-owned model that serialises back to text.

```ts
interface PlanEditor {
  update(model: Model): void; // a fresh model for the buffer's current text
  setCursorLine(at: FileLine): void; // an editor ignores a line of a file it doesn't show
  destroy(): void;
}
```

The shell mounts one editor, hands it every new model, and destroys it when the other is chosen. It holds the editors in a list, exactly as it holds renderers and exporters, and special-cases neither. Undo survives a switch because the history belongs to the buffer, not to the editor.

**Leading.** An editor may lead, publishing where its rows are for a following renderer (§3.3). A leading editor also has:

```ts
onRowLayout(cb: (layout: RowLayout) => void): () => void; // called at once, then on every change; returns unsubscribe
scrollTo(top: number): void;
setMinBodyTop(px: number): void; // start the body at least px from the pane's top; 0 removes the space
```

**Hover.** An editor may also take part in hover (§3.3), with two optional members; the shell relays the editor's line to the view and the view's to the editor:

```ts
setHoverLine?(at: FileLine | null): void; // band the row on at, hovered in the view; null clears it
onHoverLine?(cb: (at: FileLine | null) => void): void; // the line under the pointer, null when it leaves the rows; replaces any earlier callback
```

The grid takes part: hovering a body row reports its line (a comment, blank or front matter row's too; the draft and new-task rows report null), leaving the table reports null, and a relayed line bands its row, kept across a rebuild. The text editor doesn't, for now.

- Both editors lead, and publish after a scroll, an edit, a fold, a resize and each `update`. A leader measures only while something subscribes: with no subscriber, none of these measures anything, and `setMinBodyTop` waits for one. Resizes come from a `ResizeObserver` on the pane; the grid also observes its toolbar, settings banner and problems list, so either opening or closing counts.
- The text editor's rows are CodeMirror's line blocks, which cover wrapped lines; a folded line's block covers the lines folded into it, which have no rows. Each row is keyed by its file and its line in that file; a segment's header is its mount line (§4.5), an ordinary row. Its version is the buffer's: its view always shows the buffer's text. `setMinBodyTop` adds top padding to the content.
- The grid's rows are its table's body rows on screen: items, comment, blank and front matter rows (each file's front matter is one row, on its first line), keyed by their own file and line, and the draft and new-task rows as `at: null`. Its version is its model's, since its rows are drawn from it. Its whole pane scrolls, header included, so `bodyTop` is measured in the pane's content, and `contentHeight` is the rest of the pane's content, so it includes the pinned total row (§4b.1). A follower's body is as tall, so both scroll to the same end. `setMinBodyTop` adds space above the table.

The shell connects a leader to a follower by declared capability, never by which view it is, with one function, `connectPanes(left, right)` (`src/app/align.ts`):

- When one side leads and the other follows, they are connected. When both could lead, the left one does. Two editors side by side, or two renderers that don't follow, stay unconnected. Today the editor is on the left and the renderer on the right.
- The follower reports its natural header height and the shell passes it to the leader's `setMinBodyTop`, so the leader's body starts at the larger of the two headers; the follower starts its body at the layout's `bodyTop`, the same place.
- Scrolling syncs in both directions. Each side has a `ScrollEcho`: a scroll a side reports within 1px of the value the shell last set it to is that side's echo, and is dropped, however late it arrives. A leader's echo still passes its layout on, with the follower's own scroll position.
- After each analysis the shell hands the leader the model (`update`), which republishes, so the layout and model versions agree within one debounce.
- The leader's `bodyTop` and the follower's header height are each measured from their own host's top; the shell converts between the two (§3.3).

### 3.5 Multi-user (future, stated now so nothing blocks it)

The shared thing is the text buffer, not the model. A CRDT over the text (e.g. Yjs, via `y-codemirror.next`) gives collaboration without the sync layer knowing anything about the format. Each client parses and computes locally. Under collaboration, undo is replaced by a per-user undo manager behind `PlanBuffer.undo()`.

### 3.6 Exporters

```ts
interface Exporter {
  id: string;
  label: string; // e.g. "Copy for Excel"
  requires: FieldKey<unknown>[]; // TSV: estimate's rollup and hasValue
  export(model: Model): { mime: string; data: string };
}
```

Exporters belong to the plugin whose fields they read, as renderers do (the TSV exporter is in `src/plugins/estimate/exporters/`), are registered through its manifest, and appear as buttons on the preview toolbar, greyed out by `requires` as renderers are. Failures (clipboard permission, framed contexts) are shown visibly.

**TSV exporter ("Copy for Excel").** Tab-separated text, one header row then one row per item of the composed tree (§2.12) in document order, a mounted row's cells through the column mapping:

- `#` — outline number prefixed with `'` so spreadsheets keep it as text (otherwise `1.10` pastes as the number 1.1)
- `level` — 1-based depth
- `title`
- each declared column: summable cells emit `effective` as a plain decimal number of hours (duration headers read `name (h)`), empty when `hasValue` is false; text cells emit the text as entered, with any tab or newline replaced by a space
- `done` — `TRUE` / `FALSE`

No totals row: it breaks sorting and filtering, and `=SUM()` is one keystroke.

### 3.7 PlanBuffer

The app owns one buffer per open file (§6), which holds that file's text. In the single-file workspace it hands that buffer to whichever editor is mounted. In a folder it hands over the active file's **composed buffer** (below), which holds that file's undo history and shows the files it mounts. Editors never hold their own copy of the text.

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
  origin: string; // "text-editor" | "grid" | "undo" | "redo" | "load" | "remote" | "compose"
}

interface PlanBuffer {
  text(): string;
  version(): number; // how many changes it has had
  apply(edits: TextEdit[], origin: string): void;
  undo(): void;
  redo(): void;
  onChange(listener: (c: BufferChange) => void): () => void; // returns unsubscribe
}
```

- `CodeMirrorBuffer` is the production implementation. It wraps a CodeMirror `EditorState`. It and the composed buffer (`src/buffer/composed.ts`), which extends it, are the **only** modules outside `src/editor/` that import from CodeMirror (lint-enforced). `EditorState`, `Transaction` and `ChangeSet` never appear in their public types.
- `InMemoryBuffer` is a test implementation with a simple undo stack. Both pass one shared test suite.
- An edit with origin `load` replaces the whole document and clears the undo history: the recorded edits no longer describe the new text.
- An edit with origin `remote` is a change made elsewhere, never undone here. It is a change on disk, applied as a line diff (§6), or a change made to a file through a composed buffer, or one arriving in a composed buffer from a file's own buffer. It stays out of the undo history: the entries before it are mapped through it, so undo never reverts it.
- An edit with origin `compose` is a composed buffer inserting or removing segments when the mounts change. It stays out of the undo history too.
- The text editor mounts its `EditorView` on the state owned by `CodeMirrorBuffer`; its edits arrive at the buffer like any other, with origin `text-editor`.
- Undo and redo are buffer operations. No editor calls CodeMirror's history commands directly.
- The buffer knows characters only. Lines, nodes and columns are `analyze()`'s business.
- The buffer counts its changes: every edit, undo, redo, load, remote and compose change. A listener already sees the new count. `analyze` records the version it read on the model, and a leading editor's row layout carries the version its rows show (§3.3, §3.4).

**The composed buffer** (`src/buffer/composed.ts`) is a `PlanBuffer` over one CodeMirror state holding a **composed text**: the root file's text with each file it mounts in a segment (§2.12, §4.5). It has one undo history for all of them. The composed text is for editing only: it is never saved or analysed, and analysis reads each file's own text from its own buffer.

- **The piece map** (`src/buffer/pieces.ts`, pure) says which file, and which offset range of it, each run of the composed text comes from. It is built from the root file, each file's text and the model's rows that `compose` a file (§2.12). A segment goes at the start of the line after its mount row's subtree extent (§4.2), so the row's own children, and the comments indented under its last child, come first. Several segments at one place go innermost first. Mounts nest, so a file appears as several pieces around the segments inside it.
- **Joints.** Pieces always break at line starts. A file that doesn't end with a newline, and is followed by another piece, is followed by a **joint**: a newline that belongs to no file. A joint stays while its segment stays, even if the file gains a final newline, so the line the cursor is on never vanishes under it.
- **Positions.** `toComposed(file, offset)` and `toFile(pos)` translate positions. A position on a boundary belongs to the piece that starts there; the position just before a joint belongs to the file that ends there; a joint is one character that belongs to no file (`charAt` gives `joint`). So `toComposed(toFile(c)) = c` for every composed position. `toFile(toComposed(p)) = p` for every file position except one: the end of a file that ends with a newline and is followed by another piece, which is the next piece's start. An insertion there goes to the next piece.
- **Routing.** A change is split by the piece map and applied to the file it falls in: that file's own buffer gets it as `remote`, outside its own history. Undo and redo are routed the same way. A transaction is refused **whole** when any of its changes crosses a piece boundary, touches a joint, or would leave a piece ending inside a line where another file's piece follows (deleting the newline that ends it). The refusal is reported, and the status line says "Edits can't cross from one plan file into another." A change several files' pieces each contain whole, such as a replace-all, is one transaction and one undo.
- **Settling.** An accepted change that ends exactly where another file's piece starts, taking or adding whole lines at its piece's end, is moved back one character, to before that piece's final newline. The text it makes is the same, but its undo then inserts inside the piece; on the boundary, the undo's insertion would go to the next file.
- **`applyFile(file, edits, origin)`** writes edits given in one file's own offsets, placed through the piece map. An edit that spans pieces of the file is split around the segments between them. A deletion that starts on the newline ending a piece, when another piece of the same file follows the segment after it (`\nline`, the way rows deletes a line), is first moved one character on (`line\n`): the text is the same, but it lands in one piece, and no piece is left ending inside a line. It is in the history like any edit. The grid writes every row through it, each in its own file, and the text editor writes a diagnostic's fixes through it.
- **Keeping every view of a file in step.** A file's own buffer is the one record of its text. A composed buffer follows the own buffer of every file it shows: a change made there elsewhere (in that file's own composed view, or a reload from disk) arrives as `remote`, placed exactly by the piece map, not diffed. If placing it would join two files' lines, the composition is rebuilt line by line instead.
- **Recomposing.** After each analysis the shell hands the composed buffer the rows that compose a file. Segments that are no longer mounted go and new ones come, as one `compose` change, outside the history. It is made line by line: a line kept stays untouched. The root file's lines are matched first, and the other lines only between them, so a segment that changes place (a mount row moved in the grid) moves around the root's lines, and an undo entry on a root line still maps to where it was. Undoing a mount edit recomposes back.
- **Known limitation.** An undo entry for an edit inside a segment is mapped through a `compose` change like any change. If the segment is removed (its mount cell deleted) and comes back (the deletion undone), the entry has collapsed to a point. For example: edit beta's text in its segment, delete beta's `mount=` cell, then press Ctrl+Z twice. The first undo brings the cell and the segment back; the second doesn't restore the beta edit, and can insert its text beside the segment. An undo of an edit that emptied a segment's file entirely can land in the next file the same way.

### 3.8 Line operations

Structural edits are pure functions in `src/editing/`:

```ts
type LineRange = { fromLine: number; toLine: number }; // 1-based, inclusive
function indent(text: string, r: LineRange): TextEdit[];
// likewise: outdent, moveUp, moveDown, deleteLines, toggleComment
```

The text editor keymap calls them, deriving the range from its selection. The grid's structure operations on item rows work in levels through the rows edit API instead (§4b.6.4); on comment and blank rows, which have no level, the grid calls these.

### 3.9 The rows library

`packages/rows/` is an npm workspace package with its specs in `spec/`, its design in `DESIGN.md`, and a language-neutral conformance suite in `conformance/`. It has zero runtime dependencies and imports nothing from the app. The app imports it only through its `index.ts`. It moves to its own repository once the specs reach 1.0.

What the plan tool uses:

- `parseRows` for reading (§3.1), and `readValue` for frontmatter values of a vocabulary type (§3.2);
- `tokenizeLine` for highlighting (§4.1);
- `setLead`, `setCell`, `setMarker` and `insertRow` for every cell-level edit from the grid (§4b.2), and `setAnchor` for the anchors a ref cell's targets need;
- `setLevel`, `insertRow`, `moveRow`, `deleteRow` (with `removeReferences` for a row others refer to, §4b.4) and `repairRow` for the grid's structure operations and `auto` repairs (§4b.6).

The line operations in `src/editing/` stay in the app. They work on whole lines and don't depend on the format, except `toggleComment`, which takes the comment marker from the document.

## 4. Text editor (CodeMirror 6)

### 4.1 Language mode

Tokens come from the rows library's `tokenizeLine`, the same tokenizer the parser uses. Its context (separator, comment marker, markers), the column types and the frontmatter extent come from the latest model's rows document, mapped through edits until the next model arrives. Before the first model the tokenizer's own frontmatter state is carried from line 1. Cells are resolved to columns by the parser's rules, so a value is coloured by the type of the column the parser gives it. Highlighting covers: done lines (dimmed, including implicitly done descendants), comment lines, markers, anchors (`{#id}`), delimiters, cell names (`owner=`), quoted values and their escapes, duration values, the `+` sign, and the frontmatter block. In a composed text (§4.5) each line is tokenised with its own file's context, from that file's document in the model.

### 4.2 Folding

Indent-based folding on items that have child items. Indented comment lines following a parent fold with it. In a composed text (§4.5) an item's subtree is its own file's, by that file's indentation, with the segments inside it; a mount row folds its own children and its segment together, even with no children of its own.

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

In a composed text (§4.5) the line operations act on the lines of the file the cursor is in, not on composed lines: Alt+Up/Down, Tab and Shift+Tab, and Ctrl+/ run on that file's own text, and their edits are placed through the piece map as `applyFile`'s are (§3.7), so one Ctrl+Z undoes them. A move swaps with the previous or next line of the same file, wherever that line is shown, and the segments recompose after it: Alt+Down on Product A, with Product B next in the master, gives Product B, beta's segment, Product A, alpha's segment. Moves stay raw, as in a single file: the line moves, not its subtree, so a mount row with its own children in the master moves without them. On a file's first or last line a move does nothing, as at the edge of a single file; the empty text after a file's final newline is no line of it (§3.2). Only a selection whose lines are in more than one file is refused, with the status line's message. Ctrl+/ uses the comment marker of the file at the selection. A recompose keeps a cursor at the start of a line where a segment comes in on that line, after the segment.

### 4.4 Diagnostics

Via `@codemirror/lint`, fed from the model produced by the shell's single `analyze()` call (no second analysis). Severities `error`, `warning` and `info` map to the lint severities of the same names. Diagnostics with a span underline only that span; span-less diagnostics get a gutter marker only. Hover shows the model's message verbatim. A diagnostic's fixes appear as lint actions, and applying one dispatches its edits through the buffer with origin `text-editor`. A `confirm` fix first opens a panel below the editor with its preview, its warning and, for a fix that takes a typed value, an input; Apply writes it, and Cancel, Escape or any edit to the text drops it. In a composed text (§4.5) every file's diagnostics show, each at its place in its segment, and a fix's edits go to its own file through `applyFile`.

### 4.5 The composed text editor

In a folder, the text editor shows the active file through its composed buffer (§3.7). When the file mounts other plans, that is one document: the file's own text with each mounted file's text in a **segment** after its mount row. Every edit lands in the file it belongs to, and there is one undo history and one search across every file. A file that mounts nothing has a composed buffer with no segments, and looks and behaves as it did before, apart from the search panel, which every text editor now has. The single-file workspace shows its file's own buffer, as before.

- **Segments.** Each segment line has the classes `cm-segment` and `cm-segment-depth-N`, for its mount depth, and is shaded (`--mounted-row-bg`) with a border on its left (`--segment-border`). It is indented visually, by line padding, to the mount row's own indentation plus one level (4 characters), so the mounted file's roots read as the mount row's children; a nested segment adds its mount row's padding. The text is unchanged, and the cursor moves through the real characters.
- **The gutter** shows each file's own line numbers. A segment's are in `--segment-gutter-fg` on `--mounted-row-bg`, dimmer than the root's, so a mounted file's numbering can't be read as the root's going on.
- **The segment's header is its mount line** _(Task 37; it replaces a block widget above the segment)_. The mount line has the header's background (`--badge-bg`), and the segment's border starts there; the mount row's own children in its file, between it and the segment, are inside the border and unshaded. At the line's end an inline widget shows ● when the mounted file has unsaved changes, and two buttons, out of the tab order: **Open** makes that file the active one, and **Unmount** clears the mount row's `mount=` cell through the rows edit API, against the mount row's own file, as one undo step (nothing is written while the model trails that file's text). The widget can't be selected or edited; the line itself is an ordinary line and row (§3.4).
- **Folding** and **line operations**: §4.2 and §4.3. **Diagnostics**: §4.4.
- **Search and replace** are CodeMirror's own (`@codemirror/search`), over the whole composed text; Ctrl+F opens the panel. A match in a folded segment opens the fold to show it. A replace changes the file the match is in; a replace-all touching several files is one transaction and one undo. The single-file workspace has the same search panel, over its one file, so search behaves the same everywhere.
- **Cursor and rows.** The cursor is reported as `{ file, line }`, and the editor's row layout is keyed by file and line (§3.3, §3.4), so a following Gantt draws every row of every plan, each at its line. A view's click on a mounted row moves the cursor to that row in its segment.
- **Saving.** Ctrl+S saves the root file and every file in the composed text with unsaved changes, wherever the change was made, each through the check that its file on disk is unchanged (§6). Save all is unchanged.
- **Known limitation**: §3.7, recomposing.

## 4b. Grid editor

A second editor over the same `PlanBuffer`: a task sheet in the style of MS Project, one row per line, roll-ups shown inline. When the grid is active the text editor is unmounted, and vice versa. The preview pane is unaffected by which editor is active. The grid never imports CodeMirror.

### 4b.1 Rows

- One row per **item** line. Columns, left to right: WBS (outline number, read-only, doubles as the row selector), done (checkbox), a toggle for each other declared marker, title, then each declared column in order.
- **Marker toggles.** Each marker other than `done` has a checkbox column after done's, in declaration order, headed by its glyph (`^`). It calls `setMarker`, and Space toggles it, as it does done. A file whose only marker is `done` has none.
- **IDs on hover.** Hovering the WBS cell of a row with an anchor shows its ID (`#review`), so a grid user can name the task to a text user. IDs are otherwise hidden: a grid user never needs one.
- Comment and blank lines render as greyed rows: a WBS cell with no number, then one cell spanning the remaining columns and holding the raw line text, indentation included. They are editable as raw text — editing one into an item line is an ordinary text edit and the row changes kind on the next render — and they can be selected, deleted and moved like any row. The reverse is not a grid edit: an item's title cell edits only the title (§4b.2), so a `//` typed there is quoted and reads back as part of the title. An item is commented out in the text editor.
- Front matter renders as a single collapsed greyed row at the top, read-only.
- **Composed rows.** Over a composed buffer (§3.7, in a folder), the grid shows the composed lines in composed order, from the piece map: the root's rows, and each mounted file's rows in its segment, its comment and blank lines included, and its front matter as one collapsed, read-only row like the root's. Each row carries its own `{ file, line }`, which the cursor, hover and row layout use (§3.3, §3.4). A segment's mount row is its header (§4b.7). A mounted file's rows are shaded with the text editor's segment tokens from the theme, `--mounted-row-bg` and a border on their left in `--segment-border`, at every mount depth, with the classes `mounted` and `segment-depth-N`; the hover and cursor bands show over the shading; titles are indented at the row's depth in the composed tree, and outline numbers run across the whole plan. Mounted rows are edited where they appear (§4b.7). With no mounts, or in the single-file workspace, the grid is as before.
- The last body row is one blank **new task** row. Typing into it inserts a new item line at the end of the document at the indent of the last item line (or indent 0 if none). Over a composed buffer, that is the root file, at the indent of its last item line.
- A read-only **total** row below it shows document `effective` and `doneSum` per summable column, mounted plans included (§2.12). It is pinned to the bottom of the grid's scroll area (its cells are sticky). It keeps its own place at the end of the table, which is what lets the last task and the new-task row scroll clear of it, so the body needs no extra padding.
- The **current row**, the one the focused cell or selected row is on, has the views' cursor band across its full width, behind its cells, as well as the focused cell's outline. A selected row keeps its own style over it, and a done row keeps the band.

### 4b.2 Cells

Every cell edit goes through the rows edit API (§3.9). The grid never builds row text itself.

- **Title** edits call `setLead`, which keeps the indent, markers and anchors, and quotes the title when it would otherwise read as a marker, an anchor or a heading.
- **Done** checkbox calls `setMarker(done)`. A child of a done parent shows a checked, disabled checkbox. The other marker toggles call `setMarker` with their marker's name.
- **Ref cells** show each target's outline number, plus its qualifier as written when there is one (`1.2, 2.1 +1d`); a reference that doesn't resolve shows as written (`#missing`), with its warning. A cell that doesn't read as references shows its text. This is the same for any `ref` column: the grid knows nothing about scheduling.
  - **Input:** targets separated by commas, each an outline number or `#id`, optionally followed by a qualifier value after whitespace (a signed duration for `lag`, normalised as a typed duration is, §4b.6.5). Commit resolves every outline number against the current model, to its row's ID. A target with no ID gets an anchor from `mintId` (core: a slug of the title, accents folded, in the ID grammar, cut at the last hyphen within 24 characters, or at 24 when there is none, then unique ignoring case with `-2`, `-3`…, or `task` when nothing is left; deterministic, and never changed by a later change of title). The cell is written with `setCell`, so quoting and qualifiers are rows' business. The new anchors and the cell edit are one change, undone in one step.
  - **Refusals:** only when it can't be written: a number that matches no row ("There's no task 4.7."), more than one target in a column without `many`, a qualifier the column doesn't declare, and an anchor `setAnchor` refuses (the file's first, while a row has a cell written `id=…`). The whole edit is refused then, and nothing is written. Everything else, such as a dependency on a parent or on the row itself, is written, and the schedule's diagnostics report it as usual.
  - **Editing shows the outline-number form**, as the cell shows it, not the raw `#id` text. It is the one exception to "editing shows the raw cell text" below. Committing it unchanged writes nothing.
- **Summable cells** display the formatted `effective` (empty when `hasValue` is false; muted when `mode` is `derived`). Editing shows the **raw cell text** from the file, spreadsheet-formula style. Committing a non-empty value on a parent creates an override; committing an empty value on a parent restores derived. An additive value (`+…`) is shown with a marker and is read-only.
- **Text cells** display and edit the decoded text. A `|` or a leading `"` typed into a cell is quoted automatically.
- Writing a column that the row doesn't set yet follows `setCell`'s rules: append it positionally if it is the next slot, otherwise write it as a named cell (`notes=…`). The grid pads with empty cells only in `setCell`'s one exception, a column that can't be named. Clearing a cell removes it, or empties it if later cells depend on its position.
- A cell with a diagnostic has a coloured outline (error, warning or info) and shows the message on hover. A diagnostic whose span falls in a cell, a named cell's `NAME=` included, marks that cell. One with no span, or on overflow cells, marks the row's WBS cell. Anything inside the frontmatter marks its collapsed row.
- Implicit columns (`parent`, and `id` when identity is on) are not shown in v1.
- When rows refuses an edit, the grid leaves the cell as it was and shows the reason beside it briefly; it never fails silently. The reason is worded for someone who has never seen the file ("Other rows refer to this task by its ID, so it can't be deleted yet."): rows gives its reasons in its own terms, and the grid maps them to plain messages. An inserted row that rows refuses stays a draft with its text. An edit made while the model still trails the buffer (the shell's debounce) is refused the same way, since its offsets would be for the older text.
- Typed values are trimmed, and a tab becomes a space, since the buffer holds no tabs (§2.2).

### 4b.3 Selection and focus

- Exactly one of: a focused cell (navigation), an editing cell (input open), or a selected row (structural operations). Clicking a WBS cell selects the row; clicking any other cell focuses it, and double-clicking it starts editing. From the keyboard, editing starts as in §4b.4.
- One selected row at a time.
- After every buffer change the grid rebuilds and restores focus to the same line and column, using `mapPos` when the change moved lines.

### 4b.4 Keys

MS Project conventions; where Project has no default, the text editor's binding is used.

| Key                     | Focused cell                                                                                       | Editing cell                                   | Selected row                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Enter                   | move down one row (from the last item row: to the new-task row)                                    | commit, then move down                         | —                                                           |
| Tab / Shift+Tab         | next / previous cell (wraps across rows)                                                           | commit, then next / previous cell              | —                                                           |
| F2 or any printable key | start editing (printable key replaces the content; F2 keeps it, caret at end)                      | —                                              | —                                                           |
| Escape                  | —                                                                                                  | cancel edit, restore display, buffer untouched | clear selection                                             |
| Delete                  | clear cell (commit empty)                                                                          | —                                              | delete the row; its descendants move up one level (§4b.6.4); asks first when other rows refer to it |
| Insert                  | insert a blank item row **above** at the current row's level (§4b.6.4) and start editing its title | —                                              | same                                                        |
| Alt+Shift+Right / Left  | indent / outdent the row                                                                           | —                                              | same                                                        |
| Alt+Up / Alt+Down       | move the row and its subtree past its previous / next sibling (§4b.6.4)                            | —                                              | same                                                        |
| Space                   | toggle done, or a marker, when the focused cell is its checkbox                                    | —                                              | —                                                           |
| Ctrl+Z / Ctrl+Y         | buffer undo / redo                                                                                 | Ctrl+Z cancels the edit                        | same as focused                                             |
| Arrow keys              | move focus                                                                                         | —                                              | move selection                                              |

Insert-above is deliberate: inserting directly **below** a parent at the parent's indent would capture the parent's children; inserting above never does.

**Deleting a row other rows refer to** asks first, with a preview of the exact change, below the toolbar: "Delete Review? API and UI refer to it in deps; those references will be removed." When the references come from more than one column, each is listed: "… API in deps, Spec in related refer to it …". Apply calls `deleteRow` with `removeReferences`, as one change, so a grid delete never leaves a reference pointing at nothing; Cancel writes nothing, and any change to the buffer drops the question. A row nothing refers to is deleted at once, unless it is a mount row (§4b.7).

Arrow keys move between cells within a row as well as between rows; left of the done checkbox is the WBS cell, so ArrowLeft from the first cell selects the row. Tab and Enter are deliberately unbound on a selected row, and that is the keyboard's way out of the grid: select a row, then Tab leaves for the next control on the page.

The grid holds a **roving tab stop**: exactly one cell — the current place, or the first row's WBS cell before there is one — carries `tabindex="0"` and every other cell carries `-1`, so the page's tab order enters the grid once and leaves once rather than walking every cell. Focusing that cell from the keyboard places the grid there. Checkboxes are not tabbable; their cell is, and Space toggles them. Full `role="grid"` accessibility is still deferred (§7).

An inserted row is a **draft**: it appears in the grid at the right position and indent, and the buffer gets one complete item line when its title is committed. Escape, or committing nothing, discards it and leaves the buffer untouched. Writing a blank line to the buffer first would not do: a line of only spaces is a blank line, not an item, so there would be no item row to type into.

### 4b.5 Toolbar

Buttons for Insert row, Delete row, Indent, Outdent, Move up, Move down, Toggle done, Mount plan… (§4b.7), Unmount. Each mirrors a key above and is enabled only when it applies: indent only when the item row above is at the same or a greater level (a row directly below its parent is already as deep as it can usefully go; for a comment or blank row, the row above at the same or a greater indent), outdent only on a row below the top level (or an indented comment or blank row), move up and move down only when the item row has a previous or next sibling to swap with (for a comment or blank row, a line to swap with, never a front matter line), toggle done only on a row whose `~` is its own, Unmount only on a row with a `mount=` cell. All of them are disabled when nothing is selected. A control a mounted file disables (§4b.7) has a tooltip saying why, and its key gives the same note beside the cell. The toolbar acts on the current row, whether it is selected by its WBS cell or holds the focused cell. The editor toggle (Text / Grid) is in the app toolbar.

### 4b.6 Errors and repair

A grid user must never be stuck. Every error is visible in the grid. Every error that can be fixed without judgement is fixed as part of the user's own edits. Every other error offers a fix the user can apply without switching to the text editor.

#### 4b.6.1 Rules

- **Nothing is repaired on read.** Opening a file, or receiving another editor's change, never writes to the buffer. Only a user's own action writes. This protects text users mid-edit, and stops clients from correcting each other (thrashing).
- **Every fix is deterministic and idempotent.** The same text gives the same edits on every client, and applying a fix twice changes nothing the second time.
- **Every fix resolves what it is offered for.** Applying it removes the diagnostic it is offered on and adds no syntax or structural error. A fix that would fail this is never offered. The row fixes hold by construction; a settings fix, whose effect depends on the whole file (which profile applies once a `profile:` line is gone, say), is checked by reading the edited text before it is offered.
- **Every fix has a tier:**

| Tier      | Applied                                               | Allowed only when                                                                               |
| --------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `auto`    | As part of a grid edit that already touches that line | It keeps every value and changes nothing else in the document.                                  |
| `click`   | When the user clicks it. No dialog; undoable.         | It keeps every value, or it only adds to the settings.                                          |
| `confirm` | After a preview of the exact change and a warning     | It deletes or moves data, changes the tree, changes what other rows mean, or rewrites settings. |

- A grid edit and its `auto` fixes are one transaction, so they undo in one step. A repair that collides with the edit is left out, since the edit is what the user asked for: one that overlaps or touches the edit's text in a cell, and a row's indent repairs, which go together, when they overlap it. Structure operations set levels themselves and take only cell repairs.
- `auto` fixes also appear in the problems list as one-click fixes, for rows the user hasn't touched.

#### 4b.6.2 Fix model

Each entry in `Diagnostic.fixes` is:

```ts
interface Fix {
  label: string; // "Rejoin into notes"
  tier: "auto" | "click" | "confirm";
  edits: TextEdit[];
  preview?: string; // required for 'confirm': the affected lines before and after
  warning?: string; // shown with the preview: what the change may do beyond those lines
  input?: { span: Span; value: string; suggest?: "today"; before?: string; after?: string };
  // the fix writes before + value + after in place of span; edits and preview are for value, a suggestion
}
```

A fix with `suggest: 'today'` leaves the date to the editor: analysis never reads the clock, so the text editor and the grid, and their confirm panels, fill in today's date when they show the fix with core's pure `resolveFix(fix, date)`, in its edits and in its label ("Set project start to today (2026-09-29)"), and it writes the date it showed. A resolved fix suggests nothing more. A typed value is written with `inputEdit`, as `before + value + after`. "Set project start to today" replaces `project-start`'s value when the key is written, or adds a `project-start:` line before the closing `---`.

The text editor offers every fix as a lint action, whatever its tier; `confirm` fixes show their preview first.

#### 4b.6.3 Problems list

A panel in the grid view listing every diagnostic in document order, with its severity, message, row title (or line number), and its fixes as buttons. Clicking an entry focuses the row, or the cell when there is a span. The panel shows a count, even when collapsed. Diagnostics the grid can't show inline (hidden columns, settings, identity) appear only here.

With mounted files (§2.12), the list shows the root file's problems first, then each mounted file's in composed order; when more than one file has problems, each group is headed by its path. A mounted file's entry names its row in that file, and clicking it focuses that row in the grid, or its cell. Its fixes are offered as buttons, as the root's are, and apply to its file with `applyFile`. The settings banner stays the root file's: a mounted file's settings diagnostics are in its group in the list, with their fixes. The grid's inline marks show every file's, on the rows it shows.

#### 4b.6.4 Structure operations work in levels

Grid indent, outdent, insert, move and delete work on the **level** the parser assigned, never on raw spaces. They call the rows edit API (`setLevel`, `insertRow`, `moveRow`, `deleteRow`; DESIGN §6), which follows the no-new-errors invariant:

- **Indent** makes the row the last child of its previous sibling. **Outdent** makes it the next sibling of its parent. The indent written is the one its new siblings already use, or the parent's indent plus the file's usual step (the most common indent difference in the file, default 4). The row's descendants move with it and stay its descendants, as in MS Project; the rows after them keep their indent, so outdenting a row makes its later siblings its children.
- **Insert above** uses the target row's level, snapped to a valid indent.
- **Move up / down** moves the row with its subtree, swapping it with the previous or next sibling's subtree. It is enabled only when that sibling exists; moving across levels is done with indent and outdent. Comment and blank lines between the two subtrees stay where they are, and those inside a subtree move with it. Each subtree takes the indent the other's first row had, so the tree keeps its shape and a move never needs to be refused for the indentation.
- **Delete** removes the row and promotes its descendants by one level, so the rest of the tree keeps its shape.
- Any structure operation on a row whose indent fits no level first rewrites it to the level recovered by the parser (`auto`).

Comment and blank rows have no level, so the grid indents, moves and deletes them as raw lines (§3.8).

Text-editor keys stay raw: Tab adds 4 spaces and Alt+Up/Down move lines, whatever the result. In a composed text they act on the lines of the cursor's file (§4.3), so Alt+Up/Down there reorders a file's lines, mount rows included, and the segments follow.

#### 4b.6.5 Typed cell editors

The grid edits each column with an editor for its type:

- **duration:** free text, normalised when the user commits. `h`, `hr`, `hrs`, `hour` and `hours` become `h`; likewise `m`/`min`/`mins`/`minute(s)`, `d`/`day(s)`, `w`/`wk(s)`/`week(s)`. Case is ignored, so `4 Hours` and `1.5 days` become `4h` and `1.5d`. Normalised input is terms of a number and a unit word, each unit at most once, in any order, with an optional sign in front; they are written in the order typed, separated by a space (`2 wks 3d` becomes `2w 3d`, `2d4h` becomes `2d 4h`). A bare number is kept as written when the column has `unit=`. Input that still isn't valid is written as typed, and shows its warning.
- **date:** typed `YYYY-MM-DD` in a text input, with a calendar button beside it that opens the browser's date picker; picking a date fills the input.
- **bool:** a checkbox, toggled by a click or Space. A row that doesn't set the column shows its default. A value that is neither `true` nor `false` shows as written, with its warning, and is edited as text.
- **enum:** a dropdown of the declared values, plus an empty choice that clears the cell and, when the cell holds a value that isn't declared, that value, so opening the dropdown loses nothing. A printable key opens it on the first value beginning with that key. Enter, Tab or leaving the dropdown commits, as with any cell.
- **number, text:** plain input.

Normalisation applies only to what the user types, never to existing cells. Committing a cell unchanged writes nothing.

#### 4b.6.6 Cases

**Tree**

| Case                                                   | Grid shows    | Fix                                                                                    | Tier    |
| ------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------- | ------- |
| Indent that fits no level                              | Red row       | Rewrite the indent to the recovered level. Structure ops also do this first (§4b.6.4). | `auto`  |
| First row indented                                     | Red row       | Indent 0                                                                               | `auto`  |
| `parent=` disagrees with indentation, or forms a cycle | Problems list | "Use indentation": remove the `parent` cell                                            | `click` |

**Cells**

| Case                                                                 | Grid shows                                     | Fix                                                                                                                                                                                    | Tier               |
| -------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Unterminated quote, text after a closing quote, unknown escape       | Red cell showing the recovered text            | Rewrite the cell from its recovered text, correctly quoted                                                                                                                             | `auto`             |
| Overflow: more cells than columns, or unnamed cells after named ones | Badge on the WBS cell listing the extra values | "Rejoin into NOTES", where NOTES is the last declared column if it is `text`: its value becomes the original text from its cell to the end of the line, quoted. "Delete extra values". | `click`, `confirm` |
| Cell named after an undeclared column (`ratio=2`)                    | As overflow                                    | As overflow                                                                                                                                                                            | `click`, `confirm` |
| Column set twice in a row                                            | Badge showing both values                      | "Keep this value", for each, labelled with the value (`Keep owner=sam`, `Keep owner=priya`)                                                                                            | `confirm`          |

The extra values are the overflow cells other than a column's repeat, and any cell whose name is no column's (rows reads it as an unnamed cell, so it may land in a declared column). "Rejoin into NOTES" is offered only when the row has a cell in NOTES, and nothing but extra values comes after it, so it never swallows another column's value. A row without one offers "Delete extra values", or the user edits the cells. A trailing delimiter is not part of the rejoined text. "Delete extra values" removes each extra overflow cell with its delimiter, and clears an extra value in a declared column as clearing that cell would.
| Invalid value (`4 hours`, bad date, unknown enum value)              | Cell warning                                   | Edit the cell; the typed editors prevent most of these (§4b.6.5)                                                                                                                       | —                  |

**Titles**

| Case                                     | Grid shows             | Fix                                          | Tier      |
| ---------------------------------------- | ---------------------- | -------------------------------------------- | --------- |
| Row begins with the delimiter (no title) | Empty red title        | Typing a title fixes it                      | —         |
| Title reads as a heading (`# Foo`)       | Red row titled `# Foo` | Quote the title                              | `auto`    |
| Repeated marker (`~~x`)                  | Done row titled `~x`   | "Remove extra marker"                        | `click`   |
| Legacy `<!-- … -->` line                 | Item row               | "Make it a comment"; the row leaves the grid | `confirm` |

**Settings.** Shown as a banner above the grid as well as in the problems list, because they affect every row. The banner lists every diagnostic in the front matter, the unclosed `---` included, and each settings fix that diagnostics on rows share (the conversion fix) once, with how many more diagnostics it resolves. A fix is offered only for a setting written in this file: an error that comes from a profile, or a default profile, has no line to change. A conflict between a key the profile supplies and the file's own declarations is reported on the file's declaration (rows base §2.3), so its fix changes that declaration. "Remove this setting" on a `profile:` line is offered only when the file reads without errors that way; in a `.plan` file the plan profile applies once the line is gone (§2.1).

| Case                                                                                      | Fix                                                                                    | Tier      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------- |
| Unclosed `---`                                                                            | "Close settings": insert `---` after the last line that parses as a `key: value` entry | `confirm` |
| Duration column without `hpd`, `dpw` or `unit`                                            | "Add unit=h hpd=8 dpw=5"                                                               | `click`   |
| Duplicate or invalid column name                                                          | "Rename column…": the user types a name, starting from a free one (`owner2`); only the declaration changes | `confirm` |
| Unknown type (`due:dat`)                                                                  | "Change type to date", when a known type other than `enum` is within edit distance 2 (the nearest); then "Remove the type", leaving the text column it is read as | `click`   |
| A marker's column declared with another type (`done:text` while the profile's markers use `done`) | "Make done a checkbox column": the type becomes `bool`                                 | `confirm` |
| Malformed type, invalid or repeated option, bad `sep`/`comment`, unsupported `format`, profile errors | "Remove this setting" (the whole `key: value` line) or "Remove this option" (the `:TYPE`, leaving a text column, or the option) | `confirm` |

**Identity.** IDs are hidden in the grid, apart from the WBS cell's hover (§4b.1), but concurrent edits and copy-paste create these.

| Case                                        | Fix                                                                                                                                  | Tier      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Duplicate ID, or IDs differing only by case | "Rename the later one": mint a new ID (`login-2`, unused in any case). The preview warns when anything references the ID, since it's ambiguous which row they meant. | `confirm` |
| Reference to a missing ID                   | Shown only; the problems list focuses the row                                                                                        | —         |

### 4b.7 Mounted rows

Over a composed buffer (§4b.1), a mounted file's rows are edited in place. Every edit goes through the rows edit API against the row's own file's document (`Model.files`), with the repairs for that file, and is written with `applyFile` (§3.7). Comment and blank rows of a mounted file are edited as raw lines, as the root's are. Every refusal leaves the cell as it was and shows its note, as any refusal does (§4b.2). A file is named to the user by its last path segment (`alpha.plan`), or by its path in the folder when another file in the composed plan has the same last segment.

- **Columns.** The grid's columns are the root's. A cell writes the column in the row's own file that the root column maps to, by role and then by name (§2.12; `Model.column`). A root column that maps to nothing in that file shows blank, and typing into it is refused: "alpha.plan has no column for owner." Adding columns comes with the settings editor.
- **Markers.** A toggle writes the marker by name in the row's file. On a row whose file doesn't declare the marker, the toggle is disabled, with the tooltip "beta.plan has no milestone marker."; Space on it gives that note.
- **Dependencies.** A mounted row's ref cells show, and take, outline numbers within its own file's rows; a missing ID is minted in that file. An outline number that belongs to another file is refused, from any row: "Dependencies between plan files come later."
- **Structure operations** work within the row's own file (§4b.6.4). Insert above a mounted row inserts into its file, at its level; Indent needs a previous sibling in the same file; Move up and Move down swap only with a sibling in the same file, and are disabled when there is none there. Outdent on a mounted file's root is disabled, with the tooltip "That would move it out of alpha.plan."; its key gives that note. The new-task row adds to the root file. Moving a **mount row** with Alt+Up/Down swaps it with its sibling in its file, and the segments follow: that is how projects are reordered in the master.
- **A segment's mount row is its header**, as in the text editor (§4.5). _(This replaces a separate header row above the segment.)_
  - The mount row whose file is shown under it has the header's background (`--badge-bg`).
  - Its title cell shows the title, then the file badge (§3.3), then ● when that file has unsaved changes, then **Open** and **Unmount**. **Open** makes the file active. **Unmount** clears the row's `mount=` cell, as the toolbar's Unmount does, so the segment goes and the file on disk is untouched; it is one undo step, with no confirm.
  - The segment's border (`--segment-border`) starts at the mount row and runs to the segment's last row. The mount row's own children in the master sit inside it, unshaded.
  - The controls in the cell, the badge included, are out of the tab order, as the checkboxes are. The row stays a row: its cells are focusable and editable as before, and ArrowDown from it goes straight into the segment.
- **Mount rows.** Any mount row's title has the file badge (§3.3), which makes its file active, as in the views.
- **Mounting from the grid.** The toolbar's **Mount plan…** is enabled on an item row in a folder workspace; on a row that already mounts, it reads **Change mounted plan…**. In the single-file workspace it is disabled, with the tooltip "Open the folder to mount plans."
  - It opens a picker, below the toolbar where the delete confirm shows, listing the workspace's `.plan` files (`workspace.list()`), with a filter field. Escape or Cancel closes it, and any change to the buffer drops it.
  - A file that can't be mounted on the row is disabled, with core's reason as its tooltip (`mountRefusal`, from composition's own rules, §2.12):
    - the row's own file: "teams/alpha.plan is this row's own file; a file can't mount itself";
    - a file above the row, or one whose own mounts reach a file above it: "portfolio.plan mounts this file, directly or through other files", as `mount-loop` says it;
    - a file shown elsewhere in the composed plan, not counting what the row shows now: "teams/beta.plan is already mounted elsewhere in the plan", as `mount-overlap` says it.
    - The file the row mounts now is disabled too: "This row mounts it already."
  - The shell lists the files, each with the files it mounts: an open file's current text, any other read from disk, through core's `readMounts` and the workspace's `resolve`.
  - Choosing a file writes the row's `mount=` cell with `setCell` on the mount column, as the path relative to the row's own file (core's `relativePath`, the inverse of the workspace's `resolve`), through `applyFile`, as one undo step. A row in a mounted file is written in that file, relative to it, which makes a nested mount.
- **Deleting a mount row** asks first, with the preview: "Delete Product A? teams/alpha.plan stays as it is; it just won't be shown here." When other rows refer to it, the question goes on as §4b.4's does ("Product B refers to it in deps; that reference will be removed."), and Apply removes the row and those references. Its own children are promoted, as with any delete.
- **Deleting a mounted task** needs no confirm when nothing refers to it, and is one undo step. The status line names its file: "Deleted API from alpha.plan." §4b.4's reference question names the file too: "Delete API from alpha.plan? UI refers to it in deps; that reference will be removed."
- **Rebuilding.** After each change the grid keeps each row's element, found by its own file and line (the line followed through the edits since the last build), works out what every cell shows, and redraws only the cells that changed, so an edit on a portfolio of thousands of rows redraws a few cells. What it draws is exactly what a fresh build draws.

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

Same data as the tree, flat: `#`, `level`, title, declared columns. Same cell, highlight and click rules via `RenderContext`. Tree and table share their estimate cells in `src/plugins/estimate/renderers/shared.ts`, and the row builder in `src/ui/grid.ts`.

### 5.4 Schedule table

The schedule plugin's renderer (§2.11): one row per item, nested like the tree, with `#`, title, start, finish, duration and slack.

- Starts show at their own edge, `formatPinnableDate` (`toDate(t, 'start')` unless the value says `'end'`), finishes as `toDate(t, 'end')`, and a milestone shows its date, at the end edge, in both columns. `toDate(0, 'end')` is hour 0's own day, so a milestone at the project start shows on it. Dates read `Mon 5 Oct`, with the year when it isn't project-start's (`Mon 4 Jan 2027`).
- Durations and slack show in days and hours of the calendar's `hoursPerDay` (`1d 4h`, `−1d`, `0h`); a milestone's duration reads `milestone`, and a summary has none.
- A pinned start or duration shows the derived value muted beside it, as the tree shows `⟨Σ …⟩`: `Mon 12 Oct ⟨Tue 6 Oct⟩`. A milestone's derived start is muted at the end edge too, and shows even when it equals the shown date: `Mon 26 Oct ⟨Mon 26 Oct⟩`.
- Critical rows show their slack in the error colour; late rows are outlined in the warning colour.
- Same highlight and click rules via `RenderContext`. It is greyed out with the skip reason ("needs project-start", "project-start isn't a date") when its stages are skipped.

### 5.5 Gantt

The schedule plugin's second renderer (`src/plugins/schedule/renderers/gantt/`), and the first that follows (§3.3). It draws from its `RowLayout`: the editor's when one leads, otherwise its natural layout. A row with no item stays empty, and only rows in the layout are drawn, so a folded parent's children have no marks while its bracket still spans their dates.

With mounted files (§2.12), every row is keyed by its file and line. Following the composed text editor (§4.5), the Gantt draws every row of every plan, each at its line; following the grid, which shows the same rows in the same order (§4b.1), it draws every row too. Standalone, its natural layout has every row of the composed tree. A mounted row is shaded, and has the cursor and hover bands and click-to-line like any row.

- **Geometry** is a pure function, `ganttGeometry(model, layout, scale, today, chartWidth)`, returning plain data: the resolved `dayWidth` and tiers; per row, a bar, a summary bracket or a milestone diamond, its flags (critical, late, done, pinned), a pinned start's `pinX`, a late row's `deadlineX`, and its layout row's `top` and `height`; a band for every layout row with a line, an empty one too; the deadline lines, the project finish, the today line, and the scale's labels, lines and ticks. The renderer only places what it returns. `scale` is a named scale (`'day'`, `'week'`, `'month'`, `'fit'`) or an explicit `{ dayWidth, tiers }`; a named scale gives the same chart as its explicit pair. The app passes only names; the explicit form is for tests. `chartWidth`, the pane's chart width, is read only for Fit.
- **Layers,** from bottom to top: the cursor and hover bands, the scale's period lines, the marks, then the deadline, today and project-finish lines. Each item's marks sit on a transparent full-width row, which takes its clicks.
- **The x axis is working days**: a position is `WorkHours / hoursPerDay × dayWidth`, so weekends take no space at every scale; a scale changes only `dayWidth` and the labels. The **extent** runs from hour 0 to the later of the project finish and the latest deadline, rounded up to a whole working day, plus one working day.
- **Scales:**

  | Scale | `dayWidth` | Top tier | Bottom tier |
  | ----- | ---------- | -------- | ----------- |
  | Day   | 24 | each week's first working day, `Mon 5 Oct` (as §5.4 formats dates) | day letters, each centred in its day |
  | Week  | 6 | each month, `Oct 2026` | each week's first working day, its day number (`5`, `12`) |
  | Month | 1.5 | each year, `2027` | each month, `Oct` |
  | Fit   | the chart width ÷ the extent in days | as Day, Week or Month, whichever `dayWidth` is nearest by ratio | as the chosen tier |

  Fit takes the coarser tiers on a tie (12px a day is Week, 3px is Month), since the finer ones would already be dropping labels there. With a chart width of 0 or less (a collapsed pane) Fit is Day, and it recomputes when the pane is resized.
- **Where labels go.** A month or year label sits at the first working day on or after its 1st, from `calendar.fromDate(d, 'start')`. The period that holds hour 0 is labelled at x = 0, so the chart always has a label at its left edge. A label that would overlap the one kept before it in its tier is left out, by the geometry, not the renderer. With no DOM to measure, a label is estimated at 7px a character plus 6px (the scale's 12px text and its 3px paddings).
- **The scale** is a header of three rows and nothing else, the same height at every scale, which it reports as its natural header height: each deadline's date, right-aligned to its line, then the top tier, then the bottom tier. Deadline dates take no part in the tiers' overlap, and two that overlap are both kept. Full-height lines run down the chart at each top-tier period (Day: each week; Week: each month; Month: each year), labelled or not; short ticks in the header mark each bottom-tier period. The chart scrolls sideways on its own; the scale moves with it.
- **The picker** is a segmented control in the preview toolbar, placed through `RenderContext.toolbar` (§3.3), **Day · Week · Month · Fit**: a radio group with one tab stop, whose arrow keys move between the options. The choice is kept per viewer in `localStorage`, as the last-used editor is, and is Fit when nothing readable is stored. Switching keeps the date at the left edge of the view there; Fit shows everything, so it starts at the left.
- **Marks:** a leaf bar from start to finish; a summary's bracket from its start to its finish; a milestone's diamond at its finish, so a pinned milestone's diamond is at the end of its date. A bar is drawn at least 2px wide: the geometry gives its true `width` and the `drawn` width. A summary bracket narrower than its two 3px end caps is drawn as a bar (`asBar`). Diamonds, pin marks and deadline markers keep their size at every scale. Critical bars and brackets use the critical colour. A late row's mark is outlined in the warning colour, with a small marker at its deadline on that row. Done rows are dimmed. A pinned start (its mode isn't `derived`) has a pin mark at the pin's own date, so a pin that had no effect sits left of its bar; a kept milestone pin sits on its diamond.
- **Lines:** each distinct deadline is a dashed full-height line; the project finish is a solid one; today, from `today()` in `src/ui/`, is drawn only when it falls inside the extent. Geometry takes today as a parameter, so it stays pure.
- Hovering a mark shows the title, start and finish dates, duration and slack, as §5.4 formats them. Clicking a row or its mark moves the cursor to its line, and the cursor row is banded, through `RenderContext`. Hover goes both ways (§3.3): hovering anywhere on a row, empty or not, bands it and reports its line, and a line hovered in the editor is banded. A render replays only the editor's line, so it never clears the Gantt's own. It is greyed out with the skip reason when the schedule's stages are skipped.

### 5.6 Pin review

A view that belongs to no plugin (`src/views/pins/`), with no `requires`, so it is always available. It lists every pin that overrides something: for each key in `model.fields()` that is pinnable, single or by column, each node's value with both a `pin` and a `derived`, in document order. A leaf estimate has nothing derived, so it never appears. "No pins" when the list is empty.

- Each entry shows the outline number, title, what is pinned, pin, derived and effective. A single key gives its `label` and `kind` (`PLUGINS.md` §4): a `'duration'` through `formatDuration`, a `'date'` through `formatPinnableDate`, at the value's own edge (`'start'` unless it says `'end'`, as a milestone's start does), and §5.4's format. A by-column key carries neither: the entry shows the column's name, and the column's type decides the format, a duration column through `formatDuration` and a number column as the plain number. An additive pin shows its `+`.
- A pinned value whose effective value differs from its pin (a floor that had no effect) is marked. An additive one never is, since adding is what it is for.
- Click-to-line and the cursor band, as in the other views.

### 5.3 Theming

The preview is a column: its tab bar stays put, and the view's host below it fills the rest and is the scroll container.

All colours are CSS custom properties defined in `src/app/theme.css` on `:root`, with a complete dark set under `prefers-color-scheme: dark`, plus `color-scheme: light dark`. CodeMirror's chrome and lint decorations read the same tokens, and its dark flag follows the media query live. A test fails on any hex or `rgb(` literal outside the theme file and on any light token without a dark counterpart. No manual toggle yet.

## 6. Persistence and deployment

- Single user, files on disk. Open and save go through the workspace (`PLUGINS.md` §7.1); the shell checks what the workspace can do, never which kind it is, nor the browser's name.
- **Start screen.** Every load opens on a start screen, a page in the shell in place of the panes, in both themes; closing a folder, or the single file, returns to it. While it shows, the toolbar offers only **New…**, **Open file**, **Open folder** and **Reopen**, and the title is "Plan". Its choices, in order, each a button the keyboard reaches:
  1. **Reopen _name_**, only while a folder is remembered. A refusal and a missing folder behave as Reopen in the toolbar does.
  2. **New plan…**, the wizard below.
  3. **Open folder…** and **Open file…**, as in the toolbar. Open folder is disabled, with its tooltip, where the browser lacks it.
  4. **Templates:** Estimate, Schedule and Portfolio, each with a one-line description.

  The shell's boot takes an optional initial document, which tests use: that text opens as an untitled document in the single-file workspace, with no start screen.
- **Templates** are bundled with the app, so they work on GitHub Pages.
  - **Estimate** is `examples/example.plan` and **Schedule** is `examples/demo.plan`. Each opens as an untitled document in the single-file workspace, with the example's text exactly, so Save goes to Save As. Like any new document it is marked unsaved only once edited.
  - **Portfolio** is `examples/portfolio/`: `portfolio.plan`, `teams/alpha.plan` and `teams/beta.plan`. It asks for a folder (`open({ allowEmpty: true })`, so an empty one is fine) and checks the three paths against the folder's listing. Otherwise it creates each file with `create`, keeping its relative path, and opens the folder with `portfolio.plan` active. If any is there already, nothing is written; if a `create` fails partway (the file appeared meanwhile), the files already written stay. Either way the folder then opens as Open folder opens one, its file shown by the usual rule, and the status line names the file that blocked it: "_teams/alpha.plan_ already exists, so the template wasn't written. Opened the folder instead." ("wasn't fully written" when some files were). If that open fails too (a folder still without plan files), the status line gives both reasons, and the start screen stays. The folder is remembered only once the folder opens. It is disabled, with Open folder's tooltip, where Open folder is.
- **New plan wizard.** **New…** in the toolbar, always shown, and **New plan…** on the start screen open it. It is an in-page dialog with Back, Next (Create on the last step) and Cancel; Escape cancels. Its steps:
  1. **Type:** one per built-in profile, with a one-line description: Estimate (`profile: plan`) and Schedule (`profile: schedule`).
  2. **Name and location**, only when the workspace can create files (a folder). **Name** defaults to `untitled.plan`, and `.plan` is added when missing. It is refused, with a note beside the field, when it is empty ("Enter a name."), contains `/` ("A name can't contain /.") or is already in the chosen folder ("_teams/x.plan_ already exists."). **Location** is a combobox: it offers the folder's top level (`.`) and every folder the listing reaches, and accepts a typed path, relative to the folder, which may name folders that don't exist yet; `create` makes them. Empty, or `.`, is the top level, and a trailing `/` is fine. It is refused, with a note beside it, when it starts with `/` ("The location must be relative to the folder."), has a `..` part ("The location can't go up a folder (..).") or an empty part ("The location can't have empty parts.").
  3. **Project start**, only for a type whose files would be told `no-project-start` (Schedule): a date field defaulting to today, which the wizard reads as UI code.

  It writes `---\nprofile: plan\n---\n`, or `---\nprofile: schedule\nproject-start: YYYY-MM-DD\n---\n`.
  - **In a folder** the file is created with `workspace.create` and becomes the active file. **Mount it under _row_** is a checkbox in step 2, shown when the cursor in the text editor, or the selection in the grid, is on an item row of the active file's composed plan that mounts no file yet. Ticked, the wizard writes the row's `mount=` cell, relative to the row's own file, through `applyFile` as one undo step; the active file stays active, and the new plan shows as the row's segment. Undo removes the mount and leaves the file on disk.
  - **Elsewhere** (the single-file workspace, and the start screen) it opens the text as an untitled document in the single-file workspace, after the unsaved-changes dialog; Cancel there changes nothing.
- **Close.** **Close** in the toolbar, hidden on the start screen. In a folder it is a menu:
  - **Close file** closes the active file, and the files opened only to show its mounts, unless a segment of another open file shows them. A file is open when the user opened it, chose it in the file panel or created it; a file read only to fill a segment is not. The closed file itself stays read while another open file shows it as a segment. The next open file in the panel's order becomes active, else the one before it. It is disabled, titled "This is the only open file; use Close folder.", when no other file would stay open.
  - **Close folder** closes everything and returns to the start screen. The remembered folder stays, for Reopen.

  In the single-file workspace Close closes the file and returns to the start screen. Every close first asks about unsaved changes as below, listing every unsaved file it would close, mounted ones included; Save all and continue saves those files.
- **Workspaces.** The toolbar offers **Open file** and **Open folder**.
  - Open file is the single-file workspace: the File System Access API where available, falling back to file input and download.
  - Open folder picks a folder with `showDirectoryPicker` (read and write). It lists the folder's `.plan` and `.rows` files recursively, as paths relative to the folder, skipping dot-folders and `node_modules`. The file shown first is the one last active in that folder, else the first at its top level, else the first listed. A folder with no plan files opens nothing: the open files stay, and the status reads "No plan files in folder".
  - In a browser without `showDirectoryPicker`, such as Firefox, Open folder is disabled, with a tooltip saying it needs Edge or Chrome. In a cross-origin frame it is disabled with a tooltip saying so.
  - Paths resolve relative to the file they appear in. A path outside the folder is refused with a plain reason, and a mount to it gets `mount-outside` (§2.12).
  - **Mounted files** are gathered before each analysis (`PLUGINS.md` §6). A mounted file open in the store gives its current text, unsaved edits included; any other is read from disk once, and kept while it stays mounted. They are read again on focus and Refresh, with the open files.
  - **Remembering the folder.** The last folder opened is kept in IndexedDB, with the file last active in it, as a per-viewer convenience. While one is remembered, **Reopen _name_** asks the browser for permission again with one click. A refusal says "Permission to open _name_ was refused" and keeps Reopen. A folder that no longer resolves is forgotten, with a status line saying so; opening another folder replaces it. Only an open that succeeds remembers a folder: a dismissed picker, a refusal or a failed open leaves the remembered one as it was.
- **Open files.** The files opened in this session form a store, and the single-file workspace uses it too, holding one file. Each file holds its path, its own buffer (in the single-file workspace it also holds the undo history; in a folder the file's composed view does, §4.5, so either way the history survives switching files), the text as last read from or written to disk, whether it is unsaved, and whether it changed on disk since (_stale_) or can no longer be read (_missing_). Exactly one is active: the editors, analysis and views follow it, and `analyze` gets its path as the filename.
- **File panel.** For a workspace that can list files, a collapsible panel left of the editor lists them grouped by folder, with markers for unsaved (●), changed on disk (↻) and missing on disk (✕). Clicking a file, or Enter on it, makes it active, reading it the first time; the arrow keys move between files.
- **Replacing the open files.** Open file, Open folder, Reopen, the templates and a new plan outside a folder replace the open files. If any is unsaved, they first ask "_alpha.plan and beta.plan_ have unsaved changes." with **Save all and continue** (continues only if every save succeeds), **Discard and continue** and **Cancel** (changes nothing).
- **Saving.** Ctrl+S and Save write the active file; in the composed text editor, Ctrl+S also writes every file it shows with unsaved changes (§4.5). **Save all** (shown when the workspace can list) writes every unsaved file. Save As is shown only when the workspace can pick a location (`can.saveAs`); a folder creates files with New… instead, and a file with no path is not saved. Save writes the buffer as-is; nothing re-serialises from the tree. A saved file is byte-identical to the opened one except for tab-to-space and CRLF-to-LF normalisation.
- **Before each write in place**, the file is read again. If it no longer matches the text last read or written, the app asks "_alpha.plan_ changed on disk since you opened it. Overwrite it, or keep your changes unsaved?" (**Overwrite**, **Keep**) and writes nothing unless told to overwrite. A file missing on disk asks "_alpha.plan_ is no longer on disk. Save it again at _teams/alpha.plan_?"; **Yes** writes it at its path, creating it. A download overwrites nothing, so it is not checked.
- **Changes on disk.** When the window regains focus, and on **Refresh** (shown when the workspace saves in place), the workspace is listed again and every open file is read again. A file that changed on disk and has no unsaved changes gets the change as a line diff (only the lines that differ), with origin `remote`, outside the undo history (§3.7). From its own buffer the change reaches every composed view showing the file, as `remote` too, so a segment follows its file on disk. A file with unsaved changes is left as it is and marked stale, and saving it asks, as above. A file that can't be read keeps its buffer, is marked missing, and the status line names it; if it reappears it is handled like any other.
- The unsaved-changes indicator goes off only when the file on disk matches the buffer: after opening, after a save in place, or after a change on disk is applied. A download leaves it on. Leaving the page prompts while any open file's buffer differs from the text last opened, saved or downloaded.
- Open accepts `.plan` and `.rows`. Save As defaults to `.plan`. A new plan starts as the wizard writes it, above.
- In contexts where the API is unavailable or blocked (e.g. a cross-origin iframe such as the VS Code Simple Browser), failures are reported visibly, never swallowed.
- Deployed as a static build to GitHub Pages via GitHub Actions on push to the `deploy` branch (`git push origin main:deploy`). Vite `base` is `/tasklist/` under Actions and `/` locally.

## 7. Deferred

- Plan meanings for more markers, such as `?` uncertain, `!` blocked and `-` dropped. The syntax is already available through `markers:`.
- Estimate ranges / confidence, PERT roll-up
- Markdown headings (`# `) as un-indented parents. Rows reserves the form.
- Status roll-up (all children done ⇒ parent done)
- Link types other than finish-to-start; `done` affecting dates
- Additional roll-up types: `max`, `count`, `done%`, `remaining`
- Negative values and negative additive values
- `renameId`: rename an anchor and rewrite in-file references to it. Until then, `setCell` on an anchored key column renames the anchor only.
- rows `include` resolution (needs directory access in the browser), canonical form export
- Showing the implicit `id` and `parent` columns in the grid
- Renderers: Gantt; exports to Excel files, Word, HTML, MS Project
- Manual light/dark toggle
- Multi-user via text CRDT
- Desktop packaging (Electron)
- **Grid v2:** multi-row selection and bulk operations; subtree delete; add / rename / remove / reorder columns from the header (writes `columns:`); paste TSV rows from a spreadsheet; drag-to-reorder; persisted column widths; editing additive values; front matter editing; full `role="grid"` accessibility
- Rich-text decoration layer for the text editor (proportional font, rendered checkbox, aligned columns)

## 8. Build order

See `TASKS.md`.
