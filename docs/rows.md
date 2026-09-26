# rows — File Format

**Version 0.6 (draft)**

A `.rows` file is a plain-text table: an optional frontmatter block describing the columns, then one delimited row per line. The format is self-contained. Some keys and forms are reserved for extensions (§9).

The key words MUST, MUST NOT, SHOULD, and MAY follow RFC 2119.

## 1. Structure

- UTF-8. A leading BOM is stripped on read and never written.
- Lines end in LF or CRLF; writers emit LF.
- If the first line is `---`, the **frontmatter** runs to the next `---` line, and both delimiter lines are consumed.
- Everything after is the **body**. Each body line is blank, a comment, or a row.

## 2. Frontmatter

### 2.1 Grammar

Each frontmatter line is blank, a comment beginning with `#`, or an entry:

```
entry = key ":" [ value ]
key   = [A-Za-z_][A-Za-z0-9_-]*
```

The value is the rest of the line, trimmed. If it begins and ends with `"`, the quotes are removed and `\"` and `\\` are unescaped. Frontmatter is not YAML, but is readable by most YAML parsers when values are quoted.

### 2.2 Keys

All keys are optional. Unknown keys are ignored. Keys beginning `x-` are for private extensions.

| Key       | Default       | Meaning                                                                      |
| --------- | ------------- | ---------------------------------------------------------------------------- |
| `format`  | `rows/1`      | Format and major version. A prefix other than `rows/` is a structural error. |
| `table`   | filename stem | Logical table name.                                                          |
| `profile` | —             | Source of default keys (§2.3).                                               |
| `sep`     | `\|`          | Cell delimiter. One character; not whitespace, `"`, `\`, or `=`.             |
| `comment` | `//`          | Comment marker. Non-empty; must not contain `sep`.                           |
| `lead`    | `name:text`   | Declaration of the lead column (§4).                                         |
| `columns` | —             | Declarations of the remaining columns, in order (§4).                        |

### 2.3 Profiles

A profile supplies values for keys the file leaves unset.

- If the value contains `/` or ends in `.rows`, it is a path, relative to the file, to a rows file whose frontmatter supplies the defaults. Otherwise it is a name defined by the tool.
- A profile MAY set any key except `format`, `table`, `profile`, `sep`, `comment`, and `include`.
- Only the profile file's frontmatter is used; its body is ignored.
- Keys set in the file take precedence.
- A file meant for exchange SHOULD give its profile as a path, or have its profile's keys written out.

## 3. Rows and cells

A **comment line** begins, after optional whitespace, with the comment marker. The marker has no meaning elsewhere on a line. **Blank lines** contain only whitespace. Both are ignored, but parsers SHOULD retain them in source order so writers can reproduce them.

A **row** is split into cells at each unquoted delimiter. A row MUST NOT begin with the delimiter. A trailing delimiter followed only by whitespace is ignored.

**Lead cell.** The first cell. Its leading spaces are the row's **indent**: preserved, exposed separately from the value, and assigned no meaning by this specification. An indent MUST NOT contain tabs. Trailing whitespace is trimmed.

**Other cells.** Leading and trailing whitespace is trimmed. Interior whitespace is preserved. Alignment padding is never significant.

**Named cells.** An unquoted non-lead cell beginning `NAME=`, where `NAME` matches the column-name grammar and no whitespace surrounds the `=`, is **named**. The text after `=` is an ordinary cell value and may be quoted: `notes="a | b"`.

- `NAME` MUST be a declared column other than the lead.
- Unnamed cells fill the declared columns in order.
- Once a named cell appears, every later cell in the row MUST be named.
- A column MUST NOT be set twice in one row.

A row MUST NOT have more unnamed cells than declared columns (lead plus `columns`).

**Quoted cells.** A cell whose first non-whitespace character is `"` runs to the next unescaped `"`; only whitespace may follow before the delimiter or end of line. Inside, the delimiter is literal, whitespace is preserved, and the escapes are `\"`, `\\`, `\n`, `\t`. A value must be quoted if it contains the delimiter or a newline, begins with `"`, has leading or trailing whitespace to keep, is a non-lead value beginning `NAME=`, or would otherwise be read as a reserved form (§9).

**Null and empty.** An empty cell, or a column not set by the row, is **null**. The quoted cell `""` is the **empty string**, valid only in `text` columns.

## 4. Column declarations

`lead` declares the lead column; `columns` declares the rest, separated by the delimiter. Each declaration is:

```
name[:type][ option]...
```

- `name` matches `[A-Za-z_][A-Za-z0-9_-]*`, is case-sensitive, and is unique within the file.
- `type` defaults to `text`.
- Options are bare flags or `key=value`, separated by whitespace. Quote values containing whitespace.

```
lead: task:text
columns: est:duration unit=h hpd=8 | owner:text | done:bool default=false | notes:text
```

| Option      | Applies to | Meaning                                                        |
| ----------- | ---------- | -------------------------------------------------------------- |
| `required`  | any        | Cell must not be null. The lead column is always required.     |
| `unique`    | any        | No two rows share a non-null value.                            |
| `default=V` | any        | Value assumed when null, written in the column's value syntax. |
| `unit=U`    | `number`   | Informational unit label. No conversion implied.               |
| `unit=U`    | `duration` | A bare number is in unit `U`: with `unit=h`, `4` means `4h`.   |
| `hpd=N`     | `duration` | Hours per day; permits converting between `d` and `h`.         |
| `dpw=N`     | `duration` | Days per week; permits converting between `w` and `d`.         |

Unrecognised options are ignored and retained.

## 5. Types

| Type            | Value syntax              |
| --------------- | ------------------------- |
| `text`          | any value                 |
| `number`        | `[+-]?\d+(\.\d+)?`        |
| `bool`          | `true` \| `false`         |
| `date`          | `YYYY-MM-DD`              |
| `datetime`      | RFC 3339, offset required |
| `duration`      | see below                 |
| `enum[a,b,...]` | one of the listed values  |

**Duration.**

```
duration = [ "+" / "-" ] term *( [ WSP ] term )
term     = number [ WSP ] unit
number   = 1*DIGIT [ "." 1*DIGIT ]
unit     = "m" / "h" / "d" / "w"
```

With `unit=U`, a value that is a single signed number is that many `U`.

`m` is minutes, `h` hours, `d` days, `w` weeks. Each unit appears at most once. Examples: `4h`, `1d 4h`, `2.5d`, `-30m`.

A duration is a bag of unit terms, not a normalised quantity. Minutes and hours convert at 60. Tools MUST NOT convert between `d` and `h` without `hpd`, or between `w` and `d` without `dpw`. A leading sign is preserved as part of the value.

Types beginning `x-` are extension types, read as `text`. Any other unknown type is a validation error (§6).

## 6. Errors

| Class          | Meaning                                                   |
| -------------- | --------------------------------------------------------- |
| **Syntax**     | A line cannot be tokenised.                               |
| **Structural** | A line tokenises but breaks a rule of this specification. |
| **Validation** | A value does not match its column's type or options.      |

Every non-blank, non-comment body line produces a row, whatever its errors. Recovery is defined so that all parsers produce the same rows.

**Frontmatter and declarations**

| Error                                                                                        | Class      | Recovery                                                                   |
| -------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| No closing `---`                                                                             | Syntax     | No frontmatter. The opening `---` is ignored and every later line is body. |
| Malformed frontmatter line                                                                   | Syntax     | Line ignored.                                                              |
| Key set twice                                                                                | Structural | Last value used.                                                           |
| Unsupported `format`                                                                         | Structural | Read as `rows/1`.                                                          |
| Invalid `sep` or `comment`                                                                   | Structural | Default used.                                                              |
| Unresolvable profile                                                                         | Structural | File read without it.                                                      |
| Column name not matching the grammar, or already used                                        | Structural | Column kept in position, but cannot be set by name.                        |
| Malformed type, such as a bad `enum[...]`                                                    | Structural | Column read as `text`.                                                     |
| Unknown type                                                                                 | Validation | Column read as `text`.                                                     |
| Invalid option value, such as `unit=x`, `hpd=0`, or a `default` that does not match the type | Structural | Option ignored.                                                            |

**Rows**

| Error                                                     | Class      | Recovery                                                                   |
| --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| Unterminated quoted cell                                  | Syntax     | Cell runs to end of line.                                                  |
| Unknown escape                                            | Syntax     | Kept literally.                                                            |
| Text after closing quote                                  | Syntax     | Appended to the value.                                                     |
| Row begins with delimiter                                 | Structural | Lead is null.                                                              |
| Tab in indent                                             | Structural | Each tab counts as one space.                                              |
| Heading line (§9)                                         | Structural | Read as a row.                                                             |
| Named cell whose name is undeclared or is the lead column | Structural | Read as an unnamed cell whose value is the whole raw text, e.g. `ratio=2`. |
| Unnamed cell after a named cell                           | Structural | Kept as overflow.                                                          |
| Column set twice in a row                                 | Structural | First value kept; later ones kept as overflow.                             |
| More unnamed cells than columns                           | Structural | Extras kept as overflow.                                                   |
| Value does not match its column                           | Validation | Raw text kept.                                                             |

**Overflow** cells are kept in order on their row, exposed by parsers, and written back by writers.

**Modes.** A parser runs in one of two modes:

- **Strict**: the file fails if it has any syntax or structural error. For importers and CI.
- **Tolerant**: every error is reported and every row is returned, recovered as above. Editors MUST use tolerant mode.

Validation errors do not fail a file in either mode. Severity is the tool's choice.

## 7. Conformance

A parser:

- supports strict and tolerant modes;
- exposes each row's indent, values by column, overflow, and source line;
- reports each error with its class and line, and SHOULD include the column or span.

A writer:

- produces a file that reads back to the same rows, values, indents, and overflow;
- emits frontmatter first, if any keys are set;
- preserves comment lines, blank lines, and whether the file ended with a newline;
- MAY normalise padding, quote style, line endings, and whether cells are named;
- quotes any value that would otherwise be misread.

A file with no frontmatter is a one-column table named `name`. Most plain lists are therefore valid rows files.

## 8. Examples

Minimal:

```
Milk
Eggs
Bread
```

Flat table:

```
---
table: expenses
columns: amount:number unit=GBP required | when:date | paid:bool default=false | memo:text
---
Rent          | 1200   | 2026-09-01 | true
Electricity   | 84.20  | 2026-09-03 | memo="estimated; actual bill pending"
Coffee beans  | 18     | 2026-09-05 | true  | ""
```

Row 2 sets `memo` by name, leaving `paid` null (defaults to `false`). Row 3 has an empty-string memo; row 1's memo is null.

Indented file:

```
---
columns: est:duration unit=h hpd=8 | owner:text | notes:text
---
// Q4 auth work. Estimates are rough.
Auth                        | 2d
    ~Login page             | 4    | alice
    Password reset          | 6    | alice
    OAuth (Google)          | +1d  | notes="may not need for v1"
        Consent screen      | 2
        Token refresh       | 3
Admin                       | owner=bob
    User list               | 1d 4h
```

Eight rows. Indents are preserved but carry no meaning, and `~Login page` is the literal lead value. Bare numbers in `est` are hours. With `hpd=8`, `1d 4h` may be computed as `12h`.

Quoting:

```
---
sep: ,
columns: qty:number | note
---
"Widget, large" , 3 , "Has a \"quoted\" word and a newline\nhere"
```

## 9. Reserved

| Reserved                                                                                             | Treatment in this specification                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Keys `key`, `include`, `nest`, `order`, `markers`                                                    | Ignored.                                                      |
| Type `ref` (and `ref[...]`)                                                                          | Read as `text`.                                               |
| Heading line: first non-whitespace characters are one or more `#` followed by a space or end of line | Structural error. Quote the lead value to write it literally. |
| One or more `{...}` groups at the end of an unquoted lead cell                                       | Part of the lead value.                                       |
| Indent                                                                                               | Preserved; no meaning.                                        |
| Unrecognised column options                                                                          | Ignored and retained.                                         |

A `#` not followed by a space, as in `#login`, is not reserved and may begin a row.
