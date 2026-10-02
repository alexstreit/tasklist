// The dependency network both passes walk (spec §2.11): finish-to-start links read through the deps
// role, and the hierarchy, since a parent's floor applies to every descendant and a parent's finish
// is its latest descendant's. Its points are each row's start and finish, so a link may leave a
// parent: it waits for the parent's finish. Links in a cycle are left out, so what remains is acyclic.

import type { Diagnostic, ItemNode, Span, StageContext } from '../../core';
import { lagHours } from './lag';

/** `to` starts after `from` finishes, plus `lag` working hours. */
export interface Link {
  from: ItemNode;
  to: ItemNode;
  lag: number;
}

/** A row's start or its finish. */
export interface Point {
  node: ItemNode;
  end: 'start' | 'finish';
}

export interface Network {
  /** Every item, in document order. */
  items: ItemNode[];
  parent: ReadonlyMap<ItemNode, ItemNode>;
  /** The links into each row, and out of it. */
  into: ReadonlyMap<ItemNode, Link[]>;
  out: ReadonlyMap<ItemNode, Link[]>;
  /**
   * Topological over the points: a row's start comes after its parent's start and after each
   * predecessor's finish; a leaf's finish after its start, and a parent's after its children's.
   */
  order: Point[];
}

/** The span of the row's cell in the column bound to `role`, for a diagnostic. */
export function spanOf(ctx: StageContext, node: ItemNode, role: string): Span | undefined {
  const name = ctx.bindings.roles.get(role);
  const index = ctx.model.columns.findIndex((c) => c.name === name);
  return ctx.model.field(node, index)?.span;
}

/**
 * Reads the network, once per analysis: the forward pass reads it and writes it as the `network`
 * field, which the backward pass reads. The dependency diagnostics go to `ctx.diagnose`: a negative
 * lag, and every row in a cycle. Cycles are strongly connected components of the points, so the
 * result doesn't depend on row order.
 */
export function readNetwork(ctx: StageContext): Network {
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
  const diagnose = (n: ItemNode, d: Diagnostic) => ctx.diagnose(n, d);
  const hoursPerDay = ctx.calendar!.hoursPerDay;

  const candidates: Link[] = [];
  for (const to of items) {
    const value = ctx.cell(to, 'deps');
    if (value?.type !== 'ref') continue;
    const at = { line: to.line, span: spanOf(ctx, to, 'deps') };
    // One target per reference that resolves, in the cell's order. An unresolved reference is
    // already a rows validation error.
    const targets = ctx.targets(to, 'deps');
    value.refs.filter((ref) => ref.target).forEach((ref, i) => {
      let lag = lagHours(ref.qualifier, hoursPerDay);
      if (lag < 0) {
        diagnose(to, { ...at, severity: 'warning', code: 'schedule-negative-lag', message: `a negative lag isn't supported yet; the lag on #${ref.id} counts as 0` });
        lag = 0;
      }
      candidates.push({ from: targets[i], to, lag });
    });
  }

  // Points by number: a row's start is 2i and its finish 2i + 1, where i is its place in `items`.
  const place = new Map(items.map((n, i) => [n, i]));
  const startOf = (n: ItemNode) => 2 * place.get(n)!;
  const finishOf = (n: ItemNode) => 2 * place.get(n)! + 1;
  const next = (links: Link[]): number[][] => {
    const out: number[][] = [];
    items.forEach((n, i) => {
      out.push(n.children.length > 0 ? n.children.map(startOf) : [2 * i + 1]);
      const up = parent.get(n);
      out.push(up ? [finishOf(up)] : []);
    });
    for (const l of links) out[finishOf(l.from)].push(startOf(l.to));
    return out;
  };
  const all = next(candidates);
  const component = components(all);
  const cyclic = (l: Link) => component[finishOf(l.from)] === component[startOf(l.to)];
  const links = candidates.filter((l) => !cyclic(l));
  const inCycle = new Set(candidates.filter(cyclic).map((l) => component[finishOf(l.from)]));
  if (inCycle.size > 0) {
    const members = new Map<number, Set<ItemNode>>();
    component.forEach((c, p) => inCycle.has(c) && (members.get(c) ?? members.set(c, new Set()).get(c)!).add(items[p >> 1]));
    for (const n of items) {
      const cycles = [component[startOf(n)], component[finishOf(n)]].filter((c) => inCycle.has(c));
      if (cycles.length === 0) continue;
      const others = [...new Set(cycles.flatMap((c) => [...members.get(c)!]))].filter((m) => m !== n).map((m) => m.title).sort();
      const message = others.length > 0 ? `in a dependency cycle with ${others.join(', ')}; the dependencies in the cycle are ignored` : 'depends on itself; the dependency is ignored';
      diagnose(n, { line: n.line, span: spanOf(ctx, n, 'deps'), severity: 'error', code: 'schedule-dep-cycle', message });
    }
  }

  const into = new Map<ItemNode, Link[]>(items.map((n) => [n, []]));
  const out = new Map<ItemNode, Link[]>(items.map((n) => [n, []]));
  for (const l of links) {
    into.get(l.to)!.push(l);
    out.get(l.from)!.push(l);
  }

  // Reverse post-order of a depth-first walk, in document order: topological, and the same every time.
  const points = items.flatMap((node): Point[] => [
    { node, end: 'start' },
    { node, end: 'finish' },
  ]);
  const post = postOrder(links.length === candidates.length ? all : next(links));
  return { items, parent, into, out, order: post.reverse().map((p) => points[p]) };
}

/** The points in post-order of a depth-first walk from each in turn, without recursion, so a long chain can't overflow the stack. */
function postOrder(successors: number[][]): number[] {
  const seen = new Uint8Array(successors.length);
  const post: number[] = [];
  const stack: number[] = [];
  const at: number[] = [];
  for (let root = 0; root < successors.length; root++) {
    if (seen[root]) continue;
    seen[root] = 1;
    stack.push(root);
    at.push(0);
    while (stack.length > 0) {
      const v = stack[stack.length - 1];
      const i = at[at.length - 1]++;
      if (i < successors[v].length) {
        const w = successors[v][i];
        if (!seen[w]) {
          seen[w] = 1;
          stack.push(w);
          at.push(0);
        }
      } else {
        stack.pop();
        at.pop();
        post.push(v);
      }
    }
  }
  return post;
}

/** Each point's strongly connected component, as a number (Tarjan's algorithm, without recursion). */
function components(successors: number[][]): Int32Array {
  const size = successors.length;
  const index = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const component = new Int32Array(size);
  const onStack = new Uint8Array(size);
  const stack: number[] = [];
  const calls: number[] = [];
  const at: number[] = [];
  let counter = 0;
  for (let root = 0; root < size; root++) {
    if (index[root] >= 0) continue;
    calls.push(root);
    at.push(0);
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (calls.length > 0) {
      const v = calls[calls.length - 1];
      const i = at[at.length - 1]++;
      if (i < successors[v].length) {
        const w = successors[v][i];
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          calls.push(w);
          at.push(0);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      calls.pop();
      at.pop();
      if (calls.length > 0) {
        const up = calls[calls.length - 1];
        low[up] = Math.min(low[up], low[v]);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          component[w] = v;
        } while (w !== v);
      }
    }
  }
  return component;
}
