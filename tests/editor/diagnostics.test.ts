// Model diagnostics -> lint diagnostics. Spec §4.4 and every §2.9 condition.

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import { toLintDiagnostics } from '../../src/editor';

function lint(text: string) {
  const doc = EditorState.create({ doc: text }).doc;
  const model = analyze(text);
  return { doc, model, lint: toLintDiagnostics(model.diagnostics, doc) };
}

describe('toLintDiagnostics', () => {
  it('underlines exactly the field span of an unparseable duration', () => {
    const text = 'Auth | soon | alice\n';
    const { lint: out, doc } = lint(text);
    expect(out).toHaveLength(1);
    expect(doc.sliceString(out[0].from, out[0].to)).toBe('soon');
    expect(out[0].severity).toBe('warning');
  });

  it('gives a spanless diagnostic an empty range at its line start', () => {
    const { lint: out, doc, model } = lint('A\n\tB | 2h\n');
    expect(model.diagnostics[0].span).toBeUndefined();
    expect(out[0]).toMatchObject({ from: doc.line(2).from, to: doc.line(2).from, severity: 'info' });
  });

  it('passes the message through verbatim', () => {
    const { lint: out, model } = lint('# heading\n');
    expect(out[0].message).toBe(model.diagnostics[0].message);
  });

  it.each([
    // condition, text, severity, underlined text (null = gutter only)
    ['tabs converted', 'A\n\tB\n', 'info', null],
    ['reserved # line', '# heading\n', 'warning', '# heading'],
    ['more fields than columns', 'A | 1h | bob | note | extra\n', 'warning', 'extra'],
    ['unparseable duration', 'A | soon\n', 'warning', 'soon'],
    ['unknown front matter key', '---\ncalendar: x\n---\n', 'warning', null],
    ['unknown column type', '---\ncolumns: est:money\n---\n', 'warning', 'est:money'],
    ['duplicate column name', '---\ncolumns: est:duration | est:text\n---\n', 'warning', 'est:text'],
    ['front matter not closed', '---\ncolumns: est:duration\n', 'warning', null],
    ['override differs from children', 'A | 1d\n    B | 1h\n', 'info', '1d'],
  ] as const)('%s', (_name, text, severity, underlined) => {
    const { lint: out, doc } = lint(text);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe(severity);
    if (underlined === null) {
      expect(out[0].from).toBe(out[0].to);
      expect(out[0].from).toBe(doc.lineAt(out[0].from).from);
    } else {
      expect(doc.sliceString(out[0].from, out[0].to)).toBe(underlined);
    }
  });
});
