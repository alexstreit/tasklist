# Open questions

Places where the specs are ambiguous, silent, or disagree with themselves, found while writing the conformance cases. Each affected case uses the reading marked **Used** and has `"disputed": true`. Settling a question means changing the spec, then the case if needed, then removing `disputed`.

Where a question says a rule has "no class", the class matters because strict mode fails on syntax and structural errors but not on validation errors.

---

## Q1. The quoting example declares its columns with `|` in a `,` file

**Cases:** `base-8-quoting` (+ `--strict`). Companion, not disputed: `base-8-quoting-corrected`.
**Spec:** base §8 quoting example; base §4 ("`columns` declares the rest, separated by the delimiter"); base §2.2 `sep`.

The example sets `sep: ,` and then writes `columns: qty:number | note`. By §4 the declarations are split at `,`, so this is one declaration: column `qty`, type `number`, and two unrecognised bare options, `|` and `note`. The row then has one unnamed cell too many.

- **A (used).** Follow §4 as written: two columns (`name`, `qty`), the third cell is overflow, with a structural error. The example is wrong and should read `columns: qty:number , note`. `base-8-quoting-corrected` is that version.
- **B.** `columns` is always split at `|`, whatever `sep` is. That contradicts §4, and it makes a `|` inside an option value impossible to write in a `|` file anyway.

**Suggested fix:** change the example to `columns: qty:number , note`.

## Q2. Leading whitespace in frontmatter lines

**Cases:** `base-2.1-leading-whitespace` (+ `--strict`).
**Spec:** base §2.1.

The grammar is `entry = key ":" [ value ]`. It allows no whitespace before the key or between the key and `:`, and a comment is a line "beginning with `#`". Body comments explicitly allow leading whitespace (§3); frontmatter doesn't say.

- **A (used).** Follow the grammar strictly: `  table: x`, `table : y` and `  # comment` are all malformed lines (syntax errors, ignored).
- **B.** Trim each line first, so all three are fine: the entries are entries and the comment is a comment.
- **C.** Allow whitespace around the key only (A for comments, B for entries), as YAML does.

I think A is what the text says. B is friendlier, and "readable by most YAML parsers" argues against it only weakly. Either way the spec should say.

## Q3. Is `format: rows/2` an error?

**Cases:** `base-2.2-format-major-version` (+ `--strict`).
**Spec:** base §2.2 (`format`: "A prefix other than `rows/` is a structural error"); base §6 ("Unsupported `format` … Read as `rows/1`").

§2.2 only makes a non-`rows/` prefix an error. §6 says "unsupported format", which reads wider.

- **A (used).** A major version this parser doesn't implement is also unsupported: structural error, read as `rows/1`.
- **B.** Only a foreign prefix is an error. `rows/2` is read as `rows/1` silently.

A seems safer, because a future `rows/2` file read as `rows/1` without a word would be misread. The spec should also say what a malformed value such as `rows/` or `rows/x` is.

## Q4. A profile that sets a forbidden key

**Cases:** `base-2.3-forbidden-profile-key` (+ `--strict`).
**Spec:** base §2.3 ("A profile MAY set any key except `format`, `table`, `profile`, `sep`, `comment`, and `include`"); the base §6 error table has no row for it.

- **A (used).** The key is ignored and there is a structural error, reported on the file's `profile:` line (the only line in this file the error can point to).
- **B.** Ignored silently. The profile is at fault, not the file.
- **C.** The whole profile is rejected, as if it were unresolvable.

The spec needs a row in the §6 table. It should also say whether `x-` and unknown keys in a profile pass through.

## Q5. Errors inside a profile's frontmatter

**Cases:** `base-2.3-profile-with-errors` (+ `--strict`).
**Spec:** base §2.3; base §6; base §7 ("reports each error with its class and line").

A profile's own frontmatter can have malformed lines, duplicate keys, bad declarations and so on. The spec doesn't say whether the reading file reports them, or where. Their line numbers belong to another file.

- **A (used).** Each one is reported with its own class, on the file's `profile:` line. So a syntax error in a profile fails the file in strict mode.
- **B.** Not reported at all. The profile is the tool's (named) or another file's (path) concern.
- **C.** Reported under one code, such as `profile-has-errors`, on the `profile:` line, with a class chosen by the spec.

A keeps strict mode honest. The file really is read differently because of the error. It does mean a file can fail for a mistake it doesn't contain.

## Q6. `sep` that collides with the default `comment`

**Cases:** `base-2.2-sep-in-default-comment` (+ `--strict`).
**Spec:** base §2.2 (`comment` "must not contain `sep`"); base §6 ("Invalid `sep` or `comment` … Default used").

`sep: /` is a valid delimiter by itself, but the default comment `//` contains it. Using the default comment doesn't fix the conflict.

- **A (used).** `sep` is invalid, so there is a structural error on the `sep` line and `sep` falls back to `|`. The file set `sep`, so it's the key at fault.
- **B.** `sep: /` is valid and the comment marker becomes invalid, but its default is also invalid, so the file has no comment marker.
- **C.** Allowed. The rule applies only when the file sets `comment` itself.

## Q7. `enum[…]` values and a `,` delimiter

**Cases:** `base-4-enum-with-comma-sep` (+ `--strict`).
**Spec:** base §4 (declarations separated by the delimiter); base §5 (`enum[a,b,...]`).

With `sep: ,`, the declaration `level:enum[low,high]` is cut at its own commas: `level:enum[low` (malformed type) and `high]` (invalid column name). No enum can be declared in a `,` file.

- **A (used).** Follow §4 literally, as above. Two structural errors.
- **B.** Brackets protect their contents when splitting declarations.
- **C.** Enum values are separated by the delimiter's complement: `,` normally, and something else when `sep` is `,`.

I used A because it is what the text says, but I think B is what the spec should say. The same problem hits `enum` values containing whitespace, because options are split at whitespace.

## Q8. Whitespace between a closing quote and stray text

**Cases:** `base-6-row-text-after-quote-space` (+ `--strict`).
**Spec:** base §3 quoted cells ("only whitespace may follow before the delimiter"); base §6 ("Text after closing quote … Appended to the value").

For `"abc" def  |`, what is appended: ` def` or `def`?

- **A (used).** Everything after the closing quote, up to the trailing whitespace the cell loses anyway: `abc def`.
- **B.** The text after the quote, trimmed: `abcdef`.

## Q9. When one mistake breaks several rules, is each reported?

**Cases:** `base-6-row-begins-with-delimiter`, `ext-3.2-example-key-without-identity`, `ext-3.2-lead-empty-after-marker`, `ext-3.2-anchor-position` (line 5), `ext-3.1-duplicate-id` (each + `--strict` where it has one).
**Spec:** base §4 ("The lead column is always required"); base §6 recovery tables; ext §3.1 ("implicitly `unique`"); anchors §4.

Recovery produces a row, and the recovered row may then break another rule:

- `| 2d`: row begins with delimiter (structural), and the lead is then null, which breaks "the lead column is always required" (validation).
- `Auth | id=auth` with no identity: `id` is an undeclared cell name (structural), so it is read as an unnamed cell, which is then one more than there are columns (structural).
- `~ | 1d` and `{#only} | 2d`: once the marker or anchor is removed the lead is empty, so null, so required fails.
- Two rows with `{#a}`: a duplicate ID (anchors §4), and also a duplicate value in the implicitly `unique` key column (§3.1).

- **A (used).** Recovery first, then every rule is checked on the recovered row, and each violation is reported, except where two rules are the same rule stated twice (the duplicate ID is reported once, as `duplicate-id`).
- **B.** One error per mistake: only the first rule broken is reported.

A is mechanical and gives the same answer in every parser. B needs the spec to define which rule "comes first" in every combination. The spec should also say whether `    | 3d` (indent, then the delimiter) "begins with the delimiter". The case assumes it does.

## Q10. One error per row, or one per extra cell?

**Cases:** `base-6-row-too-many-cells-several` (+ `--strict`).
**Spec:** base §6 ("More unnamed cells than columns … Extras kept as overflow").

- **A (used).** One error per row. The rule is about the row.
- **B.** One per extra cell, which is what "column set twice" naturally does: each repeat is its own error.

Fixtures compare exact error lists, so the count matters.

## Q11. Which line carries an error that involves several lines?

**Cases:** `base-6-fm-key-set-twice`, `base-4-unique`, `ext-3.1-case-conflict`, `ext-6.2-parent-cycle` (each + `--strict` where it has one).
**Spec:** base §6 ("Key set twice"); base §4 `unique`; ext §3.1 (IDs differing by case); ext §6.2 (cycles); anchors §4 ("A duplicate is an error on every line that declares it"); base §7.

Only anchors §4 says. The rest don't.

- **A (used).** Symmetric conditions go on every line involved, as anchors §4 does for duplicate IDs: both rows sharing a `unique` value, both IDs differing by case, every row in a cycle. An ordered condition goes on the later line: a key set twice is reported on the second occurrence.
- **B.** Everything on the later line only.

## Q12. Must a `date` be a real calendar date?

**Cases:** `base-5-date-calendar`.
**Spec:** base §5 (`date`: `YYYY-MM-DD`).

- **A (used).** Yes: `2026-02-30` and `2026-13-01` are invalid, and `2028-02-29` is valid.
- **B.** The syntax is all that's checked.

`datetime` is defined by RFC 3339, which requires real dates, so A keeps the two types consistent.

## Q13. A quoted lead can't carry an anchor

**Cases:** `ext-3.2-quoted-lead-with-anchor` (+ `--strict`).
**Spec:** ext §3.2 ("Anchor groups are recognised at the end of an **unquoted** lead cell"); ext §5 ("The rest of the lead cell is read as usual and may be quoted"); base §3 and §6 (text after closing quote).

A title that must be quoted, such as `~Tilde title` in a file where `~` is a marker, can't also have an ID. `"~Tilde title" {#t}` is a syntax error (text after closing quote), the text is appended, and the anchor becomes part of the lead.

- **A (used).** As the text says: syntax error, lead `~Tilde title {#t}`, no ID.
- **B.** Anchor groups may follow a quoted lead value, as markers may precede one. Lead `~Tilde title`, ID `t`, no error.

I think B is what the spec should say. It also matters for DESIGN §6: `setLead` quotes a title that would read as a marker, and under A that silently drops the row's anchor from the syntax.

## Q14. Where exactly an anchor may sit in the lead

**Cases:** `ext-3.2-anchor-position`.
**Spec:** anchors §2 (groups "preceded by whitespace or the start of the line"); ext §3.2 (groups "at the end of an unquoted lead cell").

The binding moves recognition to the end of the lead cell, but doesn't say whether the other rule still applies.

- `Glued{#glued}`. **Used:** not an anchor, because the whitespace rule still applies. The lead is `Glued{#glued}`. The alternative is that the binding replaces the rule, which gives lead `Glued` and ID `glued`.
- `    {#only} | 2d`: the whole lead is an anchor. **Used:** it is an anchor ("start of the line" read as the start of the lead value, after the indent), and the lead is then null (see Q9).

## Q15. The table name of an include that can't be read, and `ref[TABLE]` naming no table

**Cases:** `ext-4.1-refs-into-unreadable-include`, `ext-4.3-example`, `ext-4.2-unknown-table`, `ext-9-auth`, `ext-9-auth-canonical`, `ext-9-auth-deps`, `anchors-3-locators` (each + `--strict`).
**Spec:** ext §4.1 ("known by … its `as` alias if given, otherwise its own `table` value"; "every reference into that table is a validation error"); ext §4.2.

Without `as`, an included table's name comes from inside the file, which can't be read. So in `include: people.rows`, a parser can't know that `ref[people]` refers to it. This covers the §9 example itself, and in v1 every include is unreadable (DESIGN §1).

- **A (used).** An unreadable include without `as` is known by its path's file stem (`people.rows` → `people`), the same default `table` has. References into it are validation errors.
- **B.** An unreadable include has no name. `ref[people]` then names no table, the same as the next point.

And for `ref[people]` when no include can be called `people`, which the spec doesn't cover:

- **A (used).** A structural error on the declaration (`unknown-table`). The column stays `ref[people]` and every reference in it is a validation error.
- **B.** A malformed type (base §6): structural, and the column is read as `text`.

## Q16. Extension rules with no class or no recovery

**Cases:** `ext-3.1-invalid-id`, `ext-4.1-duplicate-table-name`, `ext-4.2-wrong-table`, `anchors-3-locators`, `ext-4.3-lead-ref-options`, `ext-5-invalid-marker`, `ext-5-marker-column-not-bool`, `ext-6.1-nest-column-not-ref`, `ext-7-order-unknown-column` (each + `--strict` where it has one).
**Spec:** ext §3–§7; base §6 class definitions.

Each of these is a MUST whose error class, recovery, or both are not stated. **Used** is my reading; the spec should state each one.

| Rule                                                                  | Used                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1: a key value MUST match the ID grammar                           | Validation (a value not matching its column). The row has no ID.                                                                      |
| §4.1: table names MUST be unique and differ from the file's own       | Structural, on the `include` line. Which include keeps the name is also unstated; the case doesn't depend on it.                      |
| §4.2: a prefixed `TABLE#ID` MUST name the column's target table       | Validation (`wrong-table`). The spec gives no grammar for `TABLE`, so `../plans/q4.md#auth` (anchors §3) is a wrong table here, not a malformed locator. |
| §4.3: a lead `ref` column MUST NOT use `many` or `qualifier`          | Structural (like an invalid option value). The option is ignored.                                                                     |
| §5: `CHAR` must be one character outside the forbidden set            | Structural, one per bad entry. The entry is ignored, so the character is literal and no column is created.                            |
| §5: a declared marker column that is not `bool` (class stated)        | The marker entry is ignored: `~A` keeps its `~` and the column is read as declared.                                                   |
| §6.1: the nest column MUST be a `ref` to this table, without options  | Structural, on the `nest` line. Nesting from indentation still applies. The column is read as declared and not compared with indentation. |
| §7: `order: COLUMN` naming no column                                  | Structural, on the `order` line. Read as `position`.                                                                                  |

## Q17. An anchor and a key value that differ: which is the ID?

**Cases:** `ext-3.2-anchor-key-mismatch`.
**Spec:** ext §3.2 ("The first ID sets the row's key"; "A row with both an anchor and a key value that differ is a validation error").

- **A (used).** The anchor's ID. It is the one on the lead, which is what anchors §2 names the line by. The key cell keeps its raw text.
- **B.** The key cell's value, because the key column is the canonical form.
- **C.** Neither: the row has no ID.

## Q18. Parent mismatch and cycles: what the parent relation becomes

**Cases:** `ext-6.2-parent-mismatch`, `ext-6.2-parent-cycle`.
**Spec:** ext §6.2 (both are validation errors, with no recovery given); DESIGN §4 (`parent`, `roots`).

Validation errors normally leave the data as written, but the parent relation has to be something.

- Indentation and parent column disagree. **Used:** indentation wins, because it is what the reader sees. The alternative is that the column wins, because it is the canonical form.
- Cycle. **Used:** every row in the cycle has no parent and becomes a root, so the relation stays a tree and nothing hangs. The alternative is to break the cycle at one row, which then needs a rule for which row.

## Q19. Order checking: against what, and how are values compared?

**Cases:** `ext-7-order-which-row`.
**Spec:** ext §7 ("a row out of order is a validation error").

With `order: n` and values `1, 5, 2, 3`:

- **A (used).** Each row is compared with the row before it. Only `2` is out of order.
- **B.** Each row is compared with the largest value so far. `2` and `3` are both out of order.

Also unstated, with no case yet: where null values sort; how `text` compares (code points or locale); whether `duration` values compare when a `d`-to-`h` conversion would need `hpd` that isn't there; and whether rows are compared across nesting levels or only among siblings when `nest` is set.
