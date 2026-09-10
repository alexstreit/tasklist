// Pasted tabs become 4 spaces (spec §2.1).

import { describe, expect, it } from 'vitest';
import { state } from './helpers';

describe('paste', () => {
  it('converts tabs in pasted text to spaces and keeps the cursor after the paste', () => {
    const st = state('x\n', { anchor: 1 });
    const pasted = '\ta\tb\n\t\tc';
    const tr = st.update({ changes: { from: 1, insert: pasted }, selection: { anchor: 1 + pasted.length }, userEvent: 'input.paste' });
    expect(tr.state.doc.toString()).toBe('x    a    b\n        c\n');
    expect(tr.state.selection.main.head).toBe('x    a    b\n        c'.length);
  });

  it('applies to every range of a multi-cursor paste', () => {
    const st = state('a\nb\n');
    const tr = st.update({
      changes: [
        { from: 1, insert: '\t' },
        { from: 3, insert: '\t' },
      ],
      userEvent: 'input.paste',
    });
    expect(tr.state.doc.toString()).toBe('a    \nb    \n');
  });

  it('leaves non-paste transactions alone', () => {
    const tr = state('').update({ changes: { from: 0, insert: '\t' } });
    expect(tr.state.doc.toString()).toBe('\t');
  });
});
