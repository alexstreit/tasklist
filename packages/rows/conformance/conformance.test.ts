// Runs the language-neutral conformance suite (README.md). The shape checks run now; the cases
// themselves run against parseRows once the library exports it (Task 17).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as rows from '../src/index';

const dir = fileURLToPath(new URL('.', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(dir, ...parts), 'utf8');

type ErrorClass = 'syntax' | 'structural' | 'validation';
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
  needs?: ('types' | 'extensions')[];
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
    expect(Object.keys(e).filter((k) => !['spec', 'needs', 'disputed', 'failed', 'errors', 'table', 'columns', 'rows'].includes(k))).toEqual([]);
    expect(e.spec.length).toBeGreaterThan(0);
    expect(typeof e.failed).toBe('boolean');
    for (const n of e.needs ?? []) expect(['types', 'extensions']).toContain(n);
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
    if (e.disputed) expect(questions, 'disputed cases are listed in QUESTIONS.md').toContain(`\`${name.replace(STRICT, '')}\``);
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
      expect(c.expected.needs).toEqual(base!.expected.needs);
    },
  );

  it('every case named in QUESTIONS.md exists', () => {
    const named = [...questions.matchAll(/`((?:base|ext|anchors|plan)-[a-z0-9.-]+)`/g)].map((m) => m[1]);
    expect(named.filter((n) => !byName.has(n))).toEqual([]);
  });
});

// Until Task 17 the library exports nothing, and the cases below are skipped.
const parseRows = (rows as Record<string, any>).parseRows as ((text: string, options?: object) => any) | undefined;

describe('rows library', () => {
  it('does not export parseRows yet (Task 17 turns the suite on)', () => {
    expect(parseRows).toBeUndefined();
  });
});

describe.skipIf(!parseRows)('conformance cases', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { profileFiles, ...options } = c.options;
    const doc = parseRows!(c.input, {
      ...options,
      resolveProfile: (path: string) => profileFiles?.[path],
    });
    const e = c.expected;

    expect(doc.failed).toBe(e.failed);
    expect(sortErrors(doc.errors)).toEqual(sortErrors(e.errors));

    // The projections below assume DESIGN §4's shapes; Task 17 fixes them to the real types.
    const columns: any[] = doc.schema.columns;
    if (e.table !== undefined) expect(doc.schema.table).toBe(e.table);
    if (e.columns) {
      expect(columns.map((col) => ({ name: col.name, type: col.type, ...(col.implicit ? { implicit: true } : {}) }))).toEqual(e.columns);
    }
    if (!e.rows) return;

    // A column whose name an earlier column already has is keyed name@index (README).
    const keys = columns.map((col, i) => (columns.findIndex((other) => other.name === col.name) < i ? `${col.name}@${i}` : col.name));
    const actual = doc.rows.map((row: any) => ({
      line: row.line,
      lead: row.lead.text,
      indent: row.indent.width,
      values: Object.fromEntries(
        row.cells.flatMap((cell: any, i: number) => (i > 0 && cell && cell.text !== null ? [[keys[i], cell.text]] : [])),
      ),
      overflow: row.overflow.map((cell: any) => (cell.name ? `${cell.name.text}=${cell.text}` : cell.text)),
      markers: row.markers.map((m: any) => m.name),
      id: row.id,
      aliases: row.aliases,
      parent: row.parent?.line ?? null,
    }));
    const wanted = e.rows.map((r) => ({ indent: 0, values: {}, overflow: [], markers: [], id: null, aliases: [], parent: null, ...r }));
    expect(actual).toEqual(wanted);
  });
});
