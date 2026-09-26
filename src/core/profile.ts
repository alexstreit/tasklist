// The plan profile (spec §2.1), built in as a named profile. The same text is
// published as profiles/plan.rows; a test keeps the two identical.

export const PLAN_PROFILE = `---
lead: title:text
nest: parent
markers: done=~
columns: est:duration unit=h hpd=8 dpw=5 | owner:text | notes:text
---
`;

/** A file with no `profile:` key is a plan when its name ends in `.plan`, or when it has no name yet. */
export function isPlanName(filename: string | undefined): boolean {
  return filename === undefined || filename.endsWith('.plan');
}
