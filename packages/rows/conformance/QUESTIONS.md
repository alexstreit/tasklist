# Open questions

Places where the specs are ambiguous, silent, or disagree with themselves, found while writing the conformance cases. Each affected case uses the reading marked **Used** and has `"disputed": true`. Settling a question means changing the spec, then the case if needed, then removing `disputed` and moving the question to [Resolved](#resolved).

Where a question says a rule has "no class", the class matters because strict mode fails on syntax and structural errors but not on validation errors.

---

Q40 and Q41 came up while implementing the extensions stage (Task 19). The parser implements each **Used** reading.

## Q40. What "alphanumeric" means for a marker character

**Cases:** `ext-5-marker-non-ascii` (+ `--strict`).
**Spec:** ext §5 ("`CHAR` is one character that is not alphanumeric, …"); base §1 (whitespace is space and tab only, from Q29).

- **A (used).** Unicode letters and digits, so `é` and `٣` can't be markers, and `§` can. A lead such as `éclair` is never mistaken for a marker and a title.
- **B.** ASCII `A–Z`, `a–z` and `0–9`, matching the ASCII column-name and ID grammars, and Q29's narrow definition of whitespace. Then `é` could be a marker, and a row `éclair` in that file would read as a marker and `clair`.

## Q41. Can a qualifier's type be `ref`?

**Cases:** `ext-4.3-qualifier-ref-type` (+ `--strict`).
**Spec:** ext §4.3 (`qualifier=NAME:TYPE`: "validated as `TYPE`"); ext §4.4 (the join table declares `NAME:TYPE`).

A `ref` qualifier would be a reference carried on a reference. It would need its own target table, and would itself be a locator after a locator.

- **A (used).** No. `qualifier=who:ref` is an invalid option value, so the column takes no qualifier.
- **B.** Yes, targeting the current table, and resolved like any other reference.

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

### Q24. Delimiter lines and whitespace

**Decision:** a delimiter line may have trailing whitespace. A line with leading whitespace is not a delimiter; inside the frontmatter it is a malformed line.
**Spec changed:** base §1.
**Cases:** `base-1-delimiter-whitespace` (+ `--strict`), whose delimiters now carry trailing spaces and a tab.

### Q25. Quoted option values in `columns`

**Decision:** quotes protect both the delimiter and whitespace, and `\"` and `\\` are unescaped inside them, as in frontmatter values.
**Spec changed:** base §4.
**Cases:** `base-4-quoted-option-value`.

### Q26. Empty declarations

**Decision:** a trailing `|` in `columns` is ignored. An empty declaration between delimiters is a structural error, and the column keeps its position as an unnamed `text` column. It uses the `invalid-column-name` code, since an empty name doesn't match the grammar. An empty `lead:` value wasn't covered, and is Q31.
**Spec changed:** base §4; base §6 (the column-name row).
**Cases:** `base-4-empty-declarations` (+ `--strict`).

### Q27. How many errors for several unnamed cells after a named one

**Decision:** one per row.
**Spec changed:** base §6 (the unnamed-after-named row).
**Cases:** `base-6-row-unnamed-after-named-several` (+ `--strict`).

### Q28. A profile file with no frontmatter, or an unclosed one

**Decision:** both are `profile-has-errors`, and the profile supplies nothing.
**Spec changed:** base §2.3.
**Cases:** `base-2.3-profile-unclosed` (+ `--strict`). `base-2.3-profile-without-frontmatter` now expects the error, and so has gained a `--strict` variant.

### Q29. What counts as whitespace

**Decision:** space and tab only, defined once for the whole specification.
**Spec changed:** base §1.
**Cases:** `base-3-whitespace-is-space-and-tab`.

### Q30. Trailing whitespace in an unterminated quoted cell

**Decision:** trimmed. `"open   ` gives `open`, and the value span ends before the whitespace.
**Spec changed:** base §6 (the unterminated-quote row).
**Cases:** `base-6-row-unterminated-quote-trailing-space` (+ `--strict`).

### Q31. An empty `lead:` value

**Decision:** a key that has a default, and is present but empty or unusable, is a structural error, and the default applies. This is stated once, generally, in base §6; the rows for `format`, `sep` and `comment` are instances of it. An empty `lead:` gives `name:text`, and an empty `table:` gives the file name's stem, each with the new `empty-value` code. An empty `columns:` declares no columns and is not an error, because `columns` has no default.
**Spec changed:** base §2.2 (a paragraph after the key table); base §6 (a paragraph before the tables, and a new row).
**Cases:** `base-4-empty-lead-declaration` (+ `--strict`) now expects `empty-value` and the default lead. `base-2.2-empty-table` (+ `--strict`) and `base-2.2-empty-columns` (+ `--strict`) are new.

### Q32. How much whitespace a duration allows

**Decision:** any run of whitespace: `*WSP` between a number and its unit, and between terms.
**Spec changed:** base §5 (the duration grammar).
**Cases:** `base-5-duration-whitespace` now has no errors.

### Q33. Does a default satisfy `required`?

**Decision:** no.
**Spec changed:** base §4 (the `required` row).
**Cases:** `base-4-required-with-default`.

### Q34. What `unique` compares

**Decision:** typed values, by a definition of value equality stated once in base §5. Numbers compare numerically, dates and datetimes as instants, text and enum values by code point, and durations as bags. Invalid values compare as their text. `order` (Task 19) uses the same definition. The spec also lists bool with text and enum, since only `true` and `false` are valid bools. Settling this raised Q37.
**Spec changed:** base §5 (new paragraph: Equality).
**Cases:** the former base-4-unique-compares-text case is renamed `base-4-unique-compares-values`, and now expects `1`, `1.0` and `01` to be duplicates. `base-5-value-equality` is new, covering datetimes, durations and enums.

### Q35. Where a malformed type ends and an unknown one begins

**Decision:** a type in the form `name` or `name[...]` that isn't known is unknown (validation). Anything else is malformed (structural), including brackets on a type that doesn't take them and `enum` without them.
**Spec changed:** base §5 (the paragraph on type forms); base §6 (the malformed-type row).
**Cases:** `base-5-type-declaration-edges` (+ `--strict`) keeps the settled columns (`a:`, `b:enum`, `f:number[3]`, `g:foo[bar]`, `h:Number`). The enum-value columns moved to `base-5-enum-value-edges`, for Q38, which the decision doesn't cover.

### Q36. Options that don't apply, flags with values, and repeats

**Decision:** a known option on a type it doesn't apply to is structural, and ignored. So is a flag given a value, or a value option given none. A repeated option is structural, and the last one is used; it has the new `duplicate-option` code. The others use `invalid-option-value`.
**Spec changed:** base §4 (after the options table); base §6 (two new rows).
**Cases:** `base-4-option-edges` (+ `--strict`) now expects five errors: `unit=` and `hpd=` on a `text` column, `required=yes`, a bare `default`, and a repeated `hpd`.

### Q37. Duration equality: the sign, and bare numbers

**Decision:** two durations are equal when they convert to the same number of minutes, using only the conversions their column permits (`m` and `h` always, `d` and `h` with `hpd`, `w` and `d` with `dpw`). Otherwise they compare as bags of terms. The sign counts. A bare number with `unit=` is its terms, so it converts like any other value. `unique` uses this now, and `order` will use the same function. The leap-second bullet wasn't covered, and is now part of Q39.
**Spec changed:** base §5 (the Equality paragraph).
**Cases:** `base-5-duration-equality-sign` is no longer disputed. `base-5-value-equality` now expects `60m` and `1h` to be duplicates. `base-5-duration-equality` is new: with `hpd=8`, `1d 4h` equals `12h`, two `1w` values are equal as bags, `5d` equals neither, `-1h` equals `-60m`, and `+1h` differs from `1h`.

### Q38. Enum values: empty, repeated, and case

**Decision:** `enum[]` is malformed. Empty and repeated values are each structural, and the value is ignored; they use the new `invalid-enum-value` code. Values are case-sensitive, and there is no rule about values that differ only by case. An enum whose values are all empty wasn't covered, and is now part of Q39.
**Spec changed:** base §5 (the Enum paragraph); base §6 (the malformed-type row, and a new row).
**Cases:** `base-5-enum-value-edges` (+ `--strict`) now expects `enum[x,,y]` to read as `enum[x,y]` and `enum[x,x]` as `enum[x]`, each with an error.

### Q39. Leftovers from Q37 and Q38: leap seconds, and enums with only empty values

**Decision:** as used. A leap second equals the second that follows it, so `23:59:60Z` and the next `00:00:00Z` are the same instant. An enum whose values are all empty, such as `enum[,]` or `enum[ ]`, is malformed, like `enum[]`. There was no version bump, because this only makes explicit what 0.8 already implies.
**Spec changed:** base §5 (the Equality and Enum paragraphs).
**Cases:** `base-5-enum-all-empty` (+ `--strict`) is no longer disputed. `base-5-datetime-leap-second` is new.

### A1. Empty extension keys (settled by analogy with Q31)

**Decision:** an empty `key:` or `order:` is a structural error (`empty-value`), and its default applies (`id`, `position`). An empty `nest:`, `markers:` or `include:` declares nothing and isn't an error, as an empty `columns:` isn't.
**Spec changed:** ext intro.
**Cases:** `ext-1-empty-keys` (+ `--strict`).

### A2. A repeated marker name or character (settled by analogy with Q38)

**Decision:** an invalid entry (`invalid-marker`), and the later one is ignored, as a repeated `enum` value is.
**Spec changed:** ext §5.
**Cases:** `ext-5-repeated-marker-entries` (+ `--strict`).

### A3. Misused `many` and `qualifier` (settled by analogy with Q36 and base §4)

**Decision:** `many` or `qualifier` on a column that isn't a `ref`, `many` given a value, or `qualifier` given none, is a structural error, and the option is ignored, as for the base options. A qualifier is written like a declaration, `NAME[:TYPE]`, with the type defaulting to `text`. An invalid name is an invalid option value. A malformed or unknown type is reported as it would be for a column (`malformed-type`, `unknown-type`), and read as `text`.
**Spec changed:** ext §4.3.
**Cases:** `ext-4.3-options-misused` (+ `--strict`), `ext-4.3-qualifier-types` (+ `--strict`).

### A4. Invalid values under `order` (settled by analogy with Q34 and with durations that can't be converted)

**Decision:** two values that don't match their column compare as their text, as they do for equality. A valid value and an invalid one are skipped, like a pair of durations that can't be converted.
**Spec changed:** ext §7.
**Cases:** `ext-7-order-invalid-values`.
