// Injected measurements for the row alignment tests: jsdom lays nothing out, so every rect is
// zero. Each function stubs getBoundingClientRect for the elements in one pane and returns the
// function that restores it.

const PANE = { width: 600, height: 400 };

function install(inPane: (el: Element) => DOMRect | null): () => void {
  const original = Element.prototype.getBoundingClientRect;
  const ranges = { rects: Range.prototype.getClientRects, rect: Range.prototype.getBoundingClientRect };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return inPane(this) ?? original.call(this);
  };
  // CodeMirror measures a character with a range.
  Range.prototype.getClientRects = () => [new DOMRect(0, 0, 7, 20)] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 7, 20);
  return () => {
    Element.prototype.getBoundingClientRect = original;
    Range.prototype.getClientRects = ranges.rects;
    Range.prototype.getBoundingClientRect = ranges.rect;
  };
}

/**
 * A CodeMirror editor filling a 600×400 pane at the window's top: each line is as tall as
 * `lineHeight` says for its text, a filter's hidden lines take no height, and the content scrolls with the scroller. CodeMirror measures these heights itself, so its line
 * blocks carry them.
 */
export function editorLayout(pane: HTMLElement, lineHeight: (text: string) => number): () => void {
  const PADDING = 4; // CodeMirror's own .cm-content padding
  // A filter's hidden lines are one block with no height (Task 41).
  const isBlock = (el: Element) => el.classList.contains('cm-line') || el.classList.contains('cm-filter-hidden');
  const heightOf = (el: Element) => (el.classList.contains('cm-filter-hidden') ? 0 : lineHeight(el.textContent ?? ''));
  return install((el) => {
    if (!pane.contains(el)) return null;
    if (isBlock(el)) {
      const content = el.closest('.cm-content')!.getBoundingClientRect();
      let top = content.top + PADDING;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (isBlock(s)) top += heightOf(s);
      return new DOMRect(0, top, PANE.width, heightOf(el));
    }
    if (el.classList.contains('cm-content')) {
      const blocks = [...el.children].filter(isBlock).reduce((sum, block) => sum + heightOf(block), 0);
      return new DOMRect(0, -el.closest('.cm-scroller')!.scrollTop, PANE.width, blocks + 2 * PADDING);
    }
    return new DOMRect(0, 0, PANE.width, PANE.height);
  });
}

/**
 * Block layout for a 400px-high pane at the window's top that scrolls as a whole: an element is
 * as tall as `leaf` says, or else as its children together, and stacks below its earlier
 * siblings. `pane.clientHeight` and `pane.scrollHeight` follow.
 */
export function stackLayout(pane: HTMLElement, leaf: (el: Element) => number | undefined): () => void {
  const height = (el: Element): number => leaf(el) ?? [...el.children].reduce((sum, child) => sum + height(child), 0);
  const top = (el: Element): number => {
    if (el === pane) return 0;
    const parent = el.parentElement!;
    let y = top(parent) - (parent === pane ? pane.scrollTop : 0);
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) y += height(s);
    return y;
  };
  Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => PANE.height });
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => height(pane) });
  const restore = install((el) => (el === pane || pane.contains(el) ? new DOMRect(0, top(el), PANE.width, height(el)) : null));
  return () => {
    restore();
    delete (pane as { clientHeight?: number }).clientHeight;
    delete (pane as { scrollHeight?: number }).scrollHeight;
  };
}

/** A ResizeObserver jsdom lacks, whose observers the test fires by hand. */
export function mockResizeObserver(): { fire(): void; restore(): void } {
  const callbacks: (() => void)[] = [];
  const global = globalThis as { ResizeObserver?: unknown };
  const before = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(private readonly cb: () => void) {
      callbacks.push(cb);
    }
    observe(): void {}
    disconnect(): void {
      callbacks.splice(callbacks.indexOf(this.cb), 1);
    }
  };
  return {
    fire: () => [...callbacks].forEach((cb) => cb()),
    restore: () => void (global.ResizeObserver = before),
  };
}
