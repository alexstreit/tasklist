// @vitest-environment jsdom
// Task 30 made #host the preview's scroll container. Each table view still scrolls its cursor row
// into view with block: 'nearest', which scrolls whichever ancestor scrolls.

import { describe, expect, it, vi } from 'vitest';
import { analyze, renderers } from '../../src/app/registry';
import fixture from '../../examples/schedule.plan?raw';

const scroll = vi.fn();
Element.prototype.scrollIntoView = scroll;

describe.each(['tree', 'table', 'schedule'])('the %s view', (id) => {
  it('scrolls the cursor row into view, nearest, when the editor moved the cursor', () => {
    const renderer = renderers.find((r) => r.id === id)!;
    const host = document.createElement('div');
    scroll.mockClear();
    // Line 11 is UI.
    renderer.render(analyze(fixture, { filename: 'schedule.plan' }), host, {
      cursorLine: 11,
      cursorItem: { line: 11, exact: true },
      scrollToCursor: true,
      setCursorLine: () => {},
    });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect((scroll.mock.instances[0] as unknown as HTMLElement).classList.contains('at-cursor')).toBe(true);
    expect((scroll.mock.instances[0] as unknown as HTMLElement).textContent).toContain('UI');
  });
});
