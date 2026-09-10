// Everything the app shell needs to mount a plan editor.

import { foldGutter, indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { lineNumbers } from '@codemirror/view';
import { planDiagnostics } from './diagnostics';
import { planFolding } from './folding';
import { planKeys } from './keymap';
import { plan } from './language';
import { convertTabsOnPaste } from './pasteTabs';

export { planLanguage, planHighlightStyle, planTags } from './language';
export { planKeymap, selectSubtree } from './keymap';
export { showDiagnostics, toLintDiagnostics } from './diagnostics';

export function planEditor(): Extension {
  return [
    plan(),
    planFolding,
    foldGutter(),
    lineNumbers(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    planKeys,
    convertTabsOnPaste,
    planDiagnostics,
  ];
}
