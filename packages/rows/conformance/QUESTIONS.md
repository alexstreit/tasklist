# Open questions

Places where the specs are ambiguous, silent, or disagree with themselves, found while writing the conformance cases. Each affected case uses the reading marked **Used** and has `"disputed": true`. Settling a question means changing the spec, then the case if needed, then removing `disputed` and moving the question to [Resolved](#resolved).

Where a question says a rule has "no class", the class matters because strict mode fails on syntax and structural errors but not on validation errors.

---

Q24–Q30 came up while implementing the base stage (Task 17). The parser implements each **Used** reading, so settling one differently means changing the parser as well as the case.

## Q24. Delimiter lines and whitespace

**Cases:** `base-1-delimiter-whitespace` (+ `--strict`).
**Spec:** base §1 ("If the first line is `---`, the frontmatter runs to the next `---` line"); base §2.1 (frontmatter lines are trimmed, from Q2).

Since Q2, lines inside the frontmatter are trimmed, but §1 says nothing about the delimiter lines themselves.

- **A (used).** A delimiter is exactly `---`. An indented `  ---` inside the block is a malformed line, not the closing one, and a first line of `--- ` (trailing space) doesn't open frontmatter, so the file is all body.
- **B.** Delimiter lines are trimmed too, so `  ---` closes the block and `--- ` opens one.

## Q25. Quoted option values in `columns`

**Cases:** `base-4-quoted-option-value`.
**Spec:** base §4 ("Quote values containing whitespace"; declarations separated by the delimiter).

A quoted option value protects its whitespace, but the spec doesn't say whether it also protects the delimiter, or which escapes apply.

- **A (used).** Quotes protect both the delimiter and whitespace, as brackets do, and `\"` and `\\` are unescaped, as in frontmatter values (§2.1). `default="a | b"` is one option.
- **B.** Quotes protect only whitespace. `default="a | b"` is split at the delimiter, leaving a declaration `b"`.

## Q26. Empty declarations

**Cases:** `base-4-empty-declarations` (+ `--strict`).
**Spec:** base §4.

- A trailing delimiter in `columns`, as in `a | b |`. **Used:** ignored, as a trailing delimiter is in a row (§3).
- An empty declaration between delimiters, as in `a | | b`. **Used:** a column whose name is empty, so an invalid column name: a structural error, and the column is kept in position.
- An empty `lead:` value. **Used:** the same, a lead column with an invalid empty name. No case yet.

The alternatives are to skip empty declarations, which shifts every positional cell after them, or to treat them as malformed lines.

## Q27. How many errors for several unnamed cells after a named one

**Cases:** `base-6-row-unnamed-after-named-several` (+ `--strict`).
**Spec:** base §3 ("Once a named cell appears, every later cell in the row MUST be named"); base §6.

- **A (used).** One per row, as for too many cells (Q10), since the rule is about the row.
- **B.** One per unnamed cell.

The other cell rules are one error per cell, as used: each undeclared name and each column set a second time.

## Q28. A profile file with no frontmatter, or an unclosed one

**Cases:** `base-2.3-profile-without-frontmatter`, `base-2.3-profile-unclosed` (+ `--strict`).
**Spec:** base §2.3 ("Only the profile file's frontmatter is used"; "If the profile's frontmatter has any errors…").

- A profile whose text doesn't start with `---`. **Used:** it supplies no keys, and it isn't an error: it has no frontmatter, so it has no errors in it.
- A profile whose frontmatter is never closed. **Used:** `profile-has-errors`, and it supplies no keys, because an unclosed block is not frontmatter (§6).

Either could instead be unresolvable-profile, since such a file is arguably not a profile.

## Q29. What counts as whitespace

**Cases:** `base-3-whitespace-is-space-and-tab`.
**Spec:** base §2.1, §2.2 (`sep` not whitespace), §3 (blank lines, trimming, indent). Only the duration grammar (§5) says `WSP`.

- **A (used).** Whitespace is space and tab, as `WSP` means in RFC 5234. A no-break space is content: it is kept at the end of a cell, a line holding only one is a row, and `sep` may be one.
- **B.** Unicode whitespace, as most languages' `trim` does. Parsers then disagree on exotic characters unless the spec lists them.

## Q30. Trailing whitespace in an unterminated quoted cell

**Cases:** `base-6-row-unterminated-quote-trailing-space` (+ `--strict`).
**Spec:** base §6 ("Unterminated quoted cell … Cell runs to end of line"); base §3 (inside quotes, whitespace is preserved).

- **A (used).** Kept. The cell is still a quoted cell, and quoted whitespace is preserved: `"open   ` gives `open   `.
- **B.** Trimmed, since the missing quote suggests the whitespace was never meant to be kept.

---

## Resolved

### Q1. The quoting example declared its columns with `|` in a `,` file

**Decision:** declarations follow the file's own delimiter, and the example was wrong. It now reads `columns: qty:number , note`.
**Spec changed:** base §8, the quoting example, plus a sentence after it.
**Cases:** `base-8-quoting` is now the corrected example, not disputed and with no strict variant. The former base-8-quoting-corrected case is merged into it. The example's old input is kept as `base-4-columns-follow-sep` (+ `--strict`), where it shows that a `|` in a `,` file doesn't separate declarations.

### Q2. Leading whitespace in frontmatter lines

**Decision:** each frontmatter line is trimmed, and whitespace may come before the `:`.
**Spec changed:** base §2.1 (the text and the `entry` grammar).
**Cases:** `base-2.1-leading-whitespace` is rewritten so that an indented entry, a space before the colon and an indented comment all read cleanly. It has no errors, so its strict variant is gone.

### Q3. `format: rows/2`

**Decision:** any value other than `rows/1` is unsupported: another major version, or a malformed value such as `rows/` or `rows/x`. Structural error, read as `rows/1`.
**Spec changed:** base §2.2 (the `format` row); base §6 (the unsupported-format row).
**Cases:** `base-2.2-format-major-version` (+ `--strict`) is no longer disputed. `base-2.2-format-malformed` (+ `--strict`) is new.

### Q4. A profile that sets a forbidden key

**Decision:** a structural error on the file's `profile:` line, and the key is ignored. Unknown and `x-` keys in a profile pass through like any other key.
**Spec changed:** base §2.3; base §6 (new row: profile sets a forbidden key).
**Cases:** `base-2.3-forbidden-profile-key` (+ `--strict`). Its profile now also sets `x-foo` and an unknown `width`, and still produces exactly one error.

### Q5. Errors inside a profile's frontmatter

**Decision:** one structural error in total, `profile-has-errors`, on the file's `profile:` line and naming the profile. The profile is still used, as recovered. Strict mode fails.
**Spec changed:** base §2.3; base §6 (new row: errors in the profile's frontmatter).
**Cases:** `base-2.3-profile-with-errors` (+ `--strict`) expects `profile-has-errors`. The code is added to README.md.

### Q6. `sep` that collides with the default `comment`

**Decision:** the key the file set is at fault. `sep: /` with no `comment` key makes `sep` invalid.
**Spec changed:** base §2.2 (a paragraph after the key table).
**Cases:** `base-2.2-sep-in-default-comment` (+ `--strict`). Q20 settled the case where the file sets both keys, and replaced this wording.

### Q7. `enum[…]` values and a `,` delimiter

**Decision:** brackets protect their contents from both the delimiter and the whitespace between options. Enum values are trimmed and can't contain `,` or `]`.
**Spec changed:** base §4 (declarations and options); base §5 (new paragraph: Enum).
**Cases:** `base-4-enum-with-comma-sep` now declares a working enum and has no errors, so its strict variant is gone. `base-5-enum-whitespace` is new. `base-6-fm-malformed-type` now puts its unclosed `enum[` last, so that it tests only the malformed type; the unclosed bracket was settled separately, as Q22.

### Q8. Whitespace between a closing quote and stray text

**Decision:** the text after the quote is appended as written, before the cell's trailing whitespace is trimmed. `"abc" def  |` gives `abc def`.
**Spec changed:** base §6 (the text-after-closing-quote row).
**Cases:** `base-6-row-text-after-quote-space` (+ `--strict`).

### Q9. When one mistake breaks several rules

**Decision:** recovery comes first, then every rule is checked on the recovered row, and each rule it breaks is reported. A rule stated in two places is one rule, reported once. `    | 3d` does begin with the delimiter.
**Spec changed:** base §3 (a row begins with the delimiter with or without an indent); base §6 (a new paragraph before the tables); ext §3.1 (key uniqueness and Text Anchors §4 duplicates are one rule).
**Cases:** `base-6-row-begins-with-delimiter`, `ext-3.2-example-key-without-identity`, `ext-3.2-lead-empty-after-marker`, `ext-3.2-anchor-position` and `ext-3.1-duplicate-id`, each with its `--strict` variant where it has one.

### Q10. One error per row, or one per extra cell

**Decision:** one per row.
**Spec changed:** base §6 (the more-unnamed-cells row).
**Cases:** `base-6-row-too-many-cells-several` (+ `--strict`).

### Q11. Which line carries an error that involves several lines

**Decision:** symmetric conditions are reported on every line involved, and ordered ones on the later line.
**Spec changed:** base §6 (a new paragraph before the tables); ext §3.1 (case conflicts on both rows); ext §6.2 and §10 (cycles on every row in the cycle).
**Cases:** `base-6-fm-key-set-twice` (+ `--strict`), `base-4-unique`, `ext-3.1-case-conflict`, `ext-6.2-parent-cycle`.

### Q12. Must a `date` be a real calendar date?

**Decision:** yes, which keeps `date` consistent with `datetime`.
**Spec changed:** base §5 (the `date` row).
**Cases:** `base-5-date-calendar`.

### Q13. A quoted lead couldn't carry an anchor

**Decision:** anchor groups may follow a quoted lead, as markers may precede one.
**Spec changed:** ext §3.2 (where groups are recognised, plus a new example `"Email" {#home}`). base §3 (quoted cells) and base §9 now reserve `{...}` groups after the closing quote of a lead cell. The extension can't use a form the base doesn't reserve (ext intro), so without the §9 row a base-only parser would report every such anchor as text after the closing quote. In a base-only parse, the groups are appended to the lead value with no error.
**Cases:** `ext-3.2-quoted-lead-with-anchor` now gives lead `~Tilde title` and ID `t` with no errors, so its strict variant is gone. `ext-3.2-example-quoted-with-anchor` is new, for the new spec example. `base-9-braces-after-quoted-lead` (+ `--strict`) is new: it shows the base-only reading, and that other text after a quote is still a syntax error.

### Q14. Where an anchor may sit in the lead

**Decision:** as used. The whitespace rule from Text Anchors §2 still applies within the lead, so `Glued{#glued}` is not an anchor. A lead cell that holds only anchor groups is an anchor with a null lead. This belongs in the rows binding, so Text Anchors is unchanged.
**Spec changed:** ext §3.2.
**Cases:** `ext-3.2-anchor-position`.

### Q15. The table name of an unreadable include, and `ref[TABLE]` naming no table

**Decision:** a table name comes from the `as` alias, then the file's own `table` value, then the file stem. An unreadable include falls back to its alias or its stem. A `ref[TABLE]` naming no table is a structural error; the column stays a `ref`, and every reference in it is a validation error.
**Spec changed:** ext §4.1, §4.2, §10.
**Cases:** `ext-4.1-refs-into-unreadable-include`, `ext-4.3-example`, `ext-4.2-unknown-table`, `ext-9-auth`, `ext-9-auth-canonical`, `ext-9-auth-deps`, `anchors-3-locators`, each with its `--strict` variant.

### Q16. Extension rules with no class or no recovery

**Decision:** the table as used. Every choice follows the pattern the base already set. Each rule is stated where it is defined, and all the extension errors, including those with a class already, are collected in a new recovery table.
**Spec changed:** ext intro; §3.1 (invalid key), §4.1 (duplicate table names), §4.2 (wrong-table prefix), §4.3 (lead `ref` options), §5 (invalid marker entries; marker column not `bool`), §6.1 (nest column), §7 (unknown `order` column), §8 (conformance points to §10); new §10 Errors. §10 is at the end, so that §8 and §9, and the case names citing them, keep their numbers.
**Cases:** `ext-3.1-invalid-id`, `ext-4.1-duplicate-table-name`, `ext-4.2-wrong-table`, `anchors-3-locators`, `ext-4.3-lead-ref-options`, `ext-5-invalid-marker`, `ext-5-marker-column-not-bool`, `ext-6.1-nest-column-not-ref`, `ext-7-order-unknown-column`, each with its `--strict` variant where it has one. Which line carries the `ext-5-marker-column-not-bool` error was settled separately, as Q23.

### Q17. An anchor and a key value that differ

**Decision:** the anchor wins, because references are written against anchors.
**Spec changed:** ext §3.2, §10.
**Cases:** `ext-3.2-anchor-key-mismatch`.

### Q18. Parent mismatch and cycles

**Decision:** as used. When indentation and the parent column disagree, indentation wins. Rows in a cycle have no parent and become roots.
**Spec changed:** ext §6.2, §10.
**Cases:** `ext-6.2-parent-mismatch`, `ext-6.2-parent-cycle`.

### Q19. Order checking

**Decision:** each row is compared with the previous row, and null values are skipped. Text compares by code point. Durations compare in minutes where the column can convert both values, and a pair that can't be converted is skipped. With `nest`, only siblings are compared.
**Spec changed:** ext §7. The rule is written as "compared with the previous row whose value is not null", which is what skipping nulls means for the row after one. The spec also says numbers compare numerically and dates and datetimes chronologically; neither was in question. Bool, enum and ref were settled as Q21.
**Cases:** `ext-7-order-which-row` is no longer disputed. `ext-7-order-nulls`, `ext-7-order-text-code-points`, `ext-7-order-durations` and `ext-7-order-siblings` are new.

### Q20. `sep` and `comment` both set, and in conflict

**Decision:** blame `sep`, because it is the only rule that always settles. `sep` is checked on its own first, then `comment` against the resulting `sep`. If they conflict, and the file set `sep`, `sep` falls back to its default, and `comment` is then checked against `|`. Blaming `comment` instead could leave the file with no valid comment marker: with `sep: /`, the default `//` conflicts too.
**Spec changed:** base §2.2 (the paragraph after the key table, which replaces the Q6 wording).
**Cases:** `base-2.2-sep-and-comment-both-set` (+ `--strict`). `base-2.2-sep-and-comment-both-invalid` (+ `--strict`) is new: `sep: /` with `comment: "|/"` makes both invalid, so the file reads with `|` and `//`.

### Q21. How `order` compares bool, enum and ref values

**Decision:** enums compare in declaration order, and bools with `false` before `true`. References compare by locator text, by code point, and never by the target row's position; otherwise a row's validity would depend on whether a reference resolves, and on the order of another table.
**Spec changed:** ext §7.
**Cases:** `ext-7-order-enum`. `ext-7-order-bool` and `ext-7-order-ref` are new. The ref case would pass if compared by target position, and fails by locator text, so it tells the two readings apart.

### Q22. An unclosed `[` in a declaration

**Decision:** it protects nothing. Otherwise one typo swallows every column declared after it and shifts every positional cell in the file.
**Spec changed:** base §4.
**Cases:** `base-4-unclosed-bracket` (+ `--strict`).

### Q23. Which line a marker-column type error goes on

**Decision:** on the `markers:` line. The recovery ignores the marker entry, so the error belongs where the ignored entry is written.
**Spec changed:** ext §5, §10.
**Cases:** `ext-5-marker-column-not-bool` (+ `--strict`).
