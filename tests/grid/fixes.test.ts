// @vitest-environment jsdom
// The cell, settings and identity fixes in the grid (spec §4b.6.6): the
// settings banner, the badges, and the previews of confirm fixes. Run on the
// messy fixtures (tests/core/messy.test.ts says what each line reports).

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountGrid } from '../../src/grid';
import type { GridEditor } from '../../src/grid';
import messyRaw from '../fixtures/messy.plan?raw';
import settings from '../fixtures/messy-settings.plan?raw';
import unclosed from '../fixtures/messy-unclosed.plan?raw';

const WBS = -1;
const NOTES = 4;
// As the app loads a file (spec §2.2).
const messy = messyRaw.replace(/\t/g, '    ');

let buffer: InMemoryBuffer;
let grid: GridEditor;
let host: HTMLElement;
let changes: number;

function open(text: string, filename = 'test.plan'): void {
  host = document.createElement('div');
  document.body.append(host);
  buffer = new InMemoryBuffer(text);
  changes = 0;
  grid = mountGrid(buffer, host, { onCursorLine: () => {} });
  buffer.onChange(() => {
    changes++;
    grid.update(analyze(buffer.text(), filename));
  });
  grid.update(analyze(buffer.text(), filename));
}

afterEach(() => {
  grid.destroy();
  host.remove();
});

const row = (line: number) => host.querySelector<HTMLTableRowElement>(`tr[data-line="${line}"]`);
const cell = (line: number, column: number) => row(line)!.querySelector<HTMLTableCellElement>(`td[data-column="${column}"]`)!;
const lineOf = (line: number) => buffer.text().split('\n')[line - 1];
/** The problems list entries for a line. */
const problems = (line: number) => [...host.querySelectorAll<HTMLLIElement>(`.problems li[data-line="${line}"]`)];
const fixButton = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button.fix')].find((b) => b.textContent === label)!;
const fixOn = (line: number, label: string) => problems(line).map((li) => fixButton(li, label)).find(Boolean)!;
const bannerItems = () => [...host.querySelectorAll<HTMLElement>('.settings-banner .banner-item')];

describe('cell fixes', () => {
  it('"Rejoin into notes" puts the overflow back into notes, and it reads back exactly', () => {
    open('Login page | 4h | alice | call Bob | then Alice\n');
    fixOn(1, 'Rejoin into notes').click();
    expect(buffer.text()).toBe('Login page | 4h | alice | "call Bob | then Alice"\n');
    expect(cell(1, NOTES).textContent).toBe('call Bob | then Alice');
    expect(analyze(buffer.text()).diagnostics).toEqual([]);
  });

  it('shows a badge on the WBS cell listing the extra values', () => {
    open(messy);
    expect(cell(12, WBS).querySelector('.badge')!.textContent).toBe('+ then Alice');
    expect(cell(19, WBS).querySelector('.badge')!.textContent).toBe('+ 2d');
    expect(cell(8, WBS).querySelector('.badge')).toBeNull();
  });

  it('shows both values of a column set twice, and keeps the one chosen', () => {
    open(messy);
    expect(cell(18, WBS).querySelector('.badge')!.textContent).toBe('owner: sam / priya');
    fixOn(18, 'Keep owner=priya').click();
    expect(lineOf(18)).toBe('    Pagination                | 1w      | owner=sam | owner=priya');
    host.querySelector<HTMLButtonElement>('.problems .fix-preview button')!.click();
    expect(lineOf(18)).toBe('    Pagination                | 1w      | owner=priya');
  });
});

describe('the padding exception (DESIGN §6)', () => {
  it("pads with empty cells up to the duplicate owner column on a row with only a title", () => {
    open(settings, 'messy-settings.plan');
    // Review is line 10: est and the first owner are empty, and the second owner can't be named.
    const SECOND_OWNER = 4; // grid column: est, owner, then the second owner
    const input = () => host.querySelector<HTMLInputElement>('tbody input.cell-input')!;
    cell(10, SECOND_OWNER).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    input().value = 'erin';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(lineOf(10)).toBe('    Review |  |  | erin');
    expect(cell(10, SECOND_OWNER).textContent).toBe('erin');
  });
});

describe('confirm fixes', () => {
  it.each([
    ['messy.plan', messy],
    ['messy-settings.plan', settings],
    ['messy-unclosed.plan', unclosed],
  ])('every confirm fix in %s shows its preview, and cancelling writes nothing', (name, text) => {
    open(text, name);
    const confirms = analyze(text, name).diagnostics.flatMap((d) => (d.fixes ?? []).filter((f) => f.tier === 'confirm').map((f) => [d, f] as const));
    expect(confirms.length).toBeGreaterThan(0);
    for (const [d, fix] of confirms) {
      const li = problems(d.line).find((x) => fixButton(x, fix.label) && x.querySelector('.message')!.textContent === d.message)!;
      fixButton(li, fix.label).click();
      const preview = li.querySelector('.fix-preview')!;
      expect(preview.querySelector('pre')!.textContent, fix.label).toBe(fix.preview);
      fixButton(preview, 'Cancel').click();
      expect(li.querySelector('.fix-preview')).toBeNull();
    }
    expect(buffer.text()).toBe(text);
    expect(changes).toBe(0);
  });

  it('"Rename the later one" warns when the ID is referenced', () => {
    open(`${messy}Login help | 1h | | | parent=#login\n`);
    const li = problems(10).find((x) => fixButton(x, 'Rename the later one'))!;
    fixButton(li, 'Rename the later one').click();
    expect(li.querySelector('.fix-preview .fix-warning')!.textContent).toBe("A row refers to #login. It isn't clear which task it meant, so check it after renaming.");
    fixButton(li.querySelector('.fix-preview')!, 'Apply').click();
    expect(lineOf(10)).toBe('    Password reset {#login-2}   | 6       | priya | reuse email templates');
  });

  it('"Rename column…" takes the name the user types, and the preview follows it', () => {
    open(settings, 'messy-settings.plan');
    const item = bannerItems().find((x) => fixButton(x, 'Rename column…'))!;
    fixButton(item, 'Rename column…').click();
    const input = item.querySelector<HTMLInputElement>('.fix-input')!;
    expect(input.value).toBe('owner2');
    input.value = 'reviewer';
    input.dispatchEvent(new Event('input'));
    expect(item.querySelector('pre')!.textContent).toContain('+ columns: est:duration unit=h hpd=8 dpw=5 | owner:text | reviewer:text |');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(lineOf(4)).toContain('| owner:text | reviewer:text |');
    expect(host.querySelector('thead')!.textContent).toContain('reviewer');
  });
});

describe('the settings banner', () => {
  it('shows the settings problems above the grid, and the conversion fix once for every value it helps', () => {
    open(messy, 'messy.plan');
    const banner = host.querySelector<HTMLElement>('.settings-banner')!;
    expect(banner.hidden).toBe(false);
    expect(banner.nextElementSibling!.className).toBe('problems');
    const items = bannerItems().map((x) => x.querySelector('.message')!.textContent);
    expect(items).toEqual(['unknown frontmatter key "colum-widths"', '"1d" needs hpd on column est to convert to hours; treated as empty (and 11 more like it)']);
    fixButton(bannerItems()[1], 'Add unit=h hpd=8 dpw=5').click();
    expect(lineOf(2)).toBe('columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text');
    expect(bannerItems().map((x) => x.querySelector('.message')!.textContent)).toEqual(['unknown frontmatter key "colum-widths"']);
  });

  it('is hidden when the settings are fine', () => {
    open('A | 1h\n');
    expect(host.querySelector<HTMLElement>('.settings-banner')!.hidden).toBe(true);
  });

  it('"Close settings" on an unclosed block inserts --- after the last key: value line, and the settings rows leave the grid', () => {
    open(unclosed, 'messy-unclosed.plan');
    expect(row(2)!.classList.contains('item')).toBe(true);
    const item = bannerItems()[0];
    expect(item.querySelector('.message')!.textContent).toBe('No closing ---; the file has no frontmatter.');
    fixButton(item, 'Close settings').click();
    expect(buffer.text()).toBe(unclosed);
    fixButton(item.querySelector('.fix-preview')!, 'Apply').click();
    expect(buffer.text().split('\n').slice(0, 5)).toEqual(['---', 'profile: plan', 'columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text', '---', '']);
    expect(row(2)).toBeNull();
    expect(row(3)).toBeNull();
    expect(host.querySelector('tr.front-matter')).not.toBeNull();
    expect(row(9)!.classList.contains('done')).toBe(true); // ~Domain renewal
    expect(host.querySelector<HTMLElement>('.settings-banner')!.hidden).toBe(true);
  });
});

describe('every fixture case can be fixed without leaving the grid', () => {
  /** Apply the first fix anywhere in the grid (banner, problems list), confirming previews, until none is left. */
  function fixAll(): void {
    for (let round = 0; round < 60; round++) {
      const button = host.querySelector<HTMLButtonElement>('.problems button.fix');
      if (!button) return;
      const li = button.closest('li')!;
      button.click();
      const apply = li.querySelector<HTMLButtonElement>('.fix-preview button');
      if (apply) apply.click();
    }
  }

  it.each([
    ['messy.plan', messy],
    ['messy-settings.plan', settings],
    ['messy-unclosed.plan', unclosed],
  ])('%s', (name, text) => {
    open(text, name);
    fixAll();
    const left = analyze(buffer.text(), name).diagnostics.map((d) => `${d.line} ${d.code}`);
    // What remains has no fix in the spec: values to edit in their cell, a title to type, an
    // unknown key, and an override that differs from its children once they convert.
    const expected: Record<string, string[]> = {
      'messy.plan': ['4 unknown-key', '8 override-differs', '11 invalid-value', '21 invalid-value', '27 negative-value', '30 row-begins-with-delimiter', '30 required', '32 invalid-value'],
      'messy-settings.plan': ['5 override-differs'],
      'messy-unclosed.plan': ['6 override-differs'],
    };
    expect(left.sort()).toEqual(expected[name].sort());
  });
});
