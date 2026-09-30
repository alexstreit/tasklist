// Single entry point: parseRows, readTree, then the registry's stages. Spec §3.2, PLUGINS.md §5–§6.

import { parseRows } from 'rows';
import type { RowsDocument } from 'rows';
import { fieldName } from './fields';
import type { FieldKey } from './fields';
import type { Registry, StageContext } from './plugin';
import type { Diagnostic, ItemNode, Model } from './types';
import { isPlanName, PLAN_PROFILE } from './profile';
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
    profiles: { plan: PLAN_PROFILE },
    defaultProfile: isPlanName(filename) ? 'plan' : undefined,
  });
  return { doc, tabs };
}

/** `analyze` for the registry's plugins. Synchronous and pure: it never reads the clock. */
export function createAnalyzer(registry: Registry): (text: string, filename?: string) => Model {
  return (text, filename) => {
    const { doc, tabs } = parsePlan(text, filename);
    const tree = readTree(doc, (edited) => parsePlan(edited, filename).doc);
    const diagnostics = [...tree.diagnostics, ...tabs];
    const nodeFields = new Map<FieldKey<unknown>, Map<ItemNode, unknown>>();
    const documentFields = new Map<FieldKey<unknown>, unknown>();
    const model: Model = {
      doc,
      columns: tree.columns,
      roots: tree.items,
      lines: tree.nodes,
      diagnostics,
      inactive: [],
      get: <T>(node: ItemNode, key: FieldKey<T>) => nodeFields.get(key)?.get(node) as T | undefined,
      value: <T>(key: FieldKey<T>) => documentFields.get(key) as T | undefined,
    };
    const columnIndex = new Map(tree.columns.map((c, i) => [c.name, i]));

    // A field is written once a stage that writes it has run; a skipped writer passes its reason on.
    const written = new Set<FieldKey<unknown>>();
    const skippedBecause = new Map<FieldKey<unknown>, string>();
    for (const stage of registry.order) {
      const unread = stage.reads.find((key) => !written.has(key));
      if (unread) {
        const reason = skippedBecause.get(unread) ?? `needs ${fieldName(unread)}, which no stage writes`;
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
        diagnose: (d) => void diagnostics.push(d),
      };
      stage.run(ctx);
      for (const key of stage.writes) written.add(key);
    }

    diagnostics.sort((a, b) => a.line - b.line);
    return model;
  };
}
