import { defineConfig } from 'vitest/config';

// Vite's resolver can't follow `extends: "expo/tsconfig.base"`; tests don't need it.
export default defineConfig({
  oxc: { tsconfig: false },
  test: { include: ['src/**/*.test.ts'] },
});
