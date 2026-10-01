// The app's plugins and views, and the only place app/ imports from plugins/ (PLUGINS.md §8).

import { createAnalyzer, createRegistry } from '../core';
import type { Exporter, Renderer } from '../core';
import { estimatePlugin } from '../plugins/estimate';
import { schedulePlugin } from '../plugins/schedule';
import { pinsView } from '../views/pins';

export const registry = createRegistry([estimatePlugin, schedulePlugin]);
export const analyze = createAnalyzer(registry);
// Views belong to no plugin, so they come after the plugins' renderers.
export const renderers: Renderer[] = [...registry.renderers, pinsView];
export const exporters: Exporter[] = [...registry.exporters];
