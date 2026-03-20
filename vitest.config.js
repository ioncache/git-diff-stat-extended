import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    exclude: ["scripts/**", "dist/**"],
    setupFiles: ["./test/setup.js"],
    coverage: {
      include: ["src/**/*.js"],
      exclude: ["scripts/**", "dist/**", "vitest.config.js", "**/*.d.ts"],
    },
  },
});
