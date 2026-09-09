import { defineConfig } from "vitest/config";

// Node-environment unit tests (the Python<->TS parity suite). No React plugin needed.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
