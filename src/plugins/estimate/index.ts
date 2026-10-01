// The estimate plugin: roll-ups of every duration and number column, and the
// views that show them (PLUGINS.md §4, §6). Its only role is the optional
// duration role, whose column it leaves out.

import type { Plugin } from '../../core';
import { tsvExporter } from './exporters/tsv';
import { doneSum, hasValue, rollup, totals } from './fields';
import { tableRenderer } from './renderers/table';
import { treeRenderer } from './renderers/tree';
import { rollupStage } from './rollup';

export const estimatePlugin: Plugin = {
  id: 'estimate',
  requires: [],
  fields: [rollup, hasValue, doneSum, totals],
  stages: [rollupStage],
  renderers: [treeRenderer, tableRenderer],
  exporters: [tsvExporter],
};
