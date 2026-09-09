// Single entry point composing parse, parseColumns and compute. Spec §3.2.

import type { Model } from './types';
import { parse } from './parse';
import { parseColumns } from './columns';
import { compute } from './compute';

export function analyze(text: string): Model {
  const tree = parse(text);
  const { columns, diagnostics } = parseColumns(tree.frontMatter);
  return compute(tree, columns, diagnostics);
}
