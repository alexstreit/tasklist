// The piece map (plan spec §3.7, §4.5): property-tested over seeded random compositions, so a
// failure names its seed, and checked by hand on the portfolio fixture.

import { describe, expect, it } from 'vitest';
import { PieceMap, recomposition } from '../../src/buffer/pieces';
import type { Composition, Mount } from '../../src/buffer/pieces';
import type { TextEdit } from '../../src/buffer';
import { portfolio, portfolioFiles } from '../support/portfolio';

/** mulberry32: a small seeded generator, so every run tests the same cases. */
function random(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function apply(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** A random plan-like file: items at a few depths, comments and blank lines; maybe no final newline, maybe empty. */
function file(rand: (n: number) => number, name: string): string {
  if (rand(8) === 0) return '';
  const lines: string[] = [];
  let depth = 0;
  for (let i = 0, n = 1 + rand(9); i < n; i++) {
    depth = Math.max(0, Math.min(depth + rand(3) - 1, 3));
    const kind = rand(6);
    lines.push(kind === 0 ? '' : `${'    '.repeat(depth)}${kind === 1 ? '// note' : `${name} ${i}`}`);
  }
  const text = lines.join('\n');
  return rand(3) === 0 ? text : `${text}\n`;
}

/** A random composition: a root, and files mounted on its item lines and on each other's, without loops. */
function composition(seed: number): Composition {
  const rand = random(seed);
  const names = ['root', 'a', 'b', 'c', 'd', 'e'].slice(0, 2 + rand(5));
  const texts = new Map(names.map((n) => [n, file(rand, n)]));
  const mounts: Mount[] = [];
  // Each file after the root is mounted once, on an item line of an earlier file.
  for (let i = 1; i < names.length; i++) {
    const host = names[rand(i)];
    const lines = texts.get(host)!.split('\n');
    const items = lines.flatMap((l, n) => (l.trim() !== '' && !l.trim().startsWith('//') ? [n + 1] : []));
    if (items.length === 0) continue;
    mounts.push({ file: host, line: items[rand(items.length)], target: names[i] });
  }
  return { root: 'root', text: (f) => texts.get(f)!, mounts, comment: () => '//' };
}

/** Each file's text, cut back out of the composed text. */
function cut(map: PieceMap, text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of map.runs) if (!r.joint) out.set(r.file, (out.get(r.file) ?? '') + text.slice(r.at, r.at + r.to - r.from));
  return out;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe('the piece map', () => {
  it('composes the portfolio: alpha after Product A’s line, beta after Product B’s', () => {
    const files = portfolioFiles();
    const texts = new Map([['portfolio.plan', portfolio], ...[...files].map(([p, t]) => [p, t!] as [string, string])]);
    const { map, text } = PieceMap.build({
      root: 'portfolio.plan',
      text: (f) => texts.get(f)!,
      mounts: [
        { file: 'portfolio.plan', line: 6, target: 'teams/alpha.plan' },
        { file: 'portfolio.plan', line: 7, target: 'teams/beta.plan' },
      ],
      comment: () => '//',
    });
    const master = portfolio.split(/(?<=\n)/);
    expect(text).toBe([...master.slice(0, 6), texts.get('teams/alpha.plan'), master[6], texts.get('teams/beta.plan'), ...master.slice(7)].join(''));
    expect(map.runs.map((r) => [r.file, r.depth, r.joint])).toEqual([
      ['portfolio.plan', 0, false],
      ['teams/alpha.plan', 1, false],
      ['portfolio.plan', 0, false],
      ['teams/beta.plan', 1, false],
      ['portfolio.plan', 0, false],
    ]);
    expect(map.segments.map((s) => [s.file, s.mount.line])).toEqual([
      ['teams/alpha.plan', 6],
      ['teams/beta.plan', 7],
    ]);
  });

  it('places a segment after the mount row’s subtree, comments indented under its last child included (§4.2)', () => {
    const root = 'A | mount=x\n    child\n        // the child’s note\n// not the subtree’s\nB\n';
    const { text } = PieceMap.build({ root: 'r', text: (f) => (f === 'r' ? root : 'X\n'), mounts: [{ file: 'r', line: 1, target: 'x' }], comment: () => '//' });
    expect(text).toBe('A | mount=x\n    child\n        // the child’s note\nX\n// not the subtree’s\nB\n');
  });

  it('puts nested segments innermost first, and a joint after a file with no final newline', () => {
    const root = 'A | mount=x\n    B | mount=y\nC\n';
    const { map, text } = PieceMap.build({
      root: 'r',
      text: (f) => ({ r: root, x: 'X', y: 'Y\n' })[f]!,
      mounts: [
        { file: 'r', line: 1, target: 'x' },
        { file: 'r', line: 2, target: 'y' },
      ],
      comment: () => '//',
    });
    expect(text).toBe('A | mount=x\n    B | mount=y\nY\nX\nC\n');
    expect(map.runs.map((r) => (r.joint ? `joint:${r.file}` : r.file))).toEqual(['r', 'y', 'x', 'joint:x', 'r']);
    // The joint is the character after X; the position before it is x's end.
    const joint = text.indexOf('X') + 1;
    expect(map.charAt(joint)).toBe('joint');
    expect(map.toFile(joint)).toEqual({ file: 'x', offset: 1 });
    expect(map.toFile(joint + 1)).toEqual({ file: 'r', offset: root.indexOf('C') });
  });

  it.each(SEEDS)('composing and cutting out each file gives every file back (seed %i)', (seed) => {
    const c = composition(seed);
    const { map, text } = PieceMap.build(c);
    expect(map.length).toBe(text.length);
    for (const [f, t] of cut(map, text)) expect(t, f).toBe(c.text(f));
    for (const r of map.runs) if (r.joint) expect(text[r.at]).toBe('\n');
    expect(map.aligned(c.text)).toBe(true);
  });

  it.each(SEEDS)('positions translate both ways (seed %i)', (seed) => {
    const c = composition(seed);
    const { map, text } = PieceMap.build(c);
    for (let pos = 0; pos <= text.length; pos++) {
      const at = map.toFile(pos);
      expect(map.toComposed(at.file, at.offset), `composed ${pos}`).toBe(pos);
    }
    for (const f of map.files()) {
      const t = c.text(f);
      for (let offset = 0; offset <= t.length; offset++) {
        const pos = map.toComposed(f, offset);
        const back = map.toFile(pos);
        // The one exception: a file's end after its final newline, when another piece follows.
        const exception = offset === t.length && t.endsWith('\n') && back.file !== f;
        if (!exception) expect(back, `${f} ${offset}`).toEqual({ file: f, offset });
        else expect(back.offset === 0 || map.runs.some((r) => r.file === back.file && r.from === back.offset), `${f} ${offset}`).toBe(true);
      }
    }
  });

  it.each(SEEDS)('an accepted edit lands in one file, and the map follows it (seed %i)', (seed) => {
    const c = composition(seed);
    const rand = random(seed * 7919);
    let { map, text } = PieceMap.build(c);
    const texts = new Map(map.files().map((f) => [f, c.text(f)]));
    for (let step = 0; step < 20; step++) {
      const from = rand(text.length + 1);
      const to = Math.min(text.length, from + (rand(3) === 0 ? 0 : rand(6)));
      const insert = ['', 'x', '\n', 'yz\n', '    '][rand(5)];
      const split = map.split([{ from, to, insert }], (p) => text[p]);
      if (!split) {
        // Refused: it crosses a boundary, touches a joint, or would join lines of two files.
        let i = 0;
        while (i + 1 < map.runs.length && map.runs[i + 1].at <= from) i++;
        const r = map.runs[i];
        const runEnd = r.at + (r.joint ? 1 : r.to - r.from);
        const next = map.runs[i + 1];
        expect(to > from, `insert refused at ${from}`).toBe(true);
        expect(r.joint || to > runEnd || (to === runEnd && next !== undefined && !next.joint), `refused ${from}–${to}`).toBe(true);
        continue;
      }
      for (const e of split) texts.set(e.file, apply(texts.get(e.file)!, [e]));
      text = apply(text, [{ from, to, insert }]);
      map = map.apply(split);
      expect(map.length).toBe(text.length);
      for (const [f, t] of cut(map, text)) expect(t, `${f} after step ${step}`).toBe(texts.get(f));
      expect(map.aligned((f) => texts.get(f)!)).toBe(true);
    }
  });

  it('refuses an edit across a boundary, on a joint, or joining a line to another file’s', () => {
    const root = 'A | mount=x\nB\n';
    const { map, text } = PieceMap.build({ root: 'r', text: (f) => (f === 'r' ? root : 'X'), mounts: [{ file: 'r', line: 1, target: 'x' }], comment: () => '//' });
    expect(text).toBe('A | mount=x\nX\nB\n');
    const at = (p: number) => text[p];
    // From X into B.
    expect(map.split([{ from: text.indexOf('X'), to: text.indexOf('B') + 1, insert: '' }], at)).toBeNull();
    // The joint after X.
    expect(map.split([{ from: text.indexOf('X') + 1, to: text.indexOf('X') + 2, insert: '' }], at)).toBeNull();
    // The newline ending A's line, which would join it to X.
    expect(map.split([{ from: text.indexOf('X') - 1, to: text.indexOf('X'), insert: '' }], at)).toBeNull();
    // Deleting A's whole line keeps the boundary at a line start.
    expect(map.split([{ from: 0, to: text.indexOf('X'), insert: '' }], at)).toEqual([{ file: 'r', run: 0, from: 0, to: 12, insert: '' }]);
    // Typing before the joint appends to x; after it, at B's line start, goes to r.
    expect(map.split([{ from: text.indexOf('X') + 1, to: text.indexOf('X') + 1, insert: '!' }], at)).toEqual([{ file: 'x', run: 1, from: 1, to: 1, insert: '!' }]);
    expect(map.split([{ from: text.indexOf('B'), to: text.indexOf('B'), insert: '!' }], at)).toEqual([{ file: 'r', run: 3, from: 12, to: 12, insert: '!' }]);
  });

  it('places a file’s own change around the segments inside it', () => {
    const root = 'A | mount=x\nB\nC\n';
    const { map } = PieceMap.build({ root: 'r', text: (f) => (f === 'r' ? root : 'X\n'), mounts: [{ file: 'r', line: 1, target: 'x' }], comment: () => '//' });
    // Deleting A's and B's lines in r: the segment between them stays.
    const placed = map.place('r', [{ from: 0, to: root.indexOf('C'), insert: '' }]);
    expect(placed.composed).toEqual([
      { from: 0, to: 12, insert: '' },
      { from: 14, to: 16, insert: '' },
    ]);
  });

  it.each(SEEDS.slice(0, 100))('recomposing changes only the segments that come and go (seed %i)', (seed) => {
    const c = composition(seed);
    const before = PieceMap.build({ ...c, mounts: c.mounts.slice(0, Math.max(0, c.mounts.length - 1)) });
    const after = PieceMap.build(c);
    const edits = recomposition(before, after);
    expect(apply(before.text, edits)).toBe(after.text);
  });
});

describe('settling changes off the boundaries', () => {
  it.each(SEEDS)('a settled change makes the same text, and lands in the same file (seed %i)', (seed) => {
    const c = composition(seed);
    const rand = random(seed * 104729);
    const { map, text } = PieceMap.build(c);
    for (let step = 0; step < 20; step++) {
      const from = rand(text.length + 1);
      const to = Math.min(text.length, from + rand(8));
      const insert = ['', 'x\n', '\n', 'yz\n'][rand(4)];
      const change = [{ from, to, insert }];
      const at = (p: number) => text[p];
      const split = map.split(change, at);
      const moved = map.settle(change, at);
      if (!split || !moved) continue;
      expect(apply(text, moved)).toBe(apply(text, change));
      const after = map.split(moved, at);
      expect(after?.map((e) => e.file)).toEqual(split.map((e) => e.file));
      // Moved off the boundary: it no longer ends where another file's piece starts.
      const r = map.runs[after![0].run];
      expect(moved[0].to).toBeLessThan(r.at + (r.to - r.from));
    }
  });
});

describe('a line deleted with the newline before it (Task 37)', () => {
  it('stays in one piece: "\\nB" before a segment becomes "B\\n" after it', () => {
    const root = 'A | mount=x\nB\nC\n';
    const { map, text } = PieceMap.build({ root: 'r', text: (f) => (f === 'r' ? root : 'X\n'), mounts: [{ file: 'r', line: 1, target: 'x' }], comment: () => '//' });
    const at = (p: number) => text[p];
    // rows deletes B's line from the newline that ends A's, which is the last character of the piece before x.
    const placed = map.place('r', [{ from: root.indexOf('\nB'), to: root.indexOf('\nC'), insert: '' }], at);
    expect(placed.edits).toEqual([{ file: 'r', run: 2, from: root.indexOf('B'), to: root.indexOf('C'), insert: '' }]);
    expect(apply(text, placed.composed)).toBe('A | mount=x\nX\nC\n');
    expect(map.apply(placed.edits).aligned((f) => (f === 'r' ? 'A | mount=x\nC\n' : 'X\n'))).toBe(true);
  });

  it.each(SEEDS.slice(0, 200))('makes the file’s text, and leaves every piece ending a line (seed %i)', (seed) => {
    const c = composition(seed);
    const { map, text } = PieceMap.build(c);
    const at = (p: number) => text[p];
    for (const file of map.files()) {
      const own = c.text(file);
      // Every place a piece of the file ends on a newline and another of its pieces follows.
      const runs = map.runs.filter((r) => !r.joint && r.file === file);
      for (let i = 0; i + 1 < runs.length; i++) {
        const from = runs[i].to - 1;
        if (from < 0 || own[from] !== '\n') continue;
        const end = own.indexOf('\n', runs[i + 1].from);
        if (end < 0 || end >= runs[i + 1].to) continue;
        const edit = { from, to: end, insert: '' };
        const placed = map.place(file, [edit], at);
        const after = cut(map.apply(placed.edits), apply(text, placed.composed));
        expect(after.get(file)).toBe(apply(own, [edit]));
        const texts = new Map([...after].map(([f, t]) => [f, t]));
        expect(map.apply(placed.edits).aligned((f) => texts.get(f) ?? c.text(f))).toBe(true);
      }
    }
  });
});

describe('recomposing keeps the root file’s lines (Task 37)', () => {
  it('moves segments around the root’s lines, not a root line with a segment', () => {
    const root = 'A\nB\nC\n';
    const texts = new Map([
      ['r', root],
      ['x', 'X1\nX2\nX3\n'],
      ['y', 'Y\n'],
    ]);
    const base = { root: 'r', text: (f: string) => texts.get(f)!, comment: () => '//' };
    // As after A and B swap their mounts: x moves from under A to under B, and y the other way.
    const before = PieceMap.build({ ...base, mounts: [{ file: 'r', line: 1, target: 'x' }, { file: 'r', line: 2, target: 'y' }] });
    const after = PieceMap.build({ ...base, mounts: [{ file: 'r', line: 2, target: 'x' }, { file: 'r', line: 1, target: 'y' }] });
    const edits = recomposition(before, after);
    expect(apply(before.text, edits)).toBe(after.text);
    // No edit touches a root line: B's line stays where it was, and an undo entry on it with it.
    for (const run of before.map.runs.filter((r) => r.file === 'r')) {
      for (const e of edits) expect(e.from >= run.at + run.to - run.from || e.to <= run.at).toBe(true);
    }
  });
});
