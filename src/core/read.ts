// readPlan: a rows document read as a plan. Spec §2.3–2.6 and §3.1. Items
// carry the rows spans through unchanged; summable cells are read as hours.

import { durationToMinutes } from 'rows';
import type { Cell as RowsCell, Column as RowsColumn, Row, RowsDocument, RowsError } from 'rows';
import type { Column, Diagnostic, Field, Fix, ItemNode, Node, Tree } from './types';

/** rows base and extension keys (spec §2.9); any other key that isn't `x-` gets an info. */
const KNOWN_KEYS = new Set(['format', 'table', 'profile', 'sep', 'comment', 'lead', 'columns', 'key', 'include', 'markers', 'nest', 'order']);
/** What a duration column needs to convert every term to hours (spec §2.6). */
const CONVERSION = { unit: 'h', hpd: '8', dpw: '5' };
const BARE_NUMBER = /^[+-]?\d+(\.\d+)?$/;

function fromRowsError(e: RowsError): Diagnostic {
  const d: Diagnostic = { line: e.line, severity: e.class === 'validation' ? 'warning' : 'error', code: e.code, message: e.message };
  if (e.from !== undefined && e.to !== undefined) d.span = { from: e.from, to: e.to };
  return d;
}

/** Adds the options a duration column is missing, when its declaration is in this file. */
function conversionFix(column: RowsColumn): Fix[] | undefined {
  if (column.to === undefined) return undefined;
  const missing = Object.entries(CONVERSION)
    .filter(([key]) => !column.options.some((o) => o.key === key))
    .map(([key, value]) => `${key}=${value}`);
  if (missing.length === 0) return undefined;
  return [{ label: `Add ${missing.join(' ')}`, edits: [{ from: column.to, to: column.to, insert: ` ${missing.join(' ')}` }] }];
}

export function readPlan(doc: RowsDocument): Tree {
  const { schema, text } = doc;
  const diagnostics: Diagnostic[] = [];
  const byError = new Map<RowsError, Diagnostic>();
  for (const e of doc.errors) {
    const d = fromRowsError(e);
    byError.set(e, d);
    diagnostics.push(d);
  }

  for (const entry of doc.frontmatter?.entries ?? []) {
    if (KNOWN_KEYS.has(entry.key) || entry.key.startsWith('x-')) continue;
    diagnostics.push({
      line: entry.line,
      span: { from: entry.keyFrom, to: entry.keyTo },
      severity: 'info',
      code: 'unknown-key',
      message: `unknown frontmatter key "${entry.key}"`,
    });
  }

  const declared = schema.columns.filter((c) => c.index > 0 && !c.implicit);
  const columns: Column[] = declared.map((c) => ({ name: c.name, type: c.kind }));
  const doneColumn = schema.columns.find((c) => c.name === 'done' && c.kind === 'bool');

  const isDone = (row: Row): boolean => {
    if (row.markers.some((m) => m.name === 'done')) return true;
    if (!doneColumn) return false;
    const value = row.cells[doneColumn.index]?.value;
    if (value?.type === 'bool') return value.value;
    return doneColumn.default?.type === 'bool' && doneColumn.default.value;
  };

  /** Reads a summable cell into `field`, or reports why it counts as empty (spec §2.6). */
  const readAmount = (row: Row, column: RowsColumn, cell: RowsCell, field: Field): void => {
    const warn = (code: string, message: string, fixes?: Fix[]): void => {
      diagnostics.push({ line: row.line, span: field.span, severity: 'warning', code, message, ...(fixes ? { fixes } : {}) });
    };
    const value = cell.value;
    if (!value) {
      // A bare number without `unit=` is a rows validation error; it gets the conversion fix.
      if (column.kind === 'duration' && column.unit === undefined && BARE_NUMBER.test(field.text)) {
        const error = row.errors.find((e) => e.code === 'invalid-value' && e.from === cell.valueFrom);
        const d = error && byError.get(error);
        const fixes = conversionFix(column);
        if (d && fixes) d.fixes = fixes;
      }
      return;
    }
    if (field.text.startsWith('-')) return warn('negative-value', `negative values are not supported yet; "${field.text}" is treated as empty`);
    field.additive = field.text.startsWith('+');
    if (value.type === 'number') {
      field.amount = value.value;
    } else if (value.type === 'duration') {
      const converted = durationToMinutes(value, column);
      if ('minutes' in converted) field.amount = converted.minutes / 60;
      else {
        const needs = converted.error === 'needs-dpw' ? 'dpw' : 'hpd';
        warn('unconvertible-duration', `"${field.text}" needs ${needs} on column ${column.name} to convert to hours; treated as empty`, conversionFix(column));
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
      diagnostics.push({
        line: row.line,
        span: { from: row.indent.to, to: row.to },
        severity: 'info',
        code: 'html-comment',
        message: `HTML comments are not comments here; use ${schema.comment}`,
        fixes: [{ label: `Change to a ${schema.comment} comment`, edits: [{ from: row.indent.to, to: row.to, insert: inner === '' ? schema.comment : `${schema.comment} ${inner}` }] }],
      });
    }

    return {
      kind: 'item',
      line: row.line,
      span: { from: row.from, to: row.to },
      row,
      indent: row.indent.width,
      done: isDone(row),
      title: row.lead.text ?? '',
      titleSpan: { from: row.lead.valueFrom, to: row.lead.valueTo },
      fields,
      children: [],
      outlineNumber: '',
    };
  };

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

  // The hierarchy and outline numbers come from the rows parent relation (spec §2.4, §3.1).
  for (const [row, item] of items) item.children = row.children.map((child) => items.get(child)!);
  const roots = doc.rows.filter((row) => row.parent === null).map((row) => items.get(row)!);
  const number = (list: ItemNode[], prefix: string): void =>
    list.forEach((item, i) => {
      item.outlineNumber = `${prefix}${i + 1}`;
      number(item.children, `${item.outlineNumber}.`);
    });
  number(roots, '');

  return { text, doc, columns, nodes, items: roots, diagnostics };
}
