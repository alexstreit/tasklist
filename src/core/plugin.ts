// Plugins, stages and the registry (PLUGINS.md §3 and §5). A plugin is a
// manifest the app checks at startup; its stages add typed fields to the model.

import type { Value } from 'rows';
import type { Bindings } from './bindings';
import type { Calendar } from './calendar';
import { fieldName } from './fields';
import type { FieldKey } from './fields';
import type { Diagnostic, Exporter, ItemNode, Model, ModelReader, Renderer } from './types';
import { CORE_KEYS, CORE_MARKERS, CORE_ROLES, pluginOf } from './vocabulary';

export interface StageContext {
  /** Read-only: the composed tree and the fields earlier stages wrote. */
  model: ModelReader;
  /** The root file's. */
  bindings: Bindings;
  /** The bindings of the file the node is in: the root's, or a mounted file's own. */
  bindingsOf(node: ItemNode): Bindings;
  /** Present when project-start is set, so always for a stage that requires it. */
  calendar?: Calendar;
  /** The typed value of the row's cell in the column bound to `role` in the row's own file; undefined when unbound, empty or unreadable. */
  cell(node: ItemNode, role: string): Value | undefined;
  /**
   * The rows the references in the row's `role` cell point at, in the row's own file: one per
   * reference that resolves, in the cell's order. References never cross files.
   */
  targets(node: ItemNode, role: string): ItemNode[];
  /**
   * A summable cell as `readTree` read it, in hours (duration) or as the number, without its sign;
   * undefined when empty or unreadable. `column` is a root column's name, mapped to the node's own file.
   */
  hours(node: ItemNode, column: string): number | undefined;
  /** The row's own marker in its own file, or its `NAME=true` cell; false for a marker that file doesn't use. */
  marked(node: ItemNode, marker: string): boolean;
  /** Node-scope keys in the stage's `writes` only; throws otherwise. */
  set<T>(node: ItemNode, key: FieldKey<T>, value: T): void;
  /** Document-scope keys in the stage's `writes` only; throws otherwise. */
  setValue<T>(key: FieldKey<T>, value: T): void;
  /**
   * A diagnostic about `node`, whose line and spans are in the node's own file; core sets its
   * `file` from the node. Null for a document-level diagnostic on the root file.
   */
  diagnose(node: ItemNode | null, d: Diagnostic): void;
}

/** A pure function that declares everything it reads and writes only what it declares. */
export interface Stage {
  /** `estimate.rollup`, `schedule.forward`. */
  id: string;
  /** A stage is skipped when a required role is unbound. */
  roles?: { required?: string[]; optional?: string[] };
  /** A stage is skipped when a required key is absent. */
  keys?: { required?: string[]; optional?: string[] };
  /** Always optional: an unbound marker is never set. */
  markers?: string[];
  reads: FieldKey<unknown>[];
  writes: FieldKey<unknown>[];
  run(ctx: StageContext): void;
}

export interface Plugin {
  /** `estimate`, `schedule`; also the prefix of its qualified names. */
  id: string;
  /** Plugin ids whose fields this one reads. */
  requires: string[];
  /** The fields its stages write; this plugin owns them. */
  fields: FieldKey<unknown>[];
  stages: Stage[];
  renderers?: Renderer[];
  exporters?: Exporter[];
}

/** The checked, immutable set of plugins the app ships. */
export interface Registry {
  readonly plugins: readonly Plugin[];
  /** Every stage, in the order they run. */
  readonly order: readonly Stage[];
  readonly renderers: readonly Renderer[];
  readonly exporters: readonly Exporter[];
  /** The plugin that owns `key`, or undefined when it isn't registered. */
  owner(key: FieldKey<unknown>): Plugin | undefined;
}

/** The roles, keys and markers a plugin reads: the union of its stages' declarations. */
export function pluginReads(plugin: Plugin): { roles: Set<string>; keys: Set<string>; markers: Set<string> } {
  const all = (pick: (s: Stage) => string[] | undefined) => new Set(plugin.stages.flatMap((s) => pick(s) ?? []));
  return {
    roles: all((s) => [...(s.roles?.required ?? []), ...(s.roles?.optional ?? [])]),
    keys: all((s) => [...(s.keys?.required ?? []), ...(s.keys?.optional ?? [])]),
    markers: all((s) => s.markers),
  };
}

/**
 * Checks the manifests and orders the stages once. Throws, naming the plugin, when an id repeats,
 * a `requires` names no registered plugin or forms a cycle, a bare role, key or marker name it reads
 * isn't in the core vocabulary or a qualified one isn't its own, a field has two owners, a stage
 * writes a field its plugin doesn't own or reads one from a plugin it doesn't require, or stages
 * form a cycle through the fields they read and write.
 */
export function createRegistry(plugins: Plugin[]): Registry {
  const fail = (plugin: Plugin, problem: string): never => {
    throw new Error(`plugin "${plugin.id}": ${problem}`);
  };

  const byId = new Map<string, Plugin>();
  for (const plugin of plugins) {
    if (byId.has(plugin.id)) fail(plugin, 'is registered twice');
    byId.set(plugin.id, plugin);
  }
  for (const plugin of plugins) {
    for (const id of plugin.requires) if (!byId.has(id)) fail(plugin, `requires "${id}", which is not registered`);
  }
  // A requires cycle: a plugin reaches itself.
  const reaches = (from: Plugin, target: Plugin, seen = new Set<Plugin>()): boolean =>
    from.requires.some((id) => {
      const next = byId.get(id)!;
      if (next === target) return true;
      if (seen.has(next)) return false;
      seen.add(next);
      return reaches(next, target, seen);
    });
  for (const plugin of plugins) if (reaches(plugin, plugin)) fail(plugin, 'requires itself through a cycle');

  for (const plugin of plugins) {
    const reads = pluginReads(plugin);
    const vocabulary = [
      ['role', reads.roles, Object.keys(CORE_ROLES)],
      ['key', reads.keys, Object.keys(CORE_KEYS)],
      ['marker', reads.markers, CORE_MARKERS],
    ] as const;
    for (const [what, names, core] of vocabulary) {
      for (const name of names) {
        const owner = pluginOf(name);
        if (owner === null && !core.includes(name)) fail(plugin, `reads ${what} "${name}", which is not in the core vocabulary`);
        if (owner !== null && owner !== plugin.id) fail(plugin, `reads ${what} "${name}", which belongs to plugin "${owner}"`);
      }
    }
  }

  const owners = new Map<FieldKey<unknown>, Plugin>();
  for (const plugin of plugins) {
    for (const key of plugin.fields) {
      const other = owners.get(key);
      if (other) fail(plugin, `field ${fieldName(key)} is already owned by plugin "${other.id}"`);
      owners.set(key, plugin);
    }
  }
  for (const plugin of plugins) {
    for (const stage of plugin.stages) {
      for (const key of stage.writes) {
        if (owners.get(key) !== plugin) fail(plugin, `stage "${stage.id}" writes ${fieldName(key)}, which the plugin doesn't own`);
      }
      for (const key of stage.reads) {
        const owner = owners.get(key);
        if (owner !== plugin && !(owner && plugin.requires.includes(owner.id))) {
          fail(plugin, `stage "${stage.id}" reads ${fieldName(key)}, which is owned by neither the plugin nor one it requires`);
        }
      }
    }
  }

  const order = orderStages(plugins, fail);
  return {
    plugins: [...plugins],
    order,
    renderers: plugins.flatMap((p) => p.renderers ?? []),
    exporters: plugins.flatMap((p) => p.exporters ?? []),
    owner: (key) => owners.get(key),
  };
}

/** Topological by reads and writes; ties by registration order, then stage id. */
function orderStages(plugins: Plugin[], fail: (plugin: Plugin, problem: string) => never): Stage[] {
  const entries = plugins.flatMap((plugin, rank) => plugin.stages.map((stage) => ({ stage, plugin, rank })));
  const before = (a: (typeof entries)[number], b: (typeof entries)[number]): boolean =>
    a.rank !== b.rank ? a.rank < b.rank : a.stage.id < b.stage.id;
  // A stage waits for every stage that writes a field it reads, itself included.
  const waits = new Map(entries.map((e) => [e, new Set(entries.filter((w) => w.stage.writes.some((k) => e.stage.reads.includes(k))))]));
  const order: Stage[] = [];
  const done = new Set<(typeof entries)[number]>();
  while (done.size < entries.length) {
    let next: (typeof entries)[number] | undefined;
    for (const e of entries) {
      if (done.has(e) || [...waits.get(e)!].some((w) => !done.has(w))) continue;
      if (!next || before(e, next)) next = e;
    }
    if (!next) {
      // Every waiting stage is in a cycle or waits on one; name one in it.
      const inCycle = (e: (typeof entries)[number]): boolean => {
        const seen = new Set<(typeof entries)[number]>();
        const stack = [...waits.get(e)!];
        while (stack.length > 0) {
          const w = stack.pop()!;
          if (w === e) return true;
          if (done.has(w) || seen.has(w)) continue;
          seen.add(w);
          stack.push(...waits.get(w)!);
        }
        return false;
      };
      const stuck = entries.find((e) => !done.has(e) && inCycle(e))!;
      return fail(stuck.plugin, `stage "${stuck.stage.id}" is in a cycle through the fields it reads and writes`);
    }
    done.add(next);
    order.push(next.stage);
  }
  return order;
}

/**
 * Why a renderer or exporter can't show this model, or null when it can: "needs the estimate plugin"
 * when a required field's plugin isn't registered, else the reason of the first skipped stage, in
 * stage order, that writes a required field.
 */
export function unmetReason(registry: Registry, model: Model, requires: readonly FieldKey<unknown>[]): string | null {
  const missing = requires.find((key) => !registry.owner(key));
  if (missing) return `needs the ${missing.plugin} plugin`;
  const writers = new Set(registry.order.filter((s) => s.writes.some((k) => requires.includes(k))).map((s) => s.id));
  return model.inactive.find((i) => writers.has(i.stage))?.reason ?? null;
}
