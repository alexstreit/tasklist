// The row-level extensions, after every row is built: markers (ext §5), identity (§3),
// references (§4.2–4.3), nesting (§6) and order (§7). Recovery follows base §6: every rule is
// checked on the recovered rows, and symmetric errors go on every row involved.
import { rowsError, type ErrorCode } from './errors';
import type { Cell, Row, RowsError, Schema, Value } from './types';
import { compareValues, readValue } from './values';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function applyExtensions(schema: Schema, rows: Row[]): RowsError[] {
  const errors: RowsError[] = [];
  const report = (row: Row, code: ErrorCode, message: string, span?: { from: number; to: number }) => {
    const error = rowsError(code, row.line, message, span?.from, span?.to);
    row.errors.push(error);
    errors.push(error);
  };

  markers(schema, rows, report);
  const ids = identity(schema, rows, report);
  references(schema, rows, ids, report);
  nesting(schema, rows, report);
  order(schema, rows, report);
  return errors;
}

type Report = (row: Row, code: ErrorCode, message: string, span?: { from: number; to: number }) => void;

/** ext §5: a marker and an explicit `false` in the same column. */
function markers(schema: Schema, rows: Row[], report: Report): void {
  for (const row of rows) {
    for (const m of row.markers) {
      const column = schema.markers.find((x) => x.name === m.name)!.column;
      const cell = row.cells[column.index];
      if (cell?.value?.type === 'bool' && !cell.value.value) {
        report(row, 'marker-conflict', `The ${m.char} marker sets ${m.name}, but the row sets it to false.`, cell);
      }
    }
  }
}

/** ext §3: each row's ID and aliases, then duplicates and case conflicts. Returns ID → row. */
function identity(schema: Schema, rows: Row[], report: Report): Map<string, Row> {
  const byId = new Map<string, Row>();
  if (!schema.identity) return byId;
  const key = schema.key!;
  const declared = new Map<Row, string[]>();

  for (const row of rows) {
    const [anchor, ...aliases] = row.anchors.map((a) => a.id);
    const cell = row.cells[key.index];
    let keyId: string | null = null;
    if (cell && cell.text !== null) {
      if (ID.test(cell.text)) keyId = cell.text;
      else report(row, 'invalid-id', `Key ${JSON.stringify(cell.text)} is not a valid ID; the row has no ID from it.`, cell);
      if (anchor !== undefined && cell.text !== anchor) {
        report(row, 'anchor-key-mismatch', `The anchor #${anchor} and the key ${JSON.stringify(cell.text)} differ; the anchor's ID is used.`, cell);
      }
    }
    row.id = anchor ?? keyId;
    row.aliases = aliases;
    declared.set(row, row.id === null ? aliases : [row.id, ...aliases]);
  }

  // A duplicate, as a key or an alias, is reported once on every row that declares it (ext §3.1).
  const rowsOf = new Map<string, Row[]>();
  for (const [row, list] of declared) for (const id of list) rowsOf.set(id, [...(rowsOf.get(id) ?? []), row]);
  const duplicated = new Set<Row>();
  for (const [id, declaring] of rowsOf) {
    if (declaring.length > 1) for (const row of declaring) duplicated.add(row);
    if (!byId.has(id)) byId.set(id, declaring[0]);
  }
  for (const row of rows) if (duplicated.has(row)) report(row, 'duplicate-id', 'This row declares an ID that another row, or this one, also declares.');

  // IDs that differ only by case: an error on every row involved.
  const byFold = new Map<string, Set<string>>();
  for (const id of rowsOf.keys()) byFold.set(id.toLowerCase(), (byFold.get(id.toLowerCase()) ?? new Set()).add(id));
  for (const variants of byFold.values()) {
    if (variants.size < 2) continue;
    const involved = new Set([...variants].flatMap((id) => rowsOf.get(id)!));
    for (const row of rows) if (involved.has(row)) report(row, 'id-case-conflict', `IDs that differ only by case: ${[...variants].map((v) => `#${v}`).join(', ')}.`);
  }
  return byId;
}

type Ref = Extract<Value, { type: 'ref' }>['refs'][number];

/** ext §4.2–4.3: every cell of a ref column, resolved within the file. Includes are never read. */
function references(schema: Schema, rows: Row[], byId: Map<string, Row>, report: Report): void {
  for (const row of rows) {
    for (const cell of row.cells) {
      const column = cell?.column;
      if (!cell || cell.text === null || column?.kind !== 'ref') continue;
      const parts = cell.text.split(',').map((p) => p.replace(/^[ \t]+|[ \t]+$/g, ''));
      if (parts.length > 1 && !column.many) {
        report(row, 'many-not-allowed', `${column.name} holds several references but is not declared many.`, cell);
        continue;
      }
      const refs: Ref[] = [];
      let valid = true;
      for (const part of parts) {
        const m = /^(\S+)(?:[ \t]+(.+))?$/.exec(part);
        const hash = m ? m[1].lastIndexOf('#') : -1;
        const id = m ? m[1].slice(hash + 1) : '';
        if (!m || hash === -1 || !ID.test(id)) {
          valid = false;
          report(row, 'invalid-value', `${JSON.stringify(part)} is not a reference (#ID, optionally TABLE#ID).`, cell);
          break;
        }
        const prefix = m[1].slice(0, hash);
        let qualifier: Value | null = null;
        if (m[2] !== undefined) {
          if (!column.qualifier) report(row, 'qualifier-not-allowed', `${column.name} takes no qualifier.`, cell);
          else {
            qualifier = readValue(m[2], column.qualifier.column);
            if (!qualifier) report(row, 'invalid-value', `${JSON.stringify(m[2])} is not a valid ${column.qualifier.column.type}.`, cell);
          }
        }
        let target: Row | null = null;
        if (prefix !== '' && prefix !== column.refTable) {
          report(row, 'wrong-table', `${m[1]} names ${prefix}, but ${column.name} refers to ${column.refTable ?? 'this table'}.`, cell);
        } else if (column.refKnown && column.refCurrent && byId.has(id)) {
          target = byId.get(id)!;
        } else {
          report(row, 'unresolved-ref', `#${id} ${column.refCurrent ? 'is not an ID in this file' : `is in ${column.refTable}, which cannot be read`}.`, cell);
        }
        refs.push({ table: column.refTable ?? null, id, target, qualifier });
      }
      if (valid) cell.value = { type: 'ref', refs };
    }
  }
}

/**
 * ext §6.2 over the indents of the rows in order: each row's parent (an index) from indentation,
 * and whether its indent is a violation, with the tolerant recovery. The edit API uses it too.
 */
export function indentLevels(widths: number[]): { parent: number | null; bad: boolean }[] {
  // `open` is the previous row and its ancestors, with the indent each opened.
  let open: { indent: number; row: number }[] = [];
  return widths.map((w, i) => {
    let parent: number | null = null;
    let bad = false;
    if (w === 0) {
      open = [];
    } else if (i === 0) {
      bad = true; // the first row MUST have zero indent
      open = [];
    } else if (w > open[open.length - 1].indent) {
      parent = open[open.length - 1].row;
    } else {
      const level = open.findIndex((o) => o.indent === w);
      if (level !== -1) {
        parent = level > 0 ? open[level - 1].row : null;
        open = open.slice(0, level);
      } else {
        bad = true;
        // Tolerant recovery: the nearest preceding row with a smaller indent; the row opens its own level.
        const nearest = open.map((o) => o.indent < w).lastIndexOf(true);
        parent = nearest === -1 ? null : open[nearest].row;
        open = open.slice(0, nearest + 1);
      }
    }
    open.push({ indent: w, row: i });
    return { parent, bad };
  });
}

/** ext §6: the parent relation from indentation, then from the parent column. */
function nesting(schema: Schema, rows: Row[], report: Report): void {
  if (!schema.nest) return;

  // Indentation (§6.2).
  const levels = indentLevels(rows.map((row) => row.indent.width));
  const fromIndent = new Map<Row, Row | null>();
  for (const [i, row] of rows.entries()) {
    if (levels[i].bad) report(row, 'bad-indent', 'Indent matches no open level; attached to the nearest row with a smaller indent.', row.indent);
    const parent = levels[i].parent === null ? null : rows[levels[i].parent!];
    fromIndent.set(row, parent);
    row.parent = parent;
  }

  // The parent column (§6.2), when it is a valid nest column (§6.1).
  if (schema.nest.valid) {
    const index = schema.nest.column.index;
    for (const row of rows) {
      const cell = row.cells[index];
      if (!cell || cell.text === null) continue;
      const target = cell.value?.type === 'ref' ? cell.value.refs[0]?.target ?? null : null;
      if (row.indent.width > 0) {
        if (target !== fromIndent.get(row)) report(row, 'parent-mismatch', 'The parent column and the indentation disagree; the indentation is used.', cell);
      } else if (target) {
        row.parent = target;
      }
    }
  }

  // A parent chain that forms a cycle: an error on every row in it, and those rows have no parent.
  const state = new Map<Row, 'walking' | 'done'>();
  const inCycle = new Set<Row>();
  for (const start of rows) {
    const path: Row[] = [];
    let x: Row | null = start;
    while (x && !state.has(x)) {
      state.set(x, 'walking');
      path.push(x);
      x = x.parent;
    }
    if (x && state.get(x) === 'walking') for (const r of path.slice(path.indexOf(x))) inCycle.add(r);
    for (const r of path) state.set(r, 'done');
  }
  for (const row of rows) {
    if (!inCycle.has(row)) continue;
    report(row, 'parent-cycle', 'This row is in a parent chain that forms a cycle; it has no parent.', row.cells[schema.nest.column.index] ?? undefined);
    row.parent = null;
  }

  for (const row of rows) row.parent?.children.push(row);
  const depth = (row: Row): number => (row.parent ? depth(row.parent) + 1 : 0);
  for (const row of rows) row.depth = depth(row);
}

/** ext §7: each row against the previous non-null one, among siblings when nest is set. */
function order(schema: Schema, rows: Row[], report: Report): void {
  if (typeof schema.order === 'string') return;
  const { column, descending } = schema.order;
  const previous = new Map<Row | null, Cell>();
  for (const row of rows) {
    const cell = row.cells[column.index];
    if (!cell || cell.text === null) continue; // null values are skipped
    const siblings = schema.nest ? row.parent : null;
    const before = previous.get(siblings);
    if (before) {
      const c = compareValues(before, cell, column);
      if (c !== null && (descending ? c < 0 : c > 0)) {
        report(row, 'out-of-order', `${column.name} ${JSON.stringify(cell.text)} sorts before ${JSON.stringify(before.text)} above it.`, cell);
      }
    }
    previous.set(siblings, cell);
  }
}
