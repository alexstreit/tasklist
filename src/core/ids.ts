// Minting IDs (plan spec §4b.2): a row that a reference needs, and that has no ID, gets one made
// from its title. Pure and deterministic, so two clients mint the same ID from the same text.

import type { Row, RowsDocument } from 'rows';

/** Every ID a row declares: its anchors, or its key value. */
const idsOf = (row: Row): string[] => (row.anchors.length > 0 ? row.anchors.map((a) => a.id) : row.id !== null ? [row.id] : []);

/** The longest slug, before any `-2`: ext §3.3 says a minted ID SHOULD be short. */
const MAX = 24;

/**
 * A new ID for a row titled `title`: the title folded to the ID grammar (accents dropped, lower
 * case, each run of other characters a hyphen), cut at the last hyphen within 24 characters (or
 * at 24 when there is none), or `task` when nothing is left; then `-2`, `-3`…
 * until no row of the document declares it, ignoring case. `taken` adds IDs minted for the same
 * edit and not written yet. An ID never follows a later change of title.
 */
export function mintId(doc: RowsDocument, title: string, taken: Iterable<string> = []): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '');
  const hyphen = slug.lastIndexOf('-', MAX);
  const cut = slug.length <= MAX ? slug : slug.slice(0, hyphen > 0 ? hyphen : MAX);
  const base = cut === '' ? 'task' : cut;
  const used = new Set([...doc.rows.flatMap(idsOf), ...taken].map((id) => id.toLowerCase()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
