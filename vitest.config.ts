import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      forks: { execArgv: ["--experimental-sqlite"] },
      threads: { execArgv: ["--experimental-sqlite"] },
    },
  },
});
