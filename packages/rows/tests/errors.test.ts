import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/index';

describe('error codes', () => {
  it('are exactly the codes and classes listed in conformance/README.md', () => {
    const readme = readFileSync(new URL('../conformance/README.md', import.meta.url), 'utf8');
    const listed = Object.fromEntries([...readme.matchAll(/^\| `([a-z-]+)` +\| (syntax|structural|validation) /gm)].map((m) => [m[1], m[2]]));
    expect(ERROR_CODES).toEqual(listed);
  });
});
