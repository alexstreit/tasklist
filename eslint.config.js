import tseslint from 'typescript-eslint';

// Outside core, analyze() is the only entry point (spec §3.2).
const analyzeOnly = {
  regex: '(^|/)core(/|$)',
  importNames: ['parsePlan', 'readTree'],
  message: 'Call analyze() from core; parsePlan and readTree are not entry points.',
};

// Outside core, nothing reads a plan with the rows parser directly (spec §3.2).
const noParseRows = {
  regex: '^rows$',
  importNames: ['parseRows'],
  message: 'Call analyze() from core instead of parsing with rows.',
};

// Only the text editor and the CodeMirror buffer may know about CodeMirror (spec §3.7).
const noCodeMirror = {
  group: ['@codemirror/*'],
  message: 'CodeMirror may only be imported from src/editor/ and src/buffer/CodeMirrorBuffer.ts.',
};

// Renderers and exporters read computed fields, never the rows document (spec §3.2).
const noRows = {
  regex: '^rows$',
  message: 'Renderers and exporters read computed model fields; Model.doc and rows are for editors only.',
};

// The app reaches the rows library only through its entry point (packages/rows/DESIGN.md §2).
const rowsEntryOnly = {
  regex: '^rows/|(^|/)packages/rows(/|$)',
  message: "Import the rows library as 'rows', its entry point.",
};

// The shell special-cases no plugin: it reaches plugins/ only through app/registry.ts (PLUGINS.md §8).
const noPlugins = {
  regex: '(^|/)plugins(/|$)',
  message: 'Only src/app/registry.ts may import from src/plugins/.',
};

// Views belong to no plugin and read only core fields (PLUGINS.md §8).
const viewsCoreOnly = {
  regex: '^(?!\\./|(\\.\\./)+core$)',
  message: 'src/views may only import core.',
};

// Analysis never reads the clock (PLUGINS.md §5): the same text gives the same model on any day.
const noClock = {
  files: ['src/core/**/*.ts', 'src/plugins/**/*.ts'],
  ignores: ['src/plugins/*/renderers/**', 'src/plugins/*/exporters/**'],
  languageOptions: { parser: tseslint.parser },
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Analysis never reads the clock.' },
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Analysis never reads the clock.' },
    ],
  },
};

const restrict = (files, patterns, ignores) => ({
  files,
  ...(ignores ? { ignores } : {}),
  languageOptions: { parser: tseslint.parser },
  rules: { 'no-restricted-imports': ['error', { patterns }] },
});

export default [
  // Enforces the core/ boundary (CLAUDE.md): src/core imports nothing outside itself but the rows library (spec §3.2).
  restrict(
    ['src/core/**/*.ts'],
    [
      {
        // Anything that is not a ./-relative import or `rows`, or that traverses upward.
        regex: '^(?!\\./|rows$)|\\.\\.',
        message: 'src/core may only import from within src/core, and the rows library.',
      },
    ],
  ),
  restrict(['src/app/**/*.ts'], [analyzeOnly, noParseRows, noCodeMirror, rowsEntryOnly, noPlugins], ['src/app/registry.ts']),
  restrict(['src/app/registry.ts', 'src/editing/**/*.ts', 'src/buffer/**/*.ts'], [analyzeOnly, noParseRows, noCodeMirror, rowsEntryOnly]),
  restrict(['src/plugins/**/*.ts'], [analyzeOnly, noCodeMirror, rowsEntryOnly], ['src/plugins/*/renderers/**', 'src/plugins/*/exporters/**']),
  restrict(['src/plugins/*/renderers/**/*.ts', 'src/plugins/*/exporters/**/*.ts'], [analyzeOnly, noCodeMirror, rowsEntryOnly, noRows]),
  restrict(['src/views/**/*.ts'], [analyzeOnly, noCodeMirror, rowsEntryOnly, noRows, viewsCoreOnly]),
  noClock,
  restrict(['src/editor/**/*.ts', 'src/buffer/CodeMirrorBuffer.ts'], [analyzeOnly, noParseRows, rowsEntryOnly]),
  restrict(['src/grid/**/*.ts'], [analyzeOnly, noParseRows, rowsEntryOnly]),
  restrict(['tests/**/*.ts'], [rowsEntryOnly]),
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
