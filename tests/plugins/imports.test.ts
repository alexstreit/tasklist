// PLUGINS.md §8: a plugin imports only core, `rows`, its own folder and the
// plugins in its `requires`. Lint can't see a manifest, so this test reads each
// plugin folder's imports and compares them with it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plugin } from '../../src/core';

const src = new URL('../../src', import.meta.url).pathname;
const manifests = import.meta.glob('../../src/plugins/*/index.ts', { eager: true }) as Record<string, Record<string, unknown>>;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Every import that a plugin's manifest doesn't allow, as `file: specifier`. */
function violations(id: string, requires: string[], sources: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of sources) {
    // `… from 'x'` in an import or re-export, and a bare `import 'x'`.
    for (const [, from, bare] of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/gm)) {
      const specifier = from ?? bare;
      if (specifier === 'rows') continue;
      const target = specifier.startsWith('.') ? relative(src, resolve(dirname(path), specifier)) : null;
      const [top, name] = target?.split('/') ?? [];
      const allowed = top === 'core' || (top === 'plugins' && (name === id || requires.includes(name)));
      if (!allowed) out.push(`${relative(src, path)}: ${specifier}`);
    }
  }
  return out;
}

const plugins = Object.values(manifests).flatMap((m) => Object.values(m).filter((v): v is Plugin => typeof v === 'object' && v !== null && 'stages' in v));

describe('plugin imports', () => {
  it('finds every plugin folder', () => {
    expect(plugins.map((p) => p.id).sort()).toEqual(readdirSync(join(src, 'plugins')).sort());
  });

  it.each(plugins.map((p) => [p.id, p] as const))('%s imports only core, rows, itself and what it requires', (id, plugin) => {
    const sources = files(join(src, 'plugins', id)).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    expect(sources.length).toBeGreaterThan(0);
    expect(violations(id, plugin.requires, sources)).toEqual([]);
  });

  it('fails on a planted import of an undeclared plugin, or of anything outside core', () => {
    const path = join(src, 'plugins/estimate/probe.ts');
    const planted = [
      "import { start } from '../schedule/fields';",
      "import type { Model } from '../../core';",
      "import { rollup } from './fields';",
      "import { mountGrid } from '../../grid';",
      "import { applyEdits } from 'rows';",
      "import { EditorView } from '@codemirror/view';",
    ].join('\n');
    expect(violations('estimate', [], [{ path, text: planted }])).toEqual([
      'plugins/estimate/probe.ts: ../schedule/fields',
      'plugins/estimate/probe.ts: ../../grid',
      'plugins/estimate/probe.ts: @codemirror/view',
    ]);
    expect(violations('estimate', ['schedule'], [{ path, text: planted }])).toHaveLength(2);
  });
});
