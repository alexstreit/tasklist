# rows — Extensions

**Version 0.3 (draft)**

This document defines identity, references, includes, markers, nesting, and row order for rows files. It uses the keys and forms reserved by the base format (base §9), and binds the Text Anchors specification to rows. Error classes, recovery, and modes are as in base §6.

A file that uses these extensions MUST be read by a parser that implements them. A base-only parser will tokenise it, but in strict mode may reject it, for example because `id=auth` names a column only an extension declares.

The key words MUST, MUST NOT, SHOULD, and MAY follow RFC 2119.

## 1. Canonical form

Every extension in this document is sugar. A file using it can be rewritten mechanically into **canonical form**: a set of rows files that use only base syntax, the `key`, `include`, `nest`, and `order` keys, and single-valued `ref` columns without qualifiers. Every row has zero indent. `key` is written explicitly, profiles are resolved, and their keys written out. Each section below states its canonical form.

A conforming tool MUST be able to produce canonical form, and MUST read it back to the same data. Import and export to other stores SHOULD go through canonical form.

## 2. Implicit columns

Some extensions add a column when the file does not declare it. Implicit columns follow all declared columns, in the order key, nest, markers. They can be set only by named cells; unnamed cells never fill them. In canonical form they are declared explicitly.

## 3. Identity

### 3.1 Key column

`key` names the column that holds each row's ID. Identity applies only when the file sets `key` or any lead cell has an anchor; the key column is then `key`'s value, or `id` by default.

- If not declared, it is implicitly `KEY:text`.
- It is implicitly `unique`. A non-null value MUST match the Text Anchors ID grammar.
- Two keys that differ only by case are a validation error.
- A row whose key is null has no ID.

### 3.2 Anchors in the lead cell

This is the Text Anchors binding for rows:

- Anchor groups are recognised at the end of an **unquoted** lead cell. They are removed from the lead value, together with the whitespace before them.
- An anchor names its **row**.
- The first ID sets the row's key. Any further IDs are aliases.
- A row with both an anchor and a key value that differ is a validation error.
- To write a lead value ending in a literal `{#...}` group, quote it.

```
Auth {#auth}              → lead "Auth", id "auth"
Auth | id=auth            → the same row (in a file where identity applies)
"Email {#home}"           → lead "Email {#home}", no id
```

**Canonical form.** The first ID is written in the key column. Aliases are written to a companion table `TABLE-aliases`, declared `lead: alias:text` and `columns: of:ref[TABLE]`.

### 3.3 Stability

IDs follow Text Anchors §4. A tool that needs an ID for a row that lacks one (§4.4, §6.3) mints one; it SHOULD be short.

## 4. References

### 4.1 Includes

`include` lists other rows files whose rows may be referenced, separated by the delimiter:

```
include: people.rows | ../shared/rates.rows as rates
```

- Paths are relative to the including file.
- Each included file is known by a **table name**: its `as` alias if given, otherwise its own `table` value.
- Table names MUST be unique within the including file and MUST differ from its own table name.
- Includes are not transitive, and never add rows to the including file.
- An include that cannot be read is a structural error. The file still parses, and every reference into that table is a validation error.

### 4.2 The ref type

A `ref` column holds references to rows. `ref` targets the current table; `ref[TABLE]` targets the current table or an included table by name.

Each reference is a Text Anchors locator, optionally followed by a qualifier:

```
reference = locator [ 1*WSP qualifier ]
locator   = [ TABLE ] "#" ID
```

- An unprefixed `#ID` resolves in the column's target table.
- A prefixed `TABLE#ID` MUST name the column's target table.
- A reference whose target does not exist is a validation error.

### 4.3 Options

| Option                | Meaning                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `many`                | The cell may hold several references, separated by commas.                                                 |
| `qualifier=NAME:TYPE` | Each reference may carry a qualifier: the text after whitespace up to the next comma, validated as `TYPE`. |

A qualifier on a column without `qualifier`, or several references in a column without `many`, is a validation error. A lead `ref` column MUST NOT use either option. Where `sep` is `,`, a cell with several references is quoted.

```
columns: owner:ref[people] | deps:ref many qualifier=lag:duration
---
OAuth {#oauth} | #alice | #reset +2d, #login
```

### 4.4 Canonical form

A `ref` column without options is already canonical: its values are locators written as text.

A column `C` with `many` or `qualifier` moves to a join table `TABLE-C`:

```
---
include: TABLE.rows
lead: from:ref[TABLE]
columns: to:ref[TARGET] | NAME:TYPE
---
```

It has one row per reference, in source row and cell order. `NAME:TYPE` is present only if a qualifier is declared. Source rows that hold references but have no ID are given one.

## 5. Markers

`markers` maps single-character lead prefixes to `bool` columns:

```
markers: done=~ blocked=!
```

- Entries are `NAME=CHAR`, separated by whitespace. `CHAR` is one character that is not alphanumeric, whitespace, `"`, `#`, `{`, `\`, `=`, the delimiter, or the first character of the comment marker.
- Markers are recognised at the start of the lead value, after the indent, in any order. They are removed from the lead value, together with any whitespace that follows them. The rest of the lead cell is read as usual and may be quoted.
- A marker repeated in one row is a structural error. The repeat, and everything after it, is part of the lead value.
- A marker sets its column to `true`. If the column is not declared, it is implicitly `NAME:bool default=false`. A declared marker column that is not `bool` is a structural error.
- A row with a marker and an explicit `false` in the same column is a validation error.
- A lead value beginning with a declared marker character that is not meant as a marker is quoted.

```
~Login page       → lead "Login page", done = true
~!Login page      → done = true, blocked = true
~ Login page      → lead "Login page", done = true
~~Login           → structural error; lead "~Login", done = true
"~Login page"     → lead "~Login page"
```

**Canonical form.** The marker is removed and `true` written in its column.

## 6. Nesting

### 6.1 Declaration

`nest` names the column that holds each row's parent. When `nest` is set, indentation is meaningful. When it is absent, indentation has no meaning.

If not declared, the column is implicitly `NEST:ref`. It MUST be a `ref` to the current table, without options.

### 6.2 Rules

Blank lines and comment lines are skipped. Then:

- The first row MUST have zero indent.
- A row with zero indent has no parent from indentation.
- A row indented more than the previous row is its first child.
- Otherwise the row MUST have exactly the indent of the previous row or one of its ancestors, and becomes the next sibling at that level.

Levels are relative. Any number of spaces deeper counts as one level, so two-space and four-space files are equally valid.

A violation is a structural error. In tolerant mode, the row attaches to the nearest preceding row with a smaller indent, or is top-level if there is none. A recovered row opens its own indent as a level.

```
A
        B         child of A
    C             structural error; recovered as child of A
    D             sibling of C
```

If an indented row also has a value in the parent column, the two MUST agree; otherwise it is a validation error. A row with zero indent may take its parent from the column. A parent chain that forms a cycle is a validation error.

### 6.3 Canonical form

`nest` is kept. Every row is written with zero indent, and its parent is written as `#ID` in the parent column. Parents without an ID are given one. A writer MAY turn parent values back into indentation when doing so does not change row order.

## 7. Order

`order` states whether row order is data.

| `order`              | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `position` (default) | Row order is data.                                               |
| `COLUMN`             | Rows are sorted ascending by `COLUMN`. `-COLUMN` for descending. |
| `none`               | Row order is incidental. Writers MAY reorder rows.               |

- Under `position`, a tool exporting to a store without row order MUST store the order, and restore it on import.
- Under `COLUMN`, a row out of order is a validation error, and writers MUST keep rows sorted.
- Canonical form is the file as written; order needs no rewriting.

## 8. Conformance

A parser implementing these extensions, beyond base conformance:

- removes anchors and markers from lead values, and exposes each row's ID, aliases, and marker values;
- resolves every reference and exposes its target table, target row, and qualifier;
- builds the parent relation when `nest` is set, applying tolerant recovery in tolerant mode;
- reports the errors named in this document with their classes.

A writer, beyond base conformance:

- never changes or removes an existing ID;
- writes anchors only for rows that have an ID;
- can produce and read back canonical form (§1).

## 9. Example

`people.rows`

```
---
columns: rate:number unit=GBP
---
Alice Smith {#alice} | 85
Bob Jones {#bob}     | 70
```

`auth.rows`

```
---
include: people.rows
nest: parent
markers: done=~
columns: est:duration unit=h hpd=8 | owner:ref[people] | deps:ref many qualifier=lag:duration | notes:text
---
Auth {#auth}                  | 2d
    ~Login page {#login}      | 4  | #alice
    Password reset {#reset}   | 6  | #alice | #login
    OAuth (Google) {#oauth}   | 1d | deps=#reset +2d, #login | notes="may not need for v1"
        Consent screen        | 2
        Token refresh         | 3
```

### Canonical form

`auth.rows`

```
---
include: people.rows
key: id
nest: parent
columns: est:duration unit=h hpd=8 | owner:ref[people] | notes:text | id | parent:ref | done:bool default=false
---
Auth            | 2d |        |                     | auth
Login page      | 4  | #alice |                     | login | #auth  | true
Password reset  | 6  | #alice |                     | reset | #auth
OAuth (Google)  | 1d |        | may not need for v1 | oauth | #auth
Consent screen  | 2  |        |                     |       | #oauth
Token refresh   | 3  |        |                     |       | #oauth
```

`auth-deps.rows`

```
---
include: auth.rows
lead: from:ref[auth]
columns: to:ref[auth] | lag:duration
---
#reset | #login
#oauth | #reset | +2d
#oauth | #login
```

Anchors became the `id` column, indentation became `parent`, the `~` marker became `done`, and the multi-valued `deps` became a join table carrying `lag`. In canonical form `key` and `nest` are explicit and the implicit columns are declared, so they can be filled positionally.
