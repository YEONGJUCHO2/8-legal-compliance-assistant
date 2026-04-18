import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcPath
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"]
  }
});
