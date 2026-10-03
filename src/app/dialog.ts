// A question with labelled answers, shown in the page: the changed-on-disk and unsaved-changes
// prompts (spec §6). The last choice is always the one that changes nothing; Escape picks it, and it
// has the focus, so Enter never overwrites by accident.

export function ask(message: string, choices: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const text = document.createElement('p');
    text.id = 'dialog-message';
    text.textContent = message;
    box.setAttribute('aria-describedby', text.id);
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const choose = (choice: string): void => {
      backdrop.remove();
      returnFocus?.focus();
      resolve(choice);
    };
    const buttons = choices.map((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice;
      button.addEventListener('click', () => choose(choice));
      return button;
    });
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    row.append(...buttons);
    box.append(text, row);
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        choose(choices[choices.length - 1]);
      }
    });
    backdrop.append(box);
    document.body.append(backdrop);
    buttons[buttons.length - 1].focus();
  });
}

/** "alpha.plan", "alpha.plan and beta.plan", "alpha.plan, beta.plan and gamma.plan". */
export function names(list: readonly string[]): string {
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
