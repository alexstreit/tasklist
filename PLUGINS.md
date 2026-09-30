# PLUGINS.md

How plugins, the model and compute stages fit together. Read this before touching `src/core/`, `src/plugins/` or `src/views/`. The working draft is a claude.ai doc; this file is the committed copy. Where it and VISION.md disagree, raise it rather than choosing.

## 1. Summary

A plugin is a manifest the app checks at startup, plus stages that add typed fields to one model. Core reads the format; plugins only compute. Core never imports a plugin; the app hands the registry to core.

- **Plugins declare, the app checks.** A manifest names the plugins it needs and its stages; the roles, keys and markers it reads are the union of its stages' declarations, so they can't drift. Registration fails on a cycle, a field with two writers, or a name outside the plugin's namespace.
- **Fields are typed keys, not properties.** A stage writes `ctx.set(node, start, value)` with a key its plugin exports. Readers import that key, so every dependency between plugins shows up as an import and can be checked.
- **Pinnable values share one shape**, `{ derived?, pin?, effective, mode }`, defined in core. The pin review lists pins from any plugin without knowing any of them.
- **Stages are ordered once, at registration**, from what they read and write. At analyse time a stage whose required roles or keys are missing, or whose inputs didn't run, is skipped, and the model records why.
- **`analyze` is synchronous and pure.** It never reads the clock or the workspace. The shell gathers included files first and hands over a snapshot. With no `project-start`, scheduling is skipped, and a fix writes the date.
- **Core reads the format once.** `readTree` converts every duration to hours and reports plan spec §2.6's diagnostics, as `readPlan` does today; `hours()` is a lookup. Estimate is nothing but roll-ups, so a build without it still schedules.
- **Scheduling works in working hours from the project start**, and every step goes through `calendar.add`, so holidays and later per-resource calendars swap in without touching the scheduler.
- **Interpreters are not a separate phase.** VISION's plugin model has four parts.

## 2. At a glance

```
Workspace ──files──► App shell (holds the buffer, builds the registry)
                          │ text and a file snapshot
                          ▼
  analyze (core, pure, synchronous)
    parsePlan ─► readTree ─► bindVocabulary ─► stage runner
                 items,      roles, keys,      fixed order;
                 done, hours markers           skips, with reasons
                                  ▲                 ▲
                                  └── plugin registry (manifests) ──┘
                          │
                          ▼
  Model: fixed core (doc, lines, roots, bindings, calendar), typed plugin fields, skipped stages
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
     Renderers        Exporters         Editors
     read fields      read fields       edit the buffer through rows
```

The shell gathers files and owns the buffer; `analyze` turns text into a model with no side effects; views only read it, and editors change the text, never the model.

## 3. Plugin manifest

A plugin is one exported object. Everything the app needs to check it is in the manifest; nothing is discovered by running it.

```ts
interface Plugin {
  id: string; // 'estimate', 'schedule', 'propricer'; also the prefix of its qualified names
  requires: string[]; // plugin ids whose fields this one reads
  fields: FieldKey<unknown>[]; // fields its stages write; this plugin owns them
  stages: Stage[];
  renderers?: Renderer[];
  exporters?: Exporter[];
}
```

The roles, keys and markers a plugin reads are not listed on the plugin. The registry computes them as the union of its stages' declarations (§5), so the two lists can't disagree.

The app builds a **registry** from the plugins it ships. `createRegistry(plugins)` throws at startup, with a message naming the plugin, when any of these fail:

- plugin ids are unique, and every `requires` names a registered plugin, with no cycles;
- a bare role, key or marker name a stage declares is in the plan format's **core vocabulary** (`src/core/vocabulary.ts`), which also fixes each core role's column types and each core key's value type;
- a qualified name a stage declares starts with its own plugin's id, so `propricer` can declare `propricer.labour-category` but not `schedule.lag`;
- every field has exactly one owning plugin, and every field a stage reads is owned by that plugin or one it `requires`;
- stages form no cycle through the fields they read and write.

These are programmer errors, so they throw and a test covers each. What a _file_ gets wrong is a diagnostic instead (§6).

The registry is built once and is immutable. There is no runtime loading of third-party plugins; "plugin" is a unit of code organisation that the app ships.

## 4. Model fields

The model has a small fixed core, and every computed value is a typed field that one plugin owns. A value is read with the key its owner exports, never as a property.

```ts
// core
interface FieldKey<T> {
  readonly plugin: string;
  readonly name: string;
  readonly scope: "node" | "document";
  readonly pinnable: "no" | "single" | "by-column";
}
function defineField<T>(
  plugin: string,
  name: string,
  scope: "node" | "document",
): FieldKey<T>;
function definePinnable<T>(plugin: string, name: string): FieldKey<Pinnable<T>>; // node scope
function definePinnableByColumn<T>(
  plugin: string,
  name: string,
): FieldKey<Map<string, Pinnable<T>>>; // node scope

interface Pinnable<T> {
  derived?: T; // what the rest of the file gives; absent when nothing derives it
  pin?: T; // what the row's own cell says, when it says something
  effective: T; // what is used, by the owning stage's rule
  mode: "derived" | "pinned" | "additive"; // 'additive' is estimate's only
}

interface Model {
  // fixed core
  doc: RowsDocument;
  lines: Line[];
  roots: ItemNode[];
  columns: Column[];
  bindings: Bindings; // roles, keys and markers, after profile and file merge
  calendar?: Calendar; // present when project-start is set; renderers use it for dates
  diagnostics: Diagnostic[];
  inactive: Inactive[]; // stages that were skipped, and why
  // plugin fields
  get<T>(node: ItemNode, key: FieldKey<T>): T | undefined;
  value<T>(key: FieldKey<T>): T | undefined; // document-scope fields
}

// plugins/schedule/fields.ts
export const start = definePinnable<WorkHours>("schedule", "start");
// plugins/estimate/fields.ts
export const rollup = definePinnableByColumn<Hours>("estimate", "rollup");
```

- **Why keys and not properties.** One `Model` type with optional properties for every plugin would make every renderer depend on every plugin, and declaration merging would do the same invisibly. A key is an import, so the dependency is visible and the import test (§8) can check it against `requires`.
- **Scopes.** `node` fields hold one value per item; `document` fields hold one value per file (totals, the critical path, the project finish). Estimate's roll-ups are one **by-column** pinnable key, a map from column name to `Pinnable`, because fields are declared statically in the manifest and a file's columns are not.
- **Pinnable values.** `mode` is the only record of whether a value is pinned: "pinned" is `mode !== 'derived'`, never a separate boolean. How `effective` follows from `derived` and `pin` is the owning stage's rule. For estimate, `derived` is the children's sum when any child has a value (today's `childSum` and `childrenHaveValue`) and absent otherwise, so a leaf's estimate is a pin with nothing derived; an override replaces and `+` adds. For schedule, `derived` always exists, and a start pin is a floor, so `effective` can be later than `pin`.
- **The pin review** lists pins that override something: for every node field whose key is pinnable, single or by column, each value with both a `pin` and a `derived`, shown side by side. It knows no plugin, and leaf estimates never appear in it.
- **Pin diagnostics are the owning plugin's.** Schedule's "pin has no effect" is `pin !== undefined && effective > pin`, and "pin equals derived" applies in `pinned` mode only, since in `additive` mode an equal pin doubles rather than repeats. Estimate keeps exactly today's diagnostics.
- **What moves and what stays.** Each column's `effective`, `childSum` and `mode` become the `rollup` map's `Pinnable` (`childSum` is its `derived`; `childrenHaveValue` is `derived !== undefined`). `hasValue` and `doneSum` become estimate fields beside it. `done`, own and inherited, stays in core on `ItemNode`, because plan spec §2.8's inheritance is structure, not arithmetic.
- **Storage** is a `Map` per field keyed by node, which is fine for 500-line files. The interface hides it, so it can change.

## 5. Compute stages

A stage is a pure function that declares everything it reads, and writes only the fields it declares.

```ts
interface Stage {
  id: string; // 'estimate.rollup', 'schedule.forward'
  roles?: { required?: string[]; optional?: string[] };
  keys?: { required?: string[]; optional?: string[] };
  markers?: string[]; // always optional: an unbound marker is never set
  reads: FieldKey<unknown>[];
  writes: FieldKey<unknown>[];
  run(ctx: StageContext): void;
}

interface StageContext {
  model: ModelReader; // get / value, read-only
  bindings: Bindings;
  calendar?: Calendar; // present when project-start is set
  cell(node: ItemNode, role: string): Value | undefined; // undefined when unbound or empty
  hours(node: ItemNode, column: string): number | undefined; // a lookup of readTree's reading
  marked(node: ItemNode, marker: string): boolean;
  set<T>(node: ItemNode, key: FieldKey<T>, value: T): void; // node-scope keys in writes only
  setValue<T>(key: FieldKey<T>, value: T): void; // document-scope keys in writes only
  diagnose(d: Diagnostic): void;
}
```

An optional role is the normal case, not an error: in a file with no start column, `cell(node, 'start')` returns `undefined` and the stage schedules without pins. `set` and `setValue` throw when the key isn't in `writes` or has the other scope. `ctx.calendar` is set whenever a stage requires `project-start`, since the runner skips that stage otherwise, so no stage checks it for `undefined`.

**Ordering.** The registry sorts stages once, topologically by reads and writes. Ties break by registration order, then stage id, so the order is the same on every client. A stage that reads its own output from children (roll-ups) does it inside one `run`; stages never iterate with each other.

**Turning off.** At analyse time the runner walks the order and skips a stage when a required role is unbound, a required key is absent, or a field it reads was never written because its stage was skipped. Each skip is recorded as `{ stage, reason }` in `model.inactive`, with the reason in plain words ("needs a column with the duration role", "needs project-start"). Nothing throws on a file: a skipped stage is a normal outcome.

**Renderers and exporters** declare `requires: FieldKey[]` in place of today's `ColumnRequirement[]`. When a required field's stage was skipped, the app greys them out and shows the reason of the first skipped stage in stage order, as it does today. When the plugin that owns a required field isn't registered at all, the reason is "needs the estimate plugin".

**Diagnostics.** A stage's diagnostics carry `source: pluginId` so the problems list can group them. Codes stay as they are today; a new plugin's codes start with its id (`schedule-pin-no-effect`), which keeps them unique without a registry of codes. A message names the column or key it is about ("the start column", "project-start"), never a bare word shared by a field, a role and a key.

**Purity.** Stages import nothing from the DOM, CodeMirror or the app, and never read the clock. The whole run is synchronous and recomputes everything on each change, which the 500-line timing in Task 21 allows many times over. Incremental compute is not planned.

## 6. Reading

Core reads the format once, in full; plugins only compute. `readPlan` stays essentially as it is and is renamed `readTree`: what moves out of core is the roll-ups, not the reading.

```ts
// core; the app builds this once from the registry
const analyze = createAnalyzer(registry);
analyze(text, filename?, files?)  // files: a snapshot of included files (M3); unused until then
includesOf(text): string[]        // include lines, wherever the spec puts them (subproject rows in M3b); cheap

// inside analyze
parsePlan(text)                           // tabs, parseRows with the plan profile, as today
-> readTree(doc)                          // readPlan as today: items, outline numbers, own and inherited done,
                                          //   hours per summable cell, and the §2.6 diagnostics
-> bindVocabulary(doc.schema, registry)   // roles, keys and markers: Bindings + diagnostics
-> the calendar, if project-start is set
-> run the stages in order
-> Model
```

**Hours are read once.** `readTree` converts every `duration` and `number` cell as `readPlan` does today, and reports the unconvertible-duration and negative-value diagnostics there. `hours(node, column)` looks that result up. Estimate and schedule can both read the same effort cell, and the file still gets each diagnostic once, with no rule for merging duplicates.

**`bindVocabulary`** takes rows' merged `Schema.roles`, the frontmatter keys and the markers, and checks them against the core vocabulary and the registry. It reports, on the line that binds the name:

- a bare role, key or marker name that isn't in the core vocabulary: info, as today's unknown key;
- a qualified name whose plugin isn't registered: info, "needs the propricer plugin";
- a role bound to a column of the wrong type (`effort` on a text column): warning, and the role counts as unbound, so its stages turn off with a reason.

Markers are resolved before this step: rows turns each glyph into its marker name while parsing, which is why `readTree` can read `done` before `bindVocabulary` runs. For markers, `bindVocabulary` only checks the names against the vocabulary; it binds nothing.

**Interpreters** are not a phase. The format's readings (hours, typed values through `cell()`, markers through `marked()`) are core's. A reading that only one plugin needs is a pure function in that plugin, and another plugin that needs it imports it like a field key.

**Estimate is only roll-ups.** It rolls up every `duration` and `number` column, as today, so no existing file changes behaviour, and it declares no roles. The `effort` role is what _scheduling_ uses to find the one column that is effort. Since hours and `done` are core's, a build without estimate still schedules.

**No `project-start`, no schedule.** When the key is absent, no calendar is built and every stage that requires it is skipped with "needs project-start". The schedule plugin's diagnostic offers a click fix that writes today's date into the frontmatter. The fix is an edit, so it may read the clock; `analyze` never does, so two clients either side of midnight compute the same schedule from the same text.

**Includes are gathered before analysis.** The shell calls `includesOf` on the open file, reads what it names, calls `includesOf` on those, and repeats until no new file appears; then it calls `analyze` with the snapshot. A file that can't be read is left out of the snapshot, and the reference to it is the rows validation error it already is.

## 7. Workspace and calendar

Both are interfaces from the start, each with a naive first implementation, so later versions swap in without touching their callers.

### 7.1 Workspace

```ts
interface Workspace {
  readonly can: { list: boolean; watch: boolean; saveInPlace: boolean };
  open(): Promise<OpenedFile | null>; // the user picks a file (or a folder, later)
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<WriteResult>;
  saveAs(text: string, suggested: string): Promise<WriteResult>;
  list(): Promise<string[]>; // single-file: just the open file
  resolve(from: string, ref: string): string; // an include path, relative to a file
  watch?(path: string, onChange: () => void): () => void;
}

type WriteResult =
  | { outcome: "saved"; path: string }
  | { outcome: "downloaded" } // the fallback: nothing was written in place
  | { outcome: "cancelled" }
  | { outcome: "failed"; reason: string };
```

The shell asks what a workspace **can** do, never which kind it is, so no code branches on the implementation. `write` says what actually happened: in the input-and-download fallback it returns `downloaded`, and the unsaved-changes indicator stays on, because nothing on disk changed.

Only the app shell holds the workspace. Core and plugins never see it; they get the snapshot (§6).

The **single-file** implementation is today's Task 4 code moved behind the interface: File System Access where available (`saveInPlace: true`), the input-and-download fallback otherwise (`saveInPlace: false`), and visible failures in framed contexts. `read` of any other path fails with a message saying a folder workspace is needed; nothing uses that until M3.

### 7.2 Calendar

Scheduling works in **working hours from the project start**, a plain number. The calendar is the only thing that adds working time and turns hours into dates and back.

```ts
type WorkHours = number; // working hours since project-start; a finish is exclusive
type Edge = "start" | "end";

interface Calendar {
  readonly start: IsoDate; // project-start; there is no calendar without it
  add(t: WorkHours, hours: number, resource?: string): WorkHours;
  // every start + duration; negative hours for the backward pass
  fromDate(d: IsoDate, edge: Edge): WorkHours;
  // 'start': the first working hour on or after d
  // 'end': the hour just after d's last working hour
  toDate(t: WorkHours, edge: Edge): IsoDate;
  // 'start': the working day hour t falls in
  // 'end': the working day hour t - 1 falls in (an exclusive finish)
  hoursPerDay: number; // for showing durations in days
}
```

The forward and backward passes never add hours themselves: every finish is `calendar.add(start, duration)`, every lag `calendar.add(finish, lag)`. Start pins convert with `fromDate(d, 'start')`; deadlines with `fromDate(d, 'end')`, so a task that finishes at the end of the deadline day is not late. Renderers show starts with `toDate(t, 'start')` and finishes with `toDate(t, 'end')`, so an 8-hour task that starts on Monday also finishes on Monday.

Which edge to use is the caller's decision, not the calendar's: the schedule plugin converts start pins at `'start'` and deadlines at `'end'`, with a one-line comment at each conversion saying why.

- **The naive calendar** is Monday to Friday at `hpd` hours a day, with `hpd` taken from the column bound to `effort` (8 if unset). Its `add` is plain addition.
- **Holidays** change only `toDate` and `fromDate`: the hour axis skips the days that aren't worked.
- **Per-resource calendars** change `add`: it skips the hours on the shared project axis that the resource doesn't work, so a dependency between two resources' tasks still compares numbers on one axis. This holds while every resource works within the project's working time. A resource who works outside it would need a different axis; that is a later redesign, if it ever comes up.

The calendar takes `hpd` from the effort column and ignores `dpw`. `dpw` says how many days `1w` of effort is; the calendar says which days are worked, Monday to Friday until calendar tables arrive. A column with `dpw=4` changes what `1w` means, not which days a task spans.

The analyzer builds the calendar before the stages run and hands it to them in the context, so no stage builds its own.

## 8. Layout and enforcement

Each plugin is a folder, and every modularity rule in VISION §3.1 is checked by lint or a test.

```
src/
  core/                 parsePlan, readTree (with hours and done), includesOf, bindVocabulary, vocabulary,
                        fields and Pinnable, registry, stage runner, createAnalyzer,
                        Workspace and Calendar interfaces, naive calendar
  plugins/
    estimate/           the roll-up stages and their fields; tree, table and TSV move here
    schedule/           (Task 28 onwards)
  views/                renderers that belong to no plugin: the pin review (with scheduling)
  app/                  shell, registry wiring, single-file workspace
  editor/ grid/ buffer/ editing/   unchanged: editors are not plugins
```

Tree, table and TSV go into estimate because each reads estimate's roll-ups; a renderer that read only core fields would go in `views/`.

| Rule                                                                     | Enforced by                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `core/` imports nothing from `plugins/`, `views/`, `app/` or the editors | ESLint `no-restricted-imports` (extends today's core rule)                               |
| A plugin imports only core, `rows` and the plugins in its `requires`     | A test that reads each plugin folder's imports and compares them with its manifest       |
| `views/` import only core                                                | ESLint                                                                                   |
| A stage writes only its declared fields, at their scope                  | `ctx.set` and `ctx.setValue` throw; a test runs every stage on the fixtures              |
| Analysis never reads the clock                                           | ESLint: no `Date.now()` or argument-less `new Date()` in `core/` or in a plugin's stages |
| Renderers and exporters don't import `rows`                              | Today's lint rule, with the new paths                                                    |
| The shell special-cases no plugin                                        | ESLint: `app/` may import `plugins/` only in `app/registry.ts`                           |
| The simple case keeps working                                            | A test that boots the app on one file with only the estimate plugin registered           |

**Editors stay outside the plugin model.** The text editor and grid serve every plugin; typed cell editors are chosen by column type, not by plugin. Plugin input methods (dragging a Gantt bar) wait for M2, and get their own section here then.

## 9. Open questions

- **What does `done` do to dates?** Freeze them, collapse the task, or nothing. It is decided in M2 with remaining work. Schedule can read `done` from core either way, so the answer adds no dependency.
