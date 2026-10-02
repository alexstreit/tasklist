// The file panel (spec §6): the workspace's files, grouped by folder, with a marker for unsaved
// changes and for a change on disk. Clicking a file, or Enter on it, makes it active; the arrow keys
// move between files. The heading collapses the list.

export interface PanelEntry {
  path: string;
  active: boolean;
  dirty: boolean;
  stale: boolean;
  missing: boolean;
}

const MARKERS: [keyof PanelEntry, string, string][] = [
  ['dirty', '●', 'unsaved changes'],
  ['stale', '↻', 'changed on disk'],
  ['missing', '✕', 'missing on disk'],
];

export interface FilePanel {
  /** Draws the entries, in the order given; does nothing when they are as last drawn. */
  update(entries: readonly PanelEntry[]): void;
}

export function mountFilePanel(host: HTMLElement, onOpen: (path: string) => void): FilePanel {
  host.classList.add('file-panel');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'file-panel-toggle';
  toggle.textContent = 'Files';
  toggle.setAttribute('aria-expanded', 'true');
  const list = document.createElement('div');
  list.className = 'file-list';
  toggle.addEventListener('click', () => {
    const collapsed = host.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    list.hidden = collapsed;
  });
  host.replaceChildren(toggle, list);

  const items = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('button.file')];
  list.addEventListener('keydown', (event) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : null;
    if (next === null || at < 0) return;
    event.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, next))].focus();
  });

  let drawn = '';
  return {
    update(entries) {
      const key = JSON.stringify(entries);
      if (key === drawn) return;
      drawn = key;
      const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.path : undefined;
      const groups = new Map<string, PanelEntry[]>();
      for (const entry of entries) {
        const folder = entry.path.slice(0, entry.path.lastIndexOf('/') + 1);
        groups.set(folder, [...(groups.get(folder) ?? []), entry]);
      }
      // One tab stop: the active file, or the first when none is listed.
      const tabStop = entries.find((e) => e.active)?.path ?? entries[0]?.path;
      list.replaceChildren(
        ...[...groups].map(([folder, group]) => {
          const section = document.createElement('div');
          section.className = 'file-group';
          if (folder) {
            const heading = document.createElement('div');
            heading.className = 'file-folder';
            heading.textContent = folder;
            section.append(heading);
          }
          for (const entry of group) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file';
            button.dataset.path = entry.path;
            button.tabIndex = entry.path === tabStop ? 0 : -1;
            button.classList.toggle('active', entry.active);
            if (entry.active) button.setAttribute('aria-current', 'true');
            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = entry.path.slice(folder.length);
            button.append(name);
            const states: string[] = [];
            for (const [flag, mark, label] of MARKERS) {
              if (!entry[flag]) continue;
              const marker = document.createElement('span');
              marker.className = `file-marker ${flag}`;
              marker.textContent = mark;
              marker.title = label;
              button.append(marker);
              states.push(label);
            }
            button.setAttribute('aria-label', [entry.path, ...states].join(', '));
            button.addEventListener('click', () => onOpen(entry.path));
            section.append(button);
          }
          return section;
        }),
      );
      if (focused) items().find((b) => b.dataset.path === focused)?.focus();
    },
  };
}
