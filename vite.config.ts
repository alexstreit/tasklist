/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/tasklist/" : "/",
  test: {
    // `npm test` at the root runs the app and every workspace package.
    projects: [
      { extends: true, test: { name: "app", include: ["tests/**/*.test.ts"] } },
      "packages/rows",
    ],
  },
});
