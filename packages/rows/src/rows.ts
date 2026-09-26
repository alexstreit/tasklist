// Body rows: cells assigned to columns, named cells and overflow (base §3), with the rows
// recovery table in base §6.
import { rowsError } from './errors';
import type { PhysicalLine } from './text';
import { scanRow, type ScannedCell } from './tokenize';
import type { Cell, Column, Row, RowsError, Schema } from './types';

function toCell(s: ScannedCell, base: number, column: Column | null): Cell {
  return {
    column,
    from: base + s.from,
    to: base + s.to,
    valueFrom: base + s.valueFrom,
    valueTo: base + s.valueTo,
    name: s.name && { text: s.name.text, from: base + s.name.from, to: base + s.name.to },
    quoted: s.quoted,
    text: s.text,
    // Only text is typed in the base stage; the types stage reads the rest.
    value: s.text !== null && column?.type === 'text' ? { type: 'text', text: s.text } : null,
  };
}

/** A named cell read as an unnamed one: its value is the whole raw text (base §6). */
function asUnnamed(s: ScannedCell, line: string): ScannedCell {
  return { ...s, name: null, quoted: false, valueFrom: s.from, valueTo: s.to, text: line.slice(s.from, s.to), escapes: [] };
}

export function buildRow(line: PhysicalLine, schema: Schema): Row {
  const base = line.from;
  const scan = scanRow(line.text, schema.sep);
  const errors: RowsError[] = scan.errors.map((e) => rowsError(e.code, line.line, e.message, base + e.from, base + e.to));
  const columns = schema.columns;
  const cells: (Cell | null)[] = columns.map(() => null);
  const overflow: Cell[] = [];
  const lead = toCell(scan.lead, base, columns[0]);
  cells[0] = lead;

  let next = 1; // the next positional column
  let named = false;
  let unnamedAfterNamed = false;
  let tooMany = false;
  for (let s of scan.cells) {
    const at = (code: Parameters<typeof rowsError>[0], message: string) =>
      errors.push(rowsError(code, line.line, message, base + s.from, base + s.to));

    if (s.name) {
      const name = s.name.text;
      const column = columns.find((c) => c.settable && c.name === name);
      if (!column) {
        at('invalid-cell-name', name === columns[0].name ? `${name} is the lead column and cannot be set by name.` : `No column named ${name}; read as an unnamed cell.`);
        s = asUnnamed(s, line.text);
      } else if (cells[column.index]) {
        at('column-set-twice', `Column ${name} is set twice; kept as overflow.`);
        overflow.push(toCell(s, base, null));
        continue;
      } else {
        cells[column.index] = toCell(s, base, column);
        named = true;
        continue;
      }
    }

    if (named) {
      // One error per row, as for too many cells (base §6).
      if (!unnamedAfterNamed) at('unnamed-after-named', 'Unnamed cell after a named cell; kept as overflow.');
      unnamedAfterNamed = true;
      overflow.push(toCell(s, base, null));
    } else if (next < columns.length) {
      cells[next] = toCell(s, base, columns[next]);
      next++;
    } else {
      if (!tooMany) at('too-many-cells', `More cells than the ${columns.length} columns; the extras are kept as overflow.`);
      tooMany = true;
      overflow.push(toCell(s, base, null));
    }
  }

  return {
    line: line.line,
    from: line.from,
    to: line.to,
    indent: { width: scan.indent.width, from: base + scan.indent.from, to: base + scan.indent.to },
    markers: [],
    lead,
    anchors: [],
    cells,
    overflow,
    id: null,
    aliases: [],
    parent: null,
    children: [],
    depth: 0,
    errors,
  };
}
