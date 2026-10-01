// mintId (plan spec §4b.2): IDs made from titles, unique ignoring case, valid by the ID grammar.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { mintId } from '../../src/core';

const doc = (body: string) => analyze(`---\nprofile: plan\n---\n${body}`).doc;

/** The ID reads back as the row's ID from an anchor, with no diagnostic: it is valid by the grammar. */
function readsBack(id: string): void {
  const model = analyze(`---\nprofile: plan\n---\nX {#${id}}\n`);
  expect(model.doc.rows[0].id).toBe(id);
  expect(model.diagnostics).toEqual([]);
}

describe('mintId', () => {
  it.each([
    ['two rows both titled Review: the first', 'Review\nReview\n', 'Review', [], 'review'],
    ['two rows both titled Review: the second, with the first minted', 'Review\nReview\n', 'Review', ['review'], 'review-2'],
    ['two rows both titled Review: the second, with the first written', 'Review {#review}\nReview\n', 'Review', [], 'review-2'],
    ['REVIEW when review exists', 'Review {#review}\nREVIEW\n', 'REVIEW', [], 'review-2'],
    ['review when REVIEW exists, ignoring case', 'Review {#REVIEW}\n', 'review', [], 'review-2'],
    ['an accented title', '', "Écran d'accueil", [], 'ecran-d-accueil'],
    ['a title beginning with a digit', '', '2027 plan', [], '2027-plan'],
    ['an empty title', '', '', [], 'task'],
    ['a title of only punctuation', '', "?! — …'", [], 'task'],
    ['task when task exists', 'T {#task}\n', '', [], 'task-2'],
    ['the next free number', 'A {#api}\nB {#api-2}\nC | x\n', 'API', ['api-3'], 'api-4'],
    ['an ID in a key cell counts', 'B {#b}\nA | id=docs\n', 'Docs', [], 'docs-2'],
    ['a long title, cut at the last hyphen within 24 characters', '', 'Migrate the billing database to Postgres', [], 'migrate-the-billing'],
    ['a long title that collides after cutting', 'A {#migrate-the-billing}\n', 'Migrate the billing service to Kubernetes', [], 'migrate-the-billing-2'],
    ['a long title with no hyphen, cut at 24', '', 'Supercalifragilisticexpialidocious', [], 'supercalifragilisticexpi'],
    ['a hyphen at the 25th character still cuts there', '', 'abcdefghijklmnopqrstuvwx yz', [], 'abcdefghijklmnopqrstuvwx'],
  ] as const)('%s', (_, body, title, taken, want) => {
    const id = mintId(doc(body), title, taken);
    expect(id).toBe(want);
    readsBack(id);
  });

  it('keeps underscores and hyphens, and trims what may not begin or end an ID', () => {
    expect(mintId(doc(''), '_Draft -- v2 (final)!')).toBe('draft-v2-final');
    expect(mintId(doc(''), 'snake_case name')).toBe('snake_case-name');
  });

  it('is deterministic: the same text gives the same ID', () => {
    const text = 'Review {#review}\nReview\n';
    expect(mintId(doc(text), 'Review')).toBe(mintId(doc(text), 'Review'));
  });
});
