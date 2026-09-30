// readTree: a rows document read as a plan. Spec §2.3–2.6, §2.8 and §3.1. Items
// carry the rows spans through unchanged; summable cells are read as hours.

import { applyEdits, durationToMinutes, KNOWN_KEYS, parseDuration, readFlag } from 'rows';
import type { Cell as RowsCell, Column as RowsColumn, Row, RowsDocument, RowsError } from 'rows';
import { identityFixes, mapPos, preview, rowFixes } from './fixes';
import { settingsFixes } from './settings';
import type { Column, Diagnostic, Field, Fix, ItemNode, Node, Tree } from './types';

/** rows base and extension keys (spec §2.9); any other key that isn't `x-` gets an info. */
const KNOWN = new Set<string>(KNOWN_KEYS);
/** What a duration column needs to convert every term to hours (spec §2.6). */
const CONVERSION = { unit: 'h', hpd: '8', dpw: '5' };

function fromRowsError(e: RowsError): Diagnostic {
  const d: Diagnostic = { line: e.line, severity: e.class === 'validation' ? 'warning' : 'error', code: e.code, message: e.message };
  if (e.from !== undefined && e.to !== undefined) d.span = { from: e.from, to: e.to };
  return d;
}

/**
 * Adds the options a duration column is missing, when its declaration is in this file. Not when one
 * of them is written but invalid: adding it again would repeat it, and "Remove this option" comes first.
 */
function conversionFix(column: RowsColumn): Fix[] | undefined {
  if (column.to === undefined) return undefined;
  const parsed = { unit: column.unit, hpd: column.hpd, dpw: column.dpw };
  if (Object.keys(CONVERSION).some((key) => column.options.some((o) => o.key === key) && parsed[key as keyof typeof parsed] === undefined)) return undefined;
  const missing = Object.entries(CONVERSION)
    .filter(([key]) => !column.options.some((o) => o.key === key))
    .map(([key, value]) => `${key}=${value}`);
  if (missing.length === 0) return undefined;
  return [{ label: `Add ${missing.join(' ')}`, tier: 'click', edits: [{ from: column.to, to: column.to, insert: ` ${missing.join(' ')}` }] }];
}

/**
 * A fix resolves its diagnostic when, in the text it writes, no diagnostic with the same code is
 * where that one went (its span's start, or its line), and no syntax or structural error is added.
 */
function resolves(before: RowsDocument, d: Diagnostic, fix: Fix, after: Tree): boolean {
  const lineStart = before.lines[d.line - 1]?.from ?? 0;
  const at = mapPos(d.span?.from ?? lineStart, fix.edits);
  const line = after.text.slice(0, at).split('\n').length;
  if (after.diagnostics.some((x) => x.code === d.code && (d.span ? x.span?.from === at : !x.span && x.line === line))) return false;
  const count = (doc: RowsDocument) => {
    const out = new Map<string, number>();
    for (const e of doc.errors) if (e.class !== 'validation') out.set(e.code, (out.get(e.code) ?? 0) + 1);
    return out;
  };
  const [was, now] = [count(before), count(after.doc)];
  return [...now].every(([code, n]) => n <= (was.get(code) ?? 0));
}

/**
 * `reparse` reads edited text the way this document was read. With it, each settings fix is offered
 * only when it resolves its diagnostic (spec §4b.6.1): what one does depends on the whole file, such
 * as which profile applies once a `profile:` line is gone.
 */
export function readTree(doc: RowsDocument, reparse?: (text: string) => RowsDocument): Tree {
  const { schema, text } = doc;
  const diagnostics: Diagnostic[] = [];
  const byError = new Map<RowsError, Diagnostic>();
  for (const e of doc.errors) {
    const d = fromRowsError(e);
    byError.set(e, d);
    diagnostics.push(d);
  }

  for (const entry of doc.frontmatter?.entries ?? []) {
    if (KNOWN.has(entry.key) || entry.key.startsWith('x-')) continue;
    diagnostics.push({
      line: entry.line,
      span: { from: entry.keyFrom, to: entry.keyTo },
      severity: 'info',
      code: 'unknown-key',
      message: `unknown frontmatter key "${entry.key}"`,
    });
  }

  // Fixes to the settings, which readTree checks before offering (see `reparse`).
  const settings = new Set<Fix>();
  const declared = schema.columns.filter((c) => c.index > 0 && !c.implicit);
  const columns: Column[] = declared.map((c) => ({ name: c.name, type: c.kind }));
  const doneColumn = schema.columns.find((c) => c.name === 'done' && c.kind === 'bool');

  // A `done` marker always has this column: the declared bool, or the implicit one (ext §5).
  const isDone = (row: Row): boolean => (doneColumn ? readFlag(doc, row, doneColumn) === true : false);

  /** Reads a summable cell into `field`, or reports why it counts as empty (spec §2.6). */
  const readAmount = (row: Row, column: RowsColumn, cell: RowsCell, field: Field): void => {
    const warn = (code: string, message: string, fixes?: Fix[]): void => {
      diagnostics.push({ line: row.line, span: field.span, severity: 'warning', code, message, ...(fixes ? { fixes } : {}) });
    };
    const value = cell.value;
    if (!value) {
      // A bare number without `unit=` is a rows validation error; it gets the conversion fix. It
      // would read as one with a unit.
      const withUnit = column.kind === 'duration' && column.unit === undefined ? parseDuration(field.text, 'h') : null;
      if (withUnit?.type === 'duration' && withUnit.bare) {
        const error = row.errors.find((e) => e.code === 'invalid-value' && e.from === cell.valueFrom);
        const d = error && byError.get(error);
        const fixes = conversionFix(column);
        if (d && fixes) {
          d.fixes = fixes;
          fixes.forEach((f) => settings.add(f));
        }
      }
      return;
    }
    // A duration's sign is parsed; a number's value keeps none, so its sign is read from the text.
    const sign = value.type === 'duration' ? value.sign : field.text[0] === '-' || field.text[0] === '+' ? field.text[0] : null;
    if (sign === '-') return warn('negative-value', `negative values are not supported yet; "${field.text}" is treated as empty`);
    field.additive = sign === '+';
    if (value.type === 'number') {
      field.amount = value.value;
    } else if (value.type === 'duration') {
      const converted = durationToMinutes(value, column);
      if ('minutes' in converted) field.amount = converted.minutes / 60;
      else {
        const needs = converted.error === 'needs-dpw' ? 'dpw' : 'hpd';
        const fixes = conversionFix(column);
        fixes?.forEach((f) => settings.add(f));
        warn('unconvertible-duration', `"${field.text}" needs ${needs} on column ${column.name} to convert to hours; treated as empty`, fixes);
      }
    }
  };

  const readItem = (row: Row): ItemNode => {
    const fields = declared.map((column): Field | null => {
      const cell = row.cells[column.index];
      if (!cell || cell.text === null) return null;
      const field: Field = { text: cell.text, span: { from: cell.valueFrom, to: cell.valueTo }, amount: null, additive: false };
      if (column.kind === 'duration' || column.kind === 'number') readAmount(row, column, cell, field);
      return field;
    });

    // A line beginning `<!--` is a row, not a comment (spec §2.3).
    const content = text.slice(row.indent.to, row.to);
    if (content.startsWith('<!--')) {
      const inner = content.slice(4).replace(/-->\s*$/, '').trim();
      const edits = [{ from: row.indent.to, to: row.to, insert: inner === '' ? schema.comment : `${schema.comment} ${inner}` }];
      diagnostics.push({
        line: row.line,
        span: { from: row.indent.to, to: row.to },
        severity: 'info',
        code: 'html-comment',
        message: `HTML comments are not comments here; use ${schema.comment}`,
        // The row leaves the grid, so it is confirmed first (spec §4b.6.6).
        fixes: [{ label: 'Make it a comment', tier: 'confirm', edits, preview: preview(text, edits) }],
      });
    }

    return {
      kind: 'item',
      line: row.line,
      span: { from: row.from, to: row.to },
      row,
      indent: row.indent.width,
      ownDone: isDone(row),
      done: false,
      title: row.lead.text ?? '',
      titleSpan: { from: row.lead.valueFrom, to: row.lead.valueTo },
      fields,
      children: [],
      outlineNumber: '',
    };
  };

  // The tree, title, cell, identity and settings fixes (spec §4b.6.6), on the rows errors they resolve.
  const diagnosticOf = (e: RowsError) => byError.get(e)!;
  for (const row of doc.rows) rowFixes(doc, row, diagnosticOf);
  identityFixes(doc, diagnosticOf);
  settingsFixes(doc, diagnosticOf, settings);

  const items = new Map<Row, ItemNode>();
  const nodes: Node[] = doc.lines.map((line): Node => {
    const span = { from: line.from, to: line.to };
    if (line.row) {
      const item = readItem(line.row);
      items.set(line.row, item);
      return item;
    }
    if (line.kind === 'blank' || line.kind === 'comment') return { kind: line.kind, line: line.line, span };
    return { kind: 'front-matter', line: line.line, span };
  });

  // The hierarchy and outline numbers come from the rows parent relation (spec §2.4, §3.1);
  // an item is done when it or an ancestor is (spec §2.8).
  for (const [row, item] of items) item.children = row.children.map((child) => items.get(child)!);
  const roots = doc.rows.filter((row) => row.parent === null).map((row) => items.get(row)!);
  const number = (list: ItemNode[], prefix: string, inheritedDone: boolean): void =>
    list.forEach((item, i) => {
      item.outlineNumber = `${prefix}${i + 1}`;
      item.done = inheritedDone || item.ownDone;
      number(item.children, `${item.outlineNumber}.`, item.done);
    });
  number(roots, '', false);

  if (reparse && settings.size > 0) {
    const after = new Map<string, Tree>(); // one read per distinct fix, which many diagnostics may share
    for (const d of diagnostics) {
      if (!d.fixes) continue;
      d.fixes = d.fixes.filter((fix) => {
        if (!settings.has(fix)) return true;
        const key = JSON.stringify(fix.edits);
        if (!after.has(key)) after.set(key, readTree(reparse(applyEdits(text, fix.edits))));
        return resolves(doc, d, fix, after.get(key)!);
      });
      if (d.fixes.length === 0) delete d.fixes;
    }
  }

  return { text, doc, columns, nodes, items: roots, diagnostics };
}
