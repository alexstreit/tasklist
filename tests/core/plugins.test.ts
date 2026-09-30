// The plugin seams (PLUGINS.md §3–§5): the registry's checks, the stage
// runner, and analysis with no plugins at all.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { createAnalyzer, createRegistry, defineField, parsePlan, readTree, unmetReason } from '../../src/core';
import type { FieldKey, Plugin, Stage } from '../../src/core';
import { estimatePlugin } from '../../src/plugins/estimate';
import { treeRenderer } from '../../src/plugins/estimate/renderers/tree';

const fixtures = import.meta.glob(['../fixtures/*.plan', '../../examples/*.plan'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const stage = (id: string, reads: FieldKey<unknown>[], writes: FieldKey<unknown>[], run: Stage['run'] = () => {}): Stage => ({ id, reads, writes, run });
const plugin = (id: string, fields: FieldKey<unknown>[], stages: Stage[], requires: string[] = []): Plugin => ({ id, requires, fields, stages });

describe('createRegistry', () => {
  const a = defineField<number>('alpha', 'a', 'node');
  const b = defineField<number>('beta', 'b', 'node');

  it('throws on a repeated plugin id, naming it', () => {
    expect(() => createRegistry([plugin('alpha', [], []), plugin('alpha', [], [])])).toThrow('plugin "alpha": is registered twice');
  });

  it('throws when requires names a plugin that is not registered, naming the plugin', () => {
    expect(() => createRegistry([plugin('alpha', [], [], ['beta'])])).toThrow('plugin "alpha": requires "beta", which is not registered');
  });

  it('throws on a requires cycle, naming a plugin in it', () => {
    expect(() => createRegistry([plugin('alpha', [], [], ['beta']), plugin('beta', [], [], ['alpha'])])).toThrow('plugin "alpha": requires itself through a cycle');
  });

  it('throws when a field has two owners, naming the second', () => {
    expect(() => createRegistry([plugin('alpha', [a], []), plugin('beta', [a], [])])).toThrow('plugin "beta": field alpha.a is already owned by plugin "alpha"');
  });

  it("throws when a stage writes a field its plugin doesn't own, naming the plugin", () => {
    expect(() => createRegistry([plugin('alpha', [a], []), plugin('beta', [b], [stage('beta.one', [], [a])], ['alpha'])])).toThrow(
      'plugin "beta": stage "beta.one" writes alpha.a, which the plugin doesn\'t own',
    );
  });

  it('throws when a stage reads a field of a plugin its plugin does not require, naming the plugin', () => {
    const plugins = [plugin('alpha', [a], [stage('alpha.one', [], [a])]), plugin('beta', [b], [stage('beta.one', [a], [b])])];
    expect(() => createRegistry(plugins)).toThrow('plugin "beta": stage "beta.one" reads alpha.a, which is owned by neither the plugin nor one it requires');
    plugins[1].requires = ['alpha'];
    expect(() => createRegistry(plugins)).not.toThrow();
  });

  it('throws on a stage cycle through fields, naming the plugin', () => {
    const c = defineField<number>('alpha', 'c', 'node');
    expect(() => createRegistry([plugin('alpha', [a, c], [stage('alpha.one', [c], [a]), stage('alpha.two', [a], [c])])])).toThrow(
      'plugin "alpha": stage "alpha.one" is in a cycle through the fields it reads and writes',
    );
    expect(() => createRegistry([plugin('alpha', [a], [stage('alpha.self', [a], [a])])])).toThrow('plugin "alpha": stage "alpha.self" is in a cycle');
  });

  it('accepts the app plugins', () => {
    expect(createRegistry([estimatePlugin]).order.map((s) => s.id)).toEqual(['estimate.rollup']);
  });
});

describe('the stage order', () => {
  const x = defineField<number>('first', 'x', 'node');
  const y = defineField<number>('second', 'y', 'node');
  const z = defineField<number>('second', 'z', 'node');
  const plugins = () => [
    plugin('first', [x], [stage('first.x', [], [x])]),
    // Declared out of order: z reads y, and the ties among the rest break by id.
    plugin('second', [y, z], [stage('second.z', [y], [z]), stage('second.c', [], []), stage('second.y', [x], [y]), stage('second.a', [], [])], ['first']),
  ];

  it('is topological, with ties by registration order, then stage id', () => {
    expect(createRegistry(plugins()).order.map((s) => s.id)).toEqual(['first.x', 'second.a', 'second.c', 'second.y', 'second.z']);
  });

  it('is the same across repeated registrations', () => {
    const orders = Array.from({ length: 5 }, () => createRegistry(plugins()).order.map((s) => s.id));
    expect(new Set(orders.map((o) => o.join())).size).toBe(1);
  });

  it('puts a reader after its writer even when the writer registers later', () => {
    const early = plugin('early', [], [stage('early.read', [x], [])], ['first']);
    expect(createRegistry([plugin('first', [x], [stage('first.x', [], [x])]), early]).order.map((s) => s.id)).toEqual(['first.x', 'early.read']);
  });
});

describe('the stage runner', () => {
  const n = defineField<number>('probe', 'n', 'node');
  const total = defineField<number>('probe', 'total', 'document');
  const unwritten = defineField<number>('probe', 'unwritten', 'node');
  const after = defineField<number>('probe', 'after', 'node');

  it('runs the stages in order, and a later stage reads what an earlier one set', () => {
    const run = createAnalyzer(
      createRegistry([
        plugin('probe', [n, total], [
          stage('probe.count', [], [n], (ctx) => ctx.model.roots.forEach((r) => ctx.set(r, n, r.children.length))),
          stage('probe.total', [n], [total], (ctx) => ctx.setValue(total, ctx.model.roots.reduce((s, r) => s + ctx.model.get(r, n)!, 0))),
        ]),
      ]),
    );
    const model = run('A\n    B\n    C\nD\n    E\n');
    expect(model.roots.map((r) => model.get(r, n))).toEqual([2, 1]);
    expect(model.value(total)).toBe(3);
    expect(model.inactive).toEqual([]);
  });

  it('skips a stage reading a field no stage wrote, and one reading what that stage would have written, recording each', () => {
    const ran: string[] = [];
    const run = createAnalyzer(
      createRegistry([
        plugin('probe', [n, unwritten, after], [
          stage('probe.needs', [unwritten], [n], () => void ran.push('needs')),
          stage('probe.after', [n], [after], () => void ran.push('after')),
        ]),
      ]),
    );
    const model = run('A\n');
    expect(ran).toEqual([]);
    expect(model.inactive).toEqual([
      { stage: 'probe.needs', reason: 'needs probe.unwritten, which no stage writes' },
      // The reason passes on, so the user reads the cause, not the chain.
      { stage: 'probe.after', reason: 'needs probe.unwritten, which no stage writes' },
    ]);
  });

  it('gives a view the reason of the first skipped stage that writes a field it requires', () => {
    const registry = createRegistry([plugin('probe', [n, unwritten, after], [stage('probe.needs', [unwritten], [n]), stage('probe.after', [n], [after])])]);
    const model = createAnalyzer(registry)('A\n');
    expect(unmetReason(registry, model, [after, n])).toBe('needs probe.unwritten, which no stage writes');
    expect(unmetReason(registry, model, [])).toBeNull();
  });

  const throwing = (run: Stage['run'], writes: FieldKey<unknown>[] = [n]) =>
    createAnalyzer(createRegistry([plugin('probe', [n, total, after], [stage('probe.bad', [], writes, run)])]))('A\n');

  it('throws on set with a key the stage does not write', () => {
    expect(() => throwing((ctx) => ctx.set(ctx.model.roots[0], after, 1))).toThrow('stage "probe.bad" writes probe.after, which it doesn\'t declare');
  });

  it('throws on set with a document-scope key, and on setValue with a node-scope key', () => {
    expect(() => throwing((ctx) => ctx.set(ctx.model.roots[0], total, 1), [total])).toThrow('stage "probe.bad" writes probe.total with set, but it is a document-scope field');
    expect(() => throwing((ctx) => ctx.setValue(n, 1))).toThrow('stage "probe.bad" writes probe.n with setValue, but it is a node-scope field');
  });

  it('hours is a lookup of what readTree read', () => {
    const seen: (number | undefined)[] = [];
    createAnalyzer(createRegistry([plugin('probe', [], [stage('probe.look', [], [], (ctx) => ctx.model.roots.forEach((r) => seen.push(ctx.hours(r, 'est'), ctx.hours(r, 'owner'))))])]))(
      'A | 1d | sam\nB | soon\nC | +2h\n',
    );
    expect(seen).toEqual([8, undefined, undefined, undefined, 2, undefined]);
  });

  it("runs every app stage on every fixture without writing outside its declarations", () => {
    for (const text of Object.values(fixtures)) expect(() => analyze(text)).not.toThrow();
  });
});

describe('an empty registry', () => {
  const empty = createRegistry([]);
  const text = fixtures['../../examples/example.plan'];

  it("returns the tree, lines and readTree's diagnostics without error", () => {
    const model = createAnalyzer(empty)(text);
    const tree = readTree(parsePlan(text).doc);
    expect(model.roots.map((r) => r.title)).toEqual(['Auth', 'Admin']);
    expect(model.lines).toEqual(tree.nodes);
    expect(model.diagnostics).toEqual(tree.diagnostics);
    // The override-differs info is estimate's.
    expect(analyze(text).diagnostics.map((d) => d.code)).toEqual(['override-differs']);
    expect(model.diagnostics).toEqual([]);
    expect(model.inactive).toEqual([]);
  });

  it('greys out the tree renderer with "needs the estimate plugin"', () => {
    expect(unmetReason(empty, createAnalyzer(empty)(text), treeRenderer.requires)).toBe('needs the estimate plugin');
  });
});
