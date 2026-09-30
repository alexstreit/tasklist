// The fix invariant (spec §4b.6.1): applying any fix the plan layer offers
// removes the diagnostic it is offered on, and adds no syntax or structural
// error. Checked on every fixture, and on every conformance input, read both as
// a plan (an unsaved document) and as a plain rows file.

import { describe, expect, it } from 'vitest';
import { applyEdits } from 'rows';
import type { TextEdit } from 'rows';
import { analyze } from '../../src/app/registry';
import type { Diagnostic, Fix, Model } from '../../src/core';

const fixtures = import.meta.glob(['../fixtures/*.plan', '../../examples/*.plan'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const inputs = import.meta.glob('../../packages/rows/conformance/*/input.rows', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Where a position ends up after the edits. */
function mapPos(pos: number, edits: TextEdit[]): number {
  let out = pos;
  for (const e of edits) {
    if (e.to <= pos) out += e.insert.length - (e.to - e.from);
    else if (e.from < pos) out -= pos - e.from; // inside a replaced span: its start
  }
  return out;
}

const lineAt = (text: string, pos: number) => text.slice(0, pos).split('\n').length;

/** Syntax and structural errors by code. */
function structural(model: Model): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of model.doc.errors) if (e.class !== 'validation') out.set(e.code, (out.get(e.code) ?? 0) + 1);
  return out;
}

type Case = [string, string, string | undefined, Diagnostic, Fix];

function casesOf(name: string, text: string, filename: string | undefined): Case[] {
  return analyze(text, filename).diagnostics.flatMap((d) => (d.fixes ?? []).map((fix): Case => [`${name}:${d.line} ${d.code} → ${fix.label}`, text, filename, d, fix]));
}

function check([, text, filename, d, fix]: Case): void {
  const before = analyze(text, filename);
  const source = before.doc.text; // the text the fix's edits are for, tabs converted
  const edited = applyEdits(source, fix.edits);
  const after = analyze(edited, filename);
  if (fix.tier === 'confirm') expect(fix.preview).toBeTruthy();
  // The diagnostic is gone from where it went: its span's start, or its line when it has no span.
  const lineStart = source.split('\n').slice(0, d.line - 1).join('\n').length + (d.line > 1 ? 1 : 0);
  const at = mapPos(d.span?.from ?? lineStart, fix.edits);
  const same = (x: Diagnostic) => x.code === d.code && (d.span ? x.span?.from === at : !x.span && x.line === lineAt(edited, at));
  expect(after.diagnostics.filter(same)).toEqual([]);
  // No syntax or structural error is added, counted by code.
  const [was, now] = [structural(before), structural(after)];
  for (const [code, n] of now) expect(n, code).toBeLessThanOrEqual(was.get(code) ?? 0);
}

describe('every fix on the fixtures removes its diagnostic and adds no error', () => {
  const cases = Object.entries(fixtures).flatMap(([path, raw]) => {
    const name = path.split('/').pop()!;
    return casesOf(name, raw.replace(/\t/g, '    '), name);
  });
  it('offers fixes to check', () => expect(cases.length).toBeGreaterThan(40));
  it.each(cases)('%s', (...c) => check(c));
});

describe('every fix on the conformance inputs removes its diagnostic and adds no error', () => {
  const seen = new Set<string>();
  const cases = Object.entries(inputs).flatMap(([path, text]) => {
    if (seen.has(text)) return [];
    seen.add(text);
    const name = path.split('/').slice(-2, -1)[0].replace(/--strict$/, '');
    return [...casesOf(`${name} (plan)`, text, undefined), ...casesOf(`${name} (rows)`, text, `${name}.rows`)];
  });
  it('offers fixes to check', () => expect(cases.length).toBeGreaterThan(40));
  it.each(cases)('%s', (...c) => check(c));
});
