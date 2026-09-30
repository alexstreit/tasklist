import { analyze } from '../../src/app/registry';
import { parsePlan, readTree } from '../../src/core';
import type { ItemNode, Model, Pinnable, Tree } from '../../src/core';
import { doneSum, hasValue, rollup, totals } from '../../src/plugins/estimate/fields';
import type { Total } from '../../src/plugins/estimate/fields';

export function load(text: string, filename?: string): { tree: Tree; model: Model } {
  return { tree: readTree(parsePlan(text, filename).doc), model: analyze(text, filename) };
}

/** Depth-first flatten of the model's item nodes. */
export function flatten(model: Model): ItemNode[] {
  const out: ItemNode[] = [];
  const visit = (n: ItemNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  model.roots.forEach(visit);
  return out;
}

export function byTitle(model: Model, title: string): ItemNode {
  const node = flatten(model).find((n) => n.title === title);
  if (!node) throw new Error(`no node titled "${title}"`);
  return node;
}

/** A summable column's estimate fields on one node, read through their keys: the roll-up, `hasValue` and `doneSum`. */
export function est(model: Model, node: ItemNode, column = 'est'): Pinnable<number> & { hasValue: boolean; doneSum: number } {
  return {
    ...model.get(node, rollup)!.get(column)!,
    hasValue: model.get(node, hasValue)!.get(column)!,
    doneSum: model.get(node, doneSum)!.get(column)!,
  };
}

/** The document total of a summable column; undefined for any other. */
export function total(model: Model, column = 'est'): Total | undefined {
  return model.value(totals)!.get(column);
}
