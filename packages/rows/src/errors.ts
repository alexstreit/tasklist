// Stable error codes and their classes, exactly as listed in conformance/README.md.
// The specs define classes; the codes are the library's (DESIGN §4).
import type { RowsError } from './types';

export type ErrorClass = 'syntax' | 'structural' | 'validation';

export const ERROR_CODES = {
  'unclosed-frontmatter': 'syntax',
  'malformed-frontmatter-line': 'syntax',
  'unterminated-quote': 'syntax',
  'unknown-escape': 'syntax',
  'text-after-quote': 'syntax',
  'duplicate-key': 'structural',
  'unsupported-format': 'structural',
  'invalid-sep': 'structural',
  'invalid-comment': 'structural',
  'empty-value': 'structural',
  'unresolvable-profile': 'structural',
  'forbidden-profile-key': 'structural',
  'profile-has-errors': 'structural',
  'invalid-column-name': 'structural',
  'duplicate-column-name': 'structural',
  'malformed-type': 'structural',
  'invalid-option-value': 'structural',
  'duplicate-option': 'structural',
  'row-begins-with-delimiter': 'structural',
  'tab-in-indent': 'structural',
  'heading-line': 'structural',
  'invalid-cell-name': 'structural',
  'unnamed-after-named': 'structural',
  'column-set-twice': 'structural',
  'too-many-cells': 'structural',
  'unresolvable-include': 'structural',
  'duplicate-table-name': 'structural',
  'unknown-table': 'structural',
  'invalid-marker': 'structural',
  'repeated-marker': 'structural',
  'marker-column-not-bool': 'structural',
  'bad-indent': 'structural',
  'invalid-nest-column': 'structural',
  'unknown-order-column': 'structural',
  'unknown-type': 'validation',
  'invalid-value': 'validation',
  required: 'validation',
  'not-unique': 'validation',
  'invalid-id': 'validation',
  'duplicate-id': 'validation',
  'id-case-conflict': 'validation',
  'anchor-key-mismatch': 'validation',
  'unresolved-ref': 'validation',
  'wrong-table': 'validation',
  'qualifier-not-allowed': 'validation',
  'many-not-allowed': 'validation',
  'marker-conflict': 'validation',
  'parent-mismatch': 'validation',
  'parent-cycle': 'validation',
  'out-of-order': 'validation',
} as const satisfies Record<string, ErrorClass>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function rowsError(code: ErrorCode, line: number, message: string, from?: number, to?: number): RowsError {
  const error: RowsError = { class: ERROR_CODES[code], code, message, line };
  if (from !== undefined) error.from = from;
  if (to !== undefined) error.to = to;
  return error;
}
