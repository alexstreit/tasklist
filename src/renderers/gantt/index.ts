// Placeholder for the deferred Gantt renderer (spec §7). It requires a date
// column, which no MVP document has, so it exercises the app shell's greying
// out of renderers with unmet requirements. It must never be asked to render.

import type { Renderer } from '../../core';

export const ganttRenderer: Renderer = {
  id: 'gantt',
  label: 'Gantt',
  requires: [{ type: 'date' }],
  render(): void {
    throw new Error('gantt renderer is a stub and must not be rendered');
  },
};
