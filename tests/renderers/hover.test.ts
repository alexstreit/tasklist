// @vitest-environment jsdom
// Task 32: the views that don't follow show the line hovered in the editor (spec §3.3) as a band on
// the item row on exactly that line. They have no rows for comments, so a hovered comment shows
// nothing.

import { describe, expect, it } from 'vitest';
import { analyze, renderers } from '../../src/app/registry';
import type { FileLine, RenderContext } from '../../src/core';
import fixture from '../../examples/schedule.plan?raw';

describe.each(['tree', 'table', 'schedule', 'pins'])('the %s view', (id) => {
  it('bands the item row on the hovered line, and nothing for a comment line', () => {
    const renderer = renderers.find((r) => r.id === id)!;
    const host = document.createElement('div');
    let relay: (at: FileLine | null) => void = () => {};
    const ctx: RenderContext = {
      cursorLine: null,
      cursorItem: null,
      scrollToCursor: false,
      setCursorLine: () => {},
      onHoverLine: (cb) => void ((relay = cb), cb({ file: 'schedule.plan', line: 11 })),
    };
    // Line 11 is UI, which has a pin, so the pin review lists it too; line 5 is the comment.
    renderer.render(analyze(fixture, { filename: 'schedule.plan' }), host, ctx);
    const hovered = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr.hover')].map((tr) => tr.textContent);
    expect(hovered()).toHaveLength(1);
    expect(hovered()[0]).toContain('UI');
    relay({ file: 'schedule.plan', line: 5 });
    expect(hovered()).toEqual([]);
    relay(null);
    expect(hovered()).toEqual([]);
  });
});
