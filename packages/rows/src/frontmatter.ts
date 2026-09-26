// The frontmatter block (base §1, §2.1) and its recovery rows in base §6.
import { rowsError } from './errors';
import type { PhysicalLine } from './text';
import { classifyFrontmatterLine } from './tokenize';
import type { Frontmatter, FrontmatterEntry, LineKind, RowsError } from './types';

export interface FrontmatterBlock {
  frontmatter: Frontmatter | null;
  kinds: LineKind[]; // one per line of the block; empty when there is none
}

/** base §2.1: a value that begins and ends with `"` loses its quotes, and `\"` and `\\` are unescaped. */
export function unquoteValue(raw: string): { value: string; quoted: boolean } {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return { value: raw, quoted: false };
  return { value: raw.slice(1, -1).replace(/\\(["\\])/g, '$1'), quoted: true };
}

export function readFrontmatter(lines: PhysicalLine[], errors: RowsError[]): FrontmatterBlock {
  if (lines.length === 0 || lines[0].text !== '---') return { frontmatter: null, kinds: [] };
  const close = lines.findIndex((l, i) => i > 0 && l.text === '---');
  if (close === -1) {
    errors.push(rowsError('unclosed-frontmatter', 1, 'No closing ---; the file has no frontmatter.', lines[0].from, lines[0].to));
    // The opening line is ignored and every later line is body (base §6).
    return { frontmatter: null, kinds: ['fm-malformed'] };
  }

  const kinds: LineKind[] = ['fm-open'];
  const entries: FrontmatterEntry[] = [];
  for (const l of lines.slice(1, close)) {
    const fm = classifyFrontmatterLine(l.text);
    kinds.push(fm.kind);
    if (fm.kind === 'fm-malformed') {
      errors.push(rowsError('malformed-frontmatter-line', l.line, 'Malformed frontmatter line; ignored.', l.from, l.to));
    } else if (fm.kind === 'fm-entry') {
      const raw = l.text.slice(fm.value!.from, fm.value!.to);
      entries.push({
        key: fm.key!.text,
        ...unquoteValue(raw),
        line: l.line,
        from: l.from + fm.key!.from,
        to: l.from + fm.value!.to,
        keyFrom: l.from + fm.key!.from,
        keyTo: l.from + fm.key!.to,
        valueFrom: l.from + fm.value!.from,
        valueTo: l.from + fm.value!.to,
      });
    }
  }
  kinds.push('fm-close');
  return { frontmatter: { from: lines[0].from, to: lines[close].to, entries }, kinds };
}
