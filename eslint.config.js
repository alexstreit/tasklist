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

// Only the text editor and the CodeMirror and composed buffers may know about CodeMirror (spec §3.7).
const noCodeMirror = {
  group: ['@codemirror/*'],
  message: 'CodeMirror may only be imported from src/editor/, src/buffer/CodeMirrorBuffer.ts and src/buffer/composed.ts.',
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

// Views belong to no plugin and read only core fields, drawn with the shared UI layer (PLUGINS.md §8).
const viewsCoreOnly = {
  regex: '^(?!\\./|(\\.\\./)+core$|(\\.\\./)+ui/)',
  message: 'src/views may only import core and src/ui.',
};

// The shared UI layer imports only core's types (PLUGINS.md §8), so any renderer can use it.
const uiRule = {
  files: ['src/ui/**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          { regex: '^(?!\\./)(?!(\\.\\./)+core$)', message: 'src/ui may only import core types.' },
          { regex: '^(\\.\\./)+core$', allowTypeImports: true, message: 'src/ui may only import core types.' },
        ],
      },
    ],
  },
};

// Analysis never reads the clock (PLUGINS.md §5): the same text gives the same model on any day.
const clockSyntax = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Analysis never reads the clock.' },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Analysis never reads the clock.' },
];

// Plugins and views read a row's cells through model.field (PLUGINS.md §4): a mounted row's own
// fields are in its own file's column order. `model.fields()`, the keys written, is a call.
const fieldsSyntax = [
  {
    selector: "MemberExpression[property.name='fields']:not(CallExpression > MemberExpression.callee)",
    message: "Read a row's cells with model.field(node, index); node.fields is in its own file's column order.",
  },
];

const syntax = (files, selectors, ignores) => ({
  files,
  ...(ignores ? { ignores } : {}),
  languageOptions: { parser: tseslint.parser },
  rules: { 'no-restricted-syntax': ['error', ...selectors] },
});
const stages = ['src/plugins/*/renderers/**', 'src/plugins/*/exporters/**'];
const noClock = [
  syntax(['src/core/**/*.ts'], clockSyntax),
  syntax(['src/plugins/**/*.ts'], [...clockSyntax, ...fieldsSyntax], stages),
  syntax([...stages.map((s) => `${s}/*.ts`), 'src/views/**/*.ts', 'src/ui/**/*.ts'], fieldsSyntax),
];

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
  uiRule,
  ...noClock,
  restrict(['src/editor/**/*.ts', 'src/buffer/CodeMirrorBuffer.ts', 'src/buffer/composed.ts'], [analyzeOnly, noParseRows, rowsEntryOnly]),
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
