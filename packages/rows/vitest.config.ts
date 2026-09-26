import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'rows',
    include: ['conformance/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
