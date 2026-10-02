// The portfolio fixture (examples/portfolio/, Task 35) as analyze receives it from the shell: the
// mounted files' texts by resolved path, and a resolve that works as the folder workspace's does.

import alpha from '../../examples/portfolio/teams/alpha.plan?raw';
import beta from '../../examples/portfolio/teams/beta.plan?raw';
import portfolio from '../../examples/portfolio/portfolio.plan?raw';

export { portfolio };

export const portfolioFiles = (): Map<string, string | null> =>
  new Map([
    ['teams/alpha.plan', alpha],
    ['teams/beta.plan', beta],
  ]);

/** Relative to the file it is in, `.` and `..` normalised; throws for a path outside the folder. */
export function resolve(from: string, ref: string): string {
  const out = from.split('/').slice(0, -1);
  for (const part of ref.split('/')) {
    if (part === '..') {
      if (out.length === 0) throw new Error(`${ref} from ${from} is outside the folder`);
      out.pop();
    } else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}
