// The app's plugins, and the only place app/ imports from plugins/ (PLUGINS.md §8).

import { createAnalyzer, createRegistry } from '../core';
import type { Exporter, Renderer } from '../core';
import { estimatePlugin } from '../plugins/estimate';
import { schedulePlugin } from '../plugins/schedule';

export const registry = createRegistry([estimatePlugin, schedulePlugin]);
export const analyze = createAnalyzer(registry);
export const renderers: Renderer[] = [...registry.renderers];
export const exporters: Exporter[] = [...registry.exporters];
