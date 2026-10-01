// PLUGINS.md §8: each lint rule for the plugin seams fails on a planted probe,
// and the same code passes where it is allowed.

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: new URL('../..', import.meta.url).pathname });

/** The messages ESLint gives `code` as if it were the file at `path`, without no-restricted-imports' preamble. */
async function lint(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path });
  return result.messages.map((m) => m.message.replace(/^.* is restricted from being used by a pattern\. /, ''));
}

describe('lint rules for the plugin seams', () => {
  it.each([
    ['../plugins/estimate', 'src/core/probe.ts'],
    ['../views/gantt', 'src/core/probe.ts'],
    ['../app/registry', 'src/core/probe.ts'],
    ['../grid', 'src/core/probe.ts'],
    ['../editor', 'src/core/probe.ts'],
    ['../ui/grid', 'src/core/probe.ts'],
  ])('core may not import %s', async (specifier, path) => {
    expect(await lint(path, `import '${specifier}';\n`)).toEqual(['src/core may only import from within src/core, and the rows library.']);
  });

  it('app/ imports plugins/ only in registry.ts', async () => {
    const probe = "import { estimatePlugin } from '../plugins/estimate';\n";
    expect(await lint('src/app/main.ts', probe)).toEqual(['Only src/app/registry.ts may import from src/plugins/.']);
    expect(await lint('src/app/registry.ts', probe)).toEqual([]);
  });

  it.each(['src/plugins/estimate/renderers/probe.ts', 'src/plugins/estimate/exporters/probe.ts', 'src/views/probe/probe.ts'])('%s may not import rows', async (path) => {
    expect(await lint(path, "import { parseRows } from 'rows';\n")).toContain(
      'Renderers and exporters read computed model fields; Model.doc and rows are for editors only.',
    );
  });

  it('a stage may import rows', async () => {
    expect(await lint('src/plugins/estimate/probe.ts', "import { parseDuration } from 'rows';\n")).toEqual([]);
  });

  it('views import only core and src/ui', async () => {
    expect(await lint('src/views/probe/probe.ts', "import { rollup } from '../../plugins/estimate/fields';\n")).toEqual(['src/views may only import core and src/ui.']);
    expect(await lint('src/views/probe/probe.ts', "import { defineField } from '../../core';\n")).toEqual([]);
    expect(await lint('src/views/probe/probe.ts', "import { addItemRow } from '../../ui/grid';\n")).toEqual([]);
  });

  it('src/ui imports only core types', async () => {
    expect(await lint('src/ui/probe.ts', "import { formatDuration } from '../core';\n")).toEqual(['src/ui may only import core types.']);
    expect(await lint('src/ui/probe.ts', "import { rollup } from '../plugins/estimate/fields';\n")).toEqual(['src/ui may only import core types.']);
    expect(await lint('src/ui/probe.ts', "import { parseRows } from 'rows';\n")).toEqual(['src/ui may only import core types.']);
    expect(await lint('src/ui/probe.ts', "import type { ItemNode } from '../core';\nimport './grid.css';\n")).toEqual([]);
  });

  it.each(['src/core/probe.ts', 'src/plugins/estimate/probe.ts'])('%s may not read the clock', async (path) => {
    expect(await lint(path, 'export const a = Date.now();\nexport const b = new Date();\n')).toEqual([
      'Analysis never reads the clock.',
      'Analysis never reads the clock.',
    ]);
    expect(await lint(path, "export const c = new Date('2026-01-05');\n")).toEqual([]);
  });

  it("a plugin's renderers may read the clock", async () => {
    expect(await lint('src/plugins/estimate/renderers/probe.ts', 'export const a = Date.now();\n')).toEqual([]);
  });
});
