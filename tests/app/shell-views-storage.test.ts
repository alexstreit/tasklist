// @vitest-environment jsdom
// Task 41, in review: with localStorage unreadable (private browsing, say), the default view is the
// highest-ranked available one, and choosing a view still works for the page's life.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import demo from '../../examples/demo.plan?raw';

vi.mock('../../src/ui/today', () => ({ today: () => '2026-10-02' }));

const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('#renderers button')];
const shown = () => tabs().find((b) => b.classList.contains('active'))?.textContent;

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  const denied = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
  document.body.innerHTML =
    '<header class="toolbar"><button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span></header>' +
    '<main><div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section></main>';
  (await import('../../src/app/main')).boot({ document: demo });
});

describe('with localStorage unreadable', () => {
  it('opens a schedule file on the Gantt, and a pick still applies', () => {
    expect(shown()).toBe('Gantt');
    tabs().find((b) => b.textContent === 'Schedule')!.click();
    expect(shown()).toBe('Schedule');
  });
});
