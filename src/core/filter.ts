// The filter's matching (spec §5.7): which rows of the composed tree match a query, and their
// ancestors, kept for context. Display only: nothing here changes the model.

import type { FileLine, ItemNode, Model } from './types';

/** What `filterRows` found, in composed order. */
export interface Found {
  matches: FileLine[];
  /** The ancestors of the matches that don't match themselves. */
  ancestors: FileLine[];
  /** How many rows match, and how many item rows there are in all. */
  count: number;
  total: number;
}

/**
 * The rows where every whitespace-separated term of `query` appears, ignoring case, in the title or
 * in a declared cell's decoded text, in the row's own file. A ref column's cells and the key column's
 * are not searched, nor are outline numbers and anchors: the grid doesn't show their text.
 */
export function filterRows(model: Model, query: string): Found {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '');
  // Each file's searchable fields, as indices into its nodes' `fields`.
  const searched = new Map<string, number[]>();
  const fieldsOf = (file: string): number[] => {
    let out = searched.get(file);
    if (out) return out;
    const schema = (model.files.get(file)?.doc ?? model.doc).schema;
    const declared = schema.columns.filter((c) => c.index > 0 && !c.implicit);
    out = declared.flatMap((c, i) => (c.kind === 'ref' || c.index === schema.key?.index ? [] : [i]));
    searched.set(file, out);
    return out;
  };
  const matches = (node: ItemNode): boolean => {
    const text = [node.title, ...fieldsOf(node.file).map((i) => node.fields[i]?.text ?? '')].join('\n').toLowerCase();
    return terms.every((term) => text.includes(term));
  };

  const found: Found = { matches: [], ancestors: [], count: 0, total: 0 };
  // Each node in composed order, with whether it matches and whether it has a matching descendant.
  const order: { node: ItemNode; match: boolean; context: boolean }[] = [];
  const visit = (node: ItemNode): boolean => {
    const entry = { node, match: matches(node), context: false };
    order.push(entry);
    found.total++;
    for (const child of node.children) if (visit(child)) entry.context = true;
    return entry.match || entry.context;
  };
  model.roots.forEach(visit);
  for (const { node, match, context } of order) {
    const at = { file: node.file, line: node.line };
    if (match) found.matches.push(at);
    else if (context) found.ancestors.push(at);
  }
  found.count = found.matches.length;
  return found;
}
