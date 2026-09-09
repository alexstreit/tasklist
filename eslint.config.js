import tseslint from 'typescript-eslint';

// Enforces the core/ boundary (CLAUDE.md): src/core may import nothing outside itself.
export default [
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
];
