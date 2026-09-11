import tseslint from 'typescript-eslint';

export default [
  // Enforces the core/ boundary (CLAUDE.md): src/core may import nothing outside itself.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Anything that is not a ./-relative import, or that traverses upward.
              regex: '^(?!\\./)|\\.\\.',
              message: 'src/core may only import from within src/core.',
            },
          ],
        },
      ],
    },
  },
  // Outside core, analyze() is the only entry point (spec §3.2).
  {
    files: ['src/app/**/*.ts', 'src/editor/**/*.ts', 'src/renderers/**/*.ts', 'src/exporters/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)core(/|$)',
              importNames: ['parse', 'compute'],
              message: 'Call analyze() from core; parse and compute are not entry points.',
            },
          ],
        },
      ],
    },
  },
];
