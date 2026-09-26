# rows — Extensions

**Version 0.6 (draft)**

This document defines identity, references, includes, markers, nesting, and row order for rows files. It uses the keys and forms reserved by the base format (base §9), and binds the Text Anchors specification to rows. Error classes, recovery, and modes are as in base §6. §10 lists every error this document defines.

The base rule for keys with a default (base §6) applies to the keys here. An empty `order:` is a structural error, and its default, `position`, applies. An empty `key:` is a structural error, and `key` is treated as unset, so it doesn't make identity apply (§3.1). An empty `nest:`, `markers:` or `include:` declares nothing, and is not an error.

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
- It is implicitly `unique`. This is the same rule as Text Anchors §4's rule against duplicate IDs, so a duplicate is reported once on each row that declares it, whether as a key or an alias.
- A non-null value MUST match the Text Anchors ID grammar. A value that doesn't is a validation error, and the row has no ID.
- Two keys that differ only by case are a validation error, reported on both rows.
- A row whose key is null has no ID.

### 3.2 Anchors in the lead cell

This is the Text Anchors binding for rows:

- Anchor groups are recognised at the end of the lead cell: after an unquoted lead value, or after the closing quote of a quoted one (base §9). They are removed from the lead value, together with the whitespace before them.
- As in Text Anchors §2, the first group must be preceded by whitespace or by the start of the lead value, so `Glued{#glued}` is ordinary text. A lead cell that holds only anchor groups has a null lead.
- An anchor names its **row**.
- The first ID sets the row's key. Any further IDs are aliases.
- A row with both an anchor and a key value that differ is a validation error. The anchor's ID is the row's ID.
- To write a lead value ending in a literal `{#...}` group, quote the whole value.

```
Auth {#auth}              → lead "Auth", id "auth"
Auth | id=auth            → the same row (in a file where identity applies)
"Email {#home}"           → lead "Email {#home}", no id
"Email" {#home}           → lead "Email", id "home"
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
- Each included file is known by a **table name**: its `as` alias if given, otherwise its own `table` value, otherwise its file stem. An include that cannot be read has no `table` value, so it is known by its alias or its file stem.
- Table names MUST be unique within the including file and MUST differ from its own table name. A violation is a structural error on the `include` line.
- Includes are not transitive, and never add rows to the including file.
- An include that cannot be read is a structural error. The file still parses, and every reference into that table is a validation error.

### 4.2 The ref type

A `ref` column holds references to rows. `ref` targets the current table; `ref[TABLE]` targets the current table or an included table by name. A `ref[TABLE]` whose `TABLE` is neither is a structural error. The column stays a `ref`, and every reference in it is a validation error.

Each reference is a Text Anchors locator, optionally followed by a qualifier:

```
reference = locator [ 1*WSP qualifier ]
locator   = [ TABLE ] "#" ID
```

- An unprefixed `#ID` resolves in the column's target table.
- A prefixed `TABLE#ID` MUST name the column's target table; otherwise it is a validation error. `TABLE` is everything before the `#`, so `../plans/q4.md#auth` names a table, and not the target one.
- A reference whose target does not exist is a validation error.

### 4.3 Options

| Option                | Meaning                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `many`                | The cell may hold several references, separated by commas.                                                 |
| `qualifier=NAME:TYPE` | Each reference may carry a qualifier: the text after whitespace up to the next comma, validated as `TYPE`. |

A qualifier on a column without `qualifier`, or several references in a column without `many`, is a validation error. A lead `ref` column MUST NOT use either option; an option that breaks this is a structural error, and is ignored. The options otherwise follow base §4: on a column that isn't a `ref`, `many` given a value, or `qualifier` given none, each is a structural error, and the option is ignored. A qualifier is written like a declaration, `NAME[:TYPE]`, with the type defaulting to `text`; a malformed or unknown type is reported as it would be for a column, and read as `text`. A `ref` qualifier type is reserved: it is a structural error, and the option is ignored. Where `sep` is `,`, a cell with several references is quoted.

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

- Entries are `NAME=CHAR`, separated by whitespace. `CHAR` is exactly one Unicode code point that is not alphanumeric (a letter or digit in any script: `\p{L}` or `\p{N}`), whitespace, `"`, `#`, `{`, `\`, `=`, the delimiter, or the first character of the comment marker. An entry that breaks this is a structural error, and is ignored. So is a repeated name or character: as with a repeated `enum` value (base §5), the later entry is ignored.
- Markers are recognised at the start of the lead value, after the indent, in any order. They are removed from the lead value, together with any whitespace that follows them. The rest of the lead cell is read as usual and may be quoted.
- A marker repeated in one row is a structural error. The repeat, and everything after it, is part of the lead value.
- A marker sets its column to `true`. If the column is not declared, it is implicitly `NAME:bool default=false`. A declared marker column that is not `bool` is a structural error, reported on the `markers` line. Its marker entry is ignored, and the column is read as declared.
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

If not declared, the column is implicitly `NEST:ref`. It MUST be a `ref` to the current table, without options. Otherwise it is a structural error: nesting from indentation still applies, and the column is read as declared and not compared with indentation.

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

If an indented row also has a value in the parent column, the two MUST agree; otherwise it is a validation error, and the parent from indentation is used. A row with zero indent may take its parent from the column. A parent chain that forms a cycle is a validation error on every row in the cycle, and those rows have no parent.

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
- Each row is compared with the previous row whose value is not null. When `nest` is set, only siblings are compared: rows with the same parent, or top-level rows. A row that sorts before the one it is compared with is out of order.
- Null values are skipped. Numbers compare numerically, dates and datetimes chronologically, and text by Unicode code point. Durations compare in minutes where the column can convert both values (base §5); a pair that can't be converted is skipped. Enum values compare in declaration order, and bools with `false` before `true`. As for equality (base §5), two values that don't match their column compare as their text; a valid value and an invalid one, like durations that can't be converted, are skipped. References compare by their locator text, by code point, and never by their targets' positions, so a row's order doesn't depend on whether a reference resolves or on the order of another table.
- An `order` naming no column is a structural error on the `order` line, and is read as `position`.
- Canonical form is the file as written; order needs no rewriting.

## 8. Conformance

A parser implementing these extensions, beyond base conformance:

- removes anchors and markers from lead values, and exposes each row's ID, aliases, and marker values;
- resolves every reference and exposes its target table, target row, and qualifier;
- builds the parent relation when `nest` is set, applying tolerant recovery in tolerant mode;
- reports the errors listed in §10 with their classes.

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

## 10. Errors

Every error this document defines. Recovery follows base §6: recovery comes first, then every rule is checked.

| Error                                                                  | Class      | Recovery                                                                                             |
| ---------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| Key value not matching the ID grammar (§3.1)                           | Validation | Raw text kept. The row has no ID.                                                                    |
| Duplicate ID, as a key or an alias (§3.1)                              | Validation | Reported once on every row that declares it.                                                         |
| Two IDs that differ only by case (§3.1)                                | Validation | Reported on both rows.                                                                               |
| Anchor and key value differ (§3.2)                                     | Validation | The anchor's ID is the row's ID.                                                                     |
| Include cannot be read (§4.1)                                          | Structural | Known by its alias or file stem. Every reference into it is a validation error.                      |
| Table name repeated, or equal to the file's own (§4.1)                 | Structural | Reported on the `include` line.                                                                      |
| `ref[TABLE]` naming no table (§4.2)                                    | Structural | Column stays a `ref`. Every reference in it is a validation error.                                   |
| Reference whose target does not exist (§4.2)                           | Validation | Raw text kept. One error per reference.                                                              |
| Prefixed `TABLE#ID` naming another table (§4.2)                        | Validation | Raw text kept.                                                                                       |
| Qualifier without `qualifier`, or several references without `many` (§4.3) | Validation | Raw text kept.                                                                                   |
| Lead `ref` column with `many` or `qualifier` (§4.3)                    | Structural | Option ignored.                                                                                      |
| Invalid marker entry (§5)                                              | Structural | Entry ignored. One error per entry.                                                                  |
| Marker repeated in one row (§5)                                        | Structural | The repeat, and everything after it, is part of the lead value.                                      |
| Declared marker column that is not `bool` (§5)                         | Structural | Reported on the `markers` line. Marker entry ignored. Column read as declared.                       |
| Marker and an explicit `false` in the same column (§5)                 | Validation | Both kept.                                                                                           |
| Nest column not a `ref` to the current table, or with options (§6.1)   | Structural | Reported on the `nest` line. Indentation still nests; the column is read as declared.                |
| Indent breaking the rules of §6.2                                      | Structural | Attached to the nearest preceding row with a smaller indent, or top-level. Opens its own level.      |
| Indentation and parent column disagree (§6.2)                          | Validation | The parent from indentation is used.                                                                 |
| Parent chain forming a cycle (§6.2)                                    | Validation | Reported on every row in the cycle. Those rows have no parent.                                       |
| `order` naming no column (§7)                                          | Structural | Reported on the `order` line. Read as `position`.                                                    |
| Row out of order (§7)                                                  | Validation | Row kept where it is.                                                                                |
