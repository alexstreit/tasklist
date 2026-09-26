// Duration formatting. Spec §2.6. Values are read as hours by readPlan;
// formatting uses the MVP's fixed units: 1d = 8h, 1w = 5d.

/** Mixed units, largest first: 60 -> "1w 2d 4h". 0 -> "0h". */
export function formatDuration(hours: number): string {
  const total = round(hours);
  const w = Math.floor(total / 40);
  const afterWeeks = round(total - w * 40);
  const d = Math.floor(afterWeeks / 8);
  const h = round(afterWeeks - d * 8);
  const parts: string[] = [];
  if (w > 0) parts.push(`${w}w`);
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  return parts.length > 0 ? parts.join(' ') : '0h';
}

// Kill float noise from summing fractional hours (0.1 + 0.2).
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
