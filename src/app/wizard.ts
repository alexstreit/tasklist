// The new plan wizard (spec §6): the type, then the name and location (in a folder only), then the
// project start (for a type that schedules). It says what to write and where; the shell writes it.
// Escape or Cancel closes it with nothing chosen.

export interface PlanType {
  name: string;
  label: string;
  description: string;
  /** Its files are scheduled from a project start, so the wizard asks for one. */
  needsStart: boolean;
}

export interface WizardOptions {
  types: readonly PlanType[];
  /** In a folder workspace: its folders to offer, the root ('') first, and whether a path is taken. Null elsewhere. */
  folder: { folders: readonly string[]; exists(path: string): boolean } | null;
  /** The item row the new plan can be mounted under: its title. Null when there is none. */
  mountUnder: string | null;
  /** Today, for the project start's default. */
  today: string;
}

/** `path` is set in a folder, relative to it; `mount` when the box was ticked. */
export interface NewPlan {
  text: string;
  path?: string;
  mount: boolean;
}

const DEFAULT_NAME = 'untitled.plan';

/** Why `name` can't be used in `folder`, or null when it can; `.plan` is added when missing. */
export function nameRefusal(name: string, folder: string, exists: (path: string) => boolean): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (trimmed.includes('/')) return "A name can't contain /.";
  const path = folder + withExtension(trimmed);
  if (exists(path)) return `${path} already exists.`;
  return null;
}

/**
 * The folder a typed location names, relative to the workspace's, with a trailing `/` (`''` for its
 * top level, typed as nothing or `.`), or why it can't be used. Folders that don't exist yet are fine:
 * creating the file makes them.
 */
export function locationOf(typed: string): { folder: string } | { refused: string } {
  if (typed.trim().startsWith('/')) return { refused: 'The location must be relative to the folder.' };
  const trimmed = typed.trim().replace(/\/$/, '');
  if (trimmed === '' || trimmed === '.') return { folder: '' };
  const parts = trimmed.split('/');
  if (parts.includes('')) return { refused: "The location can't have empty parts." };
  if (parts.includes('..')) return { refused: "The location can't go up a folder (..)." };
  return { folder: `${parts.join('/')}/` };
}

const withExtension = (name: string): string => (name.endsWith('.plan') ? name : `${name}.plan`);

/** The text a new plan of `type` starts as (spec §6). */
export function newPlanText(type: string, start?: string): string {
  return `---\nprofile: ${type}\n${start !== undefined ? `project-start: ${start}\n` : ''}---\n`;
}

export function newPlanWizard(options: WizardOptions): Promise<NewPlan | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const box = document.createElement('div');
    box.className = 'dialog wizard';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = document.createElement('h2');
    title.id = 'wizard-title';
    box.setAttribute('aria-labelledby', title.id);
    const body = document.createElement('div');
    body.className = 'wizard-step';
    const back = button('Back');
    const next = button('Next');
    const cancel = button('Cancel');
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    row.append(back, next, cancel);
    box.append(title, body, row);
    backdrop.append(box);
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // What has been chosen so far.
    let type = options.types[0];
    let name = DEFAULT_NAME;
    // The location as typed, and the folder it names once checked.
    let folder = '';
    let checked = '';
    let mount = false;
    let start = options.today;

    type Step = 'type' | 'name' | 'start';
    const steps = (): Step[] => ['type', ...(options.folder ? (['name'] as const) : []), ...(type.needsStart ? (['start'] as const) : [])];
    let step: Step = 'type';
    // The step's check, run before moving on: false keeps the wizard on it.
    let check: () => boolean = () => true;

    const finish = (result: NewPlan | null): void => {
      backdrop.remove();
      returnFocus?.focus();
      resolve(result);
    };

    const note = (): HTMLElement => {
      const el = document.createElement('span');
      el.className = 'wizard-note';
      el.setAttribute('role', 'status');
      return el;
    };

    function show(to: Step): void {
      step = to;
      const all = steps();
      const at = all.indexOf(step);
      back.hidden = at === 0;
      next.textContent = at === all.length - 1 ? 'Create' : 'Next';
      check = () => true;
      let focus: HTMLElement;
      if (step === 'type') {
        title.textContent = `New plan · Type (step ${at + 1} of ${all.length})`;
        const group = document.createElement('div');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', 'Type');
        for (const t of options.types) {
          const label = document.createElement('label');
          label.className = 'wizard-choice';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'wizard-type';
          radio.value = t.name;
          radio.checked = t === type;
          radio.addEventListener('change', () => {
            type = t;
            show('type');
          });
          const text = document.createElement('span');
          const strong = document.createElement('strong');
          strong.textContent = t.label;
          const description = document.createElement('span');
          description.className = 'wizard-description';
          description.textContent = t.description;
          text.append(strong, description);
          label.append(radio, text);
          group.append(label);
        }
        body.replaceChildren(group);
        focus = group.querySelector<HTMLInputElement>('input:checked')!;
      } else if (step === 'name') {
        title.textContent = `New plan · Name and location (step ${at + 1} of ${all.length})`;
        const folderSpec = options.folder!;
        const nameInput = document.createElement('input');
        nameInput.id = 'wizard-name';
        nameInput.value = name;
        const nameNote = note();
        nameInput.addEventListener('input', () => {
          name = nameInput.value;
          nameNote.textContent = '';
        });
        // A combobox: the folders are offered, and any folder can be typed.
        const where = document.createElement('input');
        where.id = 'wizard-location';
        where.value = folder;
        where.placeholder = "The folder's top level";
        const list = document.createElement('datalist');
        list.id = 'wizard-folders';
        where.setAttribute('list', list.id);
        for (const f of folderSpec.folders) {
          const option = document.createElement('option');
          option.value = f === '' ? '.' : f;
          if (f === '') option.label = "The folder's top level";
          list.append(option);
        }
        const whereNote = note();
        where.addEventListener('input', () => {
          folder = where.value;
          whereNote.textContent = nameNote.textContent = '';
        });
        const fields = [field('Name', nameInput, nameNote), field('Location', where, whereNote), list];
        if (options.mountUnder !== null) {
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.id = 'wizard-mount';
          box.checked = mount;
          box.addEventListener('change', () => (mount = box.checked));
          const label = document.createElement('label');
          label.className = 'wizard-mount';
          label.append(box, ` Mount it under ${options.mountUnder}`);
          fields.push(label);
        }
        body.replaceChildren(...fields);
        check = () => {
          const at = locationOf(folder);
          whereNote.textContent = 'refused' in at ? at.refused : '';
          if ('refused' in at) {
            where.focus();
            return false;
          }
          checked = at.folder;
          const why = nameRefusal(name, at.folder, folderSpec.exists);
          nameNote.textContent = why ?? '';
          if (why !== null) nameInput.focus();
          return why === null;
        };
        focus = nameInput;
      } else {
        title.textContent = `New plan · Project start (step ${at + 1} of ${all.length})`;
        const date = document.createElement('input');
        date.type = 'date';
        date.id = 'wizard-start';
        date.value = start;
        const dateNote = note();
        date.addEventListener('input', () => {
          start = date.value;
          dateNote.textContent = '';
        });
        body.replaceChildren(field('Project start', date, dateNote));
        check = () => {
          const ok = /^\d{4}-\d{2}-\d{2}$/.test(start);
          dateNote.textContent = ok ? '' : 'Enter a date.';
          return ok;
        };
        focus = date;
      }
      focus.focus();
    }

    back.addEventListener('click', () => {
      const all = steps();
      show(all[all.indexOf(step) - 1]);
    });
    next.addEventListener('click', () => {
      if (!check()) return;
      const all = steps();
      const at = all.indexOf(step);
      if (at < all.length - 1) return show(all[at + 1]);
      finish({
        text: newPlanText(type.name, type.needsStart ? start : undefined),
        ...(options.folder ? { path: checked + withExtension(name.trim()) } : {}),
        mount: options.folder !== null && options.mountUnder !== null && mount,
      });
    });
    cancel.addEventListener('click', () => finish(null));
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') {
        event.preventDefault();
        next.click();
      }
    });

    document.body.append(backdrop);
    show('type');
  });
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  return b;
}

/** A labelled field, with its note beside it. */
function field(label: string, input: HTMLElement, note?: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wizard-field';
  const l = document.createElement('label');
  l.textContent = label;
  l.htmlFor = input.id;
  row.append(l, input);
  if (note) row.append(note);
  return row;
}
