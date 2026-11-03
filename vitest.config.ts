import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "agent/**/*.test.ts", "packages/*/src/**/*.test.ts", "evals/**/*.test.ts", "tools/*/src/**/*.test.ts", "apps/web/features/**/*.test.ts"],
  },
});
