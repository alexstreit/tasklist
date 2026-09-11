// TSV exporter against the §2.10 example. Spec §3.6.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core';
import type { TextCell } from '../../src/core';
import { tsvExporter } from '../../src/exporters/tsv';
import example from '../../examples/example.plan?raw';

describe('tsv exporter', () => {
  it('produces exactly the expected TSV for the §2.10 example', () => {
    const { mime, data } = tsvExporter.export(analyze(example));
    expect(mime).toBe('text/tab-separated-values');
    expect(data).toBe(
      [
        '#\tlevel\ttitle\test (h)\towner\tnotes\tdone',
        '1\t1\tAuth\t16\t\t\tFALSE',
        '1.1\t2\tLogin page\t4\talice\t\tTRUE',
        '1.2\t2\tPassword reset\t6\talice\t\tFALSE',
        '1.3\t2\tOAuth (Google)\t13\t\tmay not need for v1\tFALSE',
        '1.3.1\t3\tConsent screen\t2\t\t\tFALSE',
        '1.3.2\t3\tToken refresh\t3\t\t\tFALSE',
        '2\t1\tAdmin\t8\tbob\t\tFALSE',
        '2.1\t2\tUser list\t8\t\t\tFALSE',
      ].join('\n'),
    );
  });

  it('leaves a summable cell empty when there is no value, and emits fractions as decimals', () => {
    const { data } = tsvExporter.export(analyze('A | 1.5h\nB\n'));
    expect(data.split('\n').slice(1)).toEqual(['1\t1\tA\t1.5\t\t\tFALSE', '2\t1\tB\t\t\t\tFALSE']);
  });

  it('replaces a tab or newline in a text cell with a space', () => {
    // The format cannot produce these; forge them on the model to prove the defence.
    const model = analyze('A | 4h | alice\n');
    (model.roots[0].cells[1] as TextCell).value = 'al\tice\nsmith';
    model.roots[0].title = 'A\tB';
    expect(tsvExporter.export(model).data.split('\n')[1]).toBe('1\t1\tA B\t4\tal ice smith\t\tFALSE');
  });

  it("exports a done parent's implicitly done children as TRUE", () => {
    const { data } = tsvExporter.export(analyze('~A | 4h\n    B | 2h\n        C | 1h\n'));
    expect(data.split('\n').slice(1).map((l) => l.split('\t').at(-1))).toEqual(['TRUE', 'TRUE', 'TRUE']);
  });

  it('numbers header columns for number type without a unit suffix', () => {
    const { data } = tsvExporter.export(analyze('---\ncolumns: pts:number | who:text\n---\nA | 3\n'));
    expect(data).toBe('#\tlevel\ttitle\tpts\twho\tdone\n1\t1\tA\t3\t\tFALSE');
  });
});
