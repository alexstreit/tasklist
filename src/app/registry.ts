// The app's plugins, and the only place app/ imports from plugins/ (PLUGINS.md §8).

import { createAnalyzer, createRegistry } from '../core';
import type { Exporter, Renderer } from '../core';
import { estimatePlugin } from '../plugins/estimate';
import { ganttRenderer } from '../views/gantt';

export const registry = createRegistry([estimatePlugin]);
export const analyze = createAnalyzer(registry);
export const renderers: Renderer[] = [...registry.renderers, ganttRenderer];
export const exporters: Exporter[] = [...registry.exporters];
