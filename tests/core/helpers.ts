import { compute, parse, parseColumns } from '../../src/core';
import type { Model, ModelNode, SummableCell, Tree } from '../../src/core';

export function load(text: string): { tree: Tree; model: Model } {
  const tree = parse(text);
  const { columns, diagnostics } = parseColumns(tree.frontMatter);
  return { tree, model: compute(tree, columns, diagnostics) };
}

/** Depth-first flatten of the model's item nodes. */
export function flatten(model: Model): ModelNode[] {
  const out: ModelNode[] = [];
  const visit = (n: ModelNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  model.roots.forEach(visit);
  return out;
}

export function byTitle(model: Model, title: string): ModelNode {
  const node = flatten(model).find((n) => n.title === title);
  if (!node) throw new Error(`no node titled "${title}"`);
  return node;
}

export function est(node: ModelNode): SummableCell {
  return node.cells[0] as SummableCell;
}
