// Task 30: what the pin review needs from core, without knowing any plugin: the keys written in
// an analysis (`Model.fields()`), and each single pinnable key's label and kind.

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/app/registry';
import { fieldName } from '../../src/core';
import { rollup } from '../../src/plugins/estimate/fields';
import { duration, start } from '../../src/plugins/schedule/fields';
import example from '../../examples/example.plan?raw';
import fixture from '../../examples/schedule.plan?raw';

describe('Model.fields()', () => {
  it('lists the keys written in this analysis, in stage order', () => {
    expect(analyze(fixture, { filename: 'schedule.plan' }).fields().map(fieldName)).toEqual([
      'estimate.rollup',
      'estimate.has-value',
      'estimate.done-sum',
      'estimate.totals',
      'schedule.start',
      'schedule.duration',
      'schedule.finish',
      'schedule.milestone',
      'schedule.project-finish',
      'schedule.network',
      'schedule.late-start',
      'schedule.late-finish',
      'schedule.slack',
      'schedule.critical',
      'schedule.late',
      'schedule.deadline',
    ]);
  });

  it('leaves out the keys of skipped stages', () => {
    expect(analyze(example, { filename: 'example.plan' }).fields().map((k) => k.plugin)).not.toContain('schedule');
  });
});

describe('pinnable keys', () => {
  it('label and kind single keys, for the pin review', () => {
    expect([start.label, start.kind]).toEqual(['Start', 'date']);
    expect([duration.label, duration.kind]).toEqual(['Duration', 'duration']);
  });

  it('give a by-column key neither: its column names and formats it', () => {
    expect([rollup.pinnable, rollup.label, rollup.kind]).toEqual(['by-column', undefined, undefined]);
  });
});
