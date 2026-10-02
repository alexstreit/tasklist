// The grid's problems list (spec §4b.6.3), settings banner (§4b.6.6) and
// fix previews (§4b.6.1). The grid supplies the model, what is on each line,
// and its one write path; this module builds the panels and runs the fixes.

import type { EditResult } from 'rows';
import { inputEdit, preview, resolveFix } from '../core';
import { today } from '../ui/today';
import type { Diagnostic, Fix, Model, Span } from '../core';

export interface ProblemsHooks {
  /** Make an edit through the grid's write path, which shows beside `host` why one was refused. */
  write(host: HTMLElement, make: (model: Model) => EditResult): void;
  /** The title of the item on a line, or null when the line has no titled item. */
  titleOf(line: number): string | null;
  /** Focus the row a diagnostic is on, or the cell its span falls in; nothing when the line has no row. */
  focus(diagnostic: Diagnostic): void;
  /** Make a mounted file the active file, at `line`: one of its problems was clicked. */
  open(path: string, line: number): void;
}

export interface Problems {
  /** Shown above the grid when the settings have problems. */
  banner: HTMLElement;
  /** Collapsed by default; its summary carries the count. */
  list: HTMLDetailsElement;
  /** Rebuild both from a model. `settings` is the front matter's span, or null without one. */
  update(model: Model, settings: Span | null): void;
  /** Apply a fix as the list does: a confirm fix shows its preview and warning in `host` first; `onCancel` runs when it is cancelled. */
  run(host: HTMLElement, fix: Fix, onCancel?: () => void): void;
}

function part(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function mountProblems(hooks: ProblemsHooks): Problems {
  // Settings problems affect every row, so they show above the grid as well (spec §4b.6.6).
  const banner = document.createElement('div');
  banner.className = 'settings-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Settings problems');
  // The problems list (spec §4b.6.3): its count shows even when it is collapsed.
  const list = document.createElement('details');
  list.className = 'problems';
  const count = document.createElement('summary');
  const entries = document.createElement('ol');
  list.append(count, entries);

  let model: Model | null = null;
  /** Today, as of the last update: a fix that suggests it writes the date its button showed. */
  let day = '';
  const fixesOf = (d: Diagnostic) => (d.fixes ?? []).map((fix) => resolveFix(fix, day));

  /**
   * Apply a fix; a confirm fix shows its exact change first, with its warning,
   * and cancelling writes nothing (spec §4b.6.1). A fix that takes a typed
   * value (a column's new name) shows it in an input, and the preview follows it.
   */
  function runFix(host: HTMLElement, offered: Fix, onCancel?: () => void): void {
    const fix = resolveFix(offered, day);
    if (fix.tier !== 'confirm') {
      hooks.write(host, () => ({ edits: fix.edits }));
      return;
    }
    host.querySelector('.fix-preview')?.remove();
    const box = document.createElement('div');
    box.className = 'fix-preview';
    const pre = document.createElement('pre');
    pre.textContent = fix.preview ?? '';
    let edits = fix.edits;
    const ok = button('fix', 'Apply', () => hooks.write(host, () => ({ edits })));
    if (fix.warning) box.append(part('fix-warning', fix.warning));
    let first: HTMLElement = ok;
    if (fix.input) {
      const typed = fix.input;
      const text = model?.doc.text ?? '';
      const input = document.createElement('input');
      input.className = 'fix-input';
      input.value = fix.input.value;
      input.setAttribute('aria-label', 'New name');
      input.addEventListener('input', () => {
        const value = input.value.trim();
        edits = [inputEdit(typed, value)];
        pre.textContent = preview(text, edits);
        ok.disabled = value === '';
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !ok.disabled) ok.click();
      });
      box.append(input);
      first = input;
    }
    box.append(pre, ok, button('fix', 'Cancel', () => (box.remove(), onCancel?.())));
    host.append(box);
    first.focus();
  }

  /** The title of the item on a mounted file's line, or null. */
  function mountedTitle(file: string, line: number): string | null {
    const node = model?.files.get(file)?.lines[line - 1];
    return node?.kind === 'item' && node.title !== '' ? node.title : null;
  }

  /**
   * A mounted file's problem names its file and offers no fixes: their edits are for that file's
   * text, so clicking it opens the file at the row, where they are offered.
   */
  function problem(diagnostic: Diagnostic): HTMLLIElement {
    const li = document.createElement('li');
    li.className = diagnostic.severity;
    li.dataset.line = String(diagnostic.line);
    const { file, line } = diagnostic;
    if (file !== undefined) li.dataset.file = file;
    const where = (file === undefined ? hooks.titleOf(line) : mountedTitle(file, line)) ?? `Line ${line}`;
    const go = button('problem', '', () => (file === undefined ? hooks.focus(diagnostic) : hooks.open(file, line)));
    go.append(part('severity', diagnostic.severity), part('where', where), part('message', diagnostic.message));
    li.append(go);
    if (file === undefined) li.append(...fixesOf(diagnostic).map((fix) => button('fix', fix.label, () => runFix(li, fix))));
    return li;
  }

  /**
   * Every diagnostic, each with its row and its fixes (spec §4b.6.3): the root file's first, then
   * each mounted file's in composed order, in document order within each. When more than one file
   * has problems, each group is headed by its file's path.
   */
  function renderList(): void {
    const byPlace = (a: Diagnostic, b: Diagnostic) => a.line - b.line || (a.span?.from ?? -1) - (b.span?.from ?? -1);
    const all = model?.diagnostics ?? [];
    const groups = [...(model?.files.keys() ?? [''])]
      .map((path, i) => ({ path, list: all.filter((d) => (i === 0 ? d.file === undefined : d.file === path)).sort(byPlace) }))
      .filter((group) => group.list.length > 0);
    count.textContent = `Problems (${all.length})`;
    entries.replaceChildren(
      ...groups.flatMap(({ path, list }) => {
        const items: HTMLLIElement[] = list.map(problem);
        if (groups.length === 1) return items;
        const heading = document.createElement('li');
        heading.className = 'problem-file';
        heading.textContent = path || 'Untitled';
        return [heading, ...items];
      }),
    );
  }

  /**
   * The settings banner (spec §4b.6.6): every diagnostic in the front matter,
   * the unclosed one included, and each fix to the settings that diagnostics
   * on rows share, such as the conversion fix, once with how many rows it
   * would help.
   */
  function renderBanner(settings: Span | null): void {
    // The active file's settings only: a mounted file's are in the problems list.
    const diagnostics = (model?.diagnostics ?? []).filter((d) => d.file === undefined).sort((a, b) => a.line - b.line);
    const inSettings = (d: Diagnostic) => model?.lines[d.line - 1]?.kind === 'front-matter';
    const settingsEdit = (d: Diagnostic) => settings !== null && d.fixes?.some((f) => f.edits.every((e) => e.from >= settings.from && e.to <= settings.to));
    const shared = new Map<string, Diagnostic[]>();
    const items: { diagnostic: Diagnostic; more: number }[] = [];
    for (const d of diagnostics) {
      if (inSettings(d)) items.push({ diagnostic: d, more: 0 });
      else if (settingsEdit(d)) {
        const key = JSON.stringify(d.fixes!.map((f) => f.edits));
        if (!shared.has(key)) items.push({ diagnostic: d, more: 0 });
        shared.set(key, [...(shared.get(key) ?? []), d]);
      }
    }
    for (const item of items) {
      const group = shared.get(JSON.stringify(item.diagnostic.fixes?.map((f) => f.edits)));
      if (group && !inSettings(item.diagnostic)) item.more = group.length - 1;
    }
    banner.hidden = items.length === 0;
    banner.replaceChildren(
      ...items.map(({ diagnostic, more }) => {
        const item = document.createElement('div');
        item.className = `banner-item ${diagnostic.severity}`;
        const message = more > 0 ? `${diagnostic.message} (and ${more} more like it)` : diagnostic.message;
        item.append(part('severity', diagnostic.severity), part('message', message));
        item.append(...fixesOf(diagnostic).map((fix) => button('fix', fix.label, () => runFix(item, fix))));
        return item;
      }),
    );
  }

  return {
    banner,
    list,
    update(next, settings) {
      model = next;
      day = today();
      renderBanner(settings);
      renderList();
    },
    run: runFix,
  };
}
