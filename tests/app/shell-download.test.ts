// @vitest-environment jsdom
// The shell in the download fallback (no File System Access API). A download writes nothing in
// place, so the unsaved indicator stays on; leaving the page prompts only when the buffer differs
// from what was last saved or downloaded.

import { EditorView } from '@codemirror/view';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let view: EditorView;
const downloads: string[] = [];

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const leave = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  document.body.innerHTML =
    '<button id="open"></button><button id="save"></button><button id="save-as"></button><nav id="editors"></nav><span id="filename"></span><span id="status"></span>' +
    '<div id="editor"></div><section id="preview"><nav id="renderers"></nav><nav id="exporters"></nav><div id="host"></div></section>';
  vi.useFakeTimers();
  await import('../../src/app/main');
  view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
});

describe('saving by download', () => {
  it('offers Download in place of Save and Save As', () => {
    expect(document.getElementById('save')!.textContent).toBe('Download');
    expect(document.getElementById('save-as')!.hidden).toBe(true);
  });

  // Task 34: no Save all or Refresh, as a download writes nothing in place to read back; Open
  // folder is disabled, with why, as in Firefox.
  it('offers neither Save all nor Refresh, and disables Open folder with a tooltip', () => {
    const shown = [...document.querySelectorAll<HTMLButtonElement>('body > button')].filter((b) => !b.hidden).map((b) => b.id);
    expect(shown).toEqual(['open', 'open-folder', 'save']);
    const openFolder = document.getElementById('open-folder') as HTMLButtonElement;
    expect(openFolder.disabled).toBe(true);
    expect(openFolder.title).toBe('Opening a folder needs Edge or Chrome');
  });

  it('keeps the unsaved indicator on after a download, and leaving does not prompt', async () => {
    view.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    expect(document.title).toBe('● Untitled — Plan');
    expect(leave()).toBe(true);
    document.getElementById('save')!.click();
    await flush();
    expect(downloads).toEqual(['untitled.plan']);
    expect(document.getElementById('status')!.textContent).toBe(
      'Downloaded untitled.plan. This browser cannot write files in place; open the downloaded copy to continue.',
    );
    expect(document.title).toBe('● Untitled — Plan');
    expect(leave()).toBe(false);
  });

  it('prompts on leaving once the buffer is edited after the download', () => {
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(leave()).toBe(true);
    view.dispatch({ changes: { from: 0, to: 1 } });
    expect(leave()).toBe(false);
  });
});
