// The plan and schedule profiles (spec §2.1), built in as named profiles. The same texts are
// published as profiles/plan.rows and profiles/schedule.rows; a test keeps each pair identical.

export const PLAN_PROFILE = `---
lead: title:text
nest: parent
markers: done=~
columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text
roles: effort=est
---
`;

/** The plan profile plus the scheduling columns, their roles and the milestone marker. A PM writes `profile: schedule`. */
export const SCHEDULE_PROFILE = `---
lead: title:text
nest: parent
markers: done=~ milestone=^
columns: est:duration unit=h hpd=8 dpw=5 | dur:duration unit=h hpd=8 dpw=5 | start:date | deps:ref many qualifier=lag:duration | due:date | owner:text | notes:text
roles: effort=est duration=dur start=start deps=deps deadline=due
---
`;

/** A file with no `profile:` key is a plan when its name ends in `.plan`, or when it has no name yet. */
export function isPlanName(filename: string | undefined): boolean {
  return filename === undefined || filename.endsWith('.plan');
}
