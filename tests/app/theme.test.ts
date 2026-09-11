// Acceptance for dark mode: every colour lives in src/app/theme.css as a
// custom property, so nothing else in src/ carries a colour literal.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('../../src', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('colour tokens', () => {
  it('no hex or rgb() colour appears in src/ outside theme.css', () => {
    const offenders = files(src)
      .filter((f) => !f.endsWith('theme.css'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(line))
          .map(({ f, i, line }) => `${f.slice(src.length + 1)}:${i}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('theme.css defines every token twice: once on :root and once for dark', () => {
    const css = readFileSync(join(src, 'app/theme.css'), 'utf8');
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    const names = (block: string) => [...block.matchAll(/--[\w-]+(?=:)/g)].map((m) => m[0]).sort();
    expect(names(dark)).toEqual(names(light));
    expect(names(light).length).toBeGreaterThan(0);
  });
});
