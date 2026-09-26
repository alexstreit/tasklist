# rows conformance suite

Language-neutral test cases for rows base 0.8, rows extensions 0.6 and Text Anchors 0.2 (`../spec/`). Every `expected.json` was written by hand from the specs, before any parser existed. Each one is a claim about what the specs mean. If a case and a spec disagree, one of them is wrong, and which one is a spec decision.

Cases marked `"disputed": true` rest on a reading the specs don't settle. Each one has an entry in [QUESTIONS.md](QUESTIONS.md).

## Layout

One case per directory:

```
case-name/
  input.rows       the file, byte-exact (see ../../../.gitattributes)
  options.json     optional
  expected.json
```

Case names start with the spec and section they come from: `base-6-…`, `ext-5-…`, `anchors-2-…`, `plan-…`. A strict variant of a case is the same input under the name `CASE--strict`.

## options.json

| Field            | Meaning                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `mode`           | `"tolerant"` (default) or `"strict"`.                                                                   |
| `filename`       | Passed to the parser. Supplies the default table name.                                                  |
| `extensions`     | `false` runs a base-only parse. Default `true`.                                                         |
| `profiles`       | Built-in named profiles: name → the profile file's full text.                                           |
| `profileFiles`   | Path profiles: the `profile:` value exactly as written → the file's full text. Any other path is unresolvable. |
| `defaultProfile` | Applied when the file has no `profile:` key.                                                            |

## expected.json

| Field      | Required | Meaning                                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------------------- |
| `spec`     | yes      | The spec sections the case comes from, e.g. `["base §6 rows"]`.                          |
| `stage`    | yes      | The first implementation stage that can pass the case: `base`, `types` or `extensions`.   |
| `disputed` | no       | `true` when the case rests on an open question in QUESTIONS.md.                          |
| `failed`   | yes      | Strict-mode failure. Always `false` in tolerant mode.                                    |
| `errors`   | yes      | Every error, as `{ class, code, line }`. Complete and compared ignoring order.           |
| `table`    | no       | The resolved table name.                                                                 |
| `columns`  | no       | The resolved schema, lead first: `{ name, type, implicit? }`.                            |
| `rows`     | yes\*    | Every body row, in order. \*May be omitted in a `--strict` variant.                      |

`columns[].type` is the type values are read as, after recovery: a malformed or unknown type is `text`, and so is `ref` in a base-only parse. Parameterised types keep their parameters: `enum[low,high]`, `ref[people]`. Enum values are written trimmed and without spaces, so `enum[ low , high ]` is `enum[low,high]`.

Each row:

| Field      | Default | Meaning                                                                                         |
| ---------- | ------- | ----------------------------------------------------------------------------------------------- |
| `line`     | —       | 1-based source line. Required.                                                                  |
| `lead`     | —       | Decoded lead value, markers and anchors removed; `null` when the lead is null. Required.        |
| `indent`   | `0`     | Indent width. A tab counts as one.                                                              |
| `values`   | `{}`    | Decoded text of every non-lead cell the row sets, by column name. A column not listed is null.  |
| `overflow` | `[]`    | Decoded text of each overflow cell, in order, prefixed `NAME=` if the cell was named.           |
| `markers`  | `[]`    | Names of the marker columns set by markers, in source order.                                    |
| `id`       | `null`  | The row's ID.                                                                                   |
| `aliases`  | `[]`    | Further IDs, in source order.                                                                   |
| `parent`   | `null`  | Line of the parent row.                                                                         |

A field left out asserts its default. `values` holds what the row wrote, not defaults and not marker-set values: `~Login` has `markers: ["done"]` and no `done` in `values`. When two columns share a name, the later ones are keyed `name@N`, with `N` the column's index (lead = 0).

## Error codes

The specs define classes, not codes (DESIGN §4). These codes are the library's; `src/errors.ts` must use exactly these.

| Code                         | Class      | Source                                                        |
| ---------------------------- | ---------- | ------------------------------------------------------------- |
| `unclosed-frontmatter`       | syntax     | base §6: no closing `---`                                     |
| `malformed-frontmatter-line` | syntax     | base §6                                                       |
| `unterminated-quote`         | syntax     | base §6                                                       |
| `unknown-escape`             | syntax     | base §6                                                       |
| `text-after-quote`           | syntax     | base §6                                                       |
| `duplicate-key`              | structural | base §6: key set twice                                        |
| `unsupported-format`         | structural | base §6                                                       |
| `invalid-sep`                | structural | base §6                                                       |
| `invalid-comment`            | structural | base §6                                                       |
| `empty-value`                | structural | base §2.2, §6: a key with a default set to an empty value     |
| `unresolvable-profile`       | structural | base §6                                                       |
| `forbidden-profile-key`      | structural | base §2.3, §6                                                 |
| `profile-has-errors`         | structural | base §2.3, §6                                                 |
| `invalid-column-name`        | structural | base §6                                                       |
| `duplicate-column-name`      | structural | base §6                                                       |
| `malformed-type`             | structural | base §6                                                       |
| `invalid-option-value`       | structural | base §4, §6; ext §4.3 lead `ref` options                       |
| `duplicate-option`           | structural | base §4, §6: an option repeated in one declaration            |
| `invalid-enum-value`         | structural | base §5, §6: an empty or repeated `enum` value                |
| `row-begins-with-delimiter`  | structural | base §6                                                       |
| `tab-in-indent`              | structural | base §6                                                       |
| `heading-line`               | structural | base §6, §9                                                   |
| `invalid-cell-name`          | structural | base §6: named cell undeclared or the lead                    |
| `unnamed-after-named`        | structural | base §6                                                       |
| `column-set-twice`           | structural | base §6                                                       |
| `too-many-cells`             | structural | base §6                                                       |
| `unresolvable-include`       | structural | ext §4.1                                                      |
| `duplicate-table-name`       | structural | ext §4.1, §10                                                 |
| `unknown-table`              | structural | ext §4.2, §10                                                 |
| `invalid-marker`             | structural | ext §5, §10                                                   |
| `repeated-marker`            | structural | ext §5                                                        |
| `marker-column-not-bool`     | structural | ext §5                                                        |
| `bad-indent`                 | structural | ext §6.2                                                      |
| `invalid-nest-column`        | structural | ext §6.1, §10                                                 |
| `unknown-order-column`       | structural | ext §7, §10                                                   |
| `unknown-type`               | validation | base §6                                                       |
| `invalid-value`              | validation | base §6: value does not match its column                      |
| `required`                   | validation | base §4                                                       |
| `not-unique`                 | validation | base §4                                                       |
| `invalid-id`                 | validation | ext §3.1, §10                                                 |
| `duplicate-id`               | validation | ext §3.1, anchors §4                                          |
| `id-case-conflict`           | validation | ext §3.1, anchors §1                                          |
| `anchor-key-mismatch`        | validation | ext §3.2                                                      |
| `unresolved-ref`             | validation | ext §4.1, §4.2, anchors §4                                    |
| `wrong-table`                | validation | ext §4.2, §10                                                 |
| `qualifier-not-allowed`      | validation | ext §4.3                                                      |
| `many-not-allowed`           | validation | ext §4.3                                                      |
| `marker-conflict`            | validation | ext §5                                                        |
| `parent-mismatch`            | validation | ext §6.2                                                      |
| `parent-cycle`               | validation | ext §6.2                                                      |
| `out-of-order`               | validation | ext §7                                                        |

## Runner

`conformance.test.ts` checks every case's shape, and that every case with a syntax or structural error has a `--strict` variant. It runs the cases of the enabled stages against `parseRows` and skips the rest.

Stages are cumulative, and a case belongs to the first stage whose features it needs:

- `base`: frontmatter, keys, profiles, declarations, tokenising, quoting, named cells, overflow, the recovery tables, and modes. Types are read as written.
- `types`: typed values and their validation, `required`, `unique`, `default=`, option values, and unknown or malformed types.
- `extensions`: everything in the extensions spec.

Task 17 enables `base`, Task 18 adds `types`, and Task 19 adds `extensions`.
