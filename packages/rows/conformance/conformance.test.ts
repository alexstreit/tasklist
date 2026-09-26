// Runs the language-neutral conformance suite (README.md): shape checks for every case, and the
// cases of the enabled stages against parseRows.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/index';

const dir = fileURLToPath(new URL('.', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(dir, ...parts), 'utf8');

type ErrorClass = 'syntax' | 'structural' | 'validation';
type Stage = 'base' | 'types' | 'extensions';

// Task 17 enables base, Task 18 adds types, Task 19 adds extensions.
const ENABLED_STAGES = new Set<Stage>(['base', 'types', 'extensions']);
interface ExpectedError { class: ErrorClass; code: string; line: number }
interface ExpectedRow {
  line: number;
  lead: string | null;
  indent?: number;
  values?: Record<string, string>;
  overflow?: string[];
  markers?: string[];
  id?: string | null;
  aliases?: string[];
  parent?: number | null;
}
interface Expected {
  spec: string[];
  stage: Stage;
  disputed?: boolean;
  failed: boolean;
  errors: ExpectedError[];
  table?: string;
  columns?: { name: string; type: string; implicit?: boolean }[];
  rows?: ExpectedRow[];
}
interface Options {
  mode?: 'tolerant' | 'strict';
  filename?: string;
  extensions?: boolean;
  profiles?: Record<string, string>;
  profileFiles?: Record<string, string>;
  defaultProfile?: string;
}
interface Case { name: string; input: string; options: Options; expected: Expected }

const STRICT = '--strict';

const cases: Case[] = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((name) => ({
    name,
    input: read(name, 'input.rows'),
    options: existsSync(join(dir, name, 'options.json')) ? JSON.parse(read(name, 'options.json')) : {},
    expected: JSON.parse(read(name, 'expected.json')),
  }));
const byName = new Map(cases.map((c) => [c.name, c]));

// The error-code table in README.md is the vocabulary: `| \`code\` | class | … |`.
const codes = new Map(
  [...read('README.md').matchAll(/^\| `([a-z-]+)` +\| (syntax|structural|validation) /gm)].map((m) => [m[1], m[2]]),
);
const questions = read('QUESTIONS.md');
const openQuestions = questions.split('\n## Resolved')[0];

const sortErrors = (errors: ExpectedError[]) =>
  [...errors]
    .map((e) => ({ class: e.class, code: e.code, line: e.line }))
    .sort((a, b) => a.line - b.line || a.code.localeCompare(b.code) || a.class.localeCompare(b.class));
const fails = (e: Expected) => e.errors.some((x) => x.class !== 'validation');

describe('conformance suite shape', () => {
  it('has cases and an error-code table', () => {
    expect(cases.length).toBeGreaterThan(100);
    expect(codes.size).toBeGreaterThan(30);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s is well formed', (name, c) => {
    const files = readdirSync(join(dir, name)).sort();
    expect(files.filter((f) => !['expected.json', 'input.rows', 'options.json'].includes(f))).toEqual([]);

    const o = c.options;
    expect(Object.keys(o).filter((k) => !['mode', 'filename', 'extensions', 'profiles', 'profileFiles', 'defaultProfile'].includes(k))).toEqual([]);
    expect([undefined, 'tolerant', 'strict']).toContain(o.mode);
    expect(name.endsWith(STRICT)).toBe(o.mode === 'strict');

    const e = c.expected;
    expect(Object.keys(e).filter((k) => !['spec', 'stage', 'disputed', 'failed', 'errors', 'table', 'columns', 'rows'].includes(k))).toEqual([]);
    expect(e.spec.length).toBeGreaterThan(0);
    expect(typeof e.failed).toBe('boolean');
    expect(['base', 'types', 'extensions']).toContain(e.stage);
    for (const err of e.errors) {
      expect(codes.get(err.code), `code ${err.code}`).toBe(err.class);
      expect(Number.isInteger(err.line) && err.line >= 1).toBe(true);
    }
    if (o.mode !== 'strict') {
      expect(e.failed).toBe(false);
      expect(e.rows).toBeDefined();
    }
    for (const r of e.rows ?? []) {
      expect(Object.keys(r).filter((k) => !['line', 'lead', 'indent', 'values', 'overflow', 'markers', 'id', 'aliases', 'parent'].includes(k))).toEqual([]);
      expect(r).toHaveProperty('line');
      expect(r).toHaveProperty('lead');
    }
    if (e.disputed) expect(openQuestions, 'disputed cases are listed under an open question in QUESTIONS.md').toContain(`\`${name.replace(STRICT, '')}\``);
  });

  it('every case with a syntax or structural error has a strict variant expecting failure', () => {
    const missing = cases
      .filter((c) => !c.name.endsWith(STRICT) && fails(c.expected) && !byName.has(c.name + STRICT))
      .map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it.each(cases.filter((c) => c.name.endsWith(STRICT)).map((c) => [c.name, c] as const))(
    '%s matches its tolerant case',
    (name, c) => {
      const base = byName.get(name.slice(0, -STRICT.length));
      expect(base, 'tolerant case exists').toBeDefined();
      expect(c.input).toBe(base!.input);
      expect(c.options).toEqual({ ...base!.options, mode: 'strict' });
      expect(sortErrors(c.expected.errors)).toEqual(sortErrors(base!.expected.errors));
      expect(c.expected.failed).toBe(fails(base!.expected));
      expect(c.expected.disputed).toBe(base!.expected.disputed);
      expect(c.expected.stage).toBe(base!.expected.stage);
    },
  );

  it('every case named in QUESTIONS.md exists', () => {
    const named = [...questions.matchAll(/`((?:base|ext|anchors|plan)-[a-z0-9.-]+)`/g)].map((m) => m[1]);
    expect(named.filter((n) => !byName.has(n))).toEqual([]);
  });
});

describe('conformance cases', () => {
  const later = cases.filter((c) => !ENABLED_STAGES.has(c.expected.stage));
  if (later.length > 0) it.skip.each(later.map((c) => [c.name, c.expected.stage] as const))('%s (stage %s)', () => {});

  it.each(cases.filter((c) => ENABLED_STAGES.has(c.expected.stage)).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { profileFiles, ...options } = c.options;
    const doc = parseRows(c.input, { ...options, resolveProfile: (path) => profileFiles?.[path] });
    const e = c.expected;

    expect(doc.failed).toBe(e.failed);
    expect(sortErrors(doc.errors)).toEqual(sortErrors(e.errors));

    const columns = doc.schema.columns;
    if (e.table !== undefined) expect(doc.schema.table).toBe(e.table);
    if (e.columns) {
      expect(columns.map((col) => ({ name: col.name, type: col.type, ...(col.implicit ? { implicit: true } : {}) }))).toEqual(e.columns);
    }
    if (!e.rows) return;

    // A column whose name an earlier column already has is keyed name@index (README).
    const keys = columns.map((col, i) => (columns.findIndex((other) => other.name === col.name) < i ? `${col.name}@${i}` : col.name));
    const actual = doc.rows.map((row) => ({
      line: row.line,
      lead: row.lead.text,
      indent: row.indent.width,
      values: Object.fromEntries(row.cells.flatMap((cell, i) => (i > 0 && cell && cell.text !== null ? [[keys[i], cell.text]] : []))),
      overflow: row.overflow.map((cell) => (cell.name ? `${cell.name.text}=${cell.text ?? ''}` : cell.text)),
      markers: row.markers.map((m) => m.name),
      id: row.id,
      aliases: row.aliases,
      parent: row.parent?.line ?? null,
    }));
    const wanted = e.rows.map((r) => ({ indent: 0, values: {}, overflow: [], markers: [], id: null, aliases: [], parent: null, ...r }));
    expect(actual).toEqual(wanted);
  });
});
