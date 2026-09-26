# Open questions

Places where the specs are ambiguous, silent, or disagree with themselves, found while writing the conformance cases. Each affected case uses the reading marked **Used** and has `"disputed": true`. Settling a question means changing the spec, then the case if needed, then removing `disputed` and moving the question to [Resolved](#resolved).

Where a question says a rule has "no class", the class matters because strict mode fails on syntax and structural errors but not on validation errors.

---

## Q31. An empty `lead:` value

**Cases:** `base-4-empty-lead-declaration` (+ `--strict`).
**Spec:** base §2.2 (`lead`, default `name:text`); base §4.

Q26 settled empty declarations between delimiters in `columns`, but not an empty `lead:` value.

- **A (used).** The same as an empty declaration: a structural error, and the lead is an unnamed `text` column. The file still has a lead, but no name can refer to it.
- **B.** An empty value is the same as leaving `lead` unset, so the lead is `name:text` and there is no error.
- **C.** Invalid, so `name:text` is used, with a structural error.

Q32–Q36 came up while implementing the types stage (Task 18). The parser implements each **Used** reading.

## Q32. How much whitespace a duration allows

**Cases:** `base-5-duration-whitespace`.
**Spec:** base §5 (`term = number [ WSP ] unit`, `duration = [ "+" / "-" ] term *( [ WSP ] term )`); base §1 (whitespace).

In ABNF, `[ WSP ]` is at most one space or tab. The examples all use single spaces.

- **A (used).** As written: at most one space or tab between a number and its unit, and between terms. `1d  4h` and `2  d` are invalid; `1d\t4h` is valid.
- **B.** Any run of whitespace (`*WSP`), since a cell's interior whitespace is otherwise preserved without meaning, and a doubled space is an easy typo to make and hard to see.

## Q33. Does a default satisfy `required`?

**Cases:** `base-4-required-with-default`.
**Spec:** base §4 (`required`: "Cell must not be null"; `default=V`: "Value assumed when null").

- **A (used).** No. `required` is about what the row writes, so a null cell is an error even when the column has a default.
- **B.** Yes. The cell's value is the default, so it isn't null, and `required` together with `default` means "fill it in, or it's this".

## Q34. What `unique` compares

**Cases:** `base-4-unique-compares-text`.
**Spec:** base §4 (`unique`: "No two rows share a non-null value").

- **A (used).** The decoded text. `1`, `1.0` and `01` are three values, and two invalid values with the same text are a duplicate.
- **B.** The typed value, so `1` and `1.0` are the same number. That leaves open whether invalid values count, and whether durations such as `1h` and `60m` are equal.

## Q35. Where a malformed type ends and an unknown one begins

**Cases:** `base-5-type-declaration-edges` (+ `--strict`).
**Spec:** base §5 (types; `x-` types; unknown types); base §6 ("Malformed type, such as a bad `enum[...]`" is structural; "Unknown type" is validation).

**Used:** a type must be a name, optionally followed by one `[...]`. A type that isn't in that form is malformed. So is a known type with the wrong parameters: `a:` (an empty type), `b:enum` (no values), `c:enum[]` and `d:enum[x,,y]` (an empty value), and `f:number[3]` (a parameter on a type that takes none). A well-formed name the spec doesn't define is unknown: `g:foo[bar]`, and `h:Number`, because type names are case-sensitive.

Also used, and not stated: a repeated enum value, as in `e:enum[x,x]`, is allowed. Enum values match case-sensitively, so `X` isn't a value of `enum[x,x]`.

The alternative is that anything that isn't a known type is simply unknown (validation), and only a bad `enum[...]` is malformed (structural). That changes whether strict mode fails for `number[3]` or `a:`.

## Q36. Options that don't apply, flags with values, and repeats

**Cases:** `base-4-option-edges` (+ `--strict`).
**Spec:** base §4 (the options table; "Unrecognised options are ignored and retained"); base §6 ("Invalid option value … Option ignored").

- An option for another type, such as `unit=` or `hpd=` on a `text` column. **Used:** ignored and retained, with no error, like an unrecognised option. The alternative is an invalid option value.
- A flag with a value, such as `required=yes`. **Used:** an invalid option value, so the flag is ignored and the column isn't required.
- `default` with no value. **Used:** an invalid option value.
- A repeated option, such as `hpd=8 hpd=6`. **Used:** the last one is used, with no error, as a repeated key's last value is used in frontmatter. Unlike a repeated key, it isn't reported. The alternative is to report it the way a key set twice is.

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
