// The templates the start screen offers (spec §6): the example files, bundled with the app so they
// work on GitHub Pages. A single-file template opens untitled; a folder template is written into a
// folder the user picks, keeping its relative paths.

import example from '../../examples/example.plan?raw';
import demo from '../../examples/demo.plan?raw';
import portfolio from '../../examples/portfolio/portfolio.plan?raw';
import alpha from '../../examples/portfolio/teams/alpha.plan?raw';
import beta from '../../examples/portfolio/teams/beta.plan?raw';

/** Written into a folder: each file's text by its path, and the file shown first. */
export interface FolderTemplate {
  label: string;
  description: string;
  files: Readonly<Record<string, string>>;
  show: string;
}

export type Template = { label: string; description: string; text: string } | FolderTemplate;

export const TEMPLATES: readonly Template[] = [
  { label: 'Estimate', description: 'A feature list whose estimates roll up.', text: example },
  { label: 'Schedule', description: 'A small project with dependencies, milestones and a deadline.', text: demo },
  {
    label: 'Portfolio',
    description: 'A master plan that mounts two team plans, written into a folder you pick.',
    files: { 'portfolio.plan': portfolio, 'teams/alpha.plan': alpha, 'teams/beta.plan': beta },
    show: 'portfolio.plan',
  },
];
