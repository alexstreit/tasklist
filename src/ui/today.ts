// Today's date, for a fix that suggests it (Fix.input.suggest). UI code may read the clock; analysis
// never does, so the editors fill the date in when they show the fix (PLUGINS.md §6).

const pad = (n: number) => String(n).padStart(2, '0');

/** Today where the user is, as `YYYY-MM-DD`. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
