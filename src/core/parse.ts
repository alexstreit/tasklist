// Lossless parse of a plan file into a Tree. Spec §2 and §3.1.

import type {
  Diagnostic,
  Field,
  FrontMatterEntry,
  ItemNode,
  Node,
  Span,
  Tree,
} from './types';

export function parse(text: string): Tree {
  const diagnostics: Diagnostic[] = [];

  // Normalise: CRLF/CR -> LF, then tabs -> 4 spaces (info diagnostic per line).
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = rawLines.map((raw, i) => {
    if (!raw.includes('\t')) return raw;
    diagnostics.push({ line: i + 1, severity: 'info', message: 'tabs converted to spaces' });
    return raw.replace(/\t/g, '    ');
  });
  const normalised = lines.join('\n');

  const lineOffsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineOffsets.push(acc);
    acc += line.length + 1;
  }
  const lineSpan = (i: number): Span => ({ from: lineOffsets[i], to: lineOffsets[i] + lines[i].length });

  const nodes: Node[] = [];
  const items: ItemNode[] = [];
  let frontMatter: FrontMatterEntry[] | null = null;
  const stack: ItemNode[] = [];

  let i = 0;

  // Front matter: must begin on line 1 with `---`, ends at the next `---`.
  // An unclosed block consumes the rest of the file.
  if (lines.length > 0 && lines[0].trimEnd() === '---') {
    frontMatter = [];
    nodes.push({ kind: 'front-matter', line: 1, span: lineSpan(0) });
    i = 1;
    while (i < lines.length) {
      const line = lines[i];
      nodes.push({ kind: 'front-matter', line: i + 1, span: lineSpan(i) });
      if (line.trimEnd() === '---') {
        i++;
        break;
      }
      if (line.trim() !== '') {
        frontMatter.push(parseFrontMatterLine(line, i, lineOffsets[i]));
      }
      i++;
    }
    for (const entry of frontMatter) {
      if (entry.key !== 'columns') {
        diagnostics.push({
          line: entry.line,
          severity: 'warning',
          message: `unknown front matter key "${entry.key}"`,
        });
      }
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const span = lineSpan(i);
    const trimmed = line.trim();

    if (trimmed === '') {
      nodes.push({ kind: 'blank', line: lineNo, span });
    } else if (trimmed.startsWith('//') || (trimmed.startsWith('<!--') && trimmed.endsWith('-->'))) {
      nodes.push({ kind: 'comment', line: lineNo, span });
    } else if (trimmed.startsWith('#')) {
      nodes.push({ kind: 'reserved', line: lineNo, span });
      diagnostics.push({
        line: lineNo,
        span,
        severity: 'warning',
        message: "'#' lines are reserved for future headings",
      });
    } else {
      const item = parseItem(line, lineNo, lineOffsets[i]);
      nodes.push(item);
      // Parent = nearest preceding item with a strictly smaller indent (§2.4).
      while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(item);
      else items.push(item);
      stack.push(item);
    }
  }

  return { text: normalised, nodes, items, frontMatter, diagnostics };
}

function parseFrontMatterLine(line: string, index: number, lineOffset: number): FrontMatterEntry {
  const colon = line.indexOf(':');
  if (colon === -1) {
    const end = lineOffset + line.trimEnd().length;
    return { key: line.trim(), value: '', line: index + 1, valueSpan: { from: end, to: end } };
  }
  const key = line.slice(0, colon).trim();
  const rest = line.slice(colon + 1);
  const value = rest.trim();
  const from = lineOffset + colon + 1 + (rest.length - rest.trimStart().length);
  return { key, value, line: index + 1, valueSpan: { from, to: from + value.length } };
}

function parseItem(line: string, lineNo: number, lineOffset: number): ItemNode {
  let pos = 0;
  while (pos < line.length && line[pos] === ' ') pos++;
  const indent = pos;

  let done = false;
  if (line[pos] === '~') {
    done = true;
    pos++;
    while (line[pos] === ' ') pos++;
  }

  // Split the rest on '|', keeping offsets.
  const segments: { start: number; end: number }[] = [];
  let segStart = pos;
  for (let j = pos; j <= line.length; j++) {
    if (j === line.length || line[j] === '|') {
      segments.push({ start: segStart, end: j });
      segStart = j + 1;
    }
  }

  const trimSegment = (seg: { start: number; end: number }): Field => {
    let { start, end } = seg;
    while (start < end && line[start] === ' ') start++;
    while (end > start && line[end - 1] === ' ') end--;
    return {
      value: line.slice(start, end),
      span: { from: lineOffset + start, to: lineOffset + end },
    };
  };

  const title = trimSegment(segments[0]);
  const fields = segments.slice(1).map(trimSegment);
  // A trailing '|' produces nothing (§2.3): drop only a final empty field.
  if (fields.length > 0 && fields[fields.length - 1].value === '') fields.pop();

  return {
    kind: 'item',
    line: lineNo,
    span: { from: lineOffset, to: lineOffset + line.length },
    indent,
    done,
    title: title.value,
    titleSpan: title.span,
    fields,
    children: [],
  };
}
