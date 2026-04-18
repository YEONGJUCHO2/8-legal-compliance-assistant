import { defineConfig, devices } from "@playwright/test";

const appBaseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const url = new URL(appBaseUrl);

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: appBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run dev -- --hostname ${url.hostname} --port ${url.port || "3000"}`,
    url: appBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"]
      }
    }
  ]
});
