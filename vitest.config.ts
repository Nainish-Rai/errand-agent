import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The web app's own import alias, for its component tests.
    alias: { "@/": fileURLToPath(new URL("./apps/web/", import.meta.url)) },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "agent/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "evals/**/*.test.ts",
      "tools/*/src/**/*.test.ts",
      "apps/web/features/**/*.test.{ts,tsx}",
    ],
  },
});
