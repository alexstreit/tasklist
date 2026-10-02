// Task 29: the follower's own layout and the scroll echo (src/ui/row-layout.ts).

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { naturalLayout, ScrollEcho } from '../../src/ui/row-layout';

describe('naturalLayout', () => {
  const model = analyze('// plan\nA\n    B\n\nC\n    D\n', { filename: 'a.plan', version: 7 });

  it('has one row per item, in document order, at the row height, keyed by file and line', () => {
    expect(naturalLayout(model, model.version, { bodyTop: 30, scrollTop: 0, height: 400, rowHeight: 22 })).toEqual({
      version: 7,
      bodyTop: 30,
      contentHeight: 88,
      scrollTop: 0,
      rows: [
        { at: { file: 'a.plan', line: 2 }, top: 0, height: 22 },
        { at: { file: 'a.plan', line: 3 }, top: 22, height: 22 },
        { at: { file: 'a.plan', line: 5 }, top: 44, height: 22 },
        { at: { file: 'a.plan', line: 6 }, top: 66, height: 22 },
      ],
    });
  });

  it('has only the visible rows, in content coordinates', () => {
    const layout = naturalLayout(model, model.version, { bodyTop: 0, scrollTop: 30, height: 20, rowHeight: 22 });
    expect(layout.rows).toEqual([
      { at: { file: 'a.plan', line: 3 }, top: 22, height: 22 },
      { at: { file: 'a.plan', line: 5 }, top: 44, height: 22 },
    ]);
    expect(layout.scrollTop).toBe(30);
  });
});

describe('ScrollEcho', () => {
  it('drops a report within 1px of the value last set, however late it comes', () => {
    const echo = new ScrollEcho();
    expect(echo.isEcho(0)).toBe(false);
    echo.set(100.4);
    expect([echo.isEcho(100), echo.isEcho(101.4), echo.isEcho(98)]).toEqual([true, true, false]);
    // Still recognised after other reports.
    expect(echo.isEcho(100)).toBe(true);
    echo.set(200);
    expect(echo.isEcho(100)).toBe(false);
  });
});
