# VISION.md

Where the plan tool is going, and the rules that keep it maintainable on the way. The working draft is a claude.ai doc; this file is the committed copy. Every task in `TASKS.md` names the milestone it serves. Don't build ahead of it.

## 1. Purpose and scope

The tool grows, one plugin at a time, into a replacement for MS Project for a PMO: estimating, scheduling, progress tracking and cross-project roll-up, all over plain-text rows files that live in git. It is project-as-code: a text editor with elements of a sparse spreadsheet, where plugins give the columns meaning.

The Project Server functions it should cover, in the PMO's order of need:

1. Cross-project roll-up
2. Progress updates submitted by PMs
3. A shared resource pool, later
4. Permissions, only if needed

The milestones (§6) run in a different order, by who has to be won over first: the PMO is the author, so buy-in from the PMs comes before roll-up.

**Out of scope:** timesheets; pricing and cost (ProPricer does this, and the tool exports to it); automatic resource levelling (detection only); writing binary `.mpp` (MS Project XML instead). Gantt PDFs can come later, possibly as a plugin.

**Deployment:** a serverless edition (browser today, Tauri later for folders and linked files) and a server edition (Yjs) should co-exist. Git works in both. No design decision may rule out real-time collaboration.

## 2. Users

Three roles share the same files.

| User            | Job                                | What they need from the tool                                                  | Served by                                 |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Scheduling PM   | Runs projects to a schedule        | Dependencies, dates, critical path, milestones, deadlines, keeping it current | M1, M2 (next)                             |
| PMO             | Oversees all projects, prices work | Roll-up across projects, progress updates, export to ProPricer                | M3, M4                                    |
| Estimating lead | Sizes work                         | Estimates that roll up (what the tool does today)                             | Done; must keep working as the rest grows |

The scheduling PM is a hypothetical persona for now: the author tests as that user and shows the PMs a prototype before asking anything of them. The tool is for projects going forward; existing schedules stay where they are (MS Project, or BigPicture for Jira).

One file serves all three roles. The estimator fills `est`; the PM later adds dependencies and pins in the same file, and the estimate stays live. A handover between owners uses subproject includes rather than a copy.

## 3. Principles

The file holds only what a person decided; everything else is computed, and every part of the code can be understood on its own.

1. **Text holds decisions.** Computed values (totals, dates, slack) are never written into the file. Written values would make git diffs noise and make Yjs clients fight over numbers nobody typed. They appear in the model, renderers and exports.
2. **Derived or pinned.** Any computed value a person may fix follows the `est` pattern: an empty cell is derived, a filled cell is an override. The model carries both the derived and the effective value of every pinnable field: renderers show the derived value greyed beside a pin, and a pin review lists every pin against its derived counterpart. A pin equal to its derived value, or one with no effect, gets a diagnostic. Nothing about pin history is stored.
3. **One parser.** rows reads every file. Plugins read the `RowsDocument` and never parse text themselves, so every part of the app agrees on lines, spans and edits.
4. **Roles are the contract.** A plugin reads columns by role, not by name. The file names its columns freely; `roles:` binds them.
5. **Nothing is repaired on read.** Fixes are explicit edit operations, and each is deterministic (already true, and required for Yjs).
6. **Nothing knows where files live.** Files and includes are reached through one workspace interface. The interface and its single-file browser implementation land in M1, with the estimate plugin extraction; the Tauri folder workspace and the server come later behind the same interface.
7. **Collaboration stays possible.** Sync happens on the text; each client parses and computes locally. The known failure cases are an offline merge and a tool edit that rewrites a line someone is typing in. Two mitigations: typed cell editors replace the whole cell span, so concurrent edits concatenate rather than interleave, and diagnostics run after every remote update, so a cell that stops parsing is flagged.

### 3.1 Modularity rules

These keep the code from turning into spaghetti as plugins arrive. Each is enforced by lint or by a test, except the renderer rule, which is checked in review.

- Each plugin is a folder that imports only core, rows' entry point and the plugins it declares as dependencies. No cycles.
- A plugin declares the roles and frontmatter keys it reads, the model fields it adds, and the plugins it needs. The app checks these at registration.
- The app shell special-cases no plugin, as it already special-cases no renderer.
- Renderers and exporters read computed fields only. A renderer never derives a value another renderer or exporter might also need; that belongs in a compute stage.
- Anything that will get a better implementation later (calendar, workspace) sits behind an interface from the start, with the naive version as its first implementation.
- Each plugin has its own tests against fixtures. The §2.10 example stays the reference test for the estimate plugin.
- One test boots the app on a single file with no workspace features, and stays green for good: the simple use case is not lost to multi-user work.

## 4. Plugin model

A plugin is up to five parts that read columns by role and add to one shared model. It never brings its own parser.

| Part          | Reads                          | Produces                             | Example                                  |
| ------------- | ------------------------------ | ------------------------------------ | ---------------------------------------- |
| Interpreter   | `RowsDocument` and bound roles | Typed values per row                 | Durations as hours; deps as links        |
| Compute stage | The model so far               | New fields on nodes, and diagnostics | Roll-ups; start, finish, slack           |
| Input method  | Model and `doc`                | Text edits through rows' edit API    | Typed cell editors; dragging a Gantt bar |
| Renderer      | Computed fields                | A view                               | Tree, table, Gantt                       |
| Exporter      | Computed fields                | A file or clipboard text             | TSV, ProPricer, MS Project XML           |

### 4.1 Roles

A role is what a column means to a plugin, separate from its name and type. The file binds roles to columns with a `roles:` key, the same pattern as `nest: parent` and `markers: done=~`:

```
roles: effort=est, duration=dur, start=start, deps=deps
```

Profiles supply the defaults, so a user who never changes columns never sees the key.

The work is split in two. **rows owns the mechanism**: the `roles:` key and qualified names, and it knows no project concepts. **The plan format owns the vocabulary**: the core roles `effort`, `duration`, `start`, `deps` and `deadline` stay bare, so two plugins never collide and no role is renamed after files exist. Frontmatter keys follow the same rule: the plan format owns a fixed set of bare core keys (`project-start:` is the first), a plugin declares the keys it reads, and the app checks the declaration at registration. The rows spec is owned here, so a spec change is a task, not a dependency.

A plugin's own keys and roles are **qualified names**: a name, one dot, a name (`propricer.rate-table`, `propricer.labour-category`). The part before the dot is the plugin. Only keys and role names take the dot; column names and `name=` cells keep today's grammar, and `x-` stays for personal keys no plugin reads. A file that uses a plugin's names when that plugin isn't installed gets an info naming it ("needs the propricer plugin"), never a warning, since files move between people with different plugins.

### 4.2 Compute stages form a graph

Stages depend on each other's outputs, not in a single line: scheduling reads the estimate roll-ups, resource detection reads the schedule, remaining work feeds both. Each stage declares what it reads and adds. The app orders the stages from those declarations and turns off any stage, renderer or exporter whose inputs are missing, as it greys out renderers today.

The current plan core becomes the first plugin, **estimate**. Extracting it is the first step of M1, before any scheduling code, so the seams are proven on code that already has tests.

## 5. Scheduling model

An estimate becomes a schedule without retyping: duration defaults to the estimate, dates are derived, and anything a PM pins is an override.

- **Effort and duration.** `est` has the `effort` role. A `dur` column (`duration` role) is derived from effort at one full-time person, and a PM can override it. Once resources exist, derived duration becomes effort divided by the assigned units, only for rows that have an assignment; unassigned rows keep the one-person rule, so nothing reschedules when the resource plugin lands.
- **Dates.** Start and finish are computed by a forward pass from the project start, dependencies, duration and the calendar. A filled `start` cell is a floor, not a fixed date: the effective start is the later of the pin and the dependency-driven start, so a pin can never make the schedule impossible. A pin earlier than its dependencies allow has no effect and gets a diagnostic. An empty cell is derived. A hard pin (must start on) and a pinned finish come later if users ask.
- **Dependencies.** `deps:ref many qualifier=lag:duration`, finish-to-start. Other link types come later. A dependency may not point at a parent (summary) row: a summary's dates are derived from its children, so a link into it would have to push every child, and scheduling practice flags such links as defects. The tool refuses them with a diagnostic; revisit if a PM's project needs them.
- **Critical path.** A backward pass gives slack; zero slack is critical. Deadlines seed the backward pass: a row's late finish is the earlier of the project finish and any deadline downstream of it, so slack is measured against deadlines, and negative slack means the row is already late for one.
- **Parent rows** are summary tasks: start is the earliest child start, finish the latest child finish.
- **Milestones** are rows that carry a milestone marker (`markers: milestone=^`, an ASCII default any keyboard can type, by the same mechanism as `done`). They have zero duration, are points in the flow, and can be dependency targets, including from other files (M3). A milestone with a filled `est` gets a diagnostic. Zero duration alone never makes a milestone, so an unsized task is not mistaken for one.
- **Deadlines** are fixed dates drawn as guide lines on the Gantt. They never move when tasks slip, and every row with negative slack against them is flagged. A deadline is a `deadline` role on a date column, tied to its row (usually a milestone): the row is late when its computed finish passes the date, and its upstream rows carry negative slack. It lives on a row, not in the frontmatter, because the backward pass needs a node to seed. Deadlines tied to no task come with tables in M3, as a deadlines table the plan includes.
- **Shift right** (delay a task) is mostly settled by the start floor: delaying a task is typing a later start, and if the predecessor slips past it the dependency wins. Whether a lag or a delay duration is also needed is decided with the PMs during M2.

### 5.1 Calendar

Scheduling reads time only through a calendar interface: add working time to a date, count working time between two dates, and whether a day is a working day. The first implementation is naive: Monday to Friday, `hpd` hours a day, from the project start. Calendar tables (holidays, per-resource exceptions) replace it later, through includes, without changing the scheduler.

The project start is a core frontmatter key, `project-start: 2026-10-05`, not the pinned start of the first row. It is a project-level decision, the naive calendar is project-level, and under includes a subproject file sets its own or inherits the master's, which a row pin cannot do. When the key is absent the project starts today, and a diagnostic says so, with a click fix that sets the key to today's date.

Effort conversion (`hpd`, `dpw` on the column) and the calendar stay separate: the column says what `1d` of work means; the calendar says when work can happen. The naive calendar uses the same numbers, so they agree until someone changes one.

### 5.2 M1 acceptance fixture

A hand-worked fixture: a small project with dependencies, a start floor, a milestone and a deadline, whose dates and slack are computed by hand and checked by the scheduling plugin's tests. It is the counterpart to the §2.10 estimate example. A real export can become a second fixture once a PM offers one.

## 6. Milestones

Each milestone ends with something a user can do, and builds on the one before.

- **M1 · A PM schedules one file (next).** Plugin seams, column roles and the workspace interface; today's core becomes the estimate plugin. Dependencies, derived dates, start floors, critical path with deadlines, milestones, naive calendar. A read-only Gantt renderer. IDs and dependencies editable in the grid.
- **M2 · The PM keeps it current.** Remaining work and progress; updates submitted by PMs. Gantt bar drag and shift right; lag or delay only if the PMs need it.
- **M3a · A workspace of files.** Tauri folder workspace, or the browser File System Access API as a step before it. On the critical path for anything the PMO uses.
- **M3b · The PMO sees every project.** Includes and subproject rows; cross-project roll-up and dependencies. Needs the rows spec change for indented includes (a task; the spec is owned here).
- **M4 · Interop.** Export to ProPricer: effort by WBS, later by labour category. Simple MS Project XML (MSPDI) export for customer tracking updates; import later, dropping what it can't hold.
- **Later.** Calendar tables, resource tables with overallocation detection, shared resource pool, Yjs, permissions.

The ProPricer export is its own plugin and needs only today's estimate, so it can move ahead of M3 if the PMO needs it sooner; it is not planned before M4. ProPricer imports an Excel spreadsheet, and the PMO holds a sample, so the column mapping is settled when the plugin starts.

Export stays simple for now: its main use is a PM sending a customer a tracking update, and the export plugin grows stronger as PMs adopt the tool. Importers, MSPDI first, drop what the format does not yet hold (constraint types beyond a start floor, SS/FF/SF links, calendars, computed dates) with a diagnostic naming each dropped item, and gain them as support arrives. Import is lower priority than export. A pure round trip (import, then export with no edits) should give back the same file, but it is not an acceptance test yet.

## 7. Open questions

Each is settled by the milestone that needs it; none blocks M1.

- Shift right: is a lag or a delay duration needed beyond a later start floor? (M2, with the PMs)
- With includes and Yjs, who can edit the master vs. a subproject? Working assumption: each file is its own shared document, and edit rights follow the file. (M3)
- Is a first resource a labour category or a named person, and what does the join table look like? (M4 and later)
- What goes in a calendar: holidays, part-time patterns, per-resource exceptions? (Later)
