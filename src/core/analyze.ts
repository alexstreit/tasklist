// Single entry point: parseRows, readTree and bindVocabulary for each file, composition, the
// calendar, then the registry's stages. Spec §2.12, §3.2, PLUGINS.md §5–§6.

import { parseRows, readFlag } from 'rows';
import type { Column as RowsColumn, RowsDocument, Value } from 'rows';
import { bindVocabulary } from './bindings';
import { compose } from './compose';
import type { FileRead } from './compose';
import { naiveCalendar } from './calendar';
import { fieldName } from './fields';
import type { FieldKey } from './fields';
import type { Registry, Stage, StageContext } from './plugin';
import type { Diagnostic, ItemNode, Model } from './types';
import { isPlanName, PLAN_PROFILE, SCHEDULE_PROFILE } from './profile';
import { readTree } from './read';

/**
 * The rows document for a plan buffer (spec §2.1–2.2), with an info for each
 * line whose tabs were converted to 4 spaces.
 */
export function parsePlan(text: string, filename?: string): { doc: RowsDocument; tabs: Diagnostic[] } {
  const tabs: Diagnostic[] = [];
  const lines = text.split('\n').map((line, i) => {
    if (!line.includes('\t')) return line;
    tabs.push({ line: i + 1, severity: 'info', code: 'tabs-converted', message: 'tabs converted to spaces' });
    return line.replace(/\t/g, '    ');
  });
  const doc = parseRows(lines.join('\n'), {
    filename,
    profiles: { plan: PLAN_PROFILE, schedule: SCHEDULE_PROFILE },
    defaultProfile: isPlanName(filename) ? 'plan' : undefined,
  });
  return { doc, tabs };
}

/** The whole-file mounts a document's rows name, as written. A `#part` mount isn't gathered: it shows nothing yet. */
function mountPaths(doc: RowsDocument): string[] {
  return doc.rows.flatMap((row) => (row.mount && row.mount.part === undefined ? [row.mount.path] : []));
}

/** The paths the model's root file mounts, as written, read from the model so the file isn't parsed again. */
export function mountsOf(model: Model): string[] {
  return mountPaths(model.doc);
}

/** The paths a gathered file mounts, as written. It parses the file, so the shell caches the result by text. */
export function readMounts(text: string, path: string): string[] {
  return mountPaths(parsePlan(text, path).doc);
}

/** What `analyze` is told besides the text (spec §3.2). */
export interface AnalyzeOptions {
  /** The file's name; none for a new document. */
  filename?: string;
  /**
   * The shell's snapshot of mounted files, by resolved path: the text, or null when it can't be
   * read. Absent when the workspace can't read other files, so every mount says to open the folder.
   */
  files?: ReadonlyMap<string, string | null>;
  /** The workspace's resolve, for the mount paths: relative to a file; throws outside the folder. */
  resolve?: (from: string, ref: string) => string;
  /** The buffer version the text was read at, recorded on the model (spec §3.7); 0 when absent. */
  version?: number;
}

/**
 * Root column index → the mounted file's own column index, or -1 (PLUGINS.md §6). Two passes: by
 * role, each root column with a role takes the mounted column bound to that role; then by name,
 * among the mounted columns not already taken. A mounted column maps to at most one root column.
 */
function mapColumns(root: FileRead, own: FileRead): number[] {
  const columns = root.tree.columns;
  const ownIndex = (name: string | undefined) => own.tree.columns.findIndex((c) => c.name === name);
  const out = columns.map(() => -1);
  const taken = new Set<number>();
  columns.forEach((column, i) => {
    for (const [role, name] of root.bindings.roles) {
      if (name !== column.name) continue;
      const j = ownIndex(own.bindings.roles.get(role));
      if (j < 0 || taken.has(j)) continue;
      out[i] = j;
      taken.add(j);
      return;
    }
  });
  columns.forEach((column, i) => {
    const j = ownIndex(column.name);
    if (out[i] >= 0 || j < 0 || taken.has(j)) return;
    out[i] = j;
    taken.add(j);
  });
  return out;
}

/**
 * `analyze` for the registry's plugins. Synchronous and pure: it never reads the clock or the
 * workspace. Each file is parsed and read once, by its own profile, and kept while its text is
 * unchanged, so typing in the root parses no other file.
 */
export function createAnalyzer(registry: Registry): (text: string, options?: AnalyzeOptions) => Model {
  const plugins = new Set(registry.plugins.map((p) => p.id));
  const plugin = new Map(registry.plugins.flatMap((p) => p.stages.map((s) => [s, p.id] as const)));
  // The reads of the last analysis, by path; the root's under its filename, or '' when it has none.
  let cache = new Map<string, FileRead>();
  return (text, { filename, files, resolve, version = 0 } = {}) => {
    const used = new Map<string, FileRead>();
    const readFile = (path: string, content: string, name: string | undefined): FileRead => {
      let read = used.get(path) ?? cache.get(path);
      if (read?.text !== content) {
        const { doc, tabs } = parsePlan(content, name);
        const tree = readTree(doc, (edited) => parsePlan(edited, name).doc);
        const { bindings, diagnostics: vocabulary } = bindVocabulary(doc, plugins);
        read = { text: content, doc, tree, bindings, diagnostics: [...tree.diagnostics, ...vocabulary, ...tabs] };
      }
      used.set(path, read);
      return read;
    };
    const rootPath = filename ?? '';
    const root = readFile(rootPath, text, filename);
    const composed = compose(rootPath, root, { files, resolve }, (path, content) => readFile(path, content, path));
    cache = used;

    const { doc, bindings } = root;
    const fileOf = (node: ItemNode) => composed.files.get(node.file)!;
    // The root's columns are the model's; each mounted file's map onto them.
    const maps = new Map<string, number[]>();
    for (const [path, file] of composed.files) if (path !== rootPath) maps.set(path, mapColumns(root, file.read));
    const column = (node: ItemNode, index: number) => {
      const own = maps.get(node.file)?.[index] ?? index;
      return own < 0 ? null : own;
    };
    const field = (node: ItemNode, index: number) => {
      const own = column(node, index);
      return own === null ? null : (node.fields[own] ?? null);
    };

    const diagnostics: Diagnostic[] = [...root.diagnostics, ...composed.diagnostics];
    for (const [path, file] of composed.files) if (path !== rootPath) diagnostics.push(...file.read.diagnostics.map((d) => ({ ...d, file: path })));
    const rowsColumn = (name: string | undefined) => doc.schema.columns.find((c) => c.name === name);
    const projectStart = bindings.keys.get('project-start');
    // The naive calendar's day is the effort column's hpd (PLUGINS.md §7.2).
    const calendar = projectStart === undefined ? undefined : naiveCalendar(projectStart, rowsColumn(bindings.roles.get('effort'))?.hpd ?? 8);
    // Node fields are kept by each node's place in the composed tree, an array per key: stages set every row.
    const place = new Map<ItemNode, number>();
    for (const file of composed.files.values()) for (const node of file.nodes.values()) place.set(node, place.size);
    const nodeFields = new Map<FieldKey<unknown>, unknown[]>();
    const documentFields = new Map<FieldKey<unknown>, unknown>();
    const model: Model = {
      file: rootPath,
      doc,
      files: new Map([...composed.files].map(([path, file]) => [path, { doc: file.read.doc, lines: file.lines }])),
      columns: root.tree.columns,
      roots: composed.roots,
      lines: composed.files.get(rootPath)!.lines,
      bindings,
      ...(calendar ? { calendar } : {}),
      diagnostics,
      inactive: [],
      version,
      fields: () => [...written],
      field,
      column,
      get: <T>(node: ItemNode, key: FieldKey<T>) => nodeFields.get(key)?.[place.get(node) ?? -1] as T | undefined,
      value: <T>(key: FieldKey<T>) => documentFields.get(key) as T | undefined,
    };
    const columnIndex = new Map(root.tree.columns.map((c, i) => [c.name, i]));

    // Each file's column for each role and marker, looked up once per analysis: stages ask for every row.
    const markerColumns = new Map<string, RowsColumn | undefined>();
    const roleColumns = new Map<string, Map<string, number | undefined>>();
    /** The typed value of the node's cell for `role`, in its own file. */
    const cell = (node: ItemNode, role: string): Value | undefined => {
      let columns = roleColumns.get(node.file);
      if (!columns) roleColumns.set(node.file, (columns = new Map()));
      if (!columns.has(role)) {
        const { doc: own, bindings: ownBindings } = fileOf(node).read;
        columns.set(role, own.schema.columns.find((c) => c.name === ownBindings.roles.get(role))?.index);
      }
      const index = columns.get(role);
      return (index !== undefined && node.row.cells[index]?.value) || undefined;
    };
    // A field is written once a stage that writes it has run; a skipped writer passes its reason on.
    const written = new Set<FieldKey<unknown>>();
    const skippedBecause = new Map<FieldKey<unknown>, string>();
    const skipReason = (stage: Stage): string | null => {
      const role = stage.roles?.required?.find((r) => !bindings.roles.has(r));
      if (role) return bindings.mistyped.get(role) ?? `needs a column with the ${role} role`;
      const key = stage.keys?.required?.find((k) => !bindings.keys.has(k));
      if (key) return bindings.mistypedKeys.get(key) ?? `needs ${key}`;
      const unread = stage.reads.find((k) => !written.has(k));
      if (unread) return skippedBecause.get(unread) ?? `needs ${fieldName(unread)}, which no stage writes`;
      return null;
    };
    for (const stage of registry.order) {
      const reason = skipReason(stage);
      if (reason !== null) {
        model.inactive.push({ stage: stage.id, reason });
        for (const key of stage.writes) if (!written.has(key) && !skippedBecause.has(key)) skippedBecause.set(key, reason);
        continue;
      }
      const writable = (key: FieldKey<unknown>, scope: 'node' | 'document'): void => {
        if (!stage.writes.includes(key)) throw new Error(`stage "${stage.id}" writes ${fieldName(key)}, which it doesn't declare`);
        if (key.scope !== scope) throw new Error(`stage "${stage.id}" writes ${fieldName(key)} with ${scope === 'node' ? 'set' : 'setValue'}, but it is a ${key.scope}-scope field`);
      };
      // The node fields this stage has written so far: checked once each, since stages set every row.
      const own = new Map<FieldKey<unknown>, unknown[]>();
      const ctx: StageContext = {
        model,
        bindings,
        bindingsOf: (node) => fileOf(node).read.bindings,
        ...(calendar ? { calendar } : {}),
        cell,
        targets: (node, role) => {
          const value = cell(node, role);
          if (value?.type !== 'ref') return [];
          const { nodes } = fileOf(node);
          return value.refs.flatMap((ref) => {
            const target = ref.target && nodes.get(ref.target);
            return target ? [target] : [];
          });
        },
        marked: (node, marker) => {
          const own = fileOf(node).read.doc;
          const key = `${node.file}\n${marker}`;
          if (!markerColumns.has(key)) markerColumns.set(key, own.schema.markers.find((m) => m.name === marker)?.column);
          const column = markerColumns.get(key);
          return column ? readFlag(own, node.row, column) === true : false;
        },
        hours: (node, column) => field(node, columnIndex.get(column) ?? -1)?.amount ?? undefined,
        set: (node, key, value) => {
          let values = own.get(key);
          if (!values) {
            writable(key, 'node');
            nodeFields.set(key, (values = []));
            own.set(key, values);
          }
          const at = place.get(node);
          if (at === undefined) throw new Error(`stage "${stage.id}" sets ${fieldName(key)} on a node that isn't in the model`);
          values[at] = value;
        },
        setValue: (key, value) => {
          writable(key, 'document');
          documentFields.set(key, value);
        },
        diagnose: (node, d) => void diagnostics.push({ ...d, source: plugin.get(stage)!, ...(node && node.file !== rootPath ? { file: node.file } : {}) }),
      };
      stage.run(ctx);
      for (const key of stage.writes) written.add(key);
    }

    // The root file's first, then each mounted file's in composed order; by line within each.
    const rank = new Map([...composed.files.keys()].map((path, i) => [path, i]));
    diagnostics.sort((a, b) => (a.file === undefined ? 0 : rank.get(a.file)!) - (b.file === undefined ? 0 : rank.get(b.file)!) || a.line - b.line);
    return model;
  };
}
