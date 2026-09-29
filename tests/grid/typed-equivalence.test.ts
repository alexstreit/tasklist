// normaliseDuration now validates with rows' duration parser. This keeps the
// grammar it replaced as a reference, and checks that both agree on generated
// input, so the refactor changed no behaviour.

import { describe, expect, it } from 'vitest';
import { normaliseDuration } from '../../src/grid/typed';

const UNITS: Record<string, string> = {
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm', h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd', w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w',
};

/** The Task 24 implementation, before the refactor. */
function reference(typed: string): string {
  const m = /^[ \t]*([+-]?)[ \t]*([\s\S]*?)[ \t]*$/.exec(typed)!;
  const terms: string[] = [];
  const seen = new Set<string>();
  let rest = m[2];
  while (rest !== '') {
    const t = /^(\d+(?:\.\d+)?)[ \t]*([A-Za-z]+)[ \t]*/.exec(rest);
    const unit = t && UNITS[t[2].toLowerCase()];
    if (!t || !unit || seen.has(unit)) return typed;
    seen.add(unit);
    terms.push(`${t[1]}${unit}`);
    rest = rest.slice(t[0].length);
  }
  return terms.length === 0 ? typed : m[1] + terms.join(' ');
}

describe('normaliseDuration agrees with the grammar it replaced', () => {
  it('on 20,000 generated inputs', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const parts = ['1', '2', '1.5', '90', '0', '.5', '1,5', ' ', '  ', '\t', 'h', 'd', 'w', 'm', 'hours', 'Days', 'WKS', 'min', 'hr', 'x', 'parsecs', '+', '-', ',', 'soon', ''];
    for (let i = 0; i < 20000; i++) {
      const typed = Array.from({ length: 1 + Math.floor(random() * 6) }, () => parts[Math.floor(random() * parts.length)]).join('');
      expect(normaliseDuration(typed), JSON.stringify(typed)).toBe(reference(typed));
    }
  });
});
