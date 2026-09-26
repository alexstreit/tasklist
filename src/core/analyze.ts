// Single entry point: parseRows, readPlan and compute. Spec §3.2.

import { parseRows } from 'rows';
import type { RowsDocument } from 'rows';
import type { Diagnostic, Model } from './types';
import { compute } from './compute';
import { isPlanName, PLAN_PROFILE } from './profile';
import { readPlan } from './read';

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

export function analyze(text: string, filename?: string): Model {
  const { doc, tabs } = parsePlan(text, filename);
  const tree = readPlan(doc);
  tree.diagnostics.push(...tabs);
  return compute(tree, tree.columns);
}
