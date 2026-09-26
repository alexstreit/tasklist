// Generated rows files for property tests: general files mixing every construct, and nested files
// whose rows carry markers and anchors and reference each other.
import type { ParseOptions } from '../src/index';

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FM_LINES = [
  'sep: ;', 'sep: ,', 'sep: /', 'sep: ab', 'comment: #', 'comment: --', 'comment: "a|b"', 'table: t', 'table: "q\\"x"',
  'columns: est | owner | notes', 'columns: a:enum[x, y] | b', 'columns: 2bad | dup | dup', 'columns: x:number unit=h |',
  'lead: task', 'profile: p', 'profile: ./q.rows', 'profile: missing', 'format: rows/2', '# c', '', '  x : y', 'bad line', 'k:',
  'markers: done=~ blocked=!', 'markers: x=# ok=+', 'nest: parent', 'nest: est', 'key: id', 'key:', 'order: est', 'order: -name',
  'include: a.rows | b.rows as t', 'columns: dep:ref many qualifier=lag:duration | parent | est:number',
];
const FRAGMENTS = [
  'Auth', 'Login page', '  ', '\t', ' | ', '|', ';', ',', '/', '"', '\\"', '\\\\', '\\n', '\\q', '"quoted | cell"', '""',
  'notes=', 'owner=bob', 'est=2d', 'ratio=1', 'name=x', '= ', '#', '# ', '{#a}', '{x}', '//', '--', '~', '2d', 'x', ' ',
  '!', '+', '{#b #c}', ' {#a}', '#a', '#b +2d, #a', 'parent=#a', 'parent=#b', 'id=a', 'dep=#c', '    ', '        ',
];

export function generate(random: () => number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const out: string[] = [];
  if (random() < 0.6) {
    out.push('---');
    const n = Math.floor(random() * 5);
    for (let i = 0; i < n; i++) out.push(pick(FM_LINES));
    if (random() < 0.9) out.push('---');
  }
  const body = Math.floor(random() * 8);
  for (let i = 0; i < body; i++) {
    let line = '';
    const parts = Math.floor(random() * 7);
    for (let j = 0; j < parts; j++) line += pick(FRAGMENTS);
    out.push(line);
  }
  const eol = random() < 0.2 ? '\r\n' : '\n';
  let text = out.join(eol);
  if (random() < 0.7) text += eol;
  if (random() < 0.1) text = '﻿' + text;
  return text;
}

export const PROFILES: ParseOptions = {
  profiles: { p: '---\ncolumns: a | b\nsep: ;\n---\n' },
  resolveProfile: (path) => (path === './q.rows' ? '---\ncolumns q\ncolumns: c\n---\n' : undefined),
};

/** Nested files whose rows reference each other, so parents, cycles and refs are exercised. */
export function generateNested(random: () => number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const ids = ['a', 'b', 'c', 'd', 'A'];
  const lines = ['---', 'nest: parent', 'markers: done=~', pick(['order: n', 'order: -dep', 'key: id', '# none']), 'columns: n:number | dep:ref many', '---'];
  const rows = 1 + Math.floor(random() * 8);
  for (let i = 0; i < rows; i++) {
    let line = pick(['', '', '  ', '    ', '        ', '\t']) + pick(['', '~', '~~']) + `R${i}`;
    if (random() < 0.6) line += ` {#${pick(ids)}}`;
    line += ` | ${pick(['1', '2', 'x', ''])}`;
    if (random() < 0.5) line += ` | #${pick(ids)}, #${pick(ids)} +1d`;
    if (random() < 0.6) line += ` | parent=#${pick(ids)}`;
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

/** The fixed set every property test runs over: 3,000 general files and 1,000 nested ones. */
export function generatedFiles(): { text: string; options: ParseOptions }[] {
  const random = mulberry32(17);
  return [
    ...Array.from({ length: 3000 }, () => ({ text: generate(random), options: PROFILES })),
    ...Array.from({ length: 1000 }, () => ({ text: generateNested(random), options: {} as ParseOptions })),
  ];
}
