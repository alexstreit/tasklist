# VISION.md

Where the plan tool is going, and the rules that keep it maintainable on the way. The working draft is a claude.ai doc; this file is the committed copy. The plugin interfaces are in `PLUGINS.md`. Every task in `TASKS.md` names the milestone it serves. Don't build ahead of it.

## 1. Purpose and scope

The tool grows, one plugin at a time, into a replacement for MS Project for a PMO: estimating, scheduling, progress tracking and cross-project roll-up, all over plain-text rows files that live in git. It is project-as-code: a text editor with elements of a sparse spreadsheet, where plugins give the columns meaning.

The Project Server functions it should cover, in the PMO's order of need:

1. Cross-project roll-up
2. Progress updates submitted by PMs
3. A shared resource pool, later
4. Permissions, only if needed

After M1, the milestones (§7) follow the author's own needs as PMO: roll-up across teams (M3) comes before progress tracking (M2).

**Out of scope:** timesheets; pricing and cost (ProPricer does this, and the tool exports to it); automatic resource levelling (detection only); writing binary `.mpp` (MS Project XML instead). Gantt PDFs can come later, possibly as a plugin.

**Deployment:** a serverless edition (browser today, Tauri later for folders and linked files) and a server edition (Yjs) should co-exist. Git works in both. No design decision may rule out real-time collaboration.

## 2. Users

Three roles share the same files.

| User            | Job                                | What they need from the tool                                                  | Served by                                 |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Scheduling PM   | Runs projects to a schedule        | Dependencies, dates, critical path, milestones, deadlines, keeping it current | M1 (done), M2                             |
| PMO             | Oversees all projects, prices work | Roll-up across projects, progress updates, export to ProPricer                | M3 (next), M4                             |
| Estimating lead | Sizes work                         | Estimates that roll up (what the tool does today)                             | Done; must keep working as the rest grows |

M1 gave the scheduling PM a working scheduler; the PMs won't switch until the tool gives them a compelling reason, so for now the author, as PMO, is the first real user, and M3 serves that role next.

One file serves all three roles. The estimator fills `est`; the PM later adds dependencies and pins in the same file, and the estimate stays live. A handover between owners, or a team's plan in the big picture, uses a mount rather than a copy (§6).

## 3. Principles

The file holds only what a person decided; everything else is computed, and every part of the code can be understood on its own.

1. **Text holds decisions.** Computed values (totals, dates, slack) are never written into the file. Written values would make git diffs noise and make Yjs clients fight over numbers nobody typed. They appear in the model, renderers and exports.
2. **Derived or pinned.** Any computed value a person may fix follows the `est` pattern: an empty cell is derived, a filled cell is a pin. Core defines one shape for every pinnable value, `{ derived, pin?, effective, mode }`, and the owning plugin's rule says how pin and derived combine: an estimate override replaces, a start pin is a floor. Renderers show the derived value greyed beside a pin, and a pin review lists every pin against its derived value without knowing which plugin owns it. The review lists only pins that override something, so a leaf estimate never appears. Pin diagnostics (a pin equal to its derived value, a floor with no effect) belong to the plugin that owns the value; nothing about pin history is stored.
3. **One parser, one reading.** rows reads every file, and core reads the format's values once (typed cells, hours, done), reporting their diagnostics once. Plugins never parse text or re-read a cell, so every part of the app agrees on lines, spans, values and edits.
4. **Roles are the contract.** A plugin reads columns by role, not by name. The file names its columns freely; `roles:` binds them.
5. **Nothing is repaired on read.** Fixes are explicit edit operations, and each is deterministic (already true, and required for Yjs).
6. **Nothing knows where files live.** Files and includes are reached through one workspace interface. The interface and its single-file browser implementation land in M1, with the estimate plugin extraction; the folder workspace in Edge comes in M3a, and Tauri and the server later, behind the same interface.
7. **Collaboration stays possible.** Sync happens on the text; each client parses and computes locally. Concurrent edits to one cell rely on collaborators seeing each other's cursors; the known failure cases are an offline merge and a tool edit that rewrites a line someone is typing in. Two mitigations: typed cell editors replace the whole cell span, so concurrent edits concatenate rather than interleave, and diagnostics run after every remote update, so a cell that stops parsing is flagged.

### 3.1 Modularity rules

These keep the code from turning into spaghetti as plugins arrive. Each one is enforced by lint or by a test, not by convention; the renderer rule is the exception and is checked in review.

- Each plugin is a folder that imports only core, rows' entry point and the plugins it declares as dependencies. No cycles.
- A plugin's stages declare the roles, keys and markers they read and the fields they write, and the plugin declares the plugins it needs. The app checks these at registration.
- The app shell special-cases no plugin, as it already special-cases no renderer.
- Renderers and exporters read computed fields only. A renderer never derives a value another renderer or exporter might also need; that belongs in a compute stage (today's rule, generalised).
- Anything that will get a better implementation later (calendar, workspace) sits behind an interface from the start, with the naive version as its first implementation.
- Each plugin has its own tests against fixtures; the §2.10 estimate example stays the reference test for the estimate plugin.
- One test boots the single-page app on a single file with no workspace features, and stays green for good: the simple use case is not lost to multi-user work.

## 4. Plugin model

A plugin is up to four parts that read columns by role and add to one shared model. It never brings its own parser and never reads the format itself: core reads every cell once, and plugins compute from that. The interfaces are in `PLUGINS.md`.

| Part          | Reads            | Produces                             | Example                                       |
| ------------- | ---------------- | ------------------------------------ | --------------------------------------------- |
| Compute stage | The model so far | New fields on nodes, and diagnostics | Roll-ups; start, finish, slack                |
| Input method  | Model and `doc`  | Text edits through rows' edit API    | Typed cell editors; dragging a Gantt bar (M2) |
| Renderer      | Computed fields  | A view                               | Tree, table, Gantt                            |
| Exporter      | Computed fields  | A file or clipboard text             | TSV, ProPricer, MS Project XML                |

### 4.1 Roles

A role is what a column means to a plugin, separate from its name and type. The file binds roles to columns with a `roles:` key, the same pattern as `nest: parent` and `markers: done=~`:

```
roles: effort=est duration=dur start=start deps=deps
```

Profiles supply the defaults, so a user who never changes columns never sees the key. Plugins may define new roles, namespaced by plugin (a ProPricer plugin adds `propricer.labour-category`). The core roles `effort`, `duration`, `start`, `deps` and `deadline` belong to the plan format and stay bare, so two plugins never collide and no role is renamed after files exist. Marker names (`done`, `milestone`) are core vocabulary only for now: a marker name is a column name, which can't take a dot, so a plugin's own marker needs a rows spec change first. Frontmatter keys follow the same rule as roles: the plan format owns a fixed set of bare core keys (`project-start:` is the first), a plugin's stages declare the keys they read, and a plugin's own keys are prefixed (`propricer.rate-table:`); the app checks the declaration at registration, which is what turns today's unknown-key notice into a real check. Roles are a rows extension, split in two: rows owns the mechanism (the roles key and qualified names) and knows no project concepts, while the plan format owns the core vocabulary. The rows spec is owned here, so a spec change is a task, not a dependency.

A plugin's keys and roles are **qualified names**: a name, one dot, a name (`propricer.rate-table`). The part before the dot is the plugin. Only keys and role names take the dot; column names and `name=` cells keep today's grammar, and `x-` stays for personal keys no plugin reads. A file that uses a plugin's names when that plugin isn't installed gets an info naming it ("needs the propricer plugin"), never a warning, since files move between people with different plugins.

### 4.2 Compute stages form a graph

Stages depend on each other's outputs, not in a single line: resource detection will read the schedule, and remaining work will feed both the estimate and the schedule. Each stage declares what it reads and adds. The app orders the stages once from those declarations and, for each file, turns off any stage, renderer or exporter whose inputs are missing, with the reason, as it greys out renderers today.

Today's roll-ups become the first plugin, **estimate**; reading the format stays in core. Estimate is then nothing but roll-ups, and schedule doesn't depend on it, so a build without estimate still schedules. Extracting it is the first step of M1, before any scheduling code, so the seams are proven on code that already has tests.

## 5. Scheduling model

An estimate becomes a schedule without retyping: duration defaults to the estimate, dates are derived, and anything a PM pins is an override.

- **Effort and duration.** `est` has the `effort` role. A `dur` column (`duration` role) is derived from effort at one full-time person, and a PM can override it. Once resources exist, derived duration becomes effort divided by the assigned units, only for rows that have an assignment; unassigned rows keep the one-person rule, so nothing reschedules when the resource plugin lands.
- **Dates.** Start and finish are computed by a forward pass from the project start, dependencies, duration and the calendar. A filled `start` cell is a floor, not a fixed date: the effective start is the later of the pin and the dependency-driven start, so a pin can never make the schedule impossible. A pin earlier than its dependencies allow has no effect and gets a diagnostic. An empty cell is derived. A hard pin (must start on) and a pinned finish come later if users ask.
- **Dependencies.** `deps:ref many qualifier=lag:duration`, finish-to-start. Other link types come later. A dependency may point at a parent (summary) row: it waits for the whole subtree to finish, which is how one project follows another in a master plan. A parent that has dependencies of its own passes them down as a floor to every descendant.
- **Critical path.** A backward pass gives slack; zero slack is critical. Deadlines seed the backward pass: a row's late finish is the earlier of the project finish and any deadline downstream of it, so slack is measured against deadlines, and negative slack means the row is already late for one.
- **Parent rows** are summary tasks: start is the earliest child start, finish the latest child finish.
- **Milestones** are rows that carry a milestone marker (`markers: milestone=^`, an ASCII default any keyboard can type, by the same mechanism as `done`). They have zero duration, are points in the flow, and can be dependency targets, including from other files (M3). A milestone with a filled `est` gets a diagnostic. Zero duration alone never makes a milestone, so an unsized task is not mistaken for one.
- **Deadlines** are fixed dates drawn as guide lines on the Gantt. They never move when tasks slip, and every row with negative slack against them is flagged. A deadline is a `deadline` role on a date column, tied to its row (usually a milestone): the row is late when its computed finish passes the date, and its upstream rows carry negative slack. It lives on a row, not in the frontmatter, because the backward pass needs a node to seed. A date that work must be ready by but that no task owns, such as a tradeshow, is a milestone row in the master with a deadline: the milestone shows when the work is ready, the deadline when it must be.
- **Shift right** (delay a task) is mostly settled by the start floor: delaying a task is typing a later start, and if the predecessor slips past it the dependency wins. Whether a lag or a delay duration is also needed is decided with the PMs during M2.

### 5.1 Calendar

Scheduling works in working hours from the project start, and reads time only through a calendar: `add` for working time (every start plus duration, and every lag, goes through it), and `toDate` and `fromDate` to turn hours into dates and back. The first implementation is naive: Monday to Friday, `hpd` hours a day. Holidays change only the date conversions. Per-resource calendars change only `add`, which works while every resource works within the project's working time. Calendar tables replace the naive calendar later, through includes, without changing the scheduler.

The project start is a core frontmatter key, `project-start: 2026-10-05`, not the pinned start of the first row. It is a project-level decision, the naive calendar is project-level, and a mounted plan keeps its own while the master can push it later, which a row pin cannot do. When the key is absent the schedule isn't computed, and a diagnostic says so, with a click fix that sets the key to today's date. The fix may read the clock; analysis never does, so every client computes the same schedule from the same text.

Effort units and the calendar are different questions. `hpd` and `dpw` on the effort column say what `1d` or `1w` of work means; the calendar says when work can happen. The naive calendar takes `hpd` from the effort column, so the two cannot disagree on hours, and ignores `dpw`: it always works Monday to Friday, so a four-day-week effort column still schedules across five days. That is intended, since `dpw` is a unit of effort, not a working pattern; a working pattern is a calendar table, later.

### 5.2 M1 acceptance fixture

A hand-worked fixture: a small project with dependencies, a start floor, a milestone and a deadline, whose dates and slack are computed by hand and checked by the scheduling plugin's tests. It is the counterpart to the §2.10 estimate example. A real export can become a second fixture once a PM offers one.

## 6. Composing plans

A master plan mounts other plans into its tree. Each plan stays its own file, owned and edited by its team, and the master is one document in which all of them can be read, searched and edited.

- **Mounts.** A row with a `mount=` cell (an implicit column, like `parent=`) mounts another plan file: `Product A {#a} | mount=teams/alpha.plan`. The mounted plan's roots become that row's children, after any children the row has in the master. A mount row can sit at any depth, and a mounted plan can mount others. Paths resolve relative to the file that holds the mount row and stay inside the workspace. On the mount row, a missing file is a warning, and a mount loop or a path outside the workspace is an error.
- **Parts, later.** `mount=teams/alpha.plan#backend` mounts one subtree. The syntax is reserved now and resolved later, so a file can be mounted in several places by part. Overlapping mounts (the same lines twice) are refused.
- **Table imports are different.** `include:` in the frontmatter brings in a related table that references point into, such as resources or calendars. It comes with resource and calendar tables.
- **One document, files as segments.** The master view is one composed text: the master's own text, with each mounted file's text in a segment after its mount row. One editor, one undo history, one search. Each file's full text is held separately, a segment is a range of one file, and saving writes each changed file in place. The composed text is never written anywhere, so every file stays canonical.
- **Each file is read as itself**, with its own profile, IDs, columns and diagnostics, and the mounts join the results into one model. Columns line up by role, then by name. IDs are per file, so two teams can both have `#api`.
- **Editing.** Mounted rows are edited where they appear, in the text editor and the grid, and the edit goes to their file. An edit that would cross from one file into another is refused; moving a task between files comes later. Mounted rows keep their own indentation in their file, and the editor shows them indented under the mount row.
- **What the user sees.** Each segment is shaded, with a border, its own line numbers and a header naming its file and showing unsaved changes. The grid shows a file badge on the mount row. Unmount removes the `mount=` cell and never touches the file; deleting the mount row says the file stays as it is; deleting a mounted task names its file.
- **Scheduling.** One time axis, the master's calendar. A mounted plan starts at the later of its own `project-start` and whatever the master pushes on its mount row. The mount row is an ordinary parent, so the master can give a whole project a deadline, a start pin or a dependency on another project. An estimate on the mount row is the master's top-down figure, which the override diagnostic compares with the team's own.
- **Files changing underneath.** Mounted files are read again when the window regains focus or on refresh, and only the lines that changed are applied, outside the undo history. Saving checks that the file on disk is still what was loaded, and asks rather than overwriting.
- **Sharing.** Teams edit their own files directly, without the master; the master only points at them. For now everyone uses one shared folder, synced or a git repository. Mounts by URL, viewing links and permissions come with the server edition. Later, a team's own file may show what the masters mounting it impose ("mounted by portfolio.plan: due 2027-03-01").

## 7. Milestones

Each milestone ends with something a user can do, and builds on the one before. After M1 they run in this order: M3a, M3b, M2, M4.

- **M1 · A PM schedules one file (done).** Plugin seams and vocabulary; today's roll-ups become the estimate plugin, reading stays in core. Dependencies, derived dates, start floors, critical path with deadlines, milestones, naive calendar. Gantt and pin review; IDs, dependencies and milestones editable in the grid.
- **M3a · A workspace of files (next).** Open a folder in Edge; one buffer holds several files, each saved in place. Mounted files are read again when the window regains focus, plus a refresh button.
- **M3b · The PMO sees every project.** Mount rows at any depth (a rows spec change); one editable document, with each file a segment. Roll-up by role and scheduling on the master's axis; search across mounted plans; Gantt zoom. Then the settings editor: choose a profile, see its columns, set `project-start`.
- **M2 · Keeping it current.** Remaining work and progress; updates submitted by the people doing the work. Gantt bar drag and shift right; lag or delay only if needed.
- **M4 · Interop.** Export to ProPricer: effort by WBS, later by labour category. Simple MS Project XML export for customer tracking updates; import later.
- **Later.** Resources across teams (a far-off goal), calendar tables, shared resource pool, Yjs, permissions.

One exception to the order: the ProPricer export is its own plugin and needs only today's estimate, so it can move ahead of M3 if the PMO needs it sooner; it is not planned before M4. ProPricer imports an Excel spreadsheet, and the PMO holds a sample, so the column mapping is settled when the plugin starts.

Importers, MSPDI first, drop what the format does not yet hold (constraint types beyond a start floor, SS/FF/SF links, calendars, computed dates) with a diagnostic naming each dropped item, and gain them as support arrives. Import is lower priority than export, since the tool is for projects going forward. Export stays simple for now: its main use is a PM sending a customer a tracking update, and the export plugin grows stronger as PMs adopt the tool. A pure round trip (import, then export with no edits) should give back the same file, but it is not an acceptance test yet.

## 8. Open questions

Each is settled by the milestone that needs it; none blocks M1.

- Shift right: is a lag or a delay duration needed beyond a later start floor? (M2, with the PMs)
- With mounts and Yjs, who can edit the master vs. a subproject? Working assumption: each file is its own shared document, and edit rights follow the file. (M3)
- Is a first resource a labour category or a named person, and what does the join table look like? (M4 and later)
- What goes in a calendar: holidays, part-time patterns, per-resource exceptions? (Later)
