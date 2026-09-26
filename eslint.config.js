import tseslint from 'typescript-eslint';

// Outside core, analyze() is the only entry point (spec §3.2).
const analyzeOnly = {
  regex: '(^|/)core(/|$)',
  importNames: ['parse', 'compute'],
  message: 'Call analyze() from core; parse and compute are not entry points.',
};

// Only the text editor and the CodeMirror buffer may know about CodeMirror (spec §3.7).
const noCodeMirror = {
  group: ['@codemirror/*'],
  message: 'CodeMirror may only be imported from src/editor/ and src/buffer/CodeMirrorBuffer.ts.',
};

// The app reaches the rows library only through its entry point (packages/rows/DESIGN.md §2).
const rowsEntryOnly = {
  regex: '^rows/|(^|/)packages/rows(/|$)',
  message: "Import the rows library as 'rows', its entry point.",
};

const restrict = (files, patterns, ignores) => ({
  files,
  ...(ignores ? { ignores } : {}),
  languageOptions: { parser: tseslint.parser },
  rules: { 'no-restricted-imports': ['error', { patterns }] },
});

export default [
  // Enforces the core/ boundary (CLAUDE.md): src/core may import nothing outside itself.
  restrict(
    ['src/core/**/*.ts'],
    [
      {
        // Anything that is not a ./-relative import, or that traverses upward.
        regex: '^(?!\\./)|\\.\\.',
        message: 'src/core may only import from within src/core.',
      },
    ],
  ),
  restrict(['src/app/**/*.ts', 'src/renderers/**/*.ts', 'src/exporters/**/*.ts', 'src/editing/**/*.ts', 'src/buffer/**/*.ts'], [analyzeOnly, noCodeMirror, rowsEntryOnly]),
  restrict(['src/editor/**/*.ts', 'src/buffer/CodeMirrorBuffer.ts'], [analyzeOnly, rowsEntryOnly]),
  restrict(['src/grid/**/*.ts', 'tests/**/*.ts'], [rowsEntryOnly]),
  // packages/rows/src imports nothing outside itself: no app code, no packages, no Node APIs.
  restrict(
    ['packages/rows/src/**/*.ts'],
    [
      {
        regex: '^(?!\\./)|\\.\\.',
        message: 'packages/rows/src may only import from within packages/rows/src.',
      },
    ],
  ),
];
