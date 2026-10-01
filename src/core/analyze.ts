// Single entry point: parseRows, readTree, bindVocabulary, the calendar, then the registry's stages.
// Spec §3.2, PLUGINS.md §5–§6.

import { parseRows, readFlag } from 'rows';
import type { RowsDocument } from 'rows';
import { bindVocabulary } from './bindings';
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

/** The include paths rows reports, as written; `[]` when there are none. Cheap enough to run before every analysis. */
export function includesOf(text: string): string[] {
  return parsePlan(text).doc.schema.includes.map((i) => i.path);
}

/** What `analyze` is told besides the text (spec §3.2). */
export interface AnalyzeOptions {
  /** The file's name; none for a new document. */
  filename?: string;
  /** The shell's snapshot of included files, by path (M3); unused until then. */
  files?: ReadonlyMap<string, string>;
  /** The buffer version the text was read at, recorded on the model (spec §3.7); 0 when absent. */
  version?: number;
}

/** `analyze` for the registry's plugins. Synchronous and pure: it never reads the clock or the workspace. */
export function createAnalyzer(registry: Registry): (text: string, options?: AnalyzeOptions) => Model {
  const plugins = new Set(registry.plugins.map((p) => p.id));
  const plugin = new Map(registry.plugins.flatMap((p) => p.stages.map((s) => [s, p.id] as const)));
  return (text, { filename, version = 0 } = {}) => {
    const { doc, tabs } = parsePlan(text, filename);
    const tree = readTree(doc, (edited) => parsePlan(edited, filename).doc);
    const { bindings, diagnostics: vocabulary } = bindVocabulary(doc, plugins);
    const diagnostics = [...tree.diagnostics, ...vocabulary, ...tabs];
    const rowsColumn = (name: string | undefined) => doc.schema.columns.find((c) => c.name === name);
    const projectStart = bindings.keys.get('project-start');
    // The naive calendar's day is the effort column's hpd (PLUGINS.md §7.2).
    const calendar = projectStart === undefined ? undefined : naiveCalendar(projectStart, rowsColumn(bindings.roles.get('effort'))?.hpd ?? 8);
    const nodeFields = new Map<FieldKey<unknown>, Map<ItemNode, unknown>>();
    const documentFields = new Map<FieldKey<unknown>, unknown>();
    const model: Model = {
      doc,
      columns: tree.columns,
      roots: tree.items,
      lines: tree.nodes,
      bindings,
      ...(calendar ? { calendar } : {}),
      diagnostics,
      inactive: [],
      version,
      fields: () => [...written],
      get: <T>(node: ItemNode, key: FieldKey<T>) => nodeFields.get(key)?.get(node) as T | undefined,
      value: <T>(key: FieldKey<T>) => documentFields.get(key) as T | undefined,
    };
    const columnIndex = new Map(tree.columns.map((c, i) => [c.name, i]));

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
      const ctx: StageContext = {
        model,
        bindings,
        ...(calendar ? { calendar } : {}),
        cell: (node, role) => {
          const column = rowsColumn(bindings.roles.get(role));
          return (column && node.row.cells[column.index]?.value) ?? undefined;
        },
        marked: (node, marker) => {
          const column = doc.schema.markers.find((m) => m.name === marker)?.column;
          return column ? readFlag(doc, node.row, column) === true : false;
        },
        hours: (node, column) => node.fields[columnIndex.get(column) ?? -1]?.amount ?? undefined,
        set: (node, key, value) => {
          writable(key, 'node');
          let values = nodeFields.get(key);
          if (!values) nodeFields.set(key, (values = new Map()));
          values.set(node, value);
        },
        setValue: (key, value) => {
          writable(key, 'document');
          documentFields.set(key, value);
        },
        diagnose: (d) => void diagnostics.push({ ...d, source: plugin.get(stage)! }),
      };
      stage.run(ctx);
      for (const key of stage.writes) written.add(key);
    }

    diagnostics.sort((a, b) => a.line - b.line);
    return model;
  };
}
