// The messy fixtures (tests/fixtures/messy*.plan): what the app reports on each
// line, which fixes it offers, and what those fixes write. These tests are the
// reference for the fixtures; the fix invariant is in fix-invariant.test.ts.

import { describe, expect, it } from 'vitest';
import { applyEdits } from 'rows';
import { analyze } from '../../src/app/registry';
import type { Model } from '../../src/core';
import messyRaw from '../fixtures/messy.plan?raw';
import settingsRaw from '../fixtures/messy-settings.plan?raw';
import unclosedRaw from '../fixtures/messy-unclosed.plan?raw';

/** As the app loads a file: tabs become 4 spaces before the text reaches the buffer (spec §2.2). */
const load = (raw: string) => raw.replace(/\t/g, '    ');
const FILES = { 'messy.plan': load(messyRaw), 'messy-settings.plan': load(settingsRaw), 'messy-unclosed.plan': load(unclosedRaw) };

/** Each line's diagnostics as `code` or `code: fix, fix`, sorted within the line. */
function byLine(model: Model): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const d of model.diagnostics) {
    const fixes = (d.fixes ?? []).map((f) => `${f.label} (${f.tier})`);
    (out[d.line] ??= []).push(fixes.length > 0 ? `${d.code}: ${fixes.join(', ')}` : d.code);
  }
  return sorted(out);
}
const sorted = (lines: Record<number, string[]>) => Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, [...v].sort()]));

const CONVERT = 'Add unit=h hpd=8 dpw=5 (click)';

describe('messy.plan', () => {
  const model = analyze(FILES['messy.plan'], { filename: 'messy.plan' });
  const lines = byLine(model);

  it('reports each line, with its fixes', () => {
    expect(lines).toEqual(sorted({
      4: ['unknown-key'], // x-team on line 3 reports nothing
      7: ['bad-indent: Indent 0 (auto)', `unconvertible-duration: ${CONVERT}`],
      8: [`unconvertible-duration: ${CONVERT}`],
      // {#login} twice: both rows report it, and only the later one has the fix.
      9: ['duplicate-id'],
      10: [`invalid-value: ${CONVERT}`, 'duplicate-id: Rename the later one (confirm)'],
      11: ['invalid-value'],
      12: ['too-many-cells: Rejoin into notes (click), Delete extra values (confirm)', `unconvertible-duration: ${CONVERT}`],
      14: ['unterminated-quote: Rewrite the cell (auto)', 'bad-indent: Rewrite the indent (auto)'],
      15: ['repeated-marker: Remove extra marker (click)'],
      16: ['id-case-conflict'],
      // `priority=high` names no column, so it is read as the notes value, with a structural
      // error; rejoining quotes it, which clears the error.
      17: [
        'invalid-cell-name: Rejoin into notes (click), Delete extra values (confirm)',
        'id-case-conflict: Rename the later one (confirm)',
        `unconvertible-duration: ${CONVERT}`,
      ],
      18: ['column-set-twice: Keep owner=sam (confirm), Keep owner=priya (confirm)', `unconvertible-duration: ${CONVERT}`],
      // No notes cell to rejoin into.
      19: ['unnamed-after-named: Delete extra values (confirm)'],
      20: ['text-after-quote: Rewrite the cell (auto)'],
      21: ['invalid-value'],
      22: [`unconvertible-duration: ${CONVERT}`], // the tab was converted on load: no error left
      24: ['heading-line: Quote the title (auto)'],
      26: ['unknown-escape: Rewrite the cell (auto)', `unconvertible-duration: ${CONVERT}`],
      27: ['negative-value'],
      28: ['parent-mismatch: Use indentation (click)', `unconvertible-duration: ${CONVERT}`],
      // An indented row's parent comes from its indentation, so `parent=#perms` is a mismatch, not a cycle.
      29: ['parent-mismatch: Use indentation (click)', `unconvertible-duration: ${CONVERT}`],
      // A row without a title also breaks `required` on the title.
      30: ['row-begins-with-delimiter', 'required', `unconvertible-duration: ${CONVERT}`],
      31: ['html-comment: Make it a comment (confirm)'],
      32: ['invalid-value'],
      33: ['unresolved-ref', 'parent-mismatch: Use indentation (click)', `unconvertible-duration: ${CONVERT}`],
    }));
  });

  it('reads the tree through the bad indents', () => {
    const titles = (nodes: Model['roots'], depth = 0): string[] => nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.title}`, ...titles(n.children, depth + 1)]);
    const tree = titles(model.roots);
    // Consent screen at indent 12 is one level down; Token refresh at 8 is recovered as OAuth's child.
    expect(tree.slice(0, 10)).toEqual([
      'Kickoff and planning',
      'Auth',
      '  Login page',
      '  Password reset',
      '    Email templates',
      '  OAuth (Google)',
      '    Consent screen',
      '    Token refresh',
      '  ~Session timeout',
      'API',
    ]);
    expect(tree).toContain('  Webhooks');
  });

  it('rejoins the overflow into notes, and the value reads back exactly', () => {
    const d = model.diagnostics.find((x) => x.code === 'too-many-cells')!;
    const after = analyze(applyEdits(model.doc.text, d.fixes![0].edits), { filename: 'messy.plan' });
    expect(after.doc.text.split('\n')[11]).toBe('    OAuth (Google)            | +1d     |       | "call Bob | then Alice"');
    expect(after.doc.rows.find((r) => r.line === 12)!.cells[3]!.text).toBe('call Bob | then Alice');
  });

  it('warns that the later duplicate ID is referenced, when it is', () => {
    const referenced = analyze(`${FILES['messy.plan']}Login help | 1h | | | parent=#login\n`, { filename: 'messy.plan' });
    const fix = referenced.diagnostics.find((d) => d.code === 'duplicate-id' && d.fixes)!.fixes![0];
    expect(fix.warning).toBe("A row refers to #login. It isn't clear which task it meant, so check it after renaming.");
    expect(fix.preview).toBe('-     Password reset {#login}   | 6       | priya | reuse email templates\n+     Password reset {#login-2}   | 6       | priya | reuse email templates');
    // Unreferenced, there is nothing to warn about.
    expect(model.diagnostics.find((d) => d.code === 'duplicate-id' && d.fixes)!.fixes![0].warning).toBeUndefined();
  });
});

describe('messy-settings.plan', () => {
  const model = analyze(FILES['messy-settings.plan'], { filename: 'messy-settings.plan' });

  it('reports each declaration error, with the settings fixes', () => {
    expect(byLine(model)).toEqual(sorted({
      3: ['invalid-sep: Remove this setting (confirm)'],
      4: [
        'duplicate-column-name: Rename column… (confirm)',
        // An unknown type offers the near miss first, then removing the type, which leaves the
        // text column it is read as.
        'unknown-type: Change type to date (click), Remove the type (click)',
        // The fix removes the malformed type, leaving a text column, as it is read now.
        'malformed-type: Remove this option (confirm)',
        'invalid-option-value: Remove this option (confirm)',
        // Q42: the profile's `done` marker conflicts with the file's `done:text`, so the error is on
        // that declaration, not profile-has-errors on line 2, and the fix makes it a checkbox column.
        'marker-column-not-bool: Make done a checkbox column (confirm)',
      ],
      6: ['override-differs'],
    }));
    expect(model.roots[0].children[0].title).toBe('~Write copy'); // the marker is ignored
  });

  it('points the done error at the declaration, and the checkbox fix makes ~ a done marker again', () => {
    const d = model.diagnostics.find((x) => x.code === 'marker-column-not-bool')!;
    expect(model.doc.text.slice(d.span!.from, d.span!.to)).toBe('done:text');
    const after = analyze(applyEdits(model.doc.text, d.fixes![0].edits), { filename: 'messy-settings.plan' });
    expect(after.doc.text.split('\n')[3]).toMatch(/\| done:bool$/);
    expect(after.roots[0].children[0]).toMatchObject({ title: 'Write copy', done: true });
  });

  it('puts dave in the second owner column, which the padding exception writes', () => {
    const owners = model.roots[0].children.map((n) => [n.title, n.fields[1]?.text ?? '', n.fields[2]?.text ?? '']);
    expect(owners).toEqual([
      ['~Write copy', 'alice', ''],
      ['Design', 'carol', ''],
      ['Build', '', 'dave'],
      ['Review', '', ''],
    ]);
  });

  it('offers a free name for the duplicate column, and changes only the declaration', () => {
    const fix = model.diagnostics.find((d) => d.code === 'duplicate-column-name')!.fixes![0];
    expect(fix.input!.value).toBe('owner2');
    expect(model.doc.text.slice(fix.input!.span.from, fix.input!.span.to)).toBe('owner');
    expect(fix.preview).toContain('+ columns: est:duration unit=h hpd=8 dpw=5 | owner:text | owner2:text | notes:text');
  });
});

describe('messy-unclosed.plan', () => {
  const model = analyze(FILES['messy-unclosed.plan'], { filename: 'messy-unclosed.plan' });

  it('has no frontmatter: the settings lines are rows, and the file is still read as a plan', () => {
    expect(byLine(model)).toEqual({ 1: ['unclosed-frontmatter: Close settings (confirm)'], 3: ['invalid-value'], 5: ['override-differs'] });
    expect(model.roots.map((n) => n.title)).toEqual(['profile: plan', 'columns: est:duration unit=h hpd=8 dpw=5', 'Website relaunch']);
    // ~Domain renewal is done before the fix too, because a .plan file uses the plan profile.
    expect(model.roots[2].children[2]).toMatchObject({ title: 'Domain renewal', done: true });
  });

  it('"Close settings" inserts --- after line 3, the last key: value line', () => {
    const fix = model.diagnostics[0].fixes![0];
    expect(fix.preview).toBe('- columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text\n+ columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text\n+ ---');
    const after = analyze(applyEdits(model.doc.text, fix.edits), { filename: 'messy-unclosed.plan' });
    expect(after.doc.text.split('\n').slice(0, 5)).toEqual(['---', 'profile: plan', 'columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text', '---', '']);
    expect(after.roots.map((n) => n.title)).toEqual(['Website relaunch']);
    expect(after.roots[0].children[2]).toMatchObject({ title: 'Domain renewal', done: true });
  });
});
