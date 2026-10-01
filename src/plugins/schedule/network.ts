// The dependency network both passes walk (spec §2.11): finish-to-start links read through the deps
// role, and the hierarchy, since a parent's floor applies to every descendant. Links into a summary,
// and links in a cycle, are left out, so what remains is acyclic.

import type { Value } from 'rows';
import type { Diagnostic, ItemNode, Span, StageContext } from '../../core';
import { lagHours } from './lag';

/** `to` starts after `from` finishes, plus `lag` working hours. */
export interface Link {
  from: ItemNode;
  to: ItemNode;
  lag: number;
}

export interface Network {
  /** Every item, in document order. */
  items: ItemNode[];
  parent: ReadonlyMap<ItemNode, ItemNode>;
  /** The links into each row, and out of it. */
  into: ReadonlyMap<ItemNode, Link[]>;
  out: ReadonlyMap<ItemNode, Link[]>;
  /** Topological over the links and parent → child: a row comes after its parent and its predecessors. */
  order: ItemNode[];
}

/** The span of the row's cell in the column bound to `role`, for a diagnostic. */
export function spanOf(ctx: StageContext, node: ItemNode, role: string): Span | undefined {
  const name = ctx.bindings.roles.get(role);
  const index = ctx.model.columns.findIndex((c) => c.name === name);
  return node.fields[index]?.span;
}

/**
 * Reads the network. With `report`, the dependency diagnostics go to `ctx.diagnose`: a link to a
 * summary, a negative lag, and every row in a cycle. Cycles are strongly connected components, so the
 * result doesn't depend on row order.
 */
export function readNetwork(ctx: StageContext, report: boolean): Network {
  const items: ItemNode[] = [];
  const parent = new Map<ItemNode, ItemNode>();
  const visit = (n: ItemNode) => {
    items.push(n);
    for (const child of n.children) {
      parent.set(child, n);
      visit(child);
    }
  };
  ctx.model.roots.forEach(visit);
  const byRow = new Map(items.map((n) => [n.row, n]));
  const diagnose = (d: Diagnostic) => report && ctx.diagnose(d);
  const hoursPerDay = ctx.calendar!.hoursPerDay;

  const candidates: Link[] = [];
  for (const to of items) {
    const value: Value | undefined = ctx.cell(to, 'deps');
    if (value?.type !== 'ref') continue;
    const at = { line: to.line, span: spanOf(ctx, to, 'deps') };
    for (const ref of value.refs) {
      // An unresolved reference is already a rows validation error.
      const from = ref.target && byRow.get(ref.target);
      if (!from) continue;
      if (from.children.length > 0) {
        diagnose({ ...at, severity: 'warning', code: 'schedule-dep-on-summary', message: `#${ref.id} is a parent row, whose dates come from its children; the dependency is ignored` });
        continue;
      }
      let lag = lagHours(ref.qualifier, hoursPerDay);
      if (lag < 0) {
        diagnose({ ...at, severity: 'warning', code: 'schedule-negative-lag', message: `a negative lag isn't supported yet; the lag on #${ref.id} counts as 0` });
        lag = 0;
      }
      candidates.push({ from, to, lag });
    }
  }

  const next = (links: Link[]) => {
    const out = new Map<ItemNode, ItemNode[]>(items.map((n) => [n, [...n.children]]));
    for (const l of links) out.get(l.from)!.push(l.to);
    return out;
  };
  const component = components(items, next(candidates));
  const cyclic = (a: ItemNode, b: ItemNode) => component.get(a) === component.get(b);
  const links = candidates.filter((l) => !cyclic(l.from, l.to));
  const inCycle = new Set(candidates.filter((l) => cyclic(l.from, l.to)).map((l) => component.get(l.from)!));
  for (const n of items) {
    const members = component.get(n)!;
    if (!inCycle.has(members)) continue;
    const others = [...members].filter((m) => m !== n).map((m) => m.title).sort();
    const message = others.length > 0 ? `in a dependency cycle with ${others.join(', ')}; the dependencies in the cycle are ignored` : 'depends on itself; the dependency is ignored';
    diagnose({ line: n.line, span: spanOf(ctx, n, 'deps'), severity: 'error', code: 'schedule-dep-cycle', message });
  }

  const into = new Map<ItemNode, Link[]>(items.map((n) => [n, []]));
  const out = new Map<ItemNode, Link[]>(items.map((n) => [n, []]));
  for (const l of links) {
    into.get(l.to)!.push(l);
    out.get(l.from)!.push(l);
  }

  // Reverse post-order of a depth-first walk, in document order: topological, and the same every time.
  const successors = next(links);
  const seen = new Set<ItemNode>();
  const post: ItemNode[] = [];
  const walk = (n: ItemNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    successors.get(n)!.forEach(walk);
    post.push(n);
  };
  items.forEach(walk);
  return { items, parent, into, out, order: post.reverse() };
}

/** Each row's strongly connected component (Tarjan), as a shared set. */
function components(items: ItemNode[], successors: Map<ItemNode, ItemNode[]>): Map<ItemNode, Set<ItemNode>> {
  const index = new Map<ItemNode, number>();
  const low = new Map<ItemNode, number>();
  const stack: ItemNode[] = [];
  const onStack = new Set<ItemNode>();
  const result = new Map<ItemNode, Set<ItemNode>>();
  const connect = (v: ItemNode) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of successors.get(v)!) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const members = new Set<ItemNode>();
      let w: ItemNode;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        members.add(w);
      } while (w !== v);
      for (const m of members) result.set(m, members);
    }
  };
  for (const v of items) if (!index.has(v)) connect(v);
  return result;
}
