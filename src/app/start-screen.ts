// The start screen (spec §6): the page the app opens on, and returns to after Close folder. Its
// choices, in order: Reopen the remembered folder, New plan…, Open folder… and Open file…, and the
// templates. Every choice is a button, so the keyboard reaches each in order.

import type { Template } from './templates';

export interface StartActions {
  reopen(): void;
  newPlan(): void;
  openFolder(): void;
  openFile(): void;
  template(template: Template): void;
}

export interface StartScreen {
  /** Shows or hides the page; shown, its first choice has the focus. */
  show(on: boolean): void;
  /** Reopen _name_ while a folder is remembered, else nothing. */
  setReopen(name: string | null): void;
}

/** `noFolder`: why this browser can't open a folder, for Open folder… and folder templates; null when it can. */
export function mountStartScreen(host: HTMLElement, templates: readonly Template[], noFolder: string | null, actions: StartActions): StartScreen {
  host.classList.add('start-screen');
  const choice = (label: string, onClick: () => void, description?: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-choice';
    const name = document.createElement('span');
    name.className = 'start-label';
    name.textContent = label;
    button.append(name);
    if (description) {
      const line = document.createElement('span');
      line.className = 'start-description';
      line.textContent = description;
      button.append(line);
    }
    button.addEventListener('click', onClick);
    return button;
  };
  const section = (title: string, ...buttons: HTMLButtonElement[]): HTMLElement => {
    const el = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    el.append(heading, ...buttons);
    return el;
  };

  const heading = document.createElement('h1');
  heading.textContent = 'Plan';
  const reopen = choice('Reopen', () => actions.reopen());
  reopen.hidden = true;
  const openFolder = choice('Open folder…', () => actions.openFolder());
  openFolder.disabled = noFolder !== null;
  openFolder.title = noFolder ?? '';
  const templateButtons = templates.map((t) => {
    const b = choice(t.label, () => actions.template(t), t.description);
    if ('files' in t && noFolder !== null) {
      b.disabled = true;
      b.title = noFolder;
    }
    return b;
  });
  host.replaceChildren(
    heading,
    section('Start', reopen, choice('New plan…', () => actions.newPlan()), openFolder, choice('Open file…', () => actions.openFile())),
    section('Templates', ...templateButtons),
  );

  return {
    show(on) {
      host.hidden = !on;
      if (on) host.querySelector<HTMLButtonElement>('button.start-choice:not([hidden]):not(:disabled)')?.focus();
    },
    setReopen(name) {
      reopen.hidden = name === null;
      reopen.querySelector('.start-label')!.textContent = `Reopen ${name ?? ''}`;
    },
  };
}
