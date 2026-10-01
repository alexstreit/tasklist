// Every refusal the grid can meet is shown in plain words (spec §4b.2). The
// reasons are produced by rows itself, so a change to its wording fails here.

import { describe, expect, it } from 'vitest';
import { deleteRow, insertRow, moveRow, parseRows, setAnchor, setCell, setLevel, setMarker } from 'rows';
import type { EditResult } from 'rows';
import { plainRefusal } from '../../src/grid/messages';

const NEST = '---\nnest: parent\nmarkers: done=~\ncolumns: est:duration unit=h | owner | notes\n---\n';
const reason = (result: EditResult): string => {
  if (!('refused' in result)) throw new Error('expected a refusal');
  return result.refused;
};
const FALLBACK = plainRefusal('something rows has never said');

describe('plainRefusal', () => {
  const nested = parseRows(`${NEST}A\n        B\n    C\n`);
  const flat = parseRows('A\nB\n');
  const unnamable = parseRows('---\ncolumns: est | my.notes | done:bool\nmarkers: x=~\n---\nA | est=1 | 2\n');
  const anchored = parseRows('A {#a}\nB | id=b\n');
  const unanchored = parseRows('A\nB | id=b\n');
  const cases: [string, string][] = [
    ['anchored key', reason(setCell(anchored, anchored.rows[0], anchored.schema.key!, null))],
    ['unnamable column', reason(setCell(unnamable, unnamable.rows[0], unnamable.schema.columns[2], 'x'))],
    ['insert indent', reason(insertRow(parseRows(`${NEST}A\n    B\n`), 'end', 2, 'X'))],
    ['no nesting', reason(setLevel(flat, flat.rows[1], 1))],
    ['level not open', reason(setLevel(nested, nested.rows[0], 1))],
    ['no previous sibling', reason(moveRow(nested, nested.rows[0], 'up'))],
    ['no next sibling', reason(moveRow(nested, nested.rows[2], 'down'))],
    ['frontmatter delimiter', reason(moveRow(parseRows('A\n---\n'), parseRows('A\n---\n').rows[1], 'up'))],
    ['last anchor', reason(deleteRow(anchored, anchored.rows[0]))],
    ['last anchor, removing references', reason(deleteRow(anchored, anchored.rows[0], { removeReferences: true }))],
    ['first anchor', reason(setAnchor(unanchored, unanchored.rows[0], 'a'))],
    ['grid behind the buffer', 'the grid is still reading the last change; try again'],
  ];

  it.each(cases)('%s', (_, why) => {
    const message = plainRefusal(why);
    expect(message).not.toBe(FALLBACK);
    // None of rows' vocabulary reaches the reader; "row" is what the grid shows.
    expect(message).not.toMatch(/\b(anchor|nest|level \d|sibling|frontmatter|indent of)\b/i);
  });

  it('the example wording', () => {
    expect(plainRefusal(reason(deleteRow(anchored, anchored.rows[0])))).toBe(
      'Deleting this task would turn off task IDs in this file, and other tasks still use them. Give another task an ID first.',
    );
    expect(plainRefusal(reason(setAnchor(unanchored, unanchored.rows[0], 'a')))).toBe(
      'Another task has a cell written as id=…, which would start to mean a task ID. Change that cell first.',
    );
  });

  it('setMarker refuses in the words setCell does', () => {
    const doc = parseRows('---\ncolumns: est | my.notes | done:bool\n---\nA | est=1\n');
    const result = setMarker(doc, doc.rows[0], 'done', true);
    if ('refused' in result) expect(plainRefusal(result.refused)).not.toBe(FALLBACK);
  });
});
