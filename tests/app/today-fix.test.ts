// @vitest-environment jsdom
// "Set project start to today" (spec §2.11): analysis leaves the date out, and each editor fills it
// in when it shows the fix, so the fix writes the date it showed, even after midnight.

import { forEachDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeMirrorBuffer, InMemoryBuffer } from '../../src/buffer';
import { analyze } from '../../src/app/registry';
import { mountTextEditor } from '../../src/editor';
import { mountGrid } from '../../src/grid';

const MISSING = '---\nprofile: schedule\n---\nA | 1d\n';
const INVALID = '---\nprofile: schedule\nproject-start: soon\n---\nA | 1d\n';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 29, 23, 59));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const midnight = () => vi.setSystemTime(new Date(2026, 8, 30, 0, 1));

describe('the text editor', () => {
  function open(text: string): { buffer: CodeMirrorBuffer; actions: () => Diagnostic[] } {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const buffer = new CodeMirrorBuffer(text);
    const editor = mountTextEditor(buffer, document.body, { onCursorLine: () => {}, onSave: () => {} });
    buffer.onChange(() => editor.update(analyze(buffer.text(), 'a.plan')));
    editor.update(analyze(buffer.text(), 'a.plan'));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    const actions = () => {
      const out: Diagnostic[] = [];
      forEachDiagnostic(view.state, (d) => out.push(d));
      return out;
    };
    return { buffer, actions };
  }

  it('writes a missing project-start as the date it showed', () => {
    const { buffer, actions } = open(MISSING);
    const d = actions().find((a) => a.actions?.length)!;
    expect(d.actions!.map((a) => a.name)).toEqual(['Set project start to today (2026-09-29)']);
    midnight();
    d.actions![0].apply(EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!, d.from, d.to);
    expect(buffer.text()).toBe('---\nprofile: schedule\nproject-start: 2026-09-29\n---\nA | 1d\n');
  });

  it('replaces a project-start that is not a date', () => {
    const { buffer, actions } = open(INVALID);
    const d = actions().find((a) => a.actions?.length)!;
    midnight();
    d.actions![0].apply(EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!, d.from, d.to);
    expect(buffer.text()).toBe('---\nprofile: schedule\nproject-start: 2026-09-29\n---\nA | 1d\n');
  });
});

describe('the grid', () => {
  function open(text: string): { buffer: InMemoryBuffer; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const buffer = new InMemoryBuffer(text);
    const grid = mountGrid(buffer, host, { onCursorLine: () => {} });
    buffer.onChange(() => grid.update(analyze(buffer.text(), 'a.plan')));
    grid.update(analyze(buffer.text(), 'a.plan'));
    return { buffer, host };
  }
  const label = 'Set project start to today (2026-09-29)';
  const buttons = (host: HTMLElement, where: string) => [...host.querySelectorAll<HTMLButtonElement>(`${where} button.fix`)].filter((b) => b.textContent === label);

  it('offers it in the settings banner and the problems list, and writes the date it showed', () => {
    const { buffer, host } = open(MISSING);
    expect(buttons(host, '.settings-banner')).toHaveLength(1);
    expect(buttons(host, '.problems')).toHaveLength(1);
    midnight();
    buttons(host, '.problems')[0].click();
    expect(buffer.text()).toBe('---\nprofile: schedule\nproject-start: 2026-09-29\n---\nA | 1d\n');
  });

  it('replaces a project-start that is not a date', () => {
    const { buffer, host } = open(INVALID);
    midnight();
    buttons(host, '.settings-banner')[0].click();
    expect(buffer.text()).toBe('---\nprofile: schedule\nproject-start: 2026-09-29\n---\nA | 1d\n');
  });
});
