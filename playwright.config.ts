import { defineConfig } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: ["--disable-gpu"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `PORT=${PORT} ALLOW_SEEDED_ROOMS=1 NODE_ENV=production npx tsx src/server/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
