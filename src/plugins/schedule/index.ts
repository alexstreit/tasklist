// The schedule plugin (spec §2.11, VISION §5): dates, slack and lateness from dependencies, pins,
// milestones and deadlines, in working hours from project-start, and the schedule table. It
// requires no other plugin, so a build without estimate still schedules.

import type { Plugin } from '../../core';
import { backwardStage } from './backward';
import { critical, duration, finish, late, lateFinish, lateStart, milestone, projectFinish, slack, start } from './fields';
import { forwardStage } from './forward';
import { scheduleRenderer } from './renderers/table';

export const schedulePlugin: Plugin = {
  id: 'schedule',
  requires: [],
  fields: [start, duration, finish, lateStart, lateFinish, slack, critical, late, milestone, projectFinish],
  stages: [forwardStage, backwardStage],
  renderers: [scheduleRenderer],
};
