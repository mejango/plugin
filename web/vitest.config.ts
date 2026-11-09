import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Physics simulation tests run 3 to 4 s alone and can exceed vitest's 5 s default under a full parallel run.
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 30_000 },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
