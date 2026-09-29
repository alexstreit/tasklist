# Messy plan files: answer key

Try fixing each file in the grid first, without looking. Then check here what each line was meant to exercise. Case numbers refer to spec §4b.6.6. These are my predictions from the specs; where the app disagrees, either the app or the spec is wrong, and the difference is worth writing down.

## messy.plan

A legacy file (its own `columns:` line, no `hpd` or `unit`), edited by several people.

| Line | Content | Expected | Fix (tier) |
|---|---|---|---|
| 2 | `columns:` without `hpd`, `dpw` or `unit` | Every `d` and `w` value and every bare number is treated as empty, with warnings | Settings banner: "Add unit=h hpd=8 dpw=5" (click) |
| 3 | `x-team:` | Nothing: `x-` keys are private | — |
| 4 | `colum-widths:` | Info: unknown key (a typo) | Shown only |
| 7 | `  Kickoff…` | First row indented | Indent 0 (auto) |
| 8, 10 | `{#login}` twice | Duplicate ID | "Rename the later one" (confirm) |
| 10 | `6` | Bare number without `unit=` | Fixed by the settings fix on line 2 |
| 11 | `4 hours` | Invalid duration | Edit the cell; the typed editor writes `4h` |
| 12 | `call Bob \| then Alice` | Overflow: `then Alice` | "Rejoin into notes" (click) |
| 13 | `Consent screen` at indent 12 | Valid: any deeper indent is one level | — |
| 14 | `Token refresh` at indent 8 | Indent fits no level; recovered as child of OAuth | Snap indent (auto) |
| 14 | `"sam` | Unterminated quote | Rewrite the cell (auto) |
| 15 | `~~Session timeout` | Repeated marker; done, title `~Session timeout` | "Remove extra marker" (click) |
| 16, 17 | `{#API}`, `{#api}` | IDs differing only by case | "Rename the later one" (confirm) |
| 17 | `priority=high` | Undeclared column name; read as the notes value `priority=high` | As overflow; here it lands in notes, so there is nothing to rejoin |
| 18 | `owner=sam \| owner=priya` | Column set twice | "Keep this value" (confirm) |
| 19 | `owner=sam \| 2d` | Unnamed cell after a named one: `2d` is overflow | "Rejoin into notes" or "Delete extra values" |
| 20 | `notes="agreed" with Dana` | Text after closing quote; value `agreed with Dana` | Rewrite the cell (auto) |
| 21 | `soon` | Invalid duration | Edit the cell |
| 22 | Tab indent | Converted to 4 spaces on load; no error left | — |
| 24 | `# Phase 2` | Heading line | Quote the title (auto) |
| 26 | `"export \q CSV"` | Unknown escape, kept literally | Rewrite the cell (auto) |
| 27 | `-3h` | Negative values not supported | Edit the cell |
| 28 | `parent=#auth` under Admin | Parent disagrees with indentation | "Use indentation" (click) |
| 29 | `{#perms}` with `parent=#perms` | Cycle (a row that is its own parent) | "Use indentation" (click) |
| 30 | `\| 3d \| dave …` | No title | Type a title |
| 31 | `<!-- … -->` | Legacy HTML comment, read as an item | "Make it a comment" (confirm) |
| 32 | `2d 2d` | Repeated unit | Edit the cell |
| 33 | `parent=#nowhere` | Reference to a missing ID, plus parent/indent mismatch | Shown, and "Use indentation" (click) |

## messy-settings.plan

Declaration errors, each of which changes how the whole file reads.

| Content | Expected | Fix (tier) |
|---|---|---|
| `sep: /` | Conflicts with the default comment `//`; `sep` is invalid and falls back to `\|` | "Remove this setting" (confirm) |
| `owner:text` twice | Duplicate column name; the second keeps its position but can't be set by name | "Rename column…" (confirm). Until then, editing it in the grid uses the padding exception, e.g. on `Design`. |
| `due:dat` | Unknown type, read as text; `2026-10-01` is not validated as a date | "Remove this setting" or fix the type |
| `size:enum[S,M,L` | Malformed type: the unclosed `[` protects nothing | "Remove this option"; the column is read as text |
| `risk:number … hpd=8` | `hpd` on a `number` column: structural, ignored | "Remove this option" (confirm) |
| `done:text` | The profile's `done` marker needs a `bool` column; the marker is ignored, so `~Write copy` is a title starting with `~` | "Remove this setting" (confirm) |
| `Build \| 2w \| \| dave` | `dave` is in the duplicate `owner` column | Tests the padding exception in reverse |

## messy-unclosed.plan

The worst case: the settings block is never closed.

- With no closing `---`, the file has **no frontmatter**. `profile: plan` and the `columns:` line become item rows, with their own cell errors.
- The file is still read with the plan profile, because it's a `.plan` file.
- **Fix:** the banner's "Close settings" (confirm) should insert `---` after line 3, the last `key: value` line. The blank line then separates the settings block from the tasks. After that, the two settings rows leave the grid, and `~Domain renewal` is marked done.
