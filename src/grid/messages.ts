// Why an edit was not made, worded for someone who has never seen the file
// (spec §4b.2). rows gives its reasons in its own terms (rows, anchors,
// levels); the grid shows what they mean for the task the user is looking at.

const MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the row's ID is in an anchor/, () => "This task's ID can't be changed here."],
  [/^column (.+) can't be named/, (m) => `The "${m[1]}" column can't be filled in on this row until its name is fixed in the settings.`],
  [/^an indent of \d+ doesn't fit the nesting here/, () => "A task can't be added here without breaking the indentation of the tasks below it."],
  [/^the document has no nesting/, () => "This file doesn't use indentation for sub-tasks, so tasks can't be indented or outdented."],
  [/^level \d+ isn't open here/, () => "This task can't go to that level here."],
  [/^level \d+ here would leave a row/, () => 'Moving this task to that level would break the indentation of the tasks below it.'],
  [/^there is no (previous|next) sibling/, (m) => `There's no task at the same level ${m[1] === 'previous' ? 'above' : 'below'} to swap with. Indent and Outdent change a task's level.`],
  [/frontmatter delimiter/, () => 'This would put a line that reads as "---" first in the file, where it would start the settings.'],
  [/^promoting its children would leave a row/, () => "Deleting this task would break the indentation of its sub-tasks, so it can't be deleted yet."],
  [/^it has the last anchor/, () => 'Deleting this task would turn off task IDs in this file, and other tasks still use them. Give another task an ID first.'],
  [/^it would be the first anchor/, () => 'Another task has a cell written as id=…, which would start to mean a task ID. Change that cell first.'],
  [/^no task (.+)$/, (m) => `There's no task ${m[1]}.`],
  [/^column (.+) holds one reference$/, (m) => `The "${m[1]}" column holds only one task.`],
  [/^column (.+) takes no qualifier$/, (m) => `The "${m[1]}" column takes only task numbers, with nothing after them.`],
  [/^file (.+) has no column (.+)$/, (m) => `${m[1]} has no column for ${m[2]}.`],
  [/^file (.+) has no marker (.+)$/, (m) => `${m[1]} has no ${m[2]} marker.`],
  [/^it would leave file (.+)$/, (m) => `That would move it out of ${m[1]}.`],
  [/^file (.+) has no mount column$/, (m) => `${m[1]} can't mount plans: its settings have no mount column.`],
  [/^the task is in another file$/, () => 'Dependencies between plan files come later.'],
  [/^the grid is still reading/, () => 'Still catching up with the last change. Try again in a moment.'],
];

/** The message the grid shows for a refusal from rows, or from the grid itself. */
export function plainRefusal(reason: string): string {
  for (const [pattern, message] of MESSAGES) {
    const m = pattern.exec(reason);
    if (m) return message(m);
  }
  return "This change can't be made here.";
}
