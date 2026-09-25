// Spec §3.7: CodeMirror is confined to the text editor and the buffer that
// wraps it. Lint enforces this on new code; this probe proves it holds now.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = new URL('../../src', import.meta.url).pathname;
const allowed = ['editor/', 'buffer/CodeMirrorBuffer.ts'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('CodeMirror boundary', () => {
  it('is imported only from src/editor/ and src/buffer/CodeMirrorBuffer.ts', () => {
    const offenders = files(src)
      .map((f) => f.slice(src.length + 1))
      .filter((f) => !allowed.some((a) => f.startsWith(a)))
      .filter((f) => /@codemirror\//.test(readFileSync(join(src, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
