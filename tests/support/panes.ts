// A small shell for the row alignment tests: an editor leading the stub follower over one buffer,
// connected as src/app/main.ts connects them. Analysis is by hand, standing in for the shell's
// debounce, and `analyze` and `render` are separate steps, as the shell's are.

import { connectPanes, followerChannel } from '../../src/app/align';
import { analyze as analyzeText } from '../../src/app/registry';
import { CodeMirrorBuffer } from '../../src/buffer';
import type { Model } from '../../src/core';
import { mountTextEditor } from '../../src/editor';
import { mountGrid } from '../../src/grid';
import { stubFollower } from './stub-follower';
import type { StubFollower } from './stub-follower';

export interface Panes {
  pane: HTMLElement;
  buffer: CodeMirrorBuffer;
  editor: ReturnType<typeof mountTextEditor> | ReturnType<typeof mountGrid>;
  stub: StubFollower;
  /** Analyze the buffer and hand the model to the editor, which republishes its layout. */
  analyze(): Model;
  /** Hand a model to the stub, as the shell renders the active view. */
  render(model: Model): void;
  /** Both, as one shell render. */
  step(): Model;
  destroy(): void;
}

export interface PanesOptions {
  /** Install injected measurements for the pane before the editor mounts; returns the restore function. */
  measure?: (pane: HTMLElement) => () => void;
  /** The stub's own header height. */
  header?: number;
}

export function leading(kind: 'text' | 'grid', text: string, { measure, header }: PanesOptions = {}): Panes {
  const pane = document.createElement('div');
  document.body.append(pane);
  const restore = measure?.(pane);
  const buffer = new CodeMirrorBuffer(text);
  const hooks = { onCursorLine: () => {}, onSave: () => {} };
  const editor = kind === 'text' ? mountTextEditor(buffer, pane, hooks) : mountGrid(buffer, pane, hooks);
  const stub = stubFollower({ header });
  const channel = followerChannel();
  const host = document.createElement('div');
  const disconnect = connectPanes({ leads: editor }, { follows: channel.follower });
  const ctx = { cursorLine: null, cursorItem: null, scrollToCursor: false, setCursorLine: () => {}, ...channel.context };

  const panes: Panes = {
    pane,
    buffer,
    editor,
    stub,
    analyze() {
      const model = analyzeText(buffer.text(), { filename: 'a.plan', version: buffer.version() });
      editor.update(model);
      return model;
    },
    render: (model) => stub.renderer.render(model, host, ctx),
    step() {
      const model = panes.analyze();
      panes.render(model);
      return model;
    },
    destroy() {
      disconnect();
      editor.destroy();
      restore?.();
      pane.remove();
    },
  };
  return panes;
}

/** Let CodeMirror run its measure cycle. */
export async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}
