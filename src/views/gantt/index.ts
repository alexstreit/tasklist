// Placeholder for the deferred Gantt renderer (spec §7). It requires a field
// of the schedule plugin, which doesn't exist yet, so it exercises the app
// shell's greying out of renderers with unmet requirements. It must never be
// asked to render. Task 28's schedule plugin replaces it.

import { defineField } from '../../core';
import type { Renderer } from '../../core';

/** Stands in for the schedule plugin's start field until that plugin exists. */
const start = defineField<number>('schedule', 'start', 'node');

export const ganttRenderer: Renderer = {
  id: 'gantt',
  label: 'Gantt',
  requires: [start],
  render(): void {
    throw new Error('gantt renderer is a stub and must not be rendered');
  },
};
