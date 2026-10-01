# Text Anchors

**Version 0.2 (draft)**

Text Anchors is a small syntax for giving a line of a plain-text document a stable name, and for referring to that name from the same or another document. It is independent of any file format. A **host** format adopts it by stating where anchors and references may appear (§5).

Declarations follow the attribute-list convention of Pandoc, kramdown, and Python-Markdown. References are URI fragment locators as defined by RFC 3986.

The key words MUST, MUST NOT, SHOULD, and MAY follow RFC 2119.

## 1. IDs

```
ID = ( ALPHA / DIGIT ) *( ALPHA / DIGIT / "-" / "_" )
```

IDs are case-sensitive, but two IDs in one document that differ only by case are an error.

## 2. Anchors

An **anchor group** declares one or more IDs:

```
anchor-group = "{" *WSP "#" ID *( 1*WSP "#" ID ) *WSP "}"
```

```
Password reset {#reset}
Password reset {#reset #password-reset}
Password reset {#reset}{#password-reset}
```

- By default, anchor groups are recognised only at the **end of a line**: one or more groups, separated by optional whitespace, preceded by whitespace or the start of the line, and followed only by whitespace.
- A brace group containing anything other than `#ID` tokens is not an anchor group and is ordinary text.
- An anchor names the **line** it appears on. A host MAY widen this to a larger unit, such as a paragraph, section, or record.
- The **first** ID on a line is its **primary ID**. Any others are **aliases**, and resolve to the same line.

## 3. References

A **locator** names an anchor:

```
locator = [ doc ] "#" ID
```

```
#reset               same document
people#alice         another document
../plans/q4.md#auth  another document, by relative path
```

- `doc` is a URI reference without a fragment (RFC 3986 §4.1), typically a relative path, or a name the host maps to a document.
- Without `doc`, a locator refers to the current document.
- Relative paths resolve against the referencing document (RFC 3986 §5), unless the host defines otherwise.

A locator is recognised only in contexts the host designates, such as a link target or a typed field. A bare `#word` in running text is not a reference unless the host says so.

## 4. Rules

- An ID MUST be unique within its document, across primary IDs and aliases. A duplicate is an error on every line that declares it.
- A locator whose document or ID cannot be found is an error. Tools SHOULD report it and continue.
- Writers MUST NOT change or remove an existing ID except at the author's request.
- Authors SHOULD NOT reuse an ID for a different line after the original is removed, since existing references would silently change target. Tools cannot always detect this.

## 5. Host bindings

A host format that adopts Text Anchors MUST state:

1. where anchor groups are recognised, if not only at end of line;
2. what unit an anchor names, if not the line;
3. which contexts recognise locators;
4. how `doc` is resolved, if not as a relative path;
5. how to write a literal `{#` or locator where one would otherwise be recognised.

A host MAY add data to references, such as a qualifier after a locator. Such additions are part of the host binding, not of this specification.

## 6. Example binding: Markdown (informative)

- Anchor groups are recognised at the end of a heading, paragraph, or list item line.
- An anchor on a heading names its section; elsewhere it names its block.
- Locators are recognised as link targets, `[text](people.md#alice)`, and inside wikilinks, `[[people#alice]]`.
- `doc` is a relative path; the `.md` extension MAY be omitted in wikilinks.
- `\{` writes a literal brace.

```
## Password reset {#reset}

Depends on [[#login]]. Sign-off from [[people#alice]].
```

Renderers that already support heading attributes, such as Pandoc, will use `reset` as the heading's HTML `id`, so the same locator works in rendered output.
